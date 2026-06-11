"use strict";

const path = require("node:path");
const { generateHelp } = require(path.join(__dirname, "..", "flags"));

// Version of the `devteam run --json` summary schema. Bump on breaking changes.
const RUN_SCHEMA_VERSION = "1.0";

const name = "run";

const flags = {
  cwd:               { type: "string",  description: "Target project directory" },
  feature:           { type: "string",  description: "Feature description" },
  track:             { type: "string",  description: "Override the pipeline track" },
  until:             { type: "string",  description: "Stop before this stage" },
  "max-iterations":  { type: "number",  description: "Iteration cap" },
  "budget-usd":      { type: "number",  description: "Cost cap in USD" },
  "timeout-ms":      { type: "number",  description: "Per-dispatch timeout (ms)" },
  "retry-delay-ms":  { type: "number",  description: "Backoff delay between transient retries (ms)" },
  "auto-rule":       { type: "list", split: true, description: "Auto-apply Principal rulings of these classes (comma-separated)" },
  "allow-stage":     { type: "list",    description: "Grant consequence-ceiling approval for this stage (repeatable)" },
  resume:            { type: "boolean", description: "Resume an interrupted run" },
  force:             { type: "boolean", description: "Force-unlock a stale run.lock" },
  json:              { type: "boolean", description: "JSON summary on stdout" },
  help:              { type: "boolean", description: "Show this help" },
};

// `devteam run` — bounded autonomous driver (ADR-003 / H2 Phase 1 PR-A).
// Advances the pipeline unattended on the happy path; halts cleanly at the
// first thing needing a human (a FAIL, an escalation, the consequence ceiling,
// a budget cap, or a dispatch that wrote no gate). It does NOT auto-fix or
// auto-rule yet — that is PR-B / Phase 2.
function run(positional, _flags) {
  if (_flags.help) { console.log(generateHelp("devteam run [options]", flags)); process.exit(0); }
  const cwd = _flags.cwd || process.cwd();
  const { run: runDriver } = require(path.join(__dirname, "..", "..", "driver"));
  const jsonMode = Boolean(_flags.json);

  const onEvent = (ev) => {
    if (jsonMode) return; // keep stdout clean for the JSON summary
    const tag = ev.failure_class ? `  [${ev.failure_class}]` : "";
    switch (ev.type) {
      case "dispatch":     process.stderr.write(`▶️  ${ev.name} (${ev.stage}) — dispatching…\n`); break;
      case "dispatched":   process.stderr.write(`   ✓ ${ev.name} dispatched (${ev.duration_ms} ms${ev.timed_out ? ", TIMED OUT" : ""})\n`); break;
      case "merge":        process.stderr.write(`🔀 merge ${ev.name}\n`); break;
      case "complete":     process.stderr.write(`🎉 pipeline-complete\n`); break;
      case "halt":         process.stderr.write(`⏸  halt — ${ev.action}${tag}: ${ev.reason}\n`); break;
      case "ceiling":      process.stderr.write(`🛑 consequence ceiling — "${ev.name}" needs a human grant (re-run with --allow-stage ${ev.name})\n`); break;
      case "budget":       process.stderr.write(`💰 budget cap reached — halting before "${ev.name}"\n`); break;
      case "until":        process.stderr.write(`⏹  reached --until boundary\n`); break;
      case "auto-rule-dispatch": process.stderr.write(`⚖  ${ev.name} — escalation; dispatching Principal for a ruling…\n`); break;
      case "auto-ruled":   process.stderr.write(`⚖  ${ev.name} — auto-ruled [class: ${ev.grant_class}] under ${ev.authority}: ${ev.ruling}\n`); break;
      case "cannot-decide": process.stderr.write(`✋ ${ev.name} — Principal cannot decide (${ev.reason_class}); halting: ${ev.question}\n`); break;
      case "fix-retry":    process.stderr.write(`🔧 ${ev.name} — auto-fix attempt ${ev.attempt} (cleared ${ev.cleared_gates} gate(s), blockers → context.md)\n`); break;
      case "transient-retry": process.stderr.write(`↻  ${ev.name} — transient dispatch failure; retrying after ${ev.delay_ms} ms (attempt ${ev.attempt})\n`); break;
      case "structural":   process.stderr.write(`⚠  "${ev.name}" dispatched but wrote no gate and isn't transient — halting (structural-input)\n`); break;
      case "merge-failed": process.stderr.write(`❌ merge failed for "${ev.name}": ${ev.reason}\n`); break;
      default: break;
    }
  };

  runDriver({
    cwd,
    feature: _flags.feature || "",
    track: _flags.track,
    until: _flags.until,
    maxIterations: Number.isFinite(_flags.maxIterations) ? _flags.maxIterations : undefined,
    budgetUsd: Number.isFinite(_flags.budgetUsd) ? _flags.budgetUsd : undefined,
    timeoutMs: Number.isFinite(_flags.timeoutMs) ? _flags.timeoutMs : undefined,
    retryDelayMs: Number.isFinite(_flags.retryDelayMs) ? _flags.retryDelayMs : undefined,
    autoRule: _flags.autoRule || [],
    allowStages: _flags.allowStage || [],
    resume: Boolean(_flags.resume),
    force: Boolean(_flags.force),
    onEvent,
  }).then((summary) => {
    if (jsonMode) {
      console.log(JSON.stringify({ schema_version: RUN_SCHEMA_VERSION, ...summary }, null, 2));
    } else {
      const status = summary.completed ? "complete" : `halted (${summary.halt_action})`;
      process.stderr.write(
        `\n[devteam run] ${status} — ${summary.iterations} iteration(s), ` +
        `$${summary.cost_usd.toFixed(2)} spent, ${summary.stages_advanced.length} stage(s) advanced\n`,
      );
      if (summary.halted && summary.halt_reason) process.stderr.write(`  reason: ${summary.halt_reason}\n`);
      if (summary.halt_action === "fix-and-retry" || summary.halt_action === "resolve-escalation") {
        process.stderr.write(`  → run \`devteam next\` for the fix steps / escalation details\n`);
      }
    }
    // Exit 0 when the pipeline finished or stopped at a boundary the operator
    // configured (--until) or a gate they must approve (consequence ceiling).
    // Exit 1 for halts that signal something needs fixing. Exit 2 = lock error.
    const cleanStop = summary.completed
      || summary.halt_action === "until"
      || summary.halt_action === "ceiling";
    process.exit(cleanStop ? 0 : 1);
  }).catch((err) => {
    console.error(`devteam run: ${err.message}`);
    process.exit(err.code === "ELOCKED" ? 2 : 1);
  });
}

module.exports = { name, flags, run };
