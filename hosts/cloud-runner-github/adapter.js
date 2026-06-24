"use strict";

// GitHub Actions cloud runner adapter (ADR-013 / BACKLOG A3).
//
// Implements the full host-adapter contract (capabilities, install,
// renderStagePrompt, status, uninstall) plus invoke(), which:
//   1. Blocks consequence stages (stage-07, stage-08)
//   2. Reads cloud_runner config from .devteam/config.yml
//   3. Dispatches a GitHub Actions workflow_dispatch
//   4. Correlates the resulting run by name (= idempotency key)
//   5. Polls run status to completion or timeout
//   6. Downloads the result artifact (zip containing result.json)
//   7. Validates and applies the result via core/adapters/remote-bundle.js
//   8. Returns the standard InvokeResult shape
//
// Provider config (model credentials, endpoint, etc.) lives entirely in
// GitHub Secrets and is never visible to this adapter. The workflow YAML
// references secrets by name; the adapter only provides the rendered prompt.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const yaml = require("js-yaml");

const capabilities = require("./capabilities.json");
const { readZip } = require("./zip");
const {
  dispatchWorkflow,
  correlateRun,
  pollRunToCompletion,
  cancelRun,
  listArtifacts,
  downloadArtifactZip,
} = require("./github-client");
const { validateResult, applyResult } = require("../../core/adapters/remote-bundle");
const { allowedWritesCaption, appendGateFooter, renderPatchBlock, toolBudgetSection } = require("../../core/adapters/render-helpers");
const { withSpan } = require("../../core/observability");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONSEQUENCE_STAGES = new Set(["stage-07", "stage-08"]);
const GITHUB_INPUT_LIMIT = 65_535;      // bytes per workflow input value
const RESULT_ARTIFACT_PREFIX = "stagecraft-result-";
const CONFIG_STUB_COMMENT = "# cloud-runner-github — fill in your values and remove this comment\n";
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function loadConfig(cwd) {
  const configPath = path.join(cwd, ".devteam", "config.yml");
  if (!fs.existsSync(configPath)) return null;
  const raw = yaml.load(fs.readFileSync(configPath, "utf8")) || {};
  return raw.cloud_runner || null;
}

function parseConfig(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("cloud-runner-github: missing cloud_runner section in .devteam/config.yml");
  }
  const required = ["owner", "repo", "workflow", "auth_env"];
  for (const k of required) {
    if (!raw[k] || typeof raw[k] !== "string") {
      throw new Error(`cloud-runner-github: cloud_runner.${k} is required`);
    }
  }
  return {
    owner: raw.owner,
    repo: raw.repo,
    workflow: raw.workflow,
    authEnv: raw.auth_env,
    ref: raw.ref || "main",
    pollIntervalMs: typeof raw.poll_interval_ms === "number" ? raw.poll_interval_ms : undefined,
    correlationTimeoutMs: typeof raw.correlation_timeout_ms === "number" ? raw.correlation_timeout_ms : undefined,
  };
}

function generateKey() {
  return crypto.randomBytes(16).toString("hex");
}

// ---------------------------------------------------------------------------
// Adapter contract
// ---------------------------------------------------------------------------

function install(cwd, opts = {}) {
  const devteamDir = path.join(cwd, ".devteam");
  const configPath = path.join(devteamDir, "config.yml");
  const written = [];
  const skipped = [];

  if (!fs.existsSync(devteamDir)) {
    fs.mkdirSync(devteamDir, { recursive: true });
  }

  const STUB_BLOCK =
    CONFIG_STUB_COMMENT +
    "routing:\n" +
    "  default_host: cloud-runner-github\n" +
    "  roles:\n" +
    "    principal: claude-code  # ruling + fix-escalation need local filesystem access\n" +
    "    platform: claude-code   # pre-review (stage-04a) and deploy (stage-08) need shell\n" +
    "    qa: claude-code         # qa stage (stage-06, stage-06e) needs shell to run tests\n" +
    "    verifier: claude-code   # verification-beyond-tests (stage-06d) needs shell\n" +
    "cloud_runner:\n" +
    "  owner: YOUR_GITHUB_ORG\n" +
    "  repo: stagecraft-runner\n" +
    "  workflow: stagecraft-runner.yml\n" +
    "  auth_env: STAGECRAFT_RUNNER_TOKEN\n" +
    "  ref: main\n";

  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, STUB_BLOCK, "utf8");
    written.push(configPath);
    return { written, skipped };
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = yaml.load(raw) || {};

  if (parsed.cloud_runner && !opts.force) {
    skipped.push("cloud_runner section already present in .devteam/config.yml");
    return { written, skipped };
  }

  if (parsed.cloud_runner && opts.force) {
    // Replace the existing cloud_runner section with the stub
    delete parsed.cloud_runner;
    const rest = Object.keys(parsed).length > 0 ? yaml.dump(parsed) + "\n" : "";
    fs.writeFileSync(configPath, rest + STUB_BLOCK, "utf8");
  } else {
    fs.writeFileSync(configPath, raw + "\n" + STUB_BLOCK, "utf8");
  }
  written.push(configPath);
  return { written, skipped };
}

function uninstall(cwd) {
  const configPath = path.join(cwd, ".devteam", "config.yml");
  if (!fs.existsSync(configPath)) return;
  const raw = fs.readFileSync(configPath, "utf8");
  const parsed = yaml.load(raw) || {};
  if (!parsed.cloud_runner) return;
  delete parsed.cloud_runner;
  const remaining = Object.keys(parsed);
  if (remaining.length === 0) {
    fs.unlinkSync(configPath);
  } else {
    fs.writeFileSync(configPath, yaml.dump(parsed), "utf8");
  }
}

function status(cwd) {
  const missing = [];
  const notes = [];

  const raw = loadConfig(cwd);
  if (!raw) {
    missing.push("cloud_runner section in .devteam/config.yml");
    return { ok: false, missing };
  }

  let cfg;
  try {
    cfg = parseConfig(raw);
  } catch (err) {
    missing.push(err.message);
    return { ok: false, missing };
  }

  notes.push(`target: ${cfg.owner}/${cfg.repo} workflow: ${cfg.workflow}`);
  const token = process.env[cfg.authEnv];
  if (token) {
    notes.push(`auth token: present (${cfg.authEnv})`);
  } else {
    notes.push(`auth token: NOT SET — set env var ${cfg.authEnv} before invoking`);
  }
  notes.push(
    "note: shell-requiring roles (platform, qa, verifier) and principal rulings must run locally — " +
    "add routing.roles entries for these in .devteam/config.yml (see install stub for all four)",
  );

  return { ok: true, missing, notes };
}

function renderStagePrompt(descriptor, ctx) {
  const roleBriefPath = path.join(__dirname, "..", "..", "roles", `${descriptor.role}.md`);
  const briefSnippet = fs.existsSync(roleBriefPath)
    ? fs.readFileSync(roleBriefPath, "utf8")
    : `(role brief missing at ${roleBriefPath})`;

  const lines = [];
  lines.push(`# Stage: ${descriptor.stage} — ${descriptor.name}`);
  lines.push(`Role: ${descriptor.role}`);
  lines.push(`Workstream: ${descriptor.workstreamId}`);
  lines.push(`Track: ${ctx.track}`);
  if (ctx.feature) lines.push(`Feature: ${ctx.feature}`);
  renderPatchBlock(ctx, lines);
  lines.push("");
  lines.push(`## Objective`);
  lines.push(descriptor.objective);
  lines.push("");
  lines.push(`## Read first`);
  for (const f of descriptor.readFirst) lines.push(`- ${f}`);
  lines.push("");
  lines.push(allowedWritesCaption(capabilities.enforces.allowed_writes, capabilities.displayName));
  for (const f of descriptor.allowedWrites) lines.push(`- ${f}`);
  lines.push("");
  const budgetSection = toolBudgetSection(descriptor.toolBudget, capabilities.enforces.tool_budget);
  if (budgetSection) { lines.push(budgetSection); lines.push(""); }
  lines.push(`## Artifact to produce`);
  lines.push(`- ${descriptor.artifact} (from template: ${descriptor.template})`);
  lines.push("");
  lines.push(`---`);
  lines.push(`## Role brief (roles/${descriptor.role}.md)`);
  lines.push("");
  lines.push(briefSnippet);
  lines.push("");
  lines.push(`---`);
  // Gate footer last so it's the final instruction the model reads before generating.
  appendGateFooter(lines, descriptor, ctx, capabilities.name);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Result parsing
// ---------------------------------------------------------------------------

function parseResultArtifact(zipBuf) {
  const files = readZip(zipBuf);
  const resultFile = files.find((f) => f.name === "result.json");
  if (!resultFile) {
    throw new Error("cloud-runner-github: result artifact does not contain result.json");
  }

  let result;
  try {
    result = JSON.parse(resultFile.data.toString("utf8"));
  } catch (err) {
    throw new Error(`cloud-runner-github: result.json is not valid JSON — ${err.message}`);
  }

  if (!result || result.schema !== "1") {
    throw new Error(`cloud-runner-github: result.json has unknown schema "${result && result.schema}"`);
  }

  const entries = (result.files || []).map((f) => {
    const content = Buffer.from(f.contentBase64 || "", "base64");
    return { path: f.path, sizeBytes: content.length, sha256: f.sha256, content };
  });

  return { exitCode: result.exitCode ?? 1, durationMs: result.durationMs ?? 0, entries };
}

// ---------------------------------------------------------------------------
// Post-apply hook derivation
// ---------------------------------------------------------------------------

// Stage-05 (peer-review) gates are written by the approval-derivation
// PostToolUse hook — which does not run on GitHub Actions (capabilities.hooks
// = false). After the result bundle is applied, run the hook locally against
// any review files the remote model produced so workstream gates appear on the
// local filesystem before the driver checks for them.
function deriveReviewGates(cwd, reviewRelPaths) {
  const hookPath = path.join(__dirname, "..", "..", "core", "hooks", "approval-derivation.js");
  for (const reviewRelPath of reviewRelPaths) {
    const absReviewPath = path.join(cwd, ...reviewRelPath.split("/"));
    const payload = JSON.stringify({ tool_input: { file_path: absReviewPath } });
    spawnSync(process.execPath, [hookPath], {
      cwd,
      input: payload,
      stdio: ["pipe", "inherit", "inherit"],
      encoding: "utf8",
    });
  }
}

// ---------------------------------------------------------------------------
// invoke
// ---------------------------------------------------------------------------

async function invoke(descriptor, ctx, prompt) {
  const start = Date.now();

  if (CONSEQUENCE_STAGES.has(descriptor.stage)) {
    throw new Error(
      `cloud-runner-github: stage "${descriptor.stage}" cannot route to the cloud runner ` +
      "(consequence-stage boundary — sign-off and deploy must run locally)",
    );
  }

  const rawConfig = loadConfig(ctx.cwd);
  const cfg = parseConfig(rawConfig);

  const token = process.env[cfg.authEnv];
  if (!token) {
    throw new Error(`cloud-runner-github: auth token env var "${cfg.authEnv}" is not set`);
  }

  const promptText = prompt || renderStagePrompt(descriptor, ctx);
  const promptB64 = Buffer.from(promptText, "utf8").toString("base64");
  if (Buffer.byteLength(promptB64, "utf8") > GITHUB_INPUT_LIMIT) {
    throw new Error(
      `cloud-runner-github: rendered prompt (${promptB64.length} B base64) exceeds ` +
      `GitHub Actions input limit of ${GITHUB_INPUT_LIMIT} bytes. ` +
      "Shorten the prompt or upload the workspace as a pre-run artifact.",
    );
  }

  const idempotencyKey = generateKey();
  const gateRelPath = `pipeline/gates/${descriptor.workstreamId}.json`;
  const timeoutMs = typeof ctx.timeoutMs === "number" ? ctx.timeoutMs : DEFAULT_TIMEOUT_MS;
  const clientCfg = {
    owner: cfg.owner,
    repo: cfg.repo,
    token,
    pollIntervalMs: cfg.pollIntervalMs,
    correlationTimeoutMs: cfg.correlationTimeoutMs,
    baseUrl: cfg.baseUrl,  // undefined in production; set in tests
  };

  const spanAttrs = {
    "devteam.cloud_runner.owner": cfg.owner,
    "devteam.cloud_runner.repo": cfg.repo,
    "devteam.cloud_runner.workflow": cfg.workflow,
    "devteam.cloud_runner.stage": descriptor.stage,
  };

  await withSpan("cloud-runner.dispatch", spanAttrs, () =>
    dispatchWorkflow({
      ...clientCfg,
      workflow: cfg.workflow,
      ref: cfg.ref,
      inputs: {
        idempotency_key: idempotencyKey,
        stage: descriptor.stage,
        workstream_id: descriptor.workstreamId,
        prompt: promptB64,
        allowed_writes: JSON.stringify(descriptor.allowedWrites || []),
        gate_path: gateRelPath,
      },
    }),
  );

  const dispatchedAt = new Date().toISOString();

  const runId = await withSpan("cloud-runner.correlate", spanAttrs, () =>
    correlateRun({
      ...clientCfg,
      correlationId: idempotencyKey,
      dispatchedAt,
    }),
  );

  if (!runId) {
    return { exitCode: null, gatePath: null, logPath: null, durationMs: Date.now() - start, timedOut: true, writeViolations: [] };
  }

  const elapsed = Date.now() - start;
  const { conclusion, timedOut } = await withSpan(
    "cloud-runner.poll",
    { ...spanAttrs, "devteam.cloud_runner.run_id": runId },
    () =>
      pollRunToCompletion({
        ...clientCfg,
        runId,
        pollTimeoutMs: Math.max(1000, timeoutMs - elapsed),
      }),
  );

  if (timedOut) {
    await cancelRun({ ...clientCfg, runId }).catch(() => { /* best-effort */ });
    return { exitCode: null, gatePath: null, logPath: null, durationMs: Date.now() - start, timedOut: true, writeViolations: [] };
  }

  if (conclusion !== "success") {
    return { exitCode: 1, gatePath: null, logPath: null, durationMs: Date.now() - start, timedOut: false, writeViolations: [] };
  }

  const artifactList = await listArtifacts({ ...clientCfg, runId });
  const artifacts = (artifactList && artifactList.artifacts) ? artifactList.artifacts : [];
  const resultArtifact = artifacts.find((a) => a.name === `${RESULT_ARTIFACT_PREFIX}${idempotencyKey}`);

  if (!resultArtifact) {
    return { exitCode: 1, gatePath: null, logPath: null, durationMs: Date.now() - start, timedOut: false, writeViolations: [] };
  }

  const { exitCode: remoteExitCode, entries } =
    await withSpan("cloud-runner.download", { ...spanAttrs, "devteam.cloud_runner.run_id": runId }, async () => {
      const buf = await downloadArtifactZip({ ...clientCfg, artifactId: resultArtifact.id });
      return parseResultArtifact(buf);
    });

  if (remoteExitCode !== 0) {
    return { exitCode: remoteExitCode, gatePath: null, logPath: null, durationMs: Date.now() - start, timedOut: false, writeViolations: [] };
  }

  const { ok, errors } = validateResult(entries, {
    allowedWrites: descriptor.allowedWrites || [],
    gatePath: gateRelPath,
  });

  if (!ok) {
    const summary = errors.map((e) => `${e.type}:${e.path}`).join("; ");
    throw new Error(`cloud-runner-github: result validation failed — ${summary}`);
  }

  const { applied } = applyResult(entries, ctx.cwd);

  // Derive peer-review workstream gates from any code-review files the remote
  // model produced. The approval-derivation hook doesn't run on GitHub Actions
  // (hooks: false), so run it locally now that the files are on disk.
  const reviewFilesApplied = applied.filter((p) => /^pipeline\/code-review\/by-[\w-]+\.md$/.test(p));
  if (reviewFilesApplied.length > 0) {
    deriveReviewGates(ctx.cwd, reviewFilesApplied);
  }

  const absGatePath = path.join(ctx.cwd, ...gateRelPath.split("/"));
  const gateWritten = applied.includes(gateRelPath) || fs.existsSync(absGatePath);

  return {
    exitCode: 0,
    gatePath: gateWritten ? absGatePath : null,
    logPath: null,
    durationMs: Date.now() - start,
    timedOut: false,
    writeViolations: [],
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  capabilities,
  install,
  uninstall,
  status,
  renderStagePrompt,
  invoke,
  // exposed for tests
  parseResultArtifact,
  loadConfig,
  parseConfig,
  CONSEQUENCE_STAGES,
  GITHUB_INPUT_LIMIT,
};
