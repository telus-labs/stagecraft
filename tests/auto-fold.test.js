// Stage 7 auto-fold: when Stage 6 cleanly satisfies the AC→test
// contract, the orchestrator writes stage-07.json itself with
// auto_from_stage_06: true, skipping the PM+Platform sign-off
// workstreams. The auto-fold cross-checks the QA agent's claims
// against brief.md and test-report.md — it does not rubber-stamp.

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { REPO_ROOT, makeTargetProject, seedGate, cleanup } = require("./_helpers");
const { next } = require(path.join(REPO_ROOT, "core", "orchestrator"));

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
afterEach(() => { _dirs.forEach(cleanup); _dirs = []; });

function seedAll(cwd, _untilSignOff = true) {
  // Seed every stage on the full track up to and including stage-06 as PASS,
  // skipping conditional sub-stages we don't care about.
  const passes = [
    "stage-01", "stage-02", "stage-03", "stage-03b", "stage-04", "stage-04a",
    "stage-04c", "stage-05", "stage-06", "stage-06b", "stage-06c", "stage-06d",
    "stage-06e",
  ];
  for (const s of passes) {
    seedGate(cwd, s, {
      stage: s, status: "PASS",
      ...(s === "stage-04a" ? {
        security_review_required: false,
        migration_safety_required: false,
      } : {}),
      ...(s === "stage-06" ? {
        all_acceptance_criteria_met: true,
        criterion_to_test_mapping_is_one_to_one: true,
        tests_total: 2, tests_passed: 2, tests_failed: 0, failing_tests: [],
      } : {}),
    });
  }
  // brief.md with two AC-N entries
  fs.mkdirSync(path.join(cwd, "pipeline"), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, "pipeline", "brief.md"),
    "# Brief\n## Criteria\n- AC-1: Feature does X.\n- AC-2: Feature does Y.\n",
  );
  // test-report.md with a mapping table covering both
  fs.writeFileSync(
    path.join(cwd, "pipeline", "test-report.md"),
    "# Test Report\n\n## AC Coverage\n| AC | Test |\n|---|---|\n| AC-1 | t1 |\n| AC-2 | t2 |\n",
  );
}

describe("auto-fold: stage-07 auto-authored when stage-06 satisfies contract", () => {
  it("writes stage-07.json with auto_from_stage_06: true and advances past sign-off", () => {
    const cwd = track(makeTargetProject());
    seedAll(cwd);
    const r = next({ cwd });
    // Should NOT return run-stage for sign-off; the auto-fold should
    // have written stage-07 and `next` walks on to deploy (or
    // pipeline-complete if deploy already exists).
    assert.notEqual(r.name, "sign-off", "auto-fold should have skipped sign-off as a user-action");
    const stage07 = JSON.parse(fs.readFileSync(path.join(cwd, "pipeline", "gates", "stage-07.json"), "utf8"));
    assert.equal(stage07.auto_from_stage_06, true);
    assert.equal(stage07.pm_signoff, true);
    assert.equal(stage07.deploy_requested, true);
    assert.equal(stage07.status, "PASS");
    assert.equal(stage07.auto_fold.ac_count, 2);
    assert.deepEqual(stage07.auto_fold.criteria, ["AC-1", "AC-2"]);
  });

  it("populates runbook_referenced based on actual file existence", () => {
    const cwd = track(makeTargetProject());
    seedAll(cwd);
    fs.writeFileSync(path.join(cwd, "pipeline", "runbook.md"), "# Runbook\n## Rollback\n## Health signals\n");
    next({ cwd });
    const stage07 = JSON.parse(fs.readFileSync(path.join(cwd, "pipeline", "gates", "stage-07.json"), "utf8"));
    assert.equal(stage07.runbook_referenced, true);
    assert.deepEqual(stage07.warnings, []);
  });

  it("warns when runbook is missing (but still folds)", () => {
    const cwd = track(makeTargetProject());
    seedAll(cwd);
    // No runbook.md
    next({ cwd });
    const stage07 = JSON.parse(fs.readFileSync(path.join(cwd, "pipeline", "gates", "stage-07.json"), "utf8"));
    assert.equal(stage07.runbook_referenced, false);
    assert.ok(stage07.warnings.some((w) => /runbook/i.test(w)));
  });
});

describe("auto-fold: refuses when contract not satisfied", () => {
  it("does NOT fold when an AC is unmapped (QA agent's claim is wrong)", () => {
    const cwd = track(makeTargetProject());
    seedAll(cwd);
    // Override report to drop AC-2 — QA's gate still claims all_acceptance_criteria_met:true
    fs.writeFileSync(
      path.join(cwd, "pipeline", "test-report.md"),
      "# Test Report\n\n## AC Coverage\n| AC | Test |\n|---|---|\n| AC-1 | t1 |\n",
    );
    const r = next({ cwd });
    assert.equal(r.action, "run-stage");
    assert.equal(r.name, "sign-off", "should fall through to normal sign-off, not auto-fold");
    assert.ok(!fs.existsSync(path.join(cwd, "pipeline", "gates", "stage-07.json")));
  });

  it("does NOT fold when stage-06 is not PASS", () => {
    const cwd = track(makeTargetProject());
    seedAll(cwd);
    // Overwrite stage-06 to FAIL
    seedGate(cwd, "stage-06", {
      stage: "stage-06", status: "FAIL",
      blockers: ["one test failing"],
      all_acceptance_criteria_met: true,
      criterion_to_test_mapping_is_one_to_one: true,
    });
    const r = next({ cwd });
    // Stage 06 FAIL halts before sign-off
    assert.equal(r.action, "fix-and-retry");
    assert.ok(!fs.existsSync(path.join(cwd, "pipeline", "gates", "stage-07.json")));
  });

  it("does NOT fold when QA agent claims 1:1 but stage-06 says otherwise", () => {
    const cwd = track(makeTargetProject());
    seedAll(cwd);
    // QA agent now backs off the 1:1 claim
    seedGate(cwd, "stage-06", {
      stage: "stage-06", status: "PASS",
      all_acceptance_criteria_met: true,
      criterion_to_test_mapping_is_one_to_one: false, // explicitly false
    });
    const r = next({ cwd });
    assert.equal(r.name, "sign-off", "without 1:1 mapping, auto-fold refuses; falls through to normal sign-off");
    assert.ok(!fs.existsSync(path.join(cwd, "pipeline", "gates", "stage-07.json")));
  });

  it("does NOT fold when stage-07 workstreams already exist (PM/Platform started)", () => {
    const cwd = track(makeTargetProject());
    seedAll(cwd);
    // Seed a stage-07.pm.json — implies PM already authored their slice
    seedGate(cwd, "stage-07.pm", {
      stage: "stage-07", workstream: "pm", status: "PASS", host: "claude-code",
    });
    next({ cwd });
    // No stage-07.json should have been auto-folded; the orchestrator
    // should respect that work is in flight.
    const stage07Path = path.join(cwd, "pipeline", "gates", "stage-07.json");
    if (fs.existsSync(stage07Path)) {
      const g = JSON.parse(fs.readFileSync(stage07Path, "utf8"));
      assert.notEqual(g.auto_from_stage_06, true,
        "if stage-07.json exists, it should not be the auto-fold variant when workstreams already started");
    }
  });

  it("does NOT fold when brief.md has no AC-N entries", () => {
    const cwd = track(makeTargetProject());
    seedAll(cwd);
    fs.writeFileSync(path.join(cwd, "pipeline", "brief.md"), "# Brief\nFreeform prose with no AC entries.\n");
    const r = next({ cwd });
    assert.equal(r.name, "sign-off", "no AC-N in brief → no auto-fold; sign-off runs normally");
    assert.ok(!fs.existsSync(path.join(cwd, "pipeline", "gates", "stage-07.json")));
  });

  it("does NOT fold when test-report.md is missing", () => {
    const cwd = track(makeTargetProject());
    seedAll(cwd);
    fs.unlinkSync(path.join(cwd, "pipeline", "test-report.md"));
    const r = next({ cwd });
    assert.equal(r.name, "sign-off");
    assert.ok(!fs.existsSync(path.join(cwd, "pipeline", "gates", "stage-07.json")));
  });
});
