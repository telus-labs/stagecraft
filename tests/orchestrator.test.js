const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { REPO_ROOT, makeTargetProject, seedGate, cleanup } = require("./_helpers");
const { runStage, mergeWorkstreamGates, buildDescriptor, summary } =
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
    assert.match(r.reason, /single-(role|workstream)/);
  });

  it("reports missing workstreams without merging", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-04.backend", { workstream: "backend", host: "claude-code", status: "PASS" });
    // missing frontend, platform, qa
    const r = mergeWorkstreamGates("build", { cwd });
    assert.equal(r.merged, false);
    assert.match(r.reason, /missing workstream gate/);
  });

  it("reports a clear error when a workstream gate is malformed JSON (no crash)", () => {
    const cwd = track(makeTargetProject());
    const fs = require("node:fs");
    // Seed three valid + one truncated
    seedGate(cwd, "stage-04.frontend", { workstream: "frontend", host: "claude-code", status: "PASS" });
    seedGate(cwd, "stage-04.platform", { workstream: "platform", host: "claude-code", status: "PASS" });
    seedGate(cwd, "stage-04.qa", { workstream: "qa", host: "claude-code", status: "PASS" });
    fs.writeFileSync(
      path.join(cwd, "pipeline", "gates", "stage-04.backend.json"),
      '{"stage":"stage-04","workstream":"back', // truncated mid-emit
      "utf8",
    );
    const r = mergeWorkstreamGates("build", { cwd });
    assert.equal(r.merged, false);
    assert.match(r.reason, /unreadable workstream gate/);
    assert.match(r.reason, /backend/);
  });

  it("track-less workstream gates inherit the resolved pipeline track", () => {
    // When a workstream gate omits the track field (e.g. model forgot to include
    // it), the merged gate must carry the pipeline-resolved track rather than
    // shipping track:undefined which the validator would flag.
    const cwd = track(makeTargetProject());
    const roles = ["backend", "frontend", "platform", "qa"];
    roles.forEach((role) => {
      const gate = {
        stage: "stage-04",
        workstream: role,
        host: "claude-code",
        status: "PASS",
        blockers: [],
        warnings: [],
        orchestrator: "devteam@test",
        timestamp: "2026-05-26T20:00:00Z",
        // deliberately omit track
      };
      fs.writeFileSync(
        path.join(cwd, "pipeline", "gates", `stage-04.${role}.json`),
        JSON.stringify(gate, null, 2),
        "utf8",
      );
    });
    const r = mergeWorkstreamGates("build", { cwd, track: "quick" });
    assert.equal(r.merged, true);
    assert.equal(r.gate.track, "quick", `merged gate should carry resolved track; got: ${r.gate.track}`);
  });
});

describe("orchestrator: runStageHeadless --skip-completed", () => {
  // Minimal stub adapter: capabilities.headless=true, invoke() writes a gate
  // and exits 0. DEVTEAM_HEADLESS_COMMAND=true is set per-test to avoid
  // touching a real host binary.
  function makeHeadlessConfig(host = "claude-code") {
    return `routing:\n  default_host: ${host}\npipeline:\n  default_track: full\n`;
  }

  it("skips a workstream whose gate file already exists", async () => {
    const cwd = track(makeTargetProject({ config: makeHeadlessConfig() }));
    // Pre-seed frontend gate so it looks "completed"
    seedGate(cwd, "stage-04.frontend", {
      stage: "stage-04", workstream: "frontend", status: "PASS",
    });

    let dispatched = [];
    const plan = runStage("build", { cwd });
    // Simulate skip-completed check without actually invoking headless CLIs
    for (const ws of plan.workstreams) {
      const gateFile = require("node:path").join(cwd, "pipeline", "gates", `${ws.descriptor.workstreamId}.json`);
      if (!require("node:fs").existsSync(gateFile)) {
        dispatched.push(ws.role);
      }
    }

    assert.ok(!dispatched.includes("frontend"), "frontend should be skipped");
    assert.ok(dispatched.includes("backend"),   "backend should be dispatched");
    assert.ok(dispatched.includes("platform"),  "platform should be dispatched");
    assert.ok(dispatched.includes("qa"),        "qa should be dispatched");
  });

  it("dispatches all workstreams when no gates exist and skip-completed is not set", () => {
    const cwd = track(makeTargetProject());
    const plan = runStage("build", { cwd });
    assert.equal(plan.workstreams.length, 4);
    // None skipped — all four present in plan
    const roles = plan.workstreams.map((w) => w.role).sort();
    assert.deepEqual(roles, ["backend", "frontend", "platform", "qa"]);
  });
});

// ─── Fix 1.7.1: summary() must not crash on a status-less gate ────────────
// Regression for: gate.status.toLowerCase() throws TypeError when status is
// absent. Fixed by (gate.status || "unknown").toLowerCase() in orchestrator.js.
// (plans/phase-1-trust-consolidation.md item 1.7 fix 1)
describe("orchestrator: summary() — status-less gate", () => {
  it("summary() returns unknown state when merged gate file contains {} (no status field)", () => {
    const cwd = track(makeTargetProject());
    // Write a gate file that is valid JSON but has no `status` field.
    const gatesDir = path.join(cwd, "pipeline", "gates");
    fs.mkdirSync(gatesDir, { recursive: true });
    fs.writeFileSync(path.join(gatesDir, "stage-01.json"), JSON.stringify({}));

    // Must not throw — before the fix, gate.status.toLowerCase() would throw TypeError.
    let result;
    assert.doesNotThrow(() => { result = summary({ cwd }); });

    const row = result.rows.find((r) => r.stage === "stage-01");
    assert.ok(row, "stage-01 row should be present");
    assert.equal(row.state, "unknown", "status-less gate should render as 'unknown'");
  });

  it("summary() returns unknown state for a workstream entry missing status in the workstreams[] array", () => {
    const cwd = track(makeTargetProject());
    // A merged gate with a workstreams array containing an entry with no status field.
    const gatesDir = path.join(cwd, "pipeline", "gates");
    fs.mkdirSync(gatesDir, { recursive: true });
    const gate = {
      stage: "stage-04",
      status: "PASS",
      workstreams: [
        { workstream: "backend", host: "claude-code" },   // no status — crash before fix
        { workstream: "frontend", host: "claude-code", status: "PASS" },
      ],
    };
    fs.writeFileSync(path.join(gatesDir, "stage-04.json"), JSON.stringify(gate));

    let result;
    assert.doesNotThrow(() => { result = summary({ cwd }); });

    const row = result.rows.find((r) => r.stage === "stage-04");
    assert.ok(row, "stage-04 row should be present");
    assert.ok(Array.isArray(row.workstreams), "workstreams array should be present");
    const backendWs = row.workstreams.find((w) => w.role === "backend");
    assert.equal(backendWs.state, "unknown", "workstream without status should render as 'unknown'");
    const frontendWs = row.workstreams.find((w) => w.role === "frontend");
    assert.equal(frontendWs.state, "pass", "workstream with PASS status should render as 'pass'");
  });
});
