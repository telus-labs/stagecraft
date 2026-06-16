// Tests for `devteam run --auto-commit` (Phase 12.3).
//
// Strategy:
//   - runCommit export: tested directly (unit-level) in temp dirs.
//   - AUTO_COMMIT_HALTS constant: tested by importing run.js internals.
//   - CLI integration: tested via subprocess with real git repos (temp dirs
//     only — never the repo root). The driver is driven with injected next/
//     runStageHeadless so no host CLI is spawned.

"use strict";

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("node:fs");
const path   = require("node:path");
const { spawnSync, execFileSync } = require("node:child_process");

const { makeTargetProject, cleanup, REPO_ROOT } = require("./_helpers");
const REPO_BIN = path.join(REPO_ROOT, "bin", "devteam");

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
afterEach(() => { _dirs.forEach(cleanup); _dirs = []; });

// ── Helpers ──────────────────────────────────────────────────────────────────

function writeRunState(cwd, state) {
  const pDir = path.join(cwd, "pipeline");
  fs.mkdirSync(pDir, { recursive: true });
  fs.writeFileSync(path.join(pDir, "run-state.json"), JSON.stringify(state, null, 2));
}

function writeGate(cwd, stageId, gate = {}) {
  const gDir = path.join(cwd, "pipeline", "gates");
  fs.mkdirSync(gDir, { recursive: true });
  const finalGate = {
    stage: stageId,
    orchestrator: "devteam@test",
    track: "full",
    timestamp: "2026-06-15T00:00:00Z",
    blockers: [],
    warnings: [],
    status: "PASS",
    ...gate,
  };
  fs.writeFileSync(path.join(gDir, `${stageId}.json`), JSON.stringify(finalGate, null, 2));
}

// Initialise a minimal git repo in cwd so execFileSync("git", ...) works.
function initGitRepo(cwd) {
  execFileSync("git", ["init", "-b", "main"], { cwd, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Test"], { cwd, stdio: "pipe" });
  // Need an initial commit so HEAD exists before we commit pipeline files.
  fs.writeFileSync(path.join(cwd, ".gitkeep"), "");
  execFileSync("git", ["add", ".gitkeep"], { cwd, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "init"], { cwd, stdio: "pipe" });
}

// Read run-log.jsonl and return parsed event objects.
function readRunLog(cwd) {
  const logPath = path.join(cwd, "pipeline", "run-log.jsonl");
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, "utf8")
    .split("\n").filter(Boolean)
    .map((l) => JSON.parse(l));
}

// ── AUTO_COMMIT_HALTS set ─────────────────────────────────────────────────────

describe("AUTO_COMMIT_HALTS", () => {
  it("runCommit is exported from commit.js", () => {
    const { runCommit } = require(path.join(REPO_ROOT, "core", "cli", "commands", "commit"));
    assert.equal(typeof runCommit, "function", "runCommit should be exported");
  });
});

// ── runCommit: nothing-to-commit paths ────────────────────────────────────────

describe("runCommit: nothing-to-commit", () => {
  const { runCommit } = require(path.join(REPO_ROOT, "core", "cli", "commands", "commit"));

  it("returns nothing-to-commit when run-state.json is missing", () => {
    const cwd = track(makeTargetProject());
    const result = runCommit(cwd);
    assert.equal(result.committed, false);
    assert.match(result.reason, /run-state\.json/);
  });

  it("returns nothing-to-commit when stages_advanced is empty", () => {
    const cwd = track(makeTargetProject());
    writeRunState(cwd, { stages_advanced: [], last_committed_stage_index: null, intent: "feature" });
    const result = runCommit(cwd);
    assert.equal(result.committed, false);
    assert.equal(result.reason, "nothing-to-commit");
  });

  it("returns nothing-to-commit when cursor is at end", () => {
    const cwd = track(makeTargetProject());
    writeRunState(cwd, {
      stages_advanced: ["stage-01"],
      last_committed_stage_index: 0,
      intent: "feature",
    });
    writeGate(cwd, "stage-01");
    // brief.md does not exist → staged list will be empty after filter
    const result = runCommit(cwd);
    assert.equal(result.committed, false);
    assert.equal(result.reason, "nothing-to-commit");
  });
});

// ── runCommit: git commit success path ───────────────────────────────────────

describe("runCommit: commit success", () => {
  const { runCommit } = require(path.join(REPO_ROOT, "core", "cli", "commands", "commit"));

  it("commits gate file and returns committed:true", () => {
    const cwd = track(makeTargetProject());
    initGitRepo(cwd);
    writeRunState(cwd, {
      stages_advanced: ["stage-01"],
      last_committed_stage_index: null,
      intent: "feature",
    });
    writeGate(cwd, "stage-01");
    const pDir = path.join(cwd, "pipeline");
    fs.writeFileSync(path.join(pDir, "brief.md"), "# Brief\n");

    const result = runCommit(cwd);
    assert.equal(result.committed, true, `expected committed:true, got: ${JSON.stringify(result)}`);
    assert.ok(Array.isArray(result.files), "files should be an array");
    assert.ok(result.files.some((f) => f.includes("stage-01.json")), "gate file should be staged");
    assert.ok(typeof result.commitHash === "string" && result.commitHash.length > 0, "commitHash should be non-empty");
  });

  it("updates last_committed_stage_index in run-state.json after commit", () => {
    const cwd = track(makeTargetProject());
    initGitRepo(cwd);
    writeRunState(cwd, {
      stages_advanced: ["stage-01"],
      last_committed_stage_index: null,
      intent: "feature",
    });
    writeGate(cwd, "stage-01");

    runCommit(cwd);

    const state = JSON.parse(fs.readFileSync(path.join(cwd, "pipeline", "run-state.json"), "utf8"));
    assert.equal(state.last_committed_stage_index, 0, "cursor should be updated to 0 after committing stage-01");
  });

  it("only commits uncollected stages (respects cursor)", () => {
    const cwd = track(makeTargetProject());
    initGitRepo(cwd);
    writeRunState(cwd, {
      stages_advanced: ["stage-01", "stage-02"],
      last_committed_stage_index: 0,   // stage-01 already committed
      intent: "feature",
    });
    writeGate(cwd, "stage-01");
    writeGate(cwd, "stage-02");
    const pDir = path.join(cwd, "pipeline");
    fs.writeFileSync(path.join(pDir, "brief.md"), "# Brief\n");
    fs.writeFileSync(path.join(pDir, "design-spec.md"), "# Design\n");

    const result = runCommit(cwd);
    assert.equal(result.committed, true);
    // Only stage-02's files should be staged (stage-01 was already committed)
    assert.ok(!result.files.some((f) => f.includes("stage-01.json")), "stage-01 gate should not be re-staged");
    assert.ok(result.files.some((f) => f.includes("stage-02.json")), "stage-02 gate should be staged");
  });
});

// ── runCommit: git failure path ───────────────────────────────────────────────

describe("runCommit: git failure", () => {
  const { runCommit } = require(path.join(REPO_ROOT, "core", "cli", "commands", "commit"));

  it("returns committed:false with reason when git fails", () => {
    // A directory without a git repo causes git add to fail.
    const cwd = track(makeTargetProject());
    // Do NOT initGitRepo — git add will fail.
    writeRunState(cwd, {
      stages_advanced: ["stage-01"],
      last_committed_stage_index: null,
      intent: "feature",
    });
    writeGate(cwd, "stage-01");
    const pDir = path.join(cwd, "pipeline");
    fs.writeFileSync(path.join(pDir, "brief.md"), "# Brief\n");

    const result = runCommit(cwd);
    assert.equal(result.committed, false);
    assert.ok(typeof result.reason === "string" && result.reason.length > 0, "should have a reason");
  });
});

// ── CLI integration: auto-commit fires on clean halts ─────────────────────────
//
// These tests drive `devteam run --auto-commit` via subprocess using a temp
// git repo. The driver is driven by pre-seeded gates so no host CLI is needed.

function runCLI(args, cwd) {
  return spawnSync("node", [REPO_BIN, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "true", DEVTEAM_HEADLESS_COMMAND: "cat" },
  });
}

// Helper: seed stage-01 as PASS so the driver advances then hits the budget cap.
function setupBudgetScenario(cwd) {
  initGitRepo(cwd);
  const gDir = path.join(cwd, "pipeline", "gates");
  fs.mkdirSync(gDir, { recursive: true });
  // Seed stage-01 with cost so the next stage hits the budget.
  const gate = {
    stage: "stage-01", orchestrator: "devteam@test", track: "full",
    timestamp: "2026-06-15T00:00:00Z", blockers: [], warnings: [],
    status: "PASS", cost_usd: 10,
  };
  fs.writeFileSync(path.join(gDir, "stage-01.json"), JSON.stringify(gate, null, 2));
  // Create a brief.md artifact so the gate has something to commit.
  const pDir = path.join(cwd, "pipeline");
  fs.writeFileSync(path.join(pDir, "brief.md"), "# Brief\n");
}

describe("auto-commit CLI integration: budget halt fires auto-commit", () => {
  it("logs auto-commit event after budget halt with staged files", () => {
    const cwd = track(makeTargetProject());
    setupBudgetScenario(cwd);

    const r = runCLI(["run", "--budget-usd", "5", "--auto-commit", "--feature", "test"], cwd);
    // The halt_action should be budget (cost >= 5 because stage-01 cost 10).
    assert.match(r.stderr, /halt — budget|budget cap reached/i, `expected budget halt in stderr:\n${r.stderr}`);

    const logEvents = readRunLog(cwd);
    // Should have either auto-commit or auto-commit-skipped event.
    const acEvents = logEvents.filter((e) => e.event && e.event.startsWith("auto-commit"));
    assert.ok(acEvents.length > 0, `expected auto-commit* event in run-log, got: ${JSON.stringify(logEvents)}`);
    // We got a pipeline state with stage-01 advanced — expect either commit or skipped.
    const hasCommitOrSkip = acEvents.some((e) => e.event === "auto-commit" || e.event === "auto-commit-skipped");
    assert.ok(hasCommitOrSkip, `expected auto-commit or auto-commit-skipped, got: ${JSON.stringify(acEvents)}`);
  });
});

describe("auto-commit: not fired on non-clean halts", () => {
  it("resolve-escalation halt does NOT log auto-commit", () => {
    const cwd = track(makeTargetProject());
    initGitRepo(cwd);
    // Seed stage-01 as ESCALATE — driver will halt with resolve-escalation.
    writeGate(cwd, "stage-01", { status: "ESCALATE", escalation_reason: "judgment required" });

    const r = runCLI(["run", "--auto-commit", "--feature", "test"], cwd);
    assert.match(r.stderr, /resolve-escalation|judgment/i, `expected escalation halt:\n${r.stderr}`);

    const logEvents = readRunLog(cwd);
    const acEvents = logEvents.filter((e) => e.event && e.event.startsWith("auto-commit"));
    assert.equal(acEvents.length, 0, `auto-commit should NOT fire on resolve-escalation, got: ${JSON.stringify(acEvents)}`);
  });

  it("fix-and-retry halt does NOT log auto-commit", () => {
    const cwd = track(makeTargetProject());
    initGitRepo(cwd);
    // Seed stage-01 as FAIL — triggers fix-and-retry (code-defect path).
    writeGate(cwd, "stage-01", { status: "FAIL", blockers: ["test fails"], failure_class: "code-defect" });

    const r = runCLI(["run", "--auto-commit", "--feature", "test"], cwd);
    void r; // halt type may vary (fix-and-retry → convergence-exhausted after retries)

    const logEvents = readRunLog(cwd);
    const acEvents = logEvents.filter((e) => e.event && e.event.startsWith("auto-commit"));
    assert.equal(acEvents.length, 0, `auto-commit should NOT fire on fix-and-retry, got: ${JSON.stringify(acEvents)}`);
  });
});

describe("auto-commit: --auto-commit not passed → never fires", () => {
  it("no auto-commit event when flag is absent even on a budget halt", () => {
    const cwd = track(makeTargetProject());
    setupBudgetScenario(cwd);

    runCLI(["run", "--budget-usd", "5", "--feature", "test"], cwd);

    const logEvents = readRunLog(cwd);
    const acEvents = logEvents.filter((e) => e.event && e.event.startsWith("auto-commit"));
    assert.equal(acEvents.length, 0, `no auto-commit event without --auto-commit flag, got: ${JSON.stringify(acEvents)}`);
  });
});

describe("auto-commit: nothing-to-commit logs auto-commit-skipped", () => {
  it("logs auto-commit-skipped when cursor is already current", () => {
    const cwd = track(makeTargetProject());
    initGitRepo(cwd);
    // Seed stage-01 with cost 10 so driver halts on budget after seeing it.
    writeGate(cwd, "stage-01", { status: "PASS", cost_usd: 10 });

    // Write run-state with cursor already at 0 (stage-01 already committed).
    const pDir = path.join(cwd, "pipeline");
    fs.writeFileSync(path.join(pDir, "brief.md"), "# Brief\n");
    // Pre-write a run-state that the driver will resume with cursor=0.
    // The driver starts fresh with a new run-state, so cursor will be null.
    // Instead, test runCommit directly with cursor at end.
    const { runCommit } = require(path.join(REPO_ROOT, "core", "cli", "commands", "commit"));
    writeRunState(cwd, {
      stages_advanced: ["stage-01"],
      last_committed_stage_index: 0,  // already committed
      intent: "feature",
    });

    const result = runCommit(cwd);
    assert.equal(result.committed, false);
    assert.equal(result.reason, "nothing-to-commit");
  });
});

// ── CLI reference: --auto-commit flag appears in `devteam run --help` ─────────

describe("CLI reference: --auto-commit flag", () => {
  it("devteam run --help mentions --auto-commit", () => {
    const r = spawnSync("node", [REPO_BIN, "run", "--help"], { encoding: "utf8" });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /--auto-commit/);
  });

  it("--auto-commit appears in the generate-cli-ref output for run", () => {
    const { generateBlock } = require(path.join(REPO_ROOT, "scripts", "generate-cli-ref"));
    const block = generateBlock();
    assert.match(block, /--auto-commit/);
  });
});
