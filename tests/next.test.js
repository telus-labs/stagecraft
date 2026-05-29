const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { REPO_ROOT, makeTargetProject, seedGate, cleanup } = require("./_helpers");
const { next } = require(path.join(REPO_ROOT, "core", "orchestrator"));

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
afterEach(() => { _dirs.forEach(cleanup); _dirs = []; });

describe("next: walks through full track", () => {
  it("empty pipeline → run-stage requirements", () => {
    const cwd = track(makeTargetProject());
    const r = next({ cwd });
    assert.equal(r.action, "run-stage");
    assert.equal(r.name, "requirements");
  });

  it("after stage-01 PASS → run-stage design", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { status: "PASS" });
    const r = next({ cwd });
    assert.equal(r.action, "run-stage");
    assert.equal(r.name, "design");
  });

  it("multi-role partial → continue-stage with completed/remaining", () => {
    const cwd = track(makeTargetProject());
    for (const s of ["stage-01", "stage-02", "stage-03", "stage-03b"]) {
      seedGate(cwd, s, { status: "PASS" });
    }
    seedGate(cwd, "stage-04.backend", { workstream: "backend", host: "claude-code", status: "PASS" });
    seedGate(cwd, "stage-04.frontend", { workstream: "frontend", host: "claude-code", status: "PASS" });
    const r = next({ cwd });
    assert.equal(r.action, "continue-stage");
    assert.deepEqual(r.completed.sort(), ["backend", "frontend"]);
    assert.deepEqual(r.remaining.sort(), ["platform", "qa"]);
  });

  it("multi-role complete but not merged → merge action", () => {
    const cwd = track(makeTargetProject());
    for (const s of ["stage-01", "stage-02", "stage-03", "stage-03b"]) seedGate(cwd, s, { status: "PASS" });
    for (const role of ["backend", "frontend", "platform", "qa"]) {
      seedGate(cwd, `stage-04.${role}`, { workstream: role, host: "claude-code", status: "PASS" });
    }
    const r = next({ cwd });
    assert.equal(r.action, "merge");
    assert.equal(r.name, "build");
  });

  it("FAIL gate → fix-and-retry with blockers", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { status: "FAIL", blockers: ["bad criterion"] });
    const r = next({ cwd });
    assert.equal(r.action, "fix-and-retry");
    assert.deepEqual(r.blockers, ["bad criterion"]);
  });

  it("ESCALATE gate → resolve-escalation", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { status: "ESCALATE", escalation_reason: "ambiguous spec" });
    const r = next({ cwd });
    assert.equal(r.action, "resolve-escalation");
    assert.match(r.reason, /ambiguous spec/);
  });

  it("all stages PASS → pipeline-complete", () => {
    const cwd = track(makeTargetProject());
    // Seed a PASS gate for every stage in the full track so the test
    // stays robust as new stages are added to ORDERED_STAGE_NAMES.
    const { orderedStageNamesForTrack, getStage } = require("../core/pipeline/stages");
    for (const name of orderedStageNamesForTrack("full")) {
      const stageId = getStage(name).stage;
      seedGate(cwd, stageId, { status: "PASS" });
    }
    const r = next({ cwd });
    assert.equal(r.action, "pipeline-complete");
  });

  it("WARN gate treated as PASS-equivalent (advances)", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { status: "WARN", warnings: ["minor"] });
    const r = next({ cwd });
    assert.equal(r.action, "run-stage");
    assert.equal(r.name, "design");
  });
});

describe("next: conditional dispatch", () => {
  it("stage-04b skipped when stage-04a.security_review_required is false", () => {
    const cwd = track(makeTargetProject());
    for (const s of ["stage-01","stage-02","stage-03","stage-03b","stage-04"]) seedGate(cwd, s, { status: "PASS" });
    seedGate(cwd, "stage-04a", { status: "PASS", security_review_required: false });
    const r = next({ cwd });
    // Skip security-review (conditional) and land on red-team (always-on
    // for full track). stage-04c sits between stage-04b and stage-05 since
    // G4 landed.
    assert.equal(r.name, "red-team", "expected to skip security-review and land on red-team");
  });

  it("stage-04b runs when stage-04a.security_review_required is true", () => {
    const cwd = track(makeTargetProject());
    for (const s of ["stage-01","stage-02","stage-03","stage-03b","stage-04"]) seedGate(cwd, s, { status: "PASS" });
    seedGate(cwd, "stage-04a", { status: "PASS", security_review_required: true });
    const r = next({ cwd });
    assert.equal(r.action, "run-stage");
    assert.equal(r.name, "security-review");
  });
});

describe("next: track filtering", () => {
  it("nano track starts at build (skips requirements/design/clarification)", () => {
    const cwd = track(makeTargetProject({
      config: "routing:\n  default_host: generic\npipeline:\n  default_track: nano\n",
    }));
    const r = next({ cwd });
    assert.equal(r.action, "run-stage");
    assert.equal(r.name, "build");
  });

  it("nano completes after just build + qa", () => {
    const cwd = track(makeTargetProject({
      config: "routing:\n  default_host: generic\npipeline:\n  default_track: nano\n",
    }));
    seedGate(cwd, "stage-04", { status: "PASS" });
    seedGate(cwd, "stage-06", { status: "PASS" });
    const r = next({ cwd });
    assert.equal(r.action, "pipeline-complete");
  });
});
