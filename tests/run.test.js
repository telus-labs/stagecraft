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
  it("auto-retries a code-defect FAIL, then escalates as convergence-exhausted", async () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { status: "FAIL", blockers: ["bad criterion"] });
    // stage-01 (requirements) has no fix recipe → no gate cleared → gate stays FAIL.
    // After two retry archives the progress-based breaker detects identical blockers
    // and escalates as convergence-exhausted (same observable outcome as the old
    // count-based ceiling; which path fires is an implementation detail — 4.2 spec).
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

  it("--allow-stage accepts comma-separated values (e.g. sign-off,deploy)", async () => {
    const cwd = track(makeTargetProject());
    const actions = [
      { action: "run-stage", stage: "stage-07", name: "sign-off" },
      { action: "run-stage", stage: "stage-08", name: "deploy" },
      { action: "pipeline-complete", reason: "done" },
    ];
    let i = 0;
    const s = await run({
      cwd,
      allowStages: ["sign-off", "deploy"],
      next: () => actions[i++],
      runStageHeadless: async () => [{ role: "pm", gatePath: "x", durationMs: 1 }],
    });
    assert.equal(s.completed, true);
    assert.ok(s.stages_advanced.includes("sign-off"));
    assert.ok(s.stages_advanced.includes("deploy"));
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
        clear_gates: ["pipeline/gates/stage-04.backend.json"],
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
    // clear_gates names a gate that is absent → clearGates returns []
    // → toClear.length > 0 AND cleared.length === 0 → no progress possible → halt immediately.
    const s = await run({
      cwd,
      next: () => ({
        action: "fix-and-retry", stage: "stage-05", name: "peer-review", failure_class: "code-defect",
        blockers: [],
        clear_gates: ["pipeline/gates/stage-05.json"],
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

  it("fix_steps alone (no clear_gates) does not clear gates — no rm-parsing fallback", async () => {
    // Verifies that fix-recipes migration is complete: clear_gates is the only
    // machine-readable source; the driver no longer parses rm strings from fix_steps.
    const cwd = track(makeTargetProject());
    const victim = path.join(cwd, "pipeline", "gates", "stage-04.json");
    fs.writeFileSync(victim, "{}");
    const s = await run({
      cwd,
      next: () => ({
        action: "fix-and-retry", stage: "stage-04", name: "build", failure_class: "code-defect",
        blockers: ["failing"],
        fix_steps: [{ description: "clear gate", commands: ["rm pipeline/gates/stage-04.json"] }],
        // no clear_gates — driver does not parse fix_steps for rm commands
      }),
    });
    assert.equal(s.halt_action, "resolve-escalation");
    assert.equal(s.halt_failure_class, "convergence-exhausted");
    assert.ok(fs.existsSync(victim), "fix_steps alone does not clear gates; clear_gates must be present");
  });

  it("halts (convergence-exhausted) after one auto-fix attempt when blocker file content is unchanged", async () => {
    // Simulates the hello-world case: red-team names Dockerfile as the blocker file.
    // The build agent re-runs (run-stage) without modifying Dockerfile.
    //
    // Sequence:  fix-and-retry (failure 1)
    //            → run-stage  (auto-fix build dispatched)
    //            → fix-and-retry (failure 2, different blocker text so detectNoProgress
    //                             does not fire — this specifically exercises detectNoSourceChange)
    //
    // Archive 1 is written from the seeded gate (failure 1 text).
    // Archive 2 is written from the gate the mock agent writes (failure 2 text).
    // detectNoProgress: different text across archives → does not fire.
    // detectNoSourceChange: Dockerfile hash identical → fires → halt.
    const cwd = track(makeTargetProject());
    fs.writeFileSync(path.join(cwd, "Dockerfile"), "FROM node:18-alpine\n");

    const gatePath = seedGate(cwd, "stage-04", {
      status: "FAIL",
      blockers: [{ text: "EOL base image (failure 1)", file: "Dockerfile" }],
    });

    const nextSeq = [
      // Failure 1: archive written from seeded gate, srcFingerprints baseline stored.
      {
        action: "fix-and-retry", stage: "stage-04", name: "build", failure_class: "code-defect",
        blockers: [{ text: "EOL base image (failure 1)", file: "Dockerfile" }],
        clear_gates: [],
      },
      // Auto-fix build dispatched.
      { action: "run-stage", stage: "stage-04", name: "build" },
      // Failure 2: different blocker text → detectNoProgress does not fire.
      {
        action: "fix-and-retry", stage: "stage-04", name: "build", failure_class: "code-defect",
        blockers: [{ text: "EOL base image (failure 2)", file: "Dockerfile" }],
        clear_gates: [],
      },
    ];
    let n = 0;
    const s = await run({
      cwd,
      next: () => nextSeq[n++],
      // Mock agent: rewrites gate with new blocker text but leaves Dockerfile untouched.
      runStageHeadless: async () => {
        fs.writeFileSync(gatePath, JSON.stringify({
          stage: "stage-04", status: "FAIL",
          blockers: [{ text: "EOL base image (failure 2)", file: "Dockerfile" }],
        }));
        return [{ role: "platform", gatePath, exitCode: 0, durationMs: 1 }];
      },
    });

    assert.equal(s.halt_failure_class, "convergence-exhausted");
    assert.match(s.halt_reason, /no-source-change/);
    assert.match(s.halt_reason, /Dockerfile/);
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

describe("driver: stoplist enforcement on autonomous path (Phase 1 § 1.1)", () => {
  // quick track + stoplist-matching description → halts before any dispatch,
  // run-log carries the stoplist-halt event.
  it("halts before dispatch on a quick track with a stoplist-matching description", async () => {
    const cwd = track(makeTargetProject());
    let dispatched = false;
    const s = await run({
      cwd,
      track: "quick",
      description: "add password storage for user credentials",
      next: () => { dispatched = true; return { action: "pipeline-complete", reason: "done" }; },
    });
    assert.equal(s.halted, true, "run must be halted");
    assert.equal(s.halt_action, "stoplist", "halt_action must be 'stoplist'");
    assert.equal(dispatched, false, "next() must never be called — halt before loop");
    // run-log must contain the stoplist-halt event
    const log = fs.readFileSync(path.join(cwd, "pipeline", "run-log.jsonl"), "utf8");
    const events = log.trim().split("\n").map((l) => JSON.parse(l));
    const haltEvent = events.find((e) => e.outcome === "stoplist-halt");
    assert.ok(haltEvent, "run-log.jsonl must contain a stoplist-halt event");
    assert.equal(haltEvent.track, "quick");
  });

  // Same brief with full track → no stoplist halt (full bypass is by design).
  it("does not halt on a full track even with a stoplist-matching description", async () => {
    const cwd = track(makeTargetProject());
    const s = await run({
      cwd,
      track: "full",
      description: "add password storage for user credentials",
      // One iteration then done — no need for real stages.
      next: () => ({ action: "pipeline-complete", reason: "done" }),
    });
    assert.equal(s.completed, true, "full track must not be stopped by the stoplist");
    assert.notEqual(s.halt_action, "stoplist");
  });

  // Brief written mid-run (by the requirements agent) triggers pre-build halt.
  // Inject a runStageHeadless fake that writes a stoplist-matching brief.md
  // during the requirements stage; the driver must halt before dispatching build
  // (stage-04) at check-point 2.
  it("halts before build when the requirements agent writes a stoplist-matching brief", async () => {
    const cwd = track(makeTargetProject());
    // Sequence: requirements (stage-01) → build (stage-04).
    // The fake runStageHeadless writes a stoplist-matching brief.md when it
    // dispatches requirements, simulating the agent producing a brief mid-run.
    const actions = [
      { action: "run-stage", stage: "stage-01", name: "requirements" },
      { action: "run-stage", stage: "stage-04", name: "build" },
      { action: "pipeline-complete", reason: "done" },
    ];
    let i = 0;
    let buildDispatched = false;
    const s = await run({
      cwd,
      track: "quick",
      // No description at run-start (so check-point 1 sees nothing).
      description: "",
      next: () => actions[i++],
      runStageHeadless: async (stageName) => {
        if (stageName === "requirements") {
          // Simulate the requirements agent writing a sensitive brief.
          fs.mkdirSync(path.join(cwd, "pipeline"), { recursive: true });
          fs.writeFileSync(
            path.join(cwd, "pipeline", "brief.md"),
            "# Feature brief\nImplement password storage and authentication flow.",
          );
        }
        if (stageName === "build") buildDispatched = true;
        return [{ role: "pm", gatePath: "x", exitCode: 0, durationMs: 1 }];
      },
    });
    assert.equal(s.halted, true, "run must be halted");
    assert.equal(s.halt_action, "stoplist", "halt_action must be 'stoplist'");
    assert.equal(buildDispatched, false, "build must not be dispatched after stoplist match");
    // run-log must carry the pre-build halt event
    const log = fs.readFileSync(path.join(cwd, "pipeline", "run-log.jsonl"), "utf8");
    const events = log.trim().split("\n").map((l) => JSON.parse(l));
    const haltEvent = events.find((e) => e.outcome === "stoplist-halt" && e.label === "pre-build");
    assert.ok(haltEvent, "run-log must contain a pre-build stoplist-halt event");
  });
});

// ─── Fix 1.7.3: budget cap must account for unmerged workstream gate costs ─
// Regression for: totalCostUsd() sums only merged stage gates (stage-NN.json),
// so a multi-role stage's per-workstream costs (stage-NN.<role>.json) are
// invisible until the merge happens. After the fix, totalCostUsd() must include
// workstream gate costs when no merged gate exists for that stage yet, and must
// NOT double-count once the merged gate exists.
// (plans/phase-1-trust-consolidation.md item 1.7 fix 3)
describe("driver: budget cap accounts for unmerged workstream gate costs (fix 1.7.3)", () => {
  it("halts on budget before next dispatch when only workstream gates exist and their sum exceeds the cap", async () => {
    const cwd = track(makeTargetProject());
    // stage-01 merged gate passes (cost: $1)
    seedGate(cwd, "stage-01", { status: "PASS", cost_usd: 1 });
    // stage-04 has workstream gates but no merged gate yet; combined cost = $5
    const gatesDir = path.join(cwd, "pipeline", "gates");
    fs.writeFileSync(
      path.join(gatesDir, "stage-04.backend.json"),
      JSON.stringify({ stage: "stage-04", status: "PASS", cost_usd: 3 }),
    );
    fs.writeFileSync(
      path.join(gatesDir, "stage-04.frontend.json"),
      JSON.stringify({ stage: "stage-04", status: "PASS", cost_usd: 2 }),
    );
    // Budget cap is $4; total spend visible = $1 (merged) + $5 (workstream) = $6.
    // Before the fix, totalCostUsd only counted $1 (the merged gate), so the cap
    // would not trigger. After the fix it must trigger.
    //
    // Inject both next() (always returns run-stage for design) and a
    // runStageHeadless stub so the test never attempts a real dispatch.
    // Without the budget fix, the budget check passes ($1 < $4) and the test
    // would reach runStageHeadless. With the fix, it halts before dispatch.
    const s = await run({
      cwd,
      budgetUsd: 4,
      next: () => ({ action: "run-stage", stage: "stage-02", name: "design", reason: "test" }),
      runStageHeadless: () => { throw new Error("should not dispatch — budget must halt first"); },
    });
    assert.equal(s.halt_action, "budget",
      "budget halt must fire when unmerged workstream gate costs are included in total");
    assert.ok(s.cost_usd >= 4,
      `reported cost (${s.cost_usd}) must be >= cap (4) when workstream gates are counted`);
  });

  it("does NOT double-count workstream costs when a merged gate already exists for the same stage", async () => {
    const cwd = track(makeTargetProject());
    // stage-01 merged gate with cost $2 (rolled up from workstreams).
    seedGate(cwd, "stage-01", { status: "PASS", cost_usd: 2 });
    // Workstream gates also present (they should NOT be added again because the merged gate exists).
    const gatesDir = path.join(cwd, "pipeline", "gates");
    fs.writeFileSync(
      path.join(gatesDir, "stage-01.backend.json"),
      JSON.stringify({ stage: "stage-01", status: "PASS", cost_usd: 1 }),
    );
    fs.writeFileSync(
      path.join(gatesDir, "stage-01.frontend.json"),
      JSON.stringify({ stage: "stage-01", status: "PASS", cost_usd: 1 }),
    );
    // Budget cap $3; if we double-count → $4 → halt; if we don't → $2 → no halt.
    const s = await run({
      cwd,
      budgetUsd: 3,
      next: () => ({ action: "pipeline-complete", reason: "test" }),
    });
    // With no double-counting, total = $2 < $3 cap → should NOT halt on budget.
    assert.equal(s.completed, true, "pipeline should complete without budget halt when no double-counting occurs");
    assert.equal(s.halted, false, "should not be halted");
  });
});

describe("driver: progress-based convergence (4.2)", () => {
  // Write minimal run-state so the driver can be resumed with pre-seeded fixRetries.
  function seedRunState(cwd, fixRetries) {
    const p = path.join(cwd, "pipeline", "run-state.json");
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({
      track: "full",
      iterations: Object.values(fixRetries)[0] || 0,
      retries: {},
      started_at: new Date().toISOString(),
      fixRetries,
      autoRule: {},
      transient: {},
    }, null, 2));
  }

  // Write an archive gate directly into pipeline/gates/archive/.
  function seedArchive(cwd, stageId, attempt, gate) {
    const dir = path.join(cwd, "pipeline", "gates", "archive");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${stageId}.attempt-${attempt}.json`),
      JSON.stringify({ stage: stageId, blockers: [], ...gate }, null, 2),
    );
  }

  it("trips the progress-based breaker when archived blockers are identical (same blocker unchanged)", async () => {
    // Setup: one prior archive at attempt-1 with the same stuck blocker.
    // The driver archives the current gate at attempt-2 → identical → halt.
    const cwd = track(makeTargetProject());
    seedRunState(cwd, { build: 1 });
    seedArchive(cwd, "stage-04", 1, { blockers: ["unit tests still failing"] });
    seedGate(cwd, "stage-04", { status: "FAIL", blockers: ["unit tests still failing"] });

    const s = await run({
      cwd,
      resume: true,
      next: () => ({
        action: "fix-and-retry", stage: "stage-04", name: "build",
        failure_class: "code-defect",
        blockers: ["unit tests still failing"],
      }),
    });

    assert.equal(s.halt_action, "resolve-escalation");
    assert.equal(s.halt_failure_class, "convergence-exhausted");
    assert.ok(s.no_progress_evidence, "no_progress_evidence must be set in summary");
    assert.match(s.no_progress_evidence, /unit tests still failing/);
    assert.match(s.no_progress_evidence, /1,2/);
    assert.match(s.halt_reason, /no-progress convergence/);

    // run-log must carry the no_progress_evidence for operator inspection.
    const log = fs.readFileSync(path.join(cwd, "pipeline", "run-log.jsonl"), "utf8");
    const events = log.trim().split("\n").map((l) => JSON.parse(l));
    const haltEvent = events.find((e) => e.outcome === "convergence-halt");
    assert.ok(haltEvent, "run-log must contain a convergence-halt event");
    assert.ok(haltEvent.no_progress_evidence, "run-log convergence-halt must carry no_progress_evidence");
  });

  it("does NOT trip the progress-based breaker when blockers changed between archives", async () => {
    // Setup: attempt-1 had different blockers → progress was made → no-progress check passes.
    // The count ceiling (attempts=2 >= maxRetries=2) triggers the halt instead.
    const cwd = track(makeTargetProject());
    seedRunState(cwd, { build: 1 });
    seedArchive(cwd, "stage-04", 1, { blockers: ["original blocker"] });
    seedGate(cwd, "stage-04", { status: "FAIL", blockers: ["new blocker"] }); // different!

    const s = await run({
      cwd,
      resume: true,
      next: () => ({
        action: "fix-and-retry", stage: "stage-04", name: "build",
        failure_class: "code-defect",
        blockers: ["new blocker"],
      }),
    });

    assert.equal(s.halt_action, "resolve-escalation");
    assert.equal(s.halt_failure_class, "convergence-exhausted");
    assert.ok(!s.no_progress_evidence, "no_progress_evidence must be absent — halt was count-based");
    assert.match(s.halt_reason, /retry budget exhausted/);
  });

  // ─── 5.2 regression tests ──────────────────────────────────────────────────
  //
  // Both tests must FAIL on main (before 5.2 changes) and pass with the fix.
  // (a) Stage failed twice → recovered → re-entered via downstream recipe → no
  //     instant convergence-exhausted (archives pruned by prune-on-re-entry).
  // (b) Fresh non-resume run + stale attempt-2/3 archives with identical blockers
  //     → no false no-progress halt (stale-archive guard in convergence.js).

  it("(5.2a) re-entry via downstream recipe prunes stale archives — first new failure is fix-and-retry not convergence-exhausted", async () => {
    const cwd = track(makeTargetProject());

    // Seed stage-04 archives from 2 previous failures with identical blockers.
    // Without 5.2, these survive a downstream recipe's gate clear and cause
    // detectNoProgress to trip on the very first new failure (attempt-1 compared
    // to stale-2 → same blockers → noProgress=true → convergence-exhausted).
    const archiveDir = path.join(cwd, "pipeline", "gates", "archive");
    fs.mkdirSync(archiveDir, { recursive: true });
    for (const n of [1, 2]) {
      fs.writeFileSync(
        path.join(archiveDir, `stage-04.attempt-${n}.json`),
        JSON.stringify({ stage: "stage-04", blockers: ["tests failing"], status: "FAIL" }),
      );
    }
    // Stage-04 gate is PASS (it recovered after those failures).
    seedGate(cwd, "stage-04", { status: "PASS" });

    // Downstream recipe clears stage-04.json (triggering prune-on-re-entry).
    // Then stage-04 fails for the first time in the new sequence.
    const seq = [
      {
        action: "fix-and-retry",
        stage: "stage-06d",
        name: "verification-beyond-tests",
        failure_class: "code-defect",
        blockers: ["e2e failed"],
        clear_gates: ["pipeline/gates/stage-04.json"],
      },
      // Stage-04 fails again (first attempt in the new re-entry sequence).
      // No clear_gates → driver increments retry counter and loops without halting.
      {
        action: "fix-and-retry",
        stage: "stage-04",
        name: "build",
        failure_class: "code-defect",
        blockers: ["tests failing"], // same text as stale archives!
      },
      { action: "pipeline-complete", reason: "done" },
    ];
    let si = 0;
    const s = await run({ cwd, next: () => seq[si++] });

    // With 5.2: prune-on-re-entry deletes stale archives when stage-04 gate is cleared
    //   → detectNoProgress sees no archives for stage-04 → noProgress=false → fix-and-retry
    //   → pipeline completes.
    // Without 5.2: stale archives survive → detectNoProgress compares old-1 and old-2
    //   → identical blockers → convergence-exhausted → halt.
    assert.equal(s.completed, true,
      "stale archives must be pruned on re-entry — first new failure must not hit convergence-exhausted");
  });

  it("(5.2b) stale archives from a previous run don't produce a false no-progress halt on a fresh run", async () => {
    const cwd = track(makeTargetProject());

    // Seed stage-04 with a current FAIL gate.
    seedGate(cwd, "stage-04", { status: "FAIL", blockers: ["tests failing"] });

    // Seed stale archives from a PREVIOUS run — identical blockers, attempt-2 and
    // attempt-3 — with mtime set to 1 hour ago to simulate a previous run. A fresh
    // driver run resets fixRetries to 0 and archives at attempt-1 (new mtime = now),
    // but the stale 2/3 survive if pruning was missed.
    const archiveDir = path.join(cwd, "pipeline", "gates", "archive");
    fs.mkdirSync(archiveDir, { recursive: true });
    const pastTime = new Date(Date.now() - 3_600_000); // 1 hour ago
    for (const n of [2, 3]) {
      const p = path.join(archiveDir, `stage-04.attempt-${n}.json`);
      fs.writeFileSync(p, JSON.stringify({ stage: "stage-04", blockers: ["tests failing"], status: "FAIL" }));
      fs.utimesSync(p, pastTime, pastTime);
    }

    const seq = [
      // Fresh driver archives attempt-1 (mtime=now), then clears stage-04.json.
      {
        action: "fix-and-retry",
        stage: "stage-04",
        name: "build",
        failure_class: "code-defect",
        blockers: ["tests failing"],
        clear_gates: ["pipeline/gates/stage-04.json"],
      },
      { action: "pipeline-complete", reason: "done" },
    ];
    let si = 0;
    const s = await run({ cwd, next: () => seq[si++] });

    // With 5.2: _currentSequenceArchives guard filters stale-2 and stale-3 (old mtime)
    //   → detectNoProgress sees only new attempt-1 → noProgress=false → fix-and-retry loops
    //   → pipeline completes.
    // Without 5.2: no guard → detectNoProgress compares stale-2 and stale-3
    //   → identical blockers → noProgress=true → convergence-exhausted → halt.
    assert.equal(s.completed, true,
      "stale archives from a previous run must not produce a false no-progress halt");
  });

  it("no_progress_evidence is absent on a count-based convergence-exhausted halt (max_retries=0)", async () => {
    // With max_retries=0, the count ceiling fires before any archiving occurs,
    // so there are no two archives to compare → no_progress_evidence must be absent.
    const cwd = track(makeTargetProject({
      config: "routing:\n  default_host: generic\npipeline:\n  default_track: full\nautonomy:\n  max_retries: 0\n",
    }));
    seedGate(cwd, "stage-01", { status: "FAIL", blockers: ["x"] });
    const s = await run({ cwd });
    assert.equal(s.halt_failure_class, "convergence-exhausted");
    assert.ok(!s.no_progress_evidence, "count-based halt must not set no_progress_evidence");
  });
});
