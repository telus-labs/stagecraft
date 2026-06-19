const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { REPO_ROOT, makeTargetProject, cleanup } = require("./_helpers");
const { run } = require(path.join(REPO_ROOT, "core", "driver"));
const {
  TRANSITION_CONTROLS,
  transitionResult,
  applyTransitionResult,
} = require(path.join(REPO_ROOT, "core", "driver-transition"));

let dirs = [];
function track(cwd) { dirs.push(cwd); return cwd; }
afterEach(() => { dirs.forEach(cleanup); dirs = []; });

function readRun(cwd) {
  const state = JSON.parse(fs.readFileSync(path.join(cwd, "pipeline", "run-state.json"), "utf8"));
  const log = fs.readFileSync(path.join(cwd, "pipeline", "run-log.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  return { state, outcomes: log.map((entry) => entry.outcome) };
}

describe("driver transition result", () => {
  it("applies patches and observability while returning loop control", () => {
    const summary = { halted: false };
    const state = { iterations: 1 };
    const logs = [];
    const events = [];
    const result = transitionResult(TRANSITION_CONTROLS.HALT, {
      summaryPatch: { halted: true, halt_action: "test" },
      statePatch: { last_action: "test" },
      logEvents: [{ outcome: "test-halt" }],
      emittedEvents: [{ type: "halt" }],
    });

    const control = applyTransitionResult(result, {
      summary,
      state,
      logEvent: (entry) => logs.push(entry),
      onEvent: (entry) => events.push(entry),
    });

    assert.equal(control, TRANSITION_CONTROLS.HALT);
    assert.deepEqual(summary, { halted: true, halt_action: "test" });
    assert.deepEqual(state, { iterations: 1, last_action: "test" });
    assert.deepEqual(logs, [{ outcome: "test-halt" }]);
    assert.deepEqual(events, [{ type: "halt" }]);
  });

  it("rejects malformed results before they can alter run state", () => {
    assert.throws(() => transitionResult("spin"), /invalid driver transition control/);
    assert.throws(
      () => transitionResult(TRANSITION_CONTROLS.CONTINUE, { logEvents: {} }),
      /events must be arrays/,
    );
  });
});

describe("driver transition characterization", () => {
  it("pins successful dispatch and completion state/log outcomes", async () => {
    const cwd = track(makeTargetProject());
    const actions = [
      { action: "run-stage", stage: "stage-01", name: "requirements" },
      { action: "pipeline-complete", reason: "done" },
    ];
    let index = 0;

    const summary = await run({
      cwd,
      budgetUsd: 10,
      next: () => actions[index++],
      runStageHeadless: async () => [{ role: "pm", gatePath: "gate", exitCode: 0 }],
      stallProbe: () => () => {},
    });
    const persisted = readRun(cwd);

    assert.deepEqual({
      completed: summary.completed,
      halted: summary.halted,
      stages_advanced: summary.stages_advanced,
      iterations: summary.iterations,
    }, {
      completed: true,
      halted: false,
      stages_advanced: ["requirements"],
      iterations: 2,
    });
    assert.deepEqual(persisted.outcomes, [
      "run-start", "heartbeat", "dispatched", "heartbeat", "complete",
    ]);
    assert.equal(persisted.state.last_action, "pipeline-complete");
    assert.equal(persisted.state.retries.requirements, 1);
    assert.equal(persisted.state.transient.requirements, 0);
  });

  it("pins transient retry state/log outcomes", async () => {
    const cwd = track(makeTargetProject());
    const actions = [
      { action: "run-stage", stage: "stage-01", name: "requirements" },
      { action: "run-stage", stage: "stage-01", name: "requirements" },
      { action: "pipeline-complete", reason: "done" },
    ];
    const dispatches = [
      [{ role: "pm", gatePath: null, exitCode: 1 }],
      [{ role: "pm", gatePath: "gate", exitCode: 0 }],
    ];
    let actionIndex = 0;
    let dispatchIndex = 0;

    const summary = await run({
      cwd,
      budgetUsd: 10,
      retryDelayMs: 0,
      sleep: () => Promise.resolve(),
      next: () => actions[actionIndex++],
      runStageHeadless: async () => dispatches[dispatchIndex++],
      stallProbe: () => () => {},
    });
    const persisted = readRun(cwd);

    assert.equal(summary.completed, true);
    assert.deepEqual(persisted.outcomes, [
      "run-start",
      "heartbeat", "dispatched", "transient-retry",
      "heartbeat", "dispatched",
      "heartbeat", "complete",
    ]);
    assert.equal(persisted.state.retries.requirements, 2);
    assert.equal(persisted.state.transient.requirements, 0);
  });

  it("pins fix, ruling, and merge terminal traces", async () => {
    const cases = [
      {
        action: {
          action: "fix-and-retry",
          stage: "stage-01",
          name: "requirements",
          failure_class: "state-corruption",
          reason: "gate unreadable",
          blockers: ["invalid JSON"],
        },
        haltAction: "fix-and-retry",
        failureClass: "state-corruption",
        terminalOutcome: "halt",
      },
      {
        action: {
          action: "resolve-escalation",
          stage: "stage-01",
          name: "requirements",
          failure_class: "judgment-gate",
          reason: "human judgment required",
        },
        haltAction: "resolve-escalation",
        failureClass: "judgment-gate",
        terminalOutcome: "halt",
      },
      {
        action: { action: "merge", stage: "stage-04", name: "build" },
        mergeWorkstreamGates: () => ({ merged: false, reason: "missing frontend gate" }),
        haltAction: "merge-failed",
        failureClass: null,
        terminalOutcome: "merge-failed",
      },
    ];

    for (const scenario of cases) {
      const cwd = track(makeTargetProject());
      const summary = await run({
        cwd,
        budgetUsd: 10,
        next: () => scenario.action,
        mergeWorkstreamGates: scenario.mergeWorkstreamGates,
      });
      const persisted = readRun(cwd);

      assert.equal(summary.halted, true);
      assert.equal(summary.halt_action, scenario.haltAction);
      assert.equal(summary.halt_failure_class, scenario.failureClass);
      assert.deepEqual(persisted.outcomes, [
        "run-start", "heartbeat", scenario.terminalOutcome,
      ]);
      assert.equal(persisted.state.last_action, scenario.action.action);
    }
  });
});
