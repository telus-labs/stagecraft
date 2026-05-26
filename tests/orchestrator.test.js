const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { REPO_ROOT, makeTargetProject, seedGate, cleanup } = require("./_helpers");
const { runStage, mergeWorkstreamGates, buildDescriptor } =
  require(path.join(REPO_ROOT, "core", "orchestrator"));
const { getStage } = require(path.join(REPO_ROOT, "core", "pipeline", "stages"));

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
afterEach(() => { _dirs.forEach(cleanup); _dirs = []; });

describe("orchestrator: runStage decomposition", () => {
  it("single-role stage produces one workstream", () => {
    const cwd = track(makeTargetProject());
    const r = runStage("requirements", { cwd, feature: "Test" });
    assert.equal(r.workstreams.length, 1);
    assert.equal(r.workstreams[0].role, "pm");
  });

  it("multi-role stage (build) produces 4 workstreams", () => {
    const cwd = track(makeTargetProject());
    const r = runStage("build", { cwd });
    assert.equal(r.workstreams.length, 4);
    const roles = r.workstreams.map((w) => w.role).sort();
    assert.deepEqual(roles, ["backend", "frontend", "platform", "qa"]);
  });

  it("each workstream carries its own descriptor with role-specific id", () => {
    const cwd = track(makeTargetProject());
    const r = runStage("build", { cwd });
    const backend = r.workstreams.find((w) => w.role === "backend");
    assert.equal(backend.descriptor.workstreamId, "stage-04.backend");
    const frontend = r.workstreams.find((w) => w.role === "frontend");
    assert.equal(frontend.descriptor.workstreamId, "stage-04.frontend");
  });

  it("throws on unknown stage name", () => {
    const cwd = track(makeTargetProject());
    assert.throws(() => runStage("bogus", { cwd }), /Unknown stage/);
  });
});

describe("orchestrator: buildDescriptor honors overrides", () => {
  it("roleWrites filter narrows allowedWrites per role", () => {
    const build = getStage("build");
    const backend = buildDescriptor(build, "backend");
    const frontend = buildDescriptor(build, "frontend");
    assert.ok(backend.allowedWrites.some((p) => p.includes("src/backend/")));
    assert.ok(!backend.allowedWrites.some((p) => p.includes("src/frontend/")),
      "backend should NOT see src/frontend/");
    assert.ok(frontend.allowedWrites.some((p) => p.includes("src/frontend/")));
    assert.ok(!frontend.allowedWrites.some((p) => p.includes("src/backend/")));
  });

  it("falls back to stage-level allowedWrites when no roleWrites", () => {
    const req = getStage("requirements");
    const pm = buildDescriptor(req, "pm");
    assert.deepEqual(pm.allowedWrites, req.allowedWrites);
  });

  it("passes through stage.subagent override to descriptor", () => {
    const review = getStage("peer-review");
    const d = buildDescriptor(review, "backend");
    assert.equal(d.subagent, "reviewer");
  });

  it("single-role stages use bare workstreamId (no role suffix)", () => {
    const req = getStage("requirements");
    const d = buildDescriptor(req, "pm");
    assert.equal(d.workstreamId, "stage-01");
  });

  it("multi-role stages append role to workstreamId", () => {
    const build = getStage("build");
    const d = buildDescriptor(build, "platform");
    assert.equal(d.workstreamId, "stage-04.platform");
  });
});

describe("orchestrator: mergeWorkstreamGates aggregation", () => {
  function seedFour(cwd, statuses, warnings = []) {
    const roles = ["backend", "frontend", "platform", "qa"];
    roles.forEach((role, i) => {
      seedGate(cwd, `stage-04.${role}`, {
        stage: "stage-04",
        workstream: role,
        host: "claude-code",
        status: statuses[i],
        warnings: warnings[i] || [],
      });
    });
  }

  it("PASS + PASS + PASS + PASS → PASS", () => {
    const cwd = track(makeTargetProject());
    seedFour(cwd, ["PASS", "PASS", "PASS", "PASS"]);
    const r = mergeWorkstreamGates("build", { cwd });
    assert.equal(r.merged, true);
    assert.equal(r.gate.status, "PASS");
    assert.equal(r.gate.workstreams.length, 4);
  });

  it("PASS + WARN → WARN", () => {
    const cwd = track(makeTargetProject());
    seedFour(cwd, ["PASS", "WARN", "PASS", "PASS"], [[], ["coverage low"], [], []]);
    const r = mergeWorkstreamGates("build", { cwd });
    assert.equal(r.gate.status, "WARN");
    assert.deepEqual(r.gate.warnings, ["coverage low"]);
  });

  it("PASS + FAIL → FAIL", () => {
    const cwd = track(makeTargetProject());
    seedFour(cwd, ["PASS", "FAIL", "PASS", "PASS"]);
    const r = mergeWorkstreamGates("build", { cwd });
    assert.equal(r.gate.status, "FAIL");
  });

  it("FAIL + ESCALATE → ESCALATE (highest severity wins)", () => {
    const cwd = track(makeTargetProject());
    seedFour(cwd, ["FAIL", "ESCALATE", "PASS", "PASS"]);
    const r = mergeWorkstreamGates("build", { cwd });
    assert.equal(r.gate.status, "ESCALATE");
  });

  it("skips merge for single-role stages", () => {
    const cwd = track(makeTargetProject());
    const r = mergeWorkstreamGates("requirements", { cwd });
    assert.equal(r.merged, false);
    assert.match(r.reason, /single-role/);
  });

  it("reports missing workstreams without merging", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-04.backend", { workstream: "backend", host: "claude-code", status: "PASS" });
    // missing frontend, platform, qa
    const r = mergeWorkstreamGates("build", { cwd });
    assert.equal(r.merged, false);
    assert.match(r.reason, /missing workstream gate/);
  });
});
