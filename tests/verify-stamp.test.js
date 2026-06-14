const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeTargetProject, cleanup } = require("./_helpers");
const { stamp, stampStage03b, stampStage04a, stampStage06, extractAcsFromBrief } =
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

  // Audit P2-7: middle path of the command-resolution fall-through chain.
  // Unit-tested in verify-runner.test.js for resolveCommands directly;
  // this exercises it through the full stamping flow to catch any
  // wiring break between resolveCommands and the stamp logic.
  it("falls back to package.json scripts.lint / scripts.test when .devteam/config.yml has no verify section", async () => {
    // makeTargetProject's default config has no pipeline.verify.*
    const cwd = track(makeTargetProject());
    // Add a package.json with lint + test scripts that both succeed.
    fs.writeFileSync(
      path.join(cwd, "package.json"),
      JSON.stringify({ name: "test-fixture", scripts: { lint: "true", test: "true" } }, null, 2),
    );
    const gatePath = seedGateRaw(cwd, "stage-04a", {
      stage: "stage-04a", status: "PASS", orchestrator: "devteam@test", host: "generic",
      track: "full", timestamp: "2026-06-02T12:00:00Z",
      blockers: [], warnings: [],
      lint_passed: true, tests_passed: true,
      dependency_review_passed: true, security_review_required: false,
    });
    const r = await stampStage04a(cwd, gatePath);
    assert.equal(r.ok, true);
    // Both should resolve to "npm run lint" / "npm test" and exit 0.
    assert.equal(r.gate._orchestrator_stamped.runs.lint.exit_code, 0,
      "lint resolved from package.json scripts.lint and ran cleanly");
    assert.equal(r.gate._orchestrator_stamped.runs.test.exit_code, 0,
      "test resolved from package.json scripts.test and ran cleanly");
    // Should NOT show "skipped" — fall-through worked.
    assert.ok(!("skipped" in r.gate._orchestrator_stamped.runs.lint),
      "lint should not be skipped when package.json provides a script");
    assert.ok(!("skipped" in r.gate._orchestrator_stamped.runs.test),
      "test should not be skipped when package.json provides a script");
    assert.equal(r.gate.status, "PASS");
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

describe("verify/stamp: stampStage03b — spec drift detection", () => {
  function seedBrief(cwd, content) {
    fs.mkdirSync(path.join(cwd, "pipeline"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "pipeline", "brief.md"), content);
  }
  function seedSpec(cwd, content) {
    fs.mkdirSync(path.join(cwd, "pipeline"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "pipeline", "spec.feature"), content);
  }
  function seedGate03b(cwd, extra = {}) {
    return seedGateRaw(cwd, "stage-03b", {
      stage: "stage-03b", status: "PASS", orchestrator: "devteam@test", host: "generic",
      track: "full", timestamp: "2026-06-13T12:00:00Z",
      blockers: [], warnings: [],
      criteria_count: 0,
      scenarios_count: 0,
      criteria_to_scenario_mapping: [],
      all_criteria_mapped: false,
      orphan_scenarios: [],
      orphan_criteria: [],
      drift: false,
      ...extra,
    });
  }
  const BRIEF_2ACS = "## ACs\n- AC-1: user can sign in\n- AC-2: user can reset password\n";
  const SPEC_2ACS  =
    "Feature: auth\n  @AC-1\n  Scenario: AC-1 — sign in\n    Given a user exists\n    When they sign in\n    Then session created\n" +
    "  @AC-2\n  Scenario: AC-2 — reset password\n    Given a user exists\n    When they reset\n    Then email sent\n";

  it("stamps all gate fields from actual brief + spec (happy path)", async () => {
    const cwd = track(makeTargetProject());
    seedBrief(cwd, BRIEF_2ACS);
    seedSpec(cwd, SPEC_2ACS);
    const gatePath = seedGate03b(cwd);
    const r = await stampStage03b(cwd, gatePath);
    assert.equal(r.ok, true);
    assert.equal(r.gate.criteria_count, 2);
    assert.equal(r.gate.scenarios_count, 2);
    assert.equal(r.gate.all_criteria_mapped, true);
    assert.equal(r.gate.drift, false);
    assert.deepEqual(r.gate.orphan_criteria, []);
    assert.deepEqual(r.gate.orphan_scenarios, []);
    assert.equal(r.gate.criteria_to_scenario_mapping.length, 2);
    const ac1 = r.gate.criteria_to_scenario_mapping.find((m) => m.criterion_id === "AC-1");
    assert.ok(ac1, "AC-1 mapping present");
    assert.ok(ac1.scenarios.some((s) => /sign in/.test(s)), "AC-1 scenario name present");
    assert.ok(r.gate._orchestrator_stamped);
    assert.equal(r.gate._orchestrator_stamped.runs.spec_verify.drift, false);
  });

  it("flips status to FAIL and records model_said when drift detected (model claimed PASS)", async () => {
    const cwd = track(makeTargetProject());
    seedBrief(cwd, "## ACs\n- AC-1: a\n- AC-2: b\n");
    seedSpec(cwd, "Feature: x\n  @AC-1\n  Scenario: AC-1\n    Then ok\n"); // AC-2 missing
    const gatePath = seedGate03b(cwd, {
      status: "PASS",
      all_criteria_mapped: true, // model claimed mapped
      drift: false,              // model claimed no drift
    });
    const r = await stampStage03b(cwd, gatePath);
    assert.equal(r.gate.status, "FAIL", "status must flip to FAIL when drift found");
    assert.equal(r.gate.drift, true);
    assert.equal(r.gate.all_criteria_mapped, false);
    assert.ok(r.gate.orphan_criteria.includes("AC-2"), "AC-2 is orphan");
    const driftField = r.gate._orchestrator_stamped.fields.find((f) => f.field === "drift");
    assert.equal(driftField.model_said, false, "model_said=false recorded");
    assert.equal(driftField.orchestrator, true, "orchestrator=true recorded");
    assert.ok(r.gate._orchestrator_stamped.status_overridden, "status_overridden audit present");
    assert.ok(r.gate.blockers.some((b) => /spec drift/.test(b)), "drift blocker added");
  });

  it("generates scaffold and records it when spec.feature is absent", async () => {
    const cwd = track(makeTargetProject());
    seedBrief(cwd, "## ACs\n- AC-1: sign in\n");
    // No spec.feature — stamper should generate one
    const gatePath = seedGate03b(cwd);
    const r = await stampStage03b(cwd, gatePath);
    assert.equal(r.ok, true);
    // Scaffold was generated
    assert.ok(r.gate._orchestrator_stamped.runs.spec_generate.generated, "scaffold generated");
    // Even a generated scaffold has all_criteria_mapped=false (Given/When/Then are TODOs)
    // but criteria_count should reflect the brief
    assert.equal(r.gate.criteria_count, 1);
    // The spec.feature should now exist on disk
    assert.ok(fs.existsSync(path.join(cwd, "pipeline", "spec.feature")));
  });

  it("skips brief-dependent logic when pipeline/brief.md is absent", async () => {
    const cwd = track(makeTargetProject());
    // No brief.md, no spec.feature
    const gatePath = seedGate03b(cwd);
    const r = await stampStage03b(cwd, gatePath);
    assert.equal(r.ok, true);
    assert.match(r.gate._orchestrator_stamped.runs.spec_verify.skipped, /brief\.md not found/);
    // No status flip — stamper degrades gracefully
    assert.equal(r.gate.status, "PASS");
  });

  it("records model_said vs orchestrator when gate counts disagree", async () => {
    const cwd = track(makeTargetProject());
    seedBrief(cwd, BRIEF_2ACS);
    seedSpec(cwd, SPEC_2ACS);
    const gatePath = seedGate03b(cwd, {
      criteria_count: 99,  // wrong model value
      scenarios_count: 99,
    });
    const r = await stampStage03b(cwd, gatePath);
    const ccField = r.gate._orchestrator_stamped.fields.find((f) => f.field === "criteria_count");
    assert.equal(ccField.model_said, 99, "model_said captured");
    assert.equal(ccField.orchestrator, 2, "orchestrator observed 2");
    assert.equal(r.gate.criteria_count, 2, "gate overwritten with orchestrator value");
  });

  it("dispatch: stage-03b is stampable and round-trips through stamp()", async () => {
    const cwd = track(makeTargetProject());
    seedBrief(cwd, BRIEF_2ACS);
    seedSpec(cwd, SPEC_2ACS);
    seedGate03b(cwd);
    const r = await stamp(cwd, "stage-03b");
    assert.equal(r.ok, true, r.error);
    assert.equal(r.gate.drift, false);
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
