const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeTargetProject, cleanup } = require("./_helpers");
const { stamp, stampStage04a, stampStage06, extractAcsFromBrief, extractAcsFromReport } =
  require("../core/verify/stamp");

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
afterEach(() => { _dirs.forEach(cleanup); _dirs = []; });

function seedGateRaw(cwd, name, content) {
  const dir = path.join(cwd, "pipeline", "gates");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(content, null, 2));
  return file;
}

function configWith(verify) {
  return `routing:\n  default_host: generic\npipeline:\n  default_track: full\n  verify:\n${
    Object.entries(verify).map(([k, v]) => `    ${k}: ${JSON.stringify(v)}`).join("\n")
  }\n`;
}

describe("verify/stamp: extractAcsFromBrief", () => {
  it("finds AC-N in plain bullet form", () => {
    const text = "## Acceptance criteria\n- AC-1: foo\n- AC-2: bar\n- AC-3: baz\n";
    assert.deepEqual(extractAcsFromBrief(text), ["AC-1", "AC-2", "AC-3"]);
  });

  it("finds AC-N in bolded form", () => {
    const text = "**AC-1** — first\n**AC-2** — second\n";
    assert.deepEqual(extractAcsFromBrief(text), ["AC-1", "AC-2"]);
  });

  it("deduplicates references", () => {
    const text = "AC-1: foo\n... see AC-1 elsewhere ... AC-2: bar";
    assert.deepEqual(extractAcsFromBrief(text), ["AC-1", "AC-2"]);
  });

  it("returns empty for a brief with no AC-N references", () => {
    assert.deepEqual(extractAcsFromBrief("# Title\nProse only."), []);
  });
});

describe("verify/stamp: stampStage04a — happy path", () => {
  it("stamps lint_passed=true when lint command exits 0", async () => {
    const cwd = track(makeTargetProject({
      config: configWith({ lint_command: "true", test_command: "true" }),
    }));
    const gatePath = seedGateRaw(cwd, "stage-04a", {
      stage: "stage-04a", status: "PASS", orchestrator: "devteam@test", host: "generic",
      track: "full", timestamp: "2026-06-02T12:00:00Z",
      blockers: [], warnings: [],
      lint_passed: true, tests_passed: true,
      dependency_review_passed: true, security_review_required: false,
    });
    const r = await stampStage04a(cwd, gatePath);
    assert.equal(r.ok, true);
    assert.equal(r.gate.status, "PASS");
    assert.equal(r.gate.lint_passed, true);
    assert.equal(r.gate.tests_passed, true);
    assert.ok(r.gate._orchestrator_stamped);
    assert.ok(r.gate._orchestrator_stamped.runs.lint);
    assert.equal(r.gate._orchestrator_stamped.runs.lint.exit_code, 0);
  });

  it("flips status to FAIL when lint exits non-zero (model claimed PASS)", async () => {
    const cwd = track(makeTargetProject({
      config: configWith({ lint_command: "false", test_command: "true" }),
    }));
    const gatePath = seedGateRaw(cwd, "stage-04a", {
      stage: "stage-04a", status: "PASS", orchestrator: "devteam@test", host: "generic",
      track: "full", timestamp: "2026-06-02T12:00:00Z",
      blockers: [], warnings: [],
      lint_passed: true, tests_passed: true, // model lied / was optimistic
      dependency_review_passed: true, security_review_required: false,
    });
    const r = await stampStage04a(cwd, gatePath);
    assert.equal(r.gate.status, "FAIL", "status must flip when lint actually fails");
    assert.equal(r.gate.lint_passed, false);
    assert.ok(r.gate.blockers.some((b) => /lint failed/.test(b)), "blocker recorded");
    const overrideField = r.gate._orchestrator_stamped.fields.find((f) => f.field === "lint_passed");
    assert.equal(overrideField.model_said, true);
    assert.equal(overrideField.orchestrator, false);
    assert.ok(r.gate._orchestrator_stamped.status_overridden, "status_overridden audit entry present");
  });

  it("records skipped runs when commands aren't configured", async () => {
    const cwd = track(makeTargetProject()); // default config — no verify section, no package.json
    const gatePath = seedGateRaw(cwd, "stage-04a", {
      stage: "stage-04a", status: "PASS", orchestrator: "devteam@test", host: "generic",
      track: "full", timestamp: "2026-06-02T12:00:00Z",
      blockers: [], warnings: [],
      lint_passed: true, tests_passed: true,
      dependency_review_passed: true, security_review_required: false,
    });
    const r = await stampStage04a(cwd, gatePath);
    assert.equal(r.ok, true);
    assert.match(r.gate._orchestrator_stamped.runs.lint.skipped, /no lint command/);
    assert.match(r.gate._orchestrator_stamped.runs.test.skipped, /no test command/);
    assert.equal(r.gate.status, "PASS", "skipped runs don't flip status");
  });
});

describe("verify/stamp: stampStage06 — AC mapping", () => {
  function seedBrief(cwd, content) {
    fs.mkdirSync(path.join(cwd, "pipeline"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "pipeline", "brief.md"), content);
  }
  function seedReport(cwd, content) {
    fs.mkdirSync(path.join(cwd, "pipeline"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "pipeline", "test-report.md"), content);
  }

  it("PASSes when every AC in brief is covered by the test report", async () => {
    const cwd = track(makeTargetProject({
      config: configWith({ test_command: "true" }),
    }));
    seedBrief(cwd, "## Criteria\n- AC-1: foo\n- AC-2: bar\n");
    seedReport(cwd, "| AC | Test |\n|---|---|\n| AC-1 | t1 |\n| AC-2 | t2 |\n");
    const gatePath = seedGateRaw(cwd, "stage-06", {
      stage: "stage-06", status: "PASS", orchestrator: "devteam@test", host: "generic",
      track: "full", timestamp: "2026-06-02T12:00:00Z",
      blockers: [], warnings: [],
      all_acceptance_criteria_met: true,
      tests_total: 2, tests_passed: 2, tests_failed: 0, failing_tests: [],
      criterion_to_test_mapping_is_one_to_one: true,
    });
    const r = await stampStage06(cwd, gatePath);
    assert.equal(r.gate.status, "PASS");
    assert.equal(r.gate.all_acceptance_criteria_met, true);
  });

  it("flips status to FAIL when an AC is unmapped (model claimed met)", async () => {
    const cwd = track(makeTargetProject({
      config: configWith({ test_command: "true" }),
    }));
    seedBrief(cwd, "## Criteria\n- AC-1: foo\n- AC-2: bar\n- AC-3: baz\n");
    seedReport(cwd, "| AC | Test |\n|---|---|\n| AC-1 | t1 |\n| AC-2 | t2 |\n"); // AC-3 missing
    const gatePath = seedGateRaw(cwd, "stage-06", {
      stage: "stage-06", status: "PASS", orchestrator: "devteam@test", host: "generic",
      track: "full", timestamp: "2026-06-02T12:00:00Z",
      blockers: [], warnings: [],
      all_acceptance_criteria_met: true, // model claim
      tests_total: 2, tests_passed: 2, tests_failed: 0, failing_tests: [],
      criterion_to_test_mapping_is_one_to_one: true,
    });
    const r = await stampStage06(cwd, gatePath);
    assert.equal(r.gate.status, "FAIL");
    assert.equal(r.gate.all_acceptance_criteria_met, false);
    assert.ok(r.gate.blockers.some((b) => /unmapped/.test(b) && /AC-3/.test(b)));
  });

  it("flips status to FAIL when test command fails (model claimed PASS)", async () => {
    const cwd = track(makeTargetProject({
      config: configWith({ test_command: "false" }),
    }));
    seedBrief(cwd, "## Criteria\n- AC-1: foo\n");
    seedReport(cwd, "| AC | Test |\n|---|---|\n| AC-1 | t1 |\n");
    const gatePath = seedGateRaw(cwd, "stage-06", {
      stage: "stage-06", status: "PASS", orchestrator: "devteam@test", host: "generic",
      track: "full", timestamp: "2026-06-02T12:00:00Z",
      blockers: [], warnings: [],
      all_acceptance_criteria_met: true,
      tests_total: 1, tests_passed: 1, tests_failed: 0, failing_tests: [],
      criterion_to_test_mapping_is_one_to_one: true,
    });
    const r = await stampStage06(cwd, gatePath);
    assert.equal(r.gate.status, "FAIL");
    assert.ok(r.gate.blockers.some((b) => /test command failed/.test(b)));
  });

  it("skips AC mapping when brief.md is absent (hotfix/nano track)", async () => {
    const cwd = track(makeTargetProject({
      config: configWith({ test_command: "true" }),
    }));
    // No brief.md
    const gatePath = seedGateRaw(cwd, "stage-06", {
      stage: "stage-06", status: "PASS", orchestrator: "devteam@test", host: "generic",
      track: "nano", timestamp: "2026-06-02T12:00:00Z",
      blockers: [], warnings: [],
      all_acceptance_criteria_met: true,
      tests_total: 1, tests_passed: 1, tests_failed: 0, failing_tests: [],
      criterion_to_test_mapping_is_one_to_one: true,
    });
    const r = await stampStage06(cwd, gatePath);
    assert.equal(r.gate.status, "PASS");
    assert.match(r.gate._orchestrator_stamped.runs.ac_mapping.skipped, /brief\.md not found/);
  });
});

describe("verify/stamp: dispatch", () => {
  it("rejects unknown stage", async () => {
    const cwd = track(makeTargetProject());
    const r = await stamp(cwd, "stage-99");
    assert.equal(r.ok, false);
    assert.match(r.error, /no orchestrator stamping defined/);
  });

  it("rejects missing gate", async () => {
    const cwd = track(makeTargetProject());
    const r = await stamp(cwd, "stage-04a");
    assert.equal(r.ok, false);
    assert.match(r.error, /gate not found/);
  });
});
