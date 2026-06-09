// Tests for the bounded autonomous driver (ADR-003 / H2 Phase 1 PR-A).
//
// Two styles:
//   1. Real next() + seedGate — for halt paths the driver reaches WITHOUT
//      dispatching (FAIL, escalation, consequence ceiling, budget, complete).
//   2. Injected next/runStageHeadless/merge — for the dispatch loop, so we can
//      drive any action sequence deterministically without spawning a host.

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { REPO_ROOT, makeTargetProject, seedGate, cleanup } = require("./_helpers");
const { run } = require(path.join(REPO_ROOT, "core", "driver"));
const { orderedStageNamesForTrack } = require(path.join(REPO_ROOT, "core", "pipeline", "stages"));

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
afterEach(() => { _dirs.forEach(cleanup); _dirs = []; });

// Seed every stage of the full track as PASS, optionally excluding some.
function seedAllPass(cwd, { exclude = [] } = {}) {
  for (const name of orderedStageNamesForTrack("full")) {
    if (exclude.includes(name)) continue;
    const def = require(path.join(REPO_ROOT, "core", "pipeline", "stages")).getStage(name);
    seedGate(cwd, def.stage, { status: "PASS" });
  }
}

describe("driver: halt paths (real next)", () => {
  it("halts on a FAIL gate and surfaces failure_class", async () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { status: "FAIL", blockers: ["bad criterion"] });
    const s = await run({ cwd });
    assert.equal(s.completed, false);
    assert.equal(s.halted, true);
    assert.equal(s.halt_action, "fix-and-retry");
    assert.equal(s.halt_failure_class, "code-defect");
  });

  it("halts on an ESCALATE gate (judgment-gate)", async () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { status: "ESCALATE", escalation_reason: "ambiguous" });
    const s = await run({ cwd });
    assert.equal(s.halt_action, "resolve-escalation");
    assert.equal(s.halt_failure_class, "judgment-gate");
  });

  it("reaches pipeline-complete when every stage PASSes", async () => {
    const cwd = track(makeTargetProject());
    seedAllPass(cwd);
    const s = await run({ cwd });
    assert.equal(s.completed, true);
    assert.equal(s.halted, false);
  });

  it("halts at the consequence ceiling before sign-off without a grant", async () => {
    const cwd = track(makeTargetProject());
    // Everything up to sign-off passes; sign-off/deploy/retro not yet run.
    seedAllPass(cwd, { exclude: ["sign-off", "deploy", "retrospective"] });
    const s = await run({ cwd });
    assert.equal(s.halt_action, "ceiling");
    assert.match(s.halt_reason, /sign-off/);
  });

  it("halts on budget cap before dispatching the next stage", async () => {
    const cwd = track(makeTargetProject());
    // stage-01 done with a cost; next() will point at design (stage-02).
    seedGate(cwd, "stage-01", { status: "PASS", cost_usd: 5 });
    const s = await run({ cwd, budgetUsd: 3 });
    assert.equal(s.halt_action, "budget");
    assert.ok(s.cost_usd >= 3);
  });

  it("writes run-state.json and run-log.jsonl, releases the lock", async () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { status: "FAIL", blockers: ["x"] });
    await run({ cwd });
    assert.ok(fs.existsSync(path.join(cwd, "pipeline", "run-state.json")), "run-state written");
    assert.ok(fs.existsSync(path.join(cwd, "pipeline", "run-log.jsonl")), "run-log written");
    assert.ok(!fs.existsSync(path.join(cwd, "pipeline", "run.lock")), "lock released");
  });

  it("refuses to start when a live lock is held", async () => {
    const cwd = track(makeTargetProject());
    fs.mkdirSync(path.join(cwd, "pipeline"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, "pipeline", "run.lock"),
      JSON.stringify({ pid: process.pid, host: "test", started_at: "2026-06-09T00:00:00Z" }),
    );
    await assert.rejects(() => run({ cwd }), /locked by an active run/);
  });

  it("--force overrides a stale lock (dead pid)", async () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { status: "FAIL", blockers: ["x"] });
    fs.mkdirSync(path.join(cwd, "pipeline"), { recursive: true });
    // pid 1 is almost certainly not ours and process.kill(1,0) → EPERM (alive),
    // so use --force to be deterministic regardless of pid liveness.
    fs.writeFileSync(path.join(cwd, "pipeline", "run.lock"), JSON.stringify({ pid: 999999999, host: "x", started_at: "old" }));
    const s = await run({ cwd, force: true });
    assert.equal(s.halted, true); // halts on the FAIL, but it STARTED
  });
});

describe("driver: dispatch loop (injected deps)", () => {
  it("advances run-stage → merge → complete", async () => {
    const cwd = track(makeTargetProject());
    const actions = [
      { action: "run-stage", stage: "stage-04", name: "build" },
      { action: "merge", stage: "stage-04", name: "build" },
      { action: "pipeline-complete", reason: "done" },
    ];
    let i = 0;
    const s = await run({
      cwd,
      next: () => actions[i++],
      runStageHeadless: async () => [{ role: "backend", gatePath: "x", durationMs: 1 }],
      mergeWorkstreamGates: () => ({ merged: true }),
    });
    assert.equal(s.completed, true);
    assert.deepEqual(s.stages_advanced, ["build"]);
  });

  it("halts on no-progress when a dispatch writes no gate", async () => {
    const cwd = track(makeTargetProject());
    const s = await run({
      cwd,
      // next() keeps asking to run the same stage (gate never appears).
      next: () => ({ action: "run-stage", stage: "stage-01", name: "requirements" }),
      runStageHeadless: async () => [{ role: "pm", gatePath: null, durationMs: 1 }],
    });
    assert.equal(s.halt_action, "no-progress");
  });

  it("--allow-stage lets the driver dispatch a ceiling stage", async () => {
    const cwd = track(makeTargetProject());
    const actions = [
      { action: "run-stage", stage: "stage-07", name: "sign-off" },
      { action: "pipeline-complete", reason: "done" },
    ];
    let i = 0;
    const s = await run({
      cwd,
      allowStages: ["sign-off"],
      next: () => actions[i++],
      runStageHeadless: async () => [{ role: "pm", gatePath: "x", durationMs: 1 }],
    });
    assert.equal(s.completed, true);
    assert.ok(s.stages_advanced.includes("sign-off"));
  });

  it("stops at the --until boundary", async () => {
    const cwd = track(makeTargetProject());
    // until=design: a request to run a later stage (build) must halt.
    const s = await run({
      cwd,
      until: "design",
      next: () => ({ action: "run-stage", stage: "stage-04", name: "build" }),
      runStageHeadless: async () => [{ role: "backend", gatePath: "x", durationMs: 1 }],
    });
    assert.equal(s.halt_action, "until");
  });

  it("guards against runaway loops via maxIterations", async () => {
    const cwd = track(makeTargetProject());
    // merge always succeeds and never advances → would loop forever.
    const s = await run({
      cwd,
      maxIterations: 5,
      next: () => ({ action: "merge", stage: "stage-04", name: "build" }),
      mergeWorkstreamGates: () => ({ merged: true }),
    });
    assert.equal(s.halt_action, "max-iterations");
    assert.equal(s.iterations, 5);
  });
});
