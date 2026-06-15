#!/usr/bin/env node
/**
 * Budget tracking for the Stagecraft pipeline.
 *
 * Usage:
 *   npm run budget -- init
 *   npm run budget -- update <stageName> <tokens> <elapsedMinutes>
 *   npm run budget -- check
 *
 * When budget.enabled is false in .devteam/config.yml, all subcommands are no-ops.
 * Out-of-band tool — not yet auto-invoked by the orchestrator. Callers feed it
 * token / elapsed numbers from their own telemetry (e.g. OTel spans).
 */

const fs = require("node:fs");
const path = require("node:path");

// Resolve ROOT lazily so exported functions remain callable from tests that
// chdir() after require(). For the CLI entry path, process.cwd() doesn't
// change between init and exit, so behavior is unchanged.
function root() {
  return process.cwd();
}

function readConfig() {
  const configPath = path.join(root(), ".devteam", "config.yml");
  if (!fs.existsSync(configPath)) return {};
  const text = fs.readFileSync(configPath, "utf8");

  const enabled = /budget:\s*\n(?:[^\n]*\n)*?\s+enabled:\s*(true|false)/.exec(text);
  const tokensMax = /tokens_max:\s*(\d+)/.exec(text);
  const wallMax = /wall_clock_max_minutes:\s*(\d+)/.exec(text);
  const onExceed = /on_exceed:\s*(\S+)/.exec(text);

  return {
    enabled: enabled ? enabled[1] === "true" : false,
    tokensMax: tokensMax ? Number(tokensMax[1]) : 500000,
    wallMax: wallMax ? Number(wallMax[1]) : 90,
    onExceed: onExceed ? onExceed[1] : "escalate",
  };
}

function budgetPath() {
  return path.join(root(), "pipeline", "budget.md");
}

function gatesDir() {
  return path.join(root(), "pipeline", "gates");
}

function parseBudgetMd(text) {
  const startedMatch = /^Started:\s*(.+)$/m.exec(text);
  const started = startedMatch ? startedMatch[1].trim() : null;
  const intentMatch = /^Intent:\s*(.+)$/m.exec(text);
  const intent = intentMatch ? intentMatch[1].trim() : null;

  const rows = [];
  const tableBody = text.split("---")[1] || text;
  for (const line of tableBody.split("\n")) {
    const m = /^\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|\s*([\d.]+)\s*\|$/.exec(line);
    if (m) {
      rows.push({
        stage: m[1].trim(),
        tokens: Number(m[2]),
        elapsed: parseFloat(m[3]),
      });
    }
  }

  return { started, intent, rows };
}

function buildBudgetMd(started, config, rows, intent) {
  const intentLine = intent ? `Intent: ${intent}` : null;
  const header = [
    "# Budget",
    "",
    `Started: ${started}`,
    ...(intentLine ? [intentLine] : []),
    `Tokens max: ${config.tokensMax}`,
    `Wall-clock max: ${config.wallMax} min`,
    "",
    "## Running totals",
    "",
    "| Stage | Tokens | Elapsed (min) |",
    "|-------|--------|---------------|",
  ];

  const rowLines = rows.map(
    (r) => `| ${r.stage.padEnd(12)} | ${String(r.tokens).padStart(6)} | ${r.elapsed.toFixed(1).padStart(13)} |`,
  );

  const totalTokens = rows.reduce((s, r) => s + r.tokens, 0);
  const totalElapsed = rows.length > 0 ? rows[rows.length - 1].elapsed : 0;

  const footer = [
    "",
    "---",
    "",
    `Total tokens used: ${totalTokens}`,
    `Total elapsed: ${totalElapsed.toFixed(1)} min`,
  ];

  return [...header, ...rowLines, ...footer].join("\n") + "\n";
}

// intent: "repair" | "feature" | null (ADR-009 §Decision.7 — advisory only).
// Written as an optional "Intent:" line so sliced cost tracking is possible
// across repair vs feature runs without restructuring the existing table format.
function cmdInit(intent) {
  const config = readConfig();
  if (!config.enabled) {
    console.log("Budget tracking disabled (budget.enabled: false). No-op.");
    return 0;
  }

  const bp = budgetPath();
  if (fs.existsSync(bp)) {
    console.log("exists pipeline/budget.md");
    return 0;
  }

  fs.mkdirSync(path.dirname(bp), { recursive: true });
  const started = new Date().toISOString();
  const content = buildBudgetMd(started, config, [], intent || null);
  fs.writeFileSync(bp, content);
  console.log("created pipeline/budget.md");
  return 0;
}

function cmdUpdate(stageName, tokens, elapsed) {
  const config = readConfig();
  if (!config.enabled) {
    console.log("Budget tracking disabled. No-op.");
    return 0;
  }

  if (!stageName) {
    console.error("Usage: budget update <stageName> <tokens> <elapsedMinutes>");
    return 1;
  }

  const tokensNum = Number(tokens) || 0;
  const elapsedNum = parseFloat(elapsed) || 0;

  const bp = budgetPath();
  if (!fs.existsSync(bp)) {
    // Auto-init if budget.md is missing
    cmdInit();
  }

  const text = fs.readFileSync(bp, "utf8");
  const { started, intent, rows } = parseBudgetMd(text);

  // Remove existing row for this stage if present, then append
  const filtered = rows.filter((r) => r.stage !== stageName);
  filtered.push({ stage: stageName, tokens: tokensNum, elapsed: elapsedNum });

  const updated = buildBudgetMd(started || new Date().toISOString(), config, filtered, intent);
  fs.writeFileSync(bp, updated);
  console.log(`updated pipeline/budget.md: ${stageName} tokens=${tokensNum} elapsed=${elapsedNum}min`);
  return 0;
}

function cmdCheck() {
  const config = readConfig();
  if (!config.enabled) {
    console.log("Budget tracking disabled. No-op.");
    return 0;
  }

  const bp = budgetPath();
  if (!fs.existsSync(bp)) {
    console.log("No pipeline/budget.md found — run: npm run budget -- init");
    return 0;
  }

  const text = fs.readFileSync(bp, "utf8");
  const { rows } = parseBudgetMd(text);

  const totalTokens = rows.reduce((s, r) => s + r.tokens, 0);
  const totalElapsed = rows.length > 0 ? rows[rows.length - 1].elapsed : 0;

  const tokensBreach = totalTokens > config.tokensMax;
  const wallBreach = totalElapsed > config.wallMax;

  if (!tokensBreach && !wallBreach) {
    console.log(`Budget OK: tokens=${totalTokens}/${config.tokensMax} elapsed=${totalElapsed.toFixed(1)}/${config.wallMax}min`);
    return 0;
  }

  const reason = tokensBreach
    ? `tokens (${totalTokens} > ${config.tokensMax})`
    : `wall-clock (${totalElapsed.toFixed(1)}min > ${config.wallMax}min)`;

  if (config.onExceed === "warn") {
    console.warn(`BUDGET WARNING: Exceeded ${reason}`);
    return 0;
  }

  // escalate
  const orchestratorId = `devteam@${require("../package.json").version}`;
  const gate = {
    stage: "stage-budget",
    status: "ESCALATE",
    orchestrator: orchestratorId,
    track: "full",
    timestamp: new Date().toISOString(),
    escalation_reason: `Budget exceeded — ${reason}`,
    decision_needed: "Continue (override budget), or halt and inspect?",
    tokens_used: totalTokens,
    tokens_max: config.tokensMax,
    wall_clock_elapsed: totalElapsed,
    wall_clock_max: config.wallMax,
    blockers: [`Budget ceiling reached: ${reason}`],
    warnings: [],
  };

  const gatesPath = gatesDir();
  fs.mkdirSync(gatesPath, { recursive: true });
  const gatePath = path.join(gatesPath, "stage-budget.json");
  fs.writeFileSync(gatePath, `${JSON.stringify(gate, null, 2)}\n`);
  console.error(`BUDGET ESCALATE: ${reason}`);
  console.error(`Written: pipeline/gates/stage-budget.json`);
  return 3;
}

function main() {
  const subcommand = process.argv[2];

  if (subcommand === "init") {
    // Optional --intent repair|feature flag (ADR-009 §Decision.7 — advisory only).
    const intentIdx = process.argv.indexOf("--intent");
    const intent = intentIdx !== -1 ? process.argv[intentIdx + 1] : null;
    return cmdInit(intent);
  }
  if (subcommand === "update") return cmdUpdate(process.argv[3], process.argv[4], process.argv[5]);
  if (subcommand === "check") return cmdCheck();

  console.error("Usage: budget <init|update|check>");
  console.error("  init [--intent repair|feature]    — create pipeline/budget.md");
  console.error("  update <stage> <tokens> <elapsed> — append a stage row");
  console.error("  check                             — compare totals to maxima");
  return 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { cmdInit, cmdUpdate, cmdCheck, readConfig, parseBudgetMd };
