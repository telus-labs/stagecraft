// Unit tests for gate-time failure classification (ADR-003 / H1).
// classifyGate is a pure function — exercised here directly with crafted
// gate/fixStep inputs, independent of next()'s wiring.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { REPO_ROOT } = require("./_helpers");
const { classifyGate, MAX_RETRIES_DEFAULT } = require(path.join(REPO_ROOT, "core", "gates", "classify"));

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
