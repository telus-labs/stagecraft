// Tests for core/pipeline/invalidation.js (Phase 5.1 — DAG-derived gate
// invalidation) and its integration with fix-recipes.js and next().
//
// The "must FAIL on today's main" test is:
//   "stage-06d clear_gates includes peer-review gate (stage-05)"
// It verifies the #109-class fix: rewritten code must pass peer-review
// again before re-entering QA and verification-beyond-tests.

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { REPO_ROOT, makeTargetProject, seedGate, cleanup } = require("./_helpers");
const { next } = require(path.join(REPO_ROOT, "core", "orchestrator"));
const { derivedClearGates } = require(path.join(REPO_ROOT, "core", "pipeline", "invalidation"));
const { orderedStageNamesForTrack } = require(path.join(REPO_ROOT, "core", "pipeline", "stages"));

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
afterEach(() => { _dirs.forEach(cleanup); _dirs = []; });

// ── derivedClearGates unit tests ─────────────────────────────────────────────

describe("derivedClearGates: unit", () => {
  function makeTmpGatesDir(...fileNames) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devteam-test-gates-"));
    _dirs.push(dir);
    for (const f of fileNames) fs.writeFileSync(path.join(dir, f), "{}");
    return dir;
  }

  const fullList = orderedStageNamesForTrack("full");

  it("returns [] when stageList is absent", () => {
    const dir = makeTmpGatesDir("stage-04a.json");
    assert.deepEqual(
      derivedClearGates({ rootStageId: "stage-04", failingStageId: "stage-04a",
        stageList: null, gatesDir: dir }),
      []
    );
  });

  it("returns [] when gatesDir is absent", () => {
    assert.deepEqual(
      derivedClearGates({ rootStageId: "stage-04", failingStageId: "stage-04a",
        stageList: fullList, gatesDir: null }),
      []
    );
  });

  it("returns [] when root is not upstream of failing", () => {
    const dir = makeTmpGatesDir("stage-04.json");
    // Same stage: rootIdx >= failingIdx (equal)
    assert.deepEqual(
      derivedClearGates({ rootStageId: "stage-04", failingStageId: "stage-04",
        stageList: fullList, gatesDir: dir }),
      []
    );
    // Root is downstream of failing (reversed order)
    assert.deepEqual(
      derivedClearGates({ rootStageId: "stage-06d", failingStageId: "stage-04",
        stageList: fullList, gatesDir: dir }),
      []
    );
  });

  it("returns only existing gate files between root and failing (inclusive)", () => {
    // stage-04a and stage-05 exist; stage-04b/c/d do not.
    const dir = makeTmpGatesDir("stage-04a.json", "stage-05.json");
    const result = derivedClearGates({
      rootStageId: "stage-04", failingStageId: "stage-05",
      stageList: fullList, gatesDir: dir,
    });
    assert.ok(result.includes("pipeline/gates/stage-04a.json"), "includes stage-04a");
    assert.ok(result.includes("pipeline/gates/stage-05.json"), "includes stage-05 (failing)");
    // stage-04b/c/d not on disk — excluded
    assert.ok(!result.some(g => g.includes("stage-04b") || g.includes("stage-04c") || g.includes("stage-04d")),
      "no non-existent gates");
  });

  it("includes workstream/fanout gates but not cross-stage false-matches", () => {
    // stage-04a.json for pre-review, stage-05.backend.json and stage-05.backend.claude-code.json
    // for peer-review. Crucially: "stage-04a.json" must NOT match the workstream
    // pattern for "stage-04" (different stageId prefix).
    const dir = makeTmpGatesDir(
      "stage-04a.json",
      "stage-05.json",
      "stage-05.backend.json",
      "stage-05.backend.claude-code.json"
    );
    const result = derivedClearGates({
      rootStageId: "stage-04", failingStageId: "stage-05",
      stageList: fullList, gatesDir: dir,
    });
    assert.ok(result.some(g => g.includes("stage-05.backend.json")), "workstream gate included");
    assert.ok(result.some(g => g.includes("stage-05.backend.claude-code.json")), "fanout gate included");
    // stage-04a.json should appear only once (as merged gate for pre-review,
    // not as a false workstream match for "stage-04").
    const count04a = result.filter(g => g.includes("stage-04a.json")).length;
    assert.equal(count04a, 1, "stage-04a.json appears exactly once");
  });

  it("respects changeId prefix for bounded-mode paths", () => {
    const dir = makeTmpGatesDir("stage-04a.json");
    const result = derivedClearGates({
      rootStageId: "stage-04", failingStageId: "stage-04a",
      stageList: fullList, gatesDir: dir, changeId: "feat-login",
    });
    assert.ok(result.some(g => g.includes("feat-login")), "changeId prefix applied");
    assert.ok(result.some(g => g.includes("stage-04a.json")), "gate file name preserved");
  });

  it("full-range: root=stage-04, failing=stage-06d, all intermediates on disk", () => {
    // Simulate a seeded-through-stage-06c project: every intermediate gate exists.
    const dir = makeTmpGatesDir(
      "stage-04a.json", "stage-04b.json", "stage-04c.json", "stage-04d.json",
      "stage-05.json", "stage-06.json", "stage-06b.json", "stage-06c.json", "stage-06d.json"
    );
    const result = derivedClearGates({
      rootStageId: "stage-04", failingStageId: "stage-06d",
      stageList: fullList, gatesDir: dir,
    });
    for (const s of ["stage-04a", "stage-04b", "stage-04c", "stage-04d",
                     "stage-05", "stage-06", "stage-06b", "stage-06c", "stage-06d"]) {
      assert.ok(result.some(g => g.includes(`${s}.json`)), `${s}.json in derived set`);
    }
  });
});

// ── Integration: stage-06d (#109 class fix) ─────────────────────────────────

describe("invalidation: stage-06d derived clear_gates (Phase 5.1 — #109 fix)", () => {
  // Seeds all stages PASS from stage-01 through stage-06c, mirroring
  // the real scenario where rewritten code previously passed peer-review.
  function seedThroughStage06c(cwd) {
    for (const s of ["stage-01", "stage-02", "stage-03", "stage-03b",
                     "stage-04", "stage-04a", "stage-04b", "stage-04c", "stage-04d",
                     "stage-05", "stage-06", "stage-06b", "stage-06c"]) {
      seedGate(cwd, s, { status: "PASS" });
    }
    for (const role of ["backend", "frontend", "platform", "qa"]) {
      seedGate(cwd, `stage-04.${role}`, { workstream: role, status: "PASS" });
    }
  }

  it("stage-06d clear_gates includes peer-review gate (must FAIL on main before Phase 5.1)", () => {
    // THE PRIMARY BUG FIX TEST. On main, stage-05.json was not in clear_gates
    // for stage-06d, so rewritten code bypassed peer-review. After Phase 5.1,
    // derivedClearGates adds it.
    const cwd = track(makeTargetProject());
    seedThroughStage06c(cwd);
    seedGate(cwd, "stage-06d", {
      status: "FAIL",
      blockers: [
        "P11: Infinity exchange rate. Fix: src/backend/server.js:10 — guard isNaN",
      ],
    });

    const r = next({ cwd });
    assert.equal(r.action, "fix-and-retry", "returns fix-and-retry");
    assert.equal(r.name, "verification-beyond-tests");
    assert.ok(Array.isArray(r.clear_gates) && r.clear_gates.length > 0, "clear_gates non-empty");

    // Core assertion — fails on main: peer-review must be re-attested.
    assert.ok(
      r.clear_gates.some(g => g.includes("stage-05")),
      `stage-05 (peer-review) must be in clear_gates; got: ${JSON.stringify(r.clear_gates)}`
    );
    // Pre-review must also be re-attested.
    assert.ok(
      r.clear_gates.some(g => g.includes("stage-04a")),
      `stage-04a (pre-review) must be in clear_gates; got: ${JSON.stringify(r.clear_gates)}`
    );
    // QA must be re-attested.
    assert.ok(
      r.clear_gates.some(g => g.includes("stage-06.json") || g.includes("stage-06\\")),
      `stage-06 (qa) must be in clear_gates; got: ${JSON.stringify(r.clear_gates)}`
    );
    // Build root gates still present.
    assert.ok(r.clear_gates.some(g => g.includes("stage-04.backend")), "backend build gate cleared");
    assert.ok(r.clear_gates.some(g => g === "pipeline/gates/stage-04.json"), "merged build gate cleared");
    // Failing gate itself.
    assert.ok(r.clear_gates.some(g => g.includes("stage-06d")), "stage-06d itself cleared");
  });

  it("after clearing derived gates, next() re-demands pre-review before verification", () => {
    // This confirms the pipeline enforces re-review on the rebuild path.
    const cwd = track(makeTargetProject());
    seedThroughStage06c(cwd);
    seedGate(cwd, "stage-06d", {
      status: "FAIL",
      blockers: ["Fix: src/backend/server.js:10 — guard isNaN"],
    });

    // Get the fix recipe's clear_gates.
    const r = next({ cwd });
    assert.equal(r.action, "fix-and-retry");

    // Simulate clearing by deleting all derived gate files that exist on disk.
    for (const rel of r.clear_gates) {
      const abs = path.join(cwd, rel);
      try { fs.unlinkSync(abs); } catch { /* already absent */ }
    }

    // After clearing: stage-04 has workstream gates removed (backend), but
    // frontend/platform/qa still exist → next() sees a partial stage-04.
    // Regardless of the exact first action, the key invariant is: next() does
    // NOT return fix-and-retry for verification-beyond-tests — the pipeline
    // re-runs from the cleared root, not from where it left off.
    const r2 = next({ cwd });
    assert.notEqual(
      r2.name, "verification-beyond-tests",
      "next() must not skip to verification after clearing — must re-run from cleared root"
    );
    // Since stage-04a was cleared, eventually the pipeline will demand pre-review.
    // The immediate next action is continue-stage or run-stage for an earlier stage.
    assert.ok(
      r2.action === "continue-stage" || r2.action === "run-stage" || r2.action === "merge",
      `expected pipeline to re-enter build/pre-review path; got: ${r2.action} / ${r2.name}`
    );
  });

  it("stage-06d with no workstream hint: global build clear also derives intermediates", () => {
    const cwd = track(makeTargetProject());
    seedThroughStage06c(cwd);
    seedGate(cwd, "stage-06d", {
      status: "FAIL",
      blockers: ["Surviving mutant — no specific file"],
    });

    const r = next({ cwd });
    assert.equal(r.action, "fix-and-retry");
    // Even without a specific workstream, derived gates must include stage-05.
    assert.ok(
      r.clear_gates.some(g => g.includes("stage-05")),
      "stage-05 cleared even on global dispatch path"
    );
  });
});

// ── Integration: other recipes that clear stage-04 root ──────────────────────

describe("invalidation: stage-06 derived clear_gates includes pre-review", () => {
  function seedThroughPeerReview(cwd) {
    for (const s of ["stage-01", "stage-02", "stage-03", "stage-03b",
                     "stage-04", "stage-04a", "stage-04b", "stage-04c", "stage-04d",
                     "stage-05"]) {
      seedGate(cwd, s, { status: "PASS" });
    }
    for (const role of ["backend", "frontend", "platform", "qa"]) {
      seedGate(cwd, `stage-04.${role}`, { workstream: role, status: "PASS" });
    }
  }

  it("stage-06 FAIL with failing test in backend: clear_gates includes stage-04a", () => {
    const cwd = track(makeTargetProject());
    seedThroughPeerReview(cwd);
    seedGate(cwd, "stage-06", {
      status: "FAIL",
      failing_tests: [{ name: "auth.test.js", assigned_to: "backend" }],
    });

    const r = next({ cwd });
    assert.equal(r.action, "fix-and-retry");
    assert.equal(r.name, "qa");
    // stage-04a (pre-review) must be cleared: fixed code needs re-review.
    assert.ok(
      r.clear_gates.some(g => g.includes("stage-04a")),
      `stage-04a must be derived-cleared for stage-06; got: ${JSON.stringify(r.clear_gates)}`
    );
    // stage-05 (peer-review) must be cleared.
    assert.ok(
      r.clear_gates.some(g => g.includes("stage-05")),
      `stage-05 must be derived-cleared for stage-06; got: ${JSON.stringify(r.clear_gates)}`
    );
  });
});

describe("invalidation: stage-05 code-changes derived clear_gates includes pre-review", () => {
  function seedThroughBuild(cwd) {
    for (const s of ["stage-01", "stage-02", "stage-03", "stage-03b",
                     "stage-04", "stage-04a", "stage-04b", "stage-04c", "stage-04d"]) {
      seedGate(cwd, s, { status: "PASS" });
    }
    for (const role of ["backend", "frontend", "platform", "qa"]) {
      seedGate(cwd, `stage-04.${role}`, { workstream: role, status: "PASS" });
    }
  }

  it("stage-05 CHANGES_REQUESTED: clear_gates includes stage-04a", () => {
    const cwd = track(makeTargetProject());
    seedThroughBuild(cwd);
    // Seed per-area fail gate (code changes path)
    seedGate(cwd, "stage-05.backend", {
      stage: "stage-05", workstream: "backend", status: "FAIL",
      failure_reason: "CHANGES_REQUESTED",
      blockers: [{ assigned_to: "backend", text: "Missing input validation" }],
    });
    seedGate(cwd, "stage-05", { status: "FAIL", failure_reason: "CHANGES_REQUESTED" });

    const r = next({ cwd });
    assert.equal(r.action, "fix-and-retry");
    assert.equal(r.name, "peer-review");
    // stage-04a must be cleared: code changes require re-pre-review.
    assert.ok(
      r.clear_gates.some(g => g.includes("stage-04a")),
      `stage-04a must be in clear_gates for code-changes path; got: ${JSON.stringify(r.clear_gates)}`
    );
  });
});

// ── Registry meta-test: no recipe hand-lists a downstream gate ───────────────

describe("invalidation: registry meta-test", () => {
  it("no recipe hand-lists a gate for a stage strictly between the build root and itself", () => {
    // Calls each recipe without stageList (derivedClearGates returns []).
    // Verifies that gates for stages strictly BETWEEN stage-04 (the build root)
    // and the recipe's own failing stage do not appear in clear_gates.
    // Such gates must be derived (Phase 5.1), never hand-listed.
    //
    // Example: stage-06d recipe must NOT include stage-04a.json or stage-05.json
    // in clear_gates without stageList. Those are intermediate and derive-only.
    // (stage-06d.json itself is allowed — it's the recipe's own stage.)
    const { getRecipe } = require("../core/pipeline/fix-recipes");
    const { STAGES, orderedStageNamesForTrack: orderedNames } = require("../core/pipeline/stages");

    const fullList = orderedNames("full");
    const buildIdx = fullList.indexOf("build"); // index of stage-04 in full track

    // For each recipe whose stage appears after "build" in the full track,
    // check that none of the stages strictly between "build" and the recipe's
    // own stage appear as hand-listed gate paths in clear_gates (without stageList).
    const recipesToCheck = ["stage-05", "stage-06", "stage-06b", "stage-06d"];

    for (const stageId of recipesToCheck) {
      const stageDef = Object.values(STAGES).find(d => d && d.stage === stageId);
      if (!stageDef) continue;

      // Find the recipe's own position in the track.
      const stageName = Object.entries(STAGES).find(([, d]) => d && d.stage === stageId)?.[0];
      const ownIdx = stageName ? fullList.indexOf(stageName) : -1;
      if (ownIdx <= buildIdx) continue; // not after build — skip

      // Intermediate stage names: strictly between build (exclusive) and own (exclusive).
      const intermediateNames = fullList.slice(buildIdx + 1, ownIdx);
      const intermediateGateIds = intermediateNames
        .map(n => STAGES[n]?.stage)
        .filter(Boolean);

      const { clear_gates } = getRecipe(stageId).diagnose(
        { status: "FAIL", blockers: [], workstreams: [], failing_tests: [] },
        { gatesDir: null, stageDef }  // no stageList — derivedClearGates returns []
      );

      for (const intermediateStageId of intermediateGateIds) {
        // Check for the merged gate and workstream/fanout patterns.
        assert.ok(
          !clear_gates.some(g => {
            const basename = g.replace(/^.*\/gates\//, "");
            return basename === `${intermediateStageId}.json`
              || basename.startsWith(`${intermediateStageId}.`);
          }),
          `recipe "${stageId}" hand-lists intermediate stage "${intermediateStageId}" `
          + `gate in clear_gates (no stageList). clear_gates=${JSON.stringify(clear_gates)}`
        );
      }
    }
  });

  it("every recipe diagnose() returns a clear_gates array (no regression)", () => {
    const { getRecipe } = require("../core/pipeline/fix-recipes");
    const { STAGES } = require("../core/pipeline/stages");
    for (const [name, stageDef] of Object.entries(STAGES)) {
      if (!stageDef) continue;
      const recipe = getRecipe(stageDef.stage);
      const result = recipe.diagnose(
        { status: "FAIL", blockers: [], workstreams: [] },
        { gatesDir: null, stageDef }
      );
      assert.ok(Array.isArray(result.clear_gates),
        `recipe "${stageDef.stage}" (${name}) must return clear_gates array`);
    }
  });
});
