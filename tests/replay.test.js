// E6 — `devteam replay <stage-id>` CLI tests.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeTargetProject, cleanup, runCLI, seedGate } = require("./_helpers");

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
test.afterEach?.(() => { _dirs.forEach(cleanup); _dirs = []; });

test("`devteam replay` without a stage prints usage", () => {
  const r = runCLI(["replay"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Usage: devteam replay/);
});

test("`devteam replay <stage>` fails when the gate doesn't exist", () => {
  const cwd = track(makeTargetProject());
  const r = runCLI(["replay", "stage-04"], { cwd });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /No gate at/);
});

test("`devteam replay <stage> --dry-run` prints the plan + drift check without invoking", () => {
  const cwd = track(makeTargetProject());
  // Seed a stage-01 gate with full reproducibility data.
  seedGate(cwd, "stage-01", {
    workstream: "pm",
    host: "claude-code",
    status: "PASS",
    model: "claude-opus-4-7",
    temperature: 0.0,
    seed: 42,
    system_prompt_hash: `sha256:${"a".repeat(64)}`,
  });

  const r = runCLI(["replay", "stage-01", "--dry-run"], { cwd });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Replay plan/);
  assert.match(r.stdout, /Original gate:/);
  assert.match(r.stdout, /Replay configuration \(CURRENT, not pinned\)/);
  // The original hash differs from whatever is rendered today.
  assert.match(r.stdout, /Prompt hash drift:\s+⚠️\s+DRIFT/);
  // Dry-run never invokes — no replay gate should be created.
  const replayDir = path.join(cwd, "pipeline", "gates", "replay");
  assert.equal(fs.existsSync(replayDir), false, "dry-run must not create replay directory");
});

test("`devteam replay <stage> --dry-run` reports match when hashes align", () => {
  const cwd = track(makeTargetProject());
  // Render the current stage-01 prompt with the SAME feature string the
  // CLI will use (it falls back to "<replay>" when the gate has no
  // `feature` field), then seed a gate with the resulting hash.
  const { runStage } = require(path.join(__dirname, "..", "core", "orchestrator"));
  const { hashSystemPrompt } = require("../core/reproducibility");
  const result = runStage("requirements", { cwd, feature: "<replay>" });
  const currentHash = hashSystemPrompt(result.workstreams[0].prompt);

  seedGate(cwd, "stage-01", {
    workstream: "pm",
    host: "claude-code",
    status: "PASS",
    model: "claude-opus-4-7",
    system_prompt_hash: currentHash,
  });
  const r = runCLI(["replay", "stage-01", "--dry-run"], { cwd });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Prompt hash drift:\s+✅ match/);
});

test("`devteam replay <stage> --dry-run --json` emits structured output", () => {
  const cwd = track(makeTargetProject());
  seedGate(cwd, "stage-01", {
    workstream: "pm",
    host: "claude-code",
    status: "PASS",
    model: "claude-opus-4-7",
    temperature: 0.0,
    system_prompt_hash: `sha256:${"a".repeat(64)}`,
  });
  const r = runCLI(["replay", "stage-01", "--dry-run", "--json"], { cwd });
  assert.equal(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.plan, "dry-run");
  assert.equal(parsed.original_fingerprint.model, "claude-opus-4-7");
  assert.equal(parsed.hash_drift, true);
  assert.equal(parsed.readiness.level, "partial");
});

test("`devteam replay <stage>` against an empty headless command exits non-zero (no new gate)", () => {
  // With DEVTEAM_HEADLESS_COMMAND=true the child exits 0 but writes
  // nothing. The replay flow should detect "no gate written" and
  // report it cleanly instead of silently succeeding.
  const cwd = track(makeTargetProject({
    config: "routing:\n  default_host: claude-code\npipeline:\n  default_track: full\n",
  }));
  seedGate(cwd, "stage-01", {
    workstream: "pm",
    host: "claude-code",
    status: "PASS",
    model: "claude-opus-4-7",
    system_prompt_hash: `sha256:${"a".repeat(64)}`,
  });
  const r = runCLI(["replay", "stage-01"], {
    cwd,
    env: { ...process.env, DEVTEAM_HEADLESS_COMMAND: "true" },
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr + r.stdout, /did not write|produced no gate/i);
});

test("real replay: when the headless command writes a gate, replay writes to replay/ and diffs", () => {
  // Build a "headless" command that writes a fake gate to the expected
  // path. The orchestrator passes the workstream id; the gate path is
  // pipeline/gates/<workstream-id>.json. We use node -e to inline a tiny
  // writer that emits PASS with a different cost so the diff is interesting.
  const cwd = track(makeTargetProject({
    config: "routing:\n  default_host: claude-code\npipeline:\n  default_track: full\n",
  }));
  seedGate(cwd, "stage-01", {
    workstream: "pm",
    host: "claude-code",
    status: "PASS",
    model: "claude-opus-4-7",
    cost_usd: 0.05,
    tokens_in: 10000,
    tokens_out: 2000,
    system_prompt_hash: `sha256:${"a".repeat(64)}`,
  });

  // Write a tiny "replay simulator" script.
  const writerPath = path.join(cwd, "fake-host.js");
  const fakeGate = JSON.stringify({
    stage: "stage-01",
    workstream: "pm",
    host: "claude-code",
    orchestrator: "devteam@test",
    track: "full",
    timestamp: "2026-05-29T15:00:00Z",
    blockers: [],
    warnings: [],
    status: "PASS",
    model: "claude-opus-4-7",
    cost_usd: 0.06,        // different cost → drift visible in diff
    tokens_in: 11000,
    tokens_out: 2100,
  });
  fs.writeFileSync(
    writerPath,
    `const fs = require("node:fs");
     const path = require("node:path");
     fs.mkdirSync(path.join(process.cwd(), "pipeline", "gates"), { recursive: true });
     fs.writeFileSync(path.join(process.cwd(), "pipeline", "gates", "stage-01.json"), ${JSON.stringify(fakeGate)});
    `,
  );

  const r = runCLI(["replay", "stage-01"], {
    cwd,
    env: { ...process.env, DEVTEAM_HEADLESS_COMMAND: `node ${writerPath}` },
  });
  assert.equal(r.status, 0, `replay failed: ${r.stderr}\n---\n${r.stdout}`);
  assert.match(r.stdout, /Replay complete/);
  assert.match(r.stdout, /cost_usd\s+0.05\s+→\s+0.06/);
  assert.match(r.stdout, /tokens_in\s+10000\s+→\s+11000/);

  // Replay gate landed in the replay/ subdirectory.
  const replayDir = path.join(cwd, "pipeline", "gates", "replay");
  assert.ok(fs.existsSync(replayDir), "replay dir was not created");
  const replayFiles = fs.readdirSync(replayDir);
  assert.equal(replayFiles.length, 1);
  assert.match(replayFiles[0], /^stage-01\..*\.json$/);

  // Original gate was restored (the headless write to the canonical path
  // was overwritten by replay's restore step).
  const restored = JSON.parse(fs.readFileSync(path.join(cwd, "pipeline", "gates", "stage-01.json"), "utf8"));
  assert.equal(restored.cost_usd, 0.05, "original gate should be restored");
});

// ── Part B: disk-based backup / restore (3.7.4 race fix) ─────────────────────

test("backup file exists in .replay-backup/ during headless dispatch", () => {
  // The headless command checks for the backup mid-run and records its
  // finding in a sentinel file. We verify the backup existed before the
  // gate was (re)written — confirming the snapshot happens before dispatch.
  const cwd = track(makeTargetProject({
    config: "routing:\n  default_host: claude-code\npipeline:\n  default_track: full\n",
  }));
  seedGate(cwd, "stage-01", {
    workstream: "pm",
    host: "claude-code",
    status: "PASS",
    model: "claude-opus-4-7",
    cost_usd: 0.05,
  });

  // Sentinel: the fake host writes "true" or "false" here.
  const sentinelPath = path.join(cwd, "backup-check.txt");
  const fakeGate = JSON.stringify({
    stage: "stage-01", workstream: "pm", host: "claude-code",
    orchestrator: "devteam@test", track: "full",
    timestamp: "2026-06-01T00:00:00Z", blockers: [], warnings: [],
    status: "PASS", model: "claude-opus-4-7", cost_usd: 0.06,
  });
  const writerPath = path.join(cwd, "fake-host-backup-check.js");
  fs.writeFileSync(writerPath, `
const fs = require("node:fs");
const path = require("node:path");
const gatesDir = path.join(process.cwd(), "pipeline", "gates");
const backupDir = path.join(gatesDir, ".replay-backup");
const backupExists = fs.existsSync(backupDir) &&
  fs.readdirSync(backupDir).some(f => f.endsWith(".json"));
fs.writeFileSync(${JSON.stringify(sentinelPath)}, String(backupExists));
fs.mkdirSync(gatesDir, { recursive: true });
fs.writeFileSync(path.join(gatesDir, "stage-01.json"), ${JSON.stringify(fakeGate)});
`);

  const r = runCLI(["replay", "stage-01"], {
    cwd,
    env: { ...process.env, DEVTEAM_HEADLESS_COMMAND: `node ${writerPath}`, DEVTEAM_NO_LOG: "1" },
  });
  assert.equal(r.status, 0, `replay failed: ${r.stderr}\n---\n${r.stdout}`);
  assert.ok(fs.existsSync(sentinelPath), "sentinel file was not written by fake host");
  assert.equal(
    fs.readFileSync(sentinelPath, "utf8"),
    "true",
    "backup did not exist during dispatch — snapshot-before-dispatch guarantee violated",
  );
});

test("backup is deleted on successful replay (no leftover after clean run)", () => {
  const cwd = track(makeTargetProject({
    config: "routing:\n  default_host: claude-code\npipeline:\n  default_track: full\n",
  }));
  seedGate(cwd, "stage-01", {
    workstream: "pm", host: "claude-code", status: "PASS", model: "claude-opus-4-7", cost_usd: 0.05,
  });

  const fakeGate = JSON.stringify({
    stage: "stage-01", workstream: "pm", host: "claude-code",
    orchestrator: "devteam@test", track: "full",
    timestamp: "2026-06-01T00:00:00Z", blockers: [], warnings: [],
    status: "PASS", model: "claude-opus-4-7", cost_usd: 0.07,
  });
  const writerPath = path.join(cwd, "fake-host-success.js");
  fs.writeFileSync(writerPath, `
const fs = require("node:fs");
const path = require("node:path");
const gatesDir = path.join(process.cwd(), "pipeline", "gates");
fs.mkdirSync(gatesDir, { recursive: true });
fs.writeFileSync(path.join(gatesDir, "stage-01.json"), ${JSON.stringify(fakeGate)});
`);

  const r = runCLI(["replay", "stage-01"], {
    cwd,
    env: { ...process.env, DEVTEAM_HEADLESS_COMMAND: `node ${writerPath}`, DEVTEAM_NO_LOG: "1" },
  });
  assert.equal(r.status, 0, `replay failed: ${r.stderr}\n---\n${r.stdout}`);

  // Backup directory must be gone (or empty) after a clean run.
  const backupDir = path.join(cwd, "pipeline", "gates", ".replay-backup");
  if (fs.existsSync(backupDir)) {
    const leftovers = fs.readdirSync(backupDir).filter((n) => n.endsWith(".json"));
    assert.equal(leftovers.length, 0, `backup files remain after successful replay: ${leftovers.join(", ")}`);
  }

  // Original gate still restored.
  const restored = JSON.parse(fs.readFileSync(path.join(cwd, "pipeline", "gates", "stage-01.json"), "utf8"));
  assert.equal(restored.cost_usd, 0.05, "original gate should be restored after successful replay");
});

test("leftover backup from crashed replay triggers warning and non-zero exit", () => {
  // Simulate a previous crash: the backup exists but the original was
  // already overwritten. On the next replay invocation, devteam must warn
  // and exit 1 before doing any new dispatch.
  const cwd = track(makeTargetProject({
    config: "routing:\n  default_host: claude-code\npipeline:\n  default_track: full\n",
  }));
  seedGate(cwd, "stage-01", {
    workstream: "pm", host: "claude-code", status: "PASS", model: "claude-opus-4-7",
    system_prompt_hash: `sha256:${"a".repeat(64)}`,
  });

  // Plant a leftover backup as if a previous replay crashed mid-run.
  const backupDir = path.join(cwd, "pipeline", "gates", ".replay-backup");
  fs.mkdirSync(backupDir, { recursive: true });
  fs.writeFileSync(
    path.join(backupDir, "stage-01.json"),
    JSON.stringify({ stage: "stage-01", status: "PASS", _note: "leftover-backup" }),
  );

  const r = runCLI(["replay", "stage-01"], { cwd });
  assert.notEqual(r.status, 0, "should exit non-zero when leftover backup detected");
  assert.match(
    r.stderr,
    /leftover backup|crashed replay|WARNING/i,
    "should warn about leftover backup in stderr",
  );
});
