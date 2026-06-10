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
const { run, extractGateClears } = require(path.join(REPO_ROOT, "core", "driver"));
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
  it("auto-retries a code-defect FAIL, then escalates when the budget is spent", async () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { status: "FAIL", blockers: ["bad criterion"] });
    // stage-01 (requirements) has no fix recipe, so nothing is cleared and the
    // gate stays FAIL; the driver retries to the ceiling, then escalates.
    const s = await run({ cwd });
    assert.equal(s.completed, false);
    assert.equal(s.halt_action, "resolve-escalation");
    assert.equal(s.halt_failure_class, "convergence-exhausted");
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

  it("halts structural-input when a dispatch keeps writing no gate", async () => {
    const cwd = track(makeTargetProject());
    const s = await run({
      cwd,
      retryDelayMs: 0,
      sleep: () => Promise.resolve(),
      // next() keeps asking to run the same stage; dispatch never writes a gate
      // and exits non-zero → transient once, then structural-input → halt.
      next: () => ({ action: "run-stage", stage: "stage-01", name: "requirements" }),
      runStageHeadless: async () => [{ role: "pm", gatePath: null, exitCode: 1, durationMs: 1 }],
    });
    assert.equal(s.halt_action, "structural-input");
  });

  it("retries a transient dispatch failure, then succeeds", async () => {
    const cwd = track(makeTargetProject());
    const dispatches = [
      [{ role: "pm", gatePath: null, exitCode: 1, durationMs: 1 }], // transient miss
      [{ role: "pm", gatePath: "x", exitCode: 0, durationMs: 1 }],  // recovers
    ];
    const nextSeq = [
      { action: "run-stage", stage: "stage-01", name: "requirements" },
      { action: "run-stage", stage: "stage-01", name: "requirements" },
      { action: "pipeline-complete", reason: "done" },
    ];
    let d = 0, n = 0;
    const s = await run({
      cwd,
      retryDelayMs: 0,
      sleep: () => Promise.resolve(),
      next: () => nextSeq[n++],
      runStageHeadless: async () => dispatches[d++],
    });
    assert.equal(s.completed, true);
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

describe("driver: autonomous fix-and-retry (PR-B)", () => {
  it("clears the failing gate, writes context, re-dispatches, completes", async () => {
    const cwd = track(makeTargetProject());
    // Seed a workstream gate the fix recipe will clear.
    const victim = path.join(cwd, "pipeline", "gates", "stage-04.backend.json");
    fs.writeFileSync(victim, "{}");
    const nextSeq = [
      {
        action: "fix-and-retry", stage: "stage-04", name: "build", failure_class: "code-defect",
        blockers: ["backend test failing"],
        fix_steps: [{ description: "rebuild backend", commands: ["rm pipeline/gates/stage-04.backend.json", "devteam stage build --headless"] }],
      },
      { action: "run-stage", stage: "stage-04", name: "build" },
      { action: "pipeline-complete", reason: "done" },
    ];
    let n = 0;
    const s = await run({
      cwd,
      next: () => nextSeq[n++],
      runStageHeadless: async () => [{ role: "backend", gatePath: "x", exitCode: 0, durationMs: 1 }],
    });
    assert.equal(s.completed, true);
    assert.ok(!fs.existsSync(victim), "failing workstream gate was cleared in-process");
    const ctx = fs.readFileSync(path.join(cwd, "pipeline", "context.md"), "utf8");
    assert.match(ctx, /devteam:run-blockers:begin/);
    assert.match(ctx, /backend test failing/);
  });

  it("honors the structured clear_gates from next() (no fix_steps needed)", async () => {
    const cwd = track(makeTargetProject());
    const victim = path.join(cwd, "pipeline", "gates", "stage-04.backend.json");
    fs.writeFileSync(victim, "{}");
    const nextSeq = [
      {
        action: "fix-and-retry", stage: "stage-04", name: "build", failure_class: "code-defect",
        blockers: ["backend test failing"],
        clear_gates: ["pipeline/gates/stage-04.backend.json"], // structured, no fix_steps
      },
      { action: "run-stage", stage: "stage-04", name: "build" },
      { action: "pipeline-complete", reason: "done" },
    ];
    let n = 0;
    const s = await run({
      cwd,
      next: () => nextSeq[n++],
      runStageHeadless: async () => [{ role: "backend", gatePath: "x", exitCode: 0, durationMs: 1 }],
    });
    assert.equal(s.completed, true);
    assert.ok(!fs.existsSync(victim), "structured clear_gates cleared the gate in-process");
  });

  it("archives the failed attempt's gate before clearing it", async () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-04", { status: "FAIL", blockers: ["build broke"] });
    const nextSeq = [
      {
        action: "fix-and-retry", stage: "stage-04", name: "build", failure_class: "code-defect",
        blockers: ["build broke"],
        fix_steps: [{ description: "rebuild", commands: ["rm pipeline/gates/stage-04.json"] }],
      },
      { action: "run-stage", stage: "stage-04", name: "build" },
      { action: "pipeline-complete", reason: "done" },
    ];
    let n = 0;
    await run({
      cwd,
      next: () => nextSeq[n++],
      runStageHeadless: async () => [{ role: "backend", gatePath: "x", exitCode: 0, durationMs: 1 }],
    });
    const archived = path.join(cwd, "pipeline", "gates", "archive", "stage-04.attempt-1.json");
    assert.ok(fs.existsSync(archived), "the failed attempt's gate was archived before clearing");
    assert.deepEqual(JSON.parse(fs.readFileSync(archived, "utf8")).blockers, ["build broke"]);
  });

  it("halts (convergence-exhausted) after the driver retry ceiling", async () => {
    const cwd = track(makeTargetProject());
    const s = await run({
      cwd,
      // config default max_retries = 2; next() always reports the same code-defect.
      next: () => ({
        action: "fix-and-retry", stage: "stage-04", name: "build", failure_class: "code-defect",
        blockers: ["still failing"], fix_steps: [],
      }),
    });
    assert.equal(s.halt_action, "resolve-escalation");
    assert.equal(s.halt_failure_class, "convergence-exhausted");
  });

  it("halts (structural-input) immediately when recipe targets gates that don't exist", async () => {
    const cwd = track(makeTargetProject());
    // fix_steps names a gate file to rm, but the file is absent → clearGates returns []
    // → toClear.length > 0 AND cleared.length === 0 → no progress possible → halt immediately.
    const s = await run({
      cwd,
      next: () => ({
        action: "fix-and-retry", stage: "stage-05", name: "peer-review", failure_class: "code-defect",
        blockers: [],
        fix_steps: [{ description: "Clear merged gate", commands: ["rm pipeline/gates/stage-05.json"] }],
      }),
    });
    assert.equal(s.halt_action, "fix-and-retry");
    assert.equal(s.halt_failure_class, "structural-input");
    assert.match(s.halt_reason, /no gate clears/);
  });

  it("still halts on non-code-defect fix-and-retry (state-corruption)", async () => {
    const cwd = track(makeTargetProject());
    const s = await run({
      cwd,
      next: () => ({ action: "fix-and-retry", stage: "stage-01", name: "requirements", failure_class: "state-corruption", blockers: ["unreadable"] }),
    });
    assert.equal(s.halt_action, "fix-and-retry");
    assert.equal(s.halt_failure_class, "state-corruption");
  });

  it("extractGateClears pulls only pipeline/gates rm targets", () => {
    const steps = [
      { description: "x", commands: ["rm pipeline/gates/stage-04.backend.json", "devteam stage build --headless"] },
      { description: "y", commands: ["rm -f pipeline/gates/stage-04.json"] },
      { description: "z", commands: ["rm /etc/passwd"] }, // must NOT be picked up
    ];
    const got = extractGateClears(steps, "/proj");
    assert.deepEqual(got, ["/proj/pipeline/gates/stage-04.backend.json", "/proj/pipeline/gates/stage-04.json"]);
  });
});

describe("driver: auto-rule escalation (Phase 2 PR-C2)", () => {
  // Helper: write a Principal output line into context.md (what runRuling does).
  function writeOutput(cwd, line) {
    const p = path.join(cwd, "pipeline", "context.md");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, (fs.existsSync(p) ? "" : "## Principal Rulings\n\n") + line + "\n");
  }
  const escalation = { action: "resolve-escalation", stage: "stage-05", name: "peer-review", failure_class: "judgment-gate", gate: "x", reason: "reviewers split" };

  it("halts by default (no grant) without dispatching the Principal", async () => {
    const cwd = track(makeTargetProject());
    let dispatched = false;
    const s = await run({
      cwd,
      next: () => escalation,
      runRuling: async () => { dispatched = true; return { exitCode: 0 }; },
    });
    assert.equal(s.halt_action, "resolve-escalation");
    assert.equal(dispatched, false, "Principal must not be dispatched without a grant");
  });

  it("auto-applies a granted ruling and resumes", async () => {
    const cwd = track(makeTargetProject());
    const nextSeq = [escalation, { action: "pipeline-complete", reason: "done" }];
    let n = 0, applied = false;
    const s = await run({
      cwd,
      autoRule: ["formatting-only"],
      next: () => nextSeq[n++],
      runRuling: async () => { writeOutput(cwd, "PRINCIPAL-RULING: lint → accept defaults [class: formatting-only]"); return { exitCode: 0 }; },
      runFixEscalation: async () => { applied = true; return { exitCode: 0 }; },
    });
    assert.equal(s.completed, true);
    assert.equal(applied, true);
  });

  it("halts on a cannot-decide even with a grant", async () => {
    const cwd = track(makeTargetProject());
    const s = await run({
      cwd,
      autoRule: ["formatting-only"],
      next: () => escalation,
      runRuling: async () => { writeOutput(cwd, "PRINCIPAL-CANNOT-DECIDE: authority → who approves the scope cut?"); return { exitCode: 0 }; },
    });
    assert.equal(s.halt_failure_class, "cannot-decide");
    assert.equal(s.cannot_decide.reason_class, "authority");
  });

  it("halts when the ruling class is not granted", async () => {
    const cwd = track(makeTargetProject());
    const s = await run({
      cwd,
      autoRule: ["doc-only"],
      next: () => escalation,
      runRuling: async () => { writeOutput(cwd, "PRINCIPAL-RULING: auth → use JWT [class: security-tradeoff]"); return { exitCode: 0 }; },
    });
    assert.equal(s.halt_action, "resolve-escalation");
    assert.match(s.halt_reason, /not in the --auto-rule grant/);
  });

  it("never auto-rules at the consequence ceiling, even when granted", async () => {
    const cwd = track(makeTargetProject());
    let dispatched = false;
    const s = await run({
      cwd,
      autoRule: ["deploy-ok"],
      next: () => ({ action: "resolve-escalation", stage: "stage-08", name: "deploy", failure_class: "judgment-gate", gate: "x", reason: "deploy escalation" }),
      runRuling: async () => { dispatched = true; return { exitCode: 0 }; },
    });
    assert.equal(s.halt_action, "resolve-escalation");
    assert.equal(dispatched, false);
  });

  it("halts after one auto-rule attempt if the escalation persists", async () => {
    const cwd = track(makeTargetProject());
    let rulings = 0;
    const s = await run({
      cwd,
      autoRule: ["formatting-only"],
      next: () => escalation, // never clears
      runRuling: async () => { rulings++; writeOutput(cwd, "PRINCIPAL-RULING: x → y [class: formatting-only]"); return { exitCode: 0 }; },
      runFixEscalation: async () => ({ exitCode: 0 }),
    });
    assert.equal(s.halted, true);
    assert.equal(rulings, 1, "Principal dispatched at most once for the same escalation");
  });

  it("binds authority provenance (resolved_by) onto the escalating gate (PR-D2)", async () => {
    const cwd = track(makeTargetProject());
    const gp = seedGate(cwd, "stage-05", { status: "ESCALATE", escalation_reason: "split" });
    const nextSeq = [
      { action: "resolve-escalation", stage: "stage-05", name: "peer-review", failure_class: "judgment-gate", gate: gp, reason: "split" },
      { action: "pipeline-complete", reason: "done" },
    ];
    let n = 0;
    await run({
      cwd,
      autoRule: ["formatting-only"],
      next: () => nextSeq[n++],
      runRuling: async () => { writeOutput(cwd, "PRINCIPAL-RULING: lint → accept defaults [class: formatting-only]"); return { exitCode: 0 }; },
      runFixEscalation: async () => ({ exitCode: 0 }),
    });
    const g = JSON.parse(fs.readFileSync(gp, "utf8"));
    assert.equal(g.resolved_by.authority, "auto-rule:formatting-only");
    assert.equal(g.resolved_by.grant_class, "formatting-only");
    assert.match(g.resolved_by.ruling, /accept defaults/);
  });
});
