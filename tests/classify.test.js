// Unit tests for gate-time failure classification (ADR-003 / H1).
// classifyGate is a pure function — exercised here directly with crafted
// gate/fixStep inputs, independent of next()'s wiring.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { REPO_ROOT } = require("./_helpers");
const { classifyGate, classifyDispatch, MAX_RETRIES_DEFAULT } = require(path.join(REPO_ROOT, "core", "gates", "classify"));

describe("classifyGate", () => {
  it("corrupt flag → state-corruption (no status to read)", () => {
    assert.equal(classifyGate(null, null, { corrupt: true }), "state-corruption");
  });

  it("null gate → state-corruption", () => {
    assert.equal(classifyGate(null, null), "state-corruption");
  });

  it("ESCALATE → judgment-gate", () => {
    assert.equal(classifyGate({ status: "ESCALATE" }, null), "judgment-gate");
  });

  it("FAIL with no recipe (null fixSteps) → code-defect", () => {
    assert.equal(classifyGate({ status: "FAIL" }, null), "code-defect");
  });

  it("FAIL with an empty fixSteps array → code-defect (no recipe)", () => {
    assert.equal(classifyGate({ status: "FAIL" }, []), "code-defect");
  });

  it("FAIL with executable commands → code-defect", () => {
    const steps = [
      { description: "Note the blockers", commands: [] },
      { description: "Re-run build", commands: ["devteam stage build --headless"] },
    ];
    assert.equal(classifyGate({ status: "FAIL" }, steps), "code-defect");
  });

  it("FAIL whose every step is human-action (all empty commands) → external-blocked", () => {
    const steps = [
      { description: "Obtain PM sign-off", commands: [] },
      { description: "Contact the security team", commands: [] },
    ];
    assert.equal(classifyGate({ status: "FAIL" }, steps), "external-blocked");
  });

  it("PASS → null (not a failure)", () => {
    assert.equal(classifyGate({ status: "PASS" }, null), null);
  });

  it("WARN → null (not a failure)", () => {
    assert.equal(classifyGate({ status: "WARN" }, null), null);
  });

  it("exposes a default retry ceiling", () => {
    assert.equal(MAX_RETRIES_DEFAULT, 2);
  });
});

describe("classifyDispatch", () => {
  it("wrote a gate → ok", () => {
    assert.equal(classifyDispatch({ wroteGate: true, exitCode: 0, timedOut: false }), "ok");
  });

  it("non-zero exit, no gate, first time → transient", () => {
    assert.equal(classifyDispatch({ wroteGate: false, exitCode: 1, timedOut: false }, { transientRetries: 0 }), "transient");
  });

  it("timed out, no gate, first time → transient", () => {
    assert.equal(classifyDispatch({ wroteGate: false, exitCode: null, timedOut: true }, { transientRetries: 0 }), "transient");
  });

  it("clean exit (0) but no gate → structural-input immediately", () => {
    assert.equal(classifyDispatch({ wroteGate: false, exitCode: 0, timedOut: false }, { transientRetries: 0 }), "structural-input");
  });

  it("no gate after the transient budget is spent → structural-input", () => {
    assert.equal(classifyDispatch({ wroteGate: false, exitCode: 1, timedOut: false }, { transientRetries: 1, maxTransientRetries: 1 }), "structural-input");
  });

  it("stub gate present, clean exit, first attempt → transient (not structural-input)", () => {
    assert.equal(
      classifyDispatch({ wroteGate: false, exitCode: 0, timedOut: false, stubGate: true }, { transientRetries: 0 }),
      "transient",
    );
  });

  it("stub gate present, crash exit, first attempt → transient", () => {
    assert.equal(
      classifyDispatch({ wroteGate: false, exitCode: 1, timedOut: false, stubGate: true }, { transientRetries: 0 }),
      "transient",
    );
  });

  it("stub gate present after budget spent → structural-input", () => {
    assert.equal(
      classifyDispatch({ wroteGate: false, exitCode: 0, timedOut: false, stubGate: true }, { transientRetries: 1, maxTransientRetries: 1 }),
      "structural-input",
    );
  });

  it("wrote a real gate (overwrite of stub) → ok regardless of exit code", () => {
    assert.equal(
      classifyDispatch({ wroteGate: true, exitCode: 0, timedOut: false, stubGate: false }),
      "ok",
    );
  });
});
