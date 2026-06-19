// tests/workstream-suppression.test.js
//
// Tests for the workstream suppression feature (Layer 1 of issue #248).
//
// Verifies that computeDispatchPlan reads stage-01.json and filters the
// dispatch plan when active_roles is set or when out_of_scope_items
// keyword-matches a workstream area. Also verifies that mergeWorkstreamGates
// does not error when working with a filtered plan that excludes some roles.

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { REPO_ROOT, makeTargetProject, seedGate, cleanup } = require("./_helpers");
const { computeDispatchPlan, mergeWorkstreamGates } = require(path.join(REPO_ROOT, "core", "orchestrator"));
const { getStage } = require(path.join(REPO_ROOT, "core", "pipeline", "stages"));
const { loadConfig } = require(path.join(REPO_ROOT, "core", "config"));
const { gatesDir: getGatesDir } = require(path.join(REPO_ROOT, "core", "paths"));

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
afterEach(() => { _dirs.forEach(cleanup); _dirs = []; });

// Helpers
function writeStage01Gate(cwd, gate) {
  const gDir = path.join(cwd, "pipeline", "gates");
  fs.mkdirSync(gDir, { recursive: true });
  const full = {
    stage: "stage-01",
    status: "PASS",
    orchestrator: "devteam@test",
    track: "full",
    timestamp: "2026-06-01T00:00:00Z",
    blockers: [],
    warnings: [],
    acceptance_criteria_count: 0,
    required_sections_complete: true,
    out_of_scope_items: [],
    ...gate,
  };
  fs.writeFileSync(path.join(gDir, "stage-01.json"), JSON.stringify(full, null, 2));
}

function dispatchPlanRoles(cwd, stageName) {
  const stageDef = getStage(stageName);
  const config = loadConfig(cwd);
  const gDir = getGatesDir(cwd, null);
  const plan = computeDispatchPlan(stageDef, config, "full", { gatesDir: gDir });
  return plan.map(e => e.role);
}

// ---------------------------------------------------------------------------
// computeDispatchPlan with explicit active_roles
// ---------------------------------------------------------------------------

describe("computeDispatchPlan: explicit active_roles in stage-01 gate", () => {
  it("excludes frontend when active_roles = [backend, platform, qa]", () => {
    const cwd = track(makeTargetProject());
    writeStage01Gate(cwd, { active_roles: ["backend", "platform", "qa"] });
    const roles = dispatchPlanRoles(cwd, "build");
    assert.ok(!roles.includes("frontend"), `frontend should be suppressed; got: ${roles}`);
    assert.ok(roles.includes("backend"), "backend should remain active");
    assert.ok(roles.includes("platform"), "platform should remain active");
    assert.ok(roles.includes("qa"), "qa should remain active");
    assert.equal(roles.length, 3);
  });

  it("excludes multiple roles when active_roles lists fewer", () => {
    const cwd = track(makeTargetProject());
    writeStage01Gate(cwd, { active_roles: ["backend"] });
    const roles = dispatchPlanRoles(cwd, "build");
    assert.deepEqual(roles, ["backend"]);
  });

  it("returns all roles when active_roles is null", () => {
    const cwd = track(makeTargetProject());
    writeStage01Gate(cwd, { active_roles: null });
    const roles = dispatchPlanRoles(cwd, "build");
    assert.equal(roles.length, 4);
    assert.ok(roles.includes("frontend"));
  });

  it("returns all roles when stage-01.json does not exist", () => {
    const cwd = track(makeTargetProject());
    // No stage-01 gate written — safe fallback
    const roles = dispatchPlanRoles(cwd, "build");
    assert.equal(roles.length, 4);
  });
});

// ---------------------------------------------------------------------------
// computeDispatchPlan with out_of_scope_items keyword inference
// ---------------------------------------------------------------------------

describe("computeDispatchPlan: keyword inference from out_of_scope_items", () => {
  it("infers frontend suppression from 'No frontend or web UI'", () => {
    const cwd = track(makeTargetProject());
    writeStage01Gate(cwd, {
      active_roles: null,
      out_of_scope_items: ["No frontend or web UI work"],
    });
    const roles = dispatchPlanRoles(cwd, "build");
    assert.ok(!roles.includes("frontend"), `frontend should be inferred as suppressed; got: ${roles}`);
    assert.ok(roles.includes("backend"));
  });

  it("does not suppress when out_of_scope_items is empty", () => {
    const cwd = track(makeTargetProject());
    writeStage01Gate(cwd, { active_roles: null, out_of_scope_items: [] });
    const roles = dispatchPlanRoles(cwd, "build");
    assert.equal(roles.length, 4);
  });

  it("does not suppress when out_of_scope_items has no matching keywords", () => {
    const cwd = track(makeTargetProject());
    writeStage01Gate(cwd, { active_roles: null, out_of_scope_items: ["No migration needed"] });
    const roles = dispatchPlanRoles(cwd, "build");
    assert.equal(roles.length, 4);
  });

  it("explicit active_roles takes precedence over out_of_scope_items inference", () => {
    const cwd = track(makeTargetProject());
    // active_roles keeps frontend; out_of_scope_items would suppress it if consulted
    writeStage01Gate(cwd, {
      active_roles: ["backend", "frontend", "platform", "qa"],
      out_of_scope_items: ["No frontend or web UI work"],
    });
    const roles = dispatchPlanRoles(cwd, "build");
    assert.ok(roles.includes("frontend"), "active_roles should take precedence — frontend should be present");
  });
});

// ---------------------------------------------------------------------------
// computeDispatchPlan for peer-review (stage-05) with active_roles filter
// ---------------------------------------------------------------------------

describe("computeDispatchPlan: peer-review (stage-05) is also filtered", () => {
  it("peer-review plan excludes frontend when active_roles = [backend, platform, qa]", () => {
    const cwd = track(makeTargetProject());
    writeStage01Gate(cwd, { active_roles: ["backend", "platform", "qa"] });
    const roles = dispatchPlanRoles(cwd, "peer-review");
    assert.ok(!roles.includes("frontend"), `frontend should be suppressed in peer-review; got: ${roles}`);
    assert.ok(roles.includes("backend"), "backend reviewer should be in plan");
  });
});

// ---------------------------------------------------------------------------
// mergeWorkstreamGates: filtered plan does not error on missing gate
// ---------------------------------------------------------------------------

describe("mergeWorkstreamGates: filtered plan skips missing workstream gate", () => {
  it("returns merged:false (missing gate) for non-frontend role when frontend is suppressed", () => {
    const cwd = track(makeTargetProject());
    // Suppress frontend via stage-01 gate
    writeStage01Gate(cwd, { active_roles: ["backend", "platform", "qa"] });

    // Write only the backend, platform, qa peer-review workstream gates —
    // no frontend gate. Without filtering, this would produce "missing workstream gate".
    // With filtering, the plan only includes 3 roles and looks for 3 gates.
    // All 3 are missing (we seed none), so it returns missing for the first one found.
    const gDir = path.join(cwd, "pipeline", "gates");
    const r = mergeWorkstreamGates("peer-review", {
      cwd,
      gatesDir: gDir,
      changeId: null,
    });
    // The plan has 3 entries (no frontend). All 3 gate files are absent.
    // The function returns merged:false with reason "missing workstream gate"
    // rather than throwing or mentioning frontend at all.
    assert.equal(r.merged, false);
    assert.ok(!r.reason.includes("frontend"), `reason should not mention frontend: ${r.reason}`);
    assert.ok(r.reason.includes("missing"), `reason should say missing: ${r.reason}`);
  });

  it("merges successfully when all filtered role gates are present", () => {
    const cwd = track(makeTargetProject());
    writeStage01Gate(cwd, { active_roles: ["backend", "platform", "qa"] });

    const gDir = path.join(cwd, "pipeline", "gates");
    // Write gates for the 3 active roles (no frontend gate)
    for (const role of ["backend", "platform", "qa"]) {
      seedGate(cwd, `stage-05.${role}`, {
        stage: `stage-05.${role}`,
        workstream: role,
        status: "PASS",
        blockers: [],
        warnings: [],
      });
    }
    const r = mergeWorkstreamGates("peer-review", {
      cwd,
      gatesDir: gDir,
      changeId: null,
    });
    assert.equal(r.merged, true, `expected merge to succeed; got: ${JSON.stringify(r)}`);
  });
});
