const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { REPO_ROOT, makeTargetProject, seedGate, cleanup, runCLI } = require("./_helpers");
const { next, clearGatesFromFixSteps } = require(path.join(REPO_ROOT, "core", "orchestrator"));

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

describe("next: malformed gate handling", () => {
  it("returns fix-and-retry with a clear error when a stage gate is malformed", () => {
    const cwd = track(makeTargetProject());
    const fs = require("node:fs");
    const gatePath = path.join(cwd, "pipeline", "gates", "stage-01.json");
    fs.writeFileSync(gatePath, '{"stage":"stage-01","status":"PA', "utf8"); // truncated mid-emit
    const r = next({ cwd });
    assert.equal(r.action, "fix-and-retry");
    assert.equal(r.name, "requirements");
    assert.ok(Array.isArray(r.blockers) && r.blockers.length > 0, "blockers populated");
    assert.match(r.blockers[0], /unreadable|malformed/i);
  });
});

describe("next: failure classification (H1)", () => {
  it("FAIL gate → failure_class code-defect", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { status: "FAIL", blockers: ["bad criterion"] });
    const r = next({ cwd });
    assert.equal(r.action, "fix-and-retry");
    assert.equal(r.failure_class, "code-defect");
  });

  it("ESCALATE gate → failure_class judgment-gate", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { status: "ESCALATE", escalation_reason: "ambiguous spec" });
    const r = next({ cwd });
    assert.equal(r.action, "resolve-escalation");
    assert.equal(r.failure_class, "judgment-gate");
  });

  it("malformed gate → failure_class state-corruption", () => {
    const cwd = track(makeTargetProject());
    const fs = require("node:fs");
    fs.writeFileSync(
      path.join(cwd, "pipeline", "gates", "stage-01.json"),
      '{"stage":"stage-01","status":"FA', "utf8",
    );
    const r = next({ cwd });
    assert.equal(r.action, "fix-and-retry");
    assert.equal(r.failure_class, "state-corruption");
  });

  it("PASS/WARN actions carry no failure_class", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { status: "PASS" });
    const r = next({ cwd }); // → run-stage design
    assert.equal(r.action, "run-stage");
    assert.equal(r.failure_class, undefined);
  });
});

describe("next: convergence ceiling (H1)", () => {
  it("FAIL below the retry ceiling → still fix-and-retry", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", {
      status: "FAIL", blockers: ["x"], retry_number: 1, this_attempt_differs_by: "tried Y",
    });
    const r = next({ cwd });
    assert.equal(r.action, "fix-and-retry");
    assert.equal(r.failure_class, "code-defect");
  });

  it("FAIL at the retry ceiling (default 2) → resolve-escalation, convergence-exhausted", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", {
      status: "FAIL", blockers: ["x"], retry_number: 2, this_attempt_differs_by: "tried Z",
    });
    const r = next({ cwd });
    assert.equal(r.action, "resolve-escalation");
    assert.equal(r.failure_class, "convergence-exhausted");
    assert.match(r.reason, /retry budget exhausted/i);
  });

  it("respects autonomy.max_retries override from config", () => {
    const cwd = track(makeTargetProject({
      config: "routing:\n  default_host: generic\npipeline:\n  default_track: full\nautonomy:\n  max_retries: 0\n",
    }));
    // retry_number 0 already meets a ceiling of 0 → escalate on first FAIL.
    seedGate(cwd, "stage-01", { status: "FAIL", blockers: ["x"] });
    const r = next({ cwd });
    assert.equal(r.action, "resolve-escalation");
    assert.equal(r.failure_class, "convergence-exhausted");
  });
});

describe("next --json (H1)", () => {
  it("emits schema_version and carries failure_class through to JSON", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { status: "FAIL", blockers: ["bad criterion"] });
    const { status, stdout } = runCLI(["next", "--json"], { cwd });
    assert.equal(status, 0);
    const obj = JSON.parse(stdout);
    assert.equal(obj.schema_version, "1.0");
    assert.equal(obj.action, "fix-and-retry");
    assert.equal(obj.failure_class, "code-defect");
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

  it("nano completes after build + peer-review + qa", () => {
    const cwd = track(makeTargetProject({
      config: "routing:\n  default_host: generic\npipeline:\n  default_track: nano\n",
    }));
    seedGate(cwd, "stage-04", { status: "PASS" });
    seedGate(cwd, "stage-05", { status: "PASS" });
    seedGate(cwd, "stage-06", { status: "PASS" });
    const r = next({ cwd });
    assert.equal(r.action, "pipeline-complete");
  });

  it("nano dispatches a single peer-review workstream, not 4", () => {
    const cwd = track(makeTargetProject({
      config: "routing:\n  default_host: generic\npipeline:\n  default_track: nano\n",
    }));
    const { runStage } = require("../core/orchestrator");
    const r = runStage("peer-review", { cwd, track: "nano" });
    assert.equal(r.workstreams.length, 1, "nano peer-review should fan out to 1 workstream");
    assert.equal(r.workstreams[0].role, "backend", "scoped reviewer is the backend slot");
  });
});

describe("next: stage-05 per-area fix steps", () => {
  function seedPreReviewStages(cwd) {
    for (const s of ["stage-01", "stage-02", "stage-03", "stage-03b", "stage-04", "stage-04a",
                     "stage-04b", "stage-04c", "stage-04d", "stage-04e"]) {
      seedGate(cwd, s, { status: "PASS" });
    }
  }

  it("INSUFFICIENT_APPROVALS area → rm + re-run reviewer commands in fix_steps", () => {
    const cwd = track(makeTargetProject());
    seedPreReviewStages(cwd);
    // platform area: reviewer wrote wrong areas, quorum not reached
    seedGate(cwd, "stage-05.platform", {
      stage: "stage-05", workstream: "platform", status: "FAIL",
      failure_reason: "INSUFFICIENT_APPROVALS",
      approvals: [], required_approvals: 2, changes_requested: [], blockers: [],
    });
    // qa area: same problem
    seedGate(cwd, "stage-05.qa", {
      stage: "stage-05", workstream: "qa", status: "FAIL",
      failure_reason: "INSUFFICIENT_APPROVALS",
      approvals: ["dev-platform"], required_approvals: 2, changes_requested: [], blockers: [],
    });
    // backend area: approved (should be left alone)
    seedGate(cwd, "stage-05.backend", {
      stage: "stage-05", workstream: "backend", status: "PASS",
      approvals: ["dev-backend", "dev-platform"], required_approvals: 2,
    });
    // merged gate: FAIL
    seedGate(cwd, "stage-05", {
      status: "FAIL", changes_requested: [], approvals: [],
    });

    const r = next({ cwd });
    assert.equal(r.action, "fix-and-retry");
    assert.equal(r.name, "peer-review");
    assert.ok(Array.isArray(r.fix_steps) && r.fix_steps.length > 0, "fix_steps present");

    const allCmds = r.fix_steps.flatMap(s => s.commands);
    // Must include rm commands for the incomplete areas
    assert.ok(allCmds.some(c => c.includes("rm pipeline/gates/stage-05.platform.json")),
      "rm platform gate");
    assert.ok(allCmds.some(c => c.includes("rm pipeline/gates/stage-05.qa.json")),
      "rm qa gate");
    // Must include targeted peer-review re-run commands
    assert.ok(allCmds.some(c => c.includes("devteam stage peer-review --workstream platform")),
      "re-run platform reviewer");
    assert.ok(allCmds.some(c => c.includes("devteam stage peer-review --workstream qa")),
      "re-run qa reviewer");
    // Must include merge step
    assert.ok(allCmds.some(c => c.includes("devteam merge peer-review")), "merge step");
    // Must NOT include generic peer-review command
    assert.ok(!allCmds.some(c => c === "devteam stage peer-review --headless"),
      "no generic peer-review command");
    // Must NOT include rm for backend (it passed)
    assert.ok(!allCmds.some(c => c.includes("stage-05.backend.json")),
      "backend gate untouched");
  });

  it("CHANGES_REQUESTED area → build + rm + re-review commands in fix_steps", () => {
    const cwd = track(makeTargetProject());
    seedPreReviewStages(cwd);
    // frontend area: reviewer requested code changes
    seedGate(cwd, "stage-05.frontend", {
      stage: "stage-05", workstream: "frontend", status: "FAIL",
      failure_reason: "CHANGES_REQUESTED",
      approvals: [], required_approvals: 2,
      changes_requested: [{ reviewer: "dev-frontend", timestamp: "2026-06-09T10:00:00Z" }],
      blockers: [{ reviewer: "dev-frontend", text: "missing input validation" }],
    });
    // backend area: passed
    seedGate(cwd, "stage-05.backend", {
      stage: "stage-05", workstream: "backend", status: "PASS",
      approvals: ["dev-backend", "dev-platform"], required_approvals: 2,
    });
    // merged gate
    seedGate(cwd, "stage-05", { status: "FAIL" });

    const r = next({ cwd });
    assert.equal(r.action, "fix-and-retry");
    const allCmds = r.fix_steps.flatMap(s => s.commands);

    // Must include build stage gate clears so the driver backtracks to build
    assert.ok(allCmds.some(c => c.includes("rm pipeline/gates/stage-04.frontend.json")),
      "rm build workstream gate — driver must re-enter build to fix the code");
    assert.ok(allCmds.some(c => c === "rm pipeline/gates/stage-04.json"),
      "rm merged build gate — without this next() still sees build PASS and skips it");
    // Must include build re-run with --patch --from peer-review so the agent implements
    // the required changes rather than just verifying existing code
    assert.ok(allCmds.some(c => c.includes("devteam stage build --workstream frontend") && c.includes("--patch --from peer-review")),
      "rebuild frontend with --patch --from peer-review");
    assert.ok(allCmds.some(c => c.includes("devteam merge build")), "merge build");
    // Must include rm + re-review for the area with changes requested
    assert.ok(allCmds.some(c => c.includes("rm pipeline/gates/stage-05.frontend.json")),
      "rm frontend gate");
    assert.ok(allCmds.some(c => c.includes("devteam stage peer-review --workstream frontend")),
      "re-run frontend reviewer");
    assert.ok(allCmds.some(c => c.includes("devteam merge peer-review")), "merge peer-review");
    // Description should mention the blocker text
    const descs = r.fix_steps.map(s => s.description).join(" ");
    assert.ok(descs.includes("missing input validation"), "blocker text in description");
  });

  it("mixed areas (CHANGES_REQUESTED + INSUFFICIENT_APPROVALS) → both sets of commands", () => {
    const cwd = track(makeTargetProject());
    seedPreReviewStages(cwd);
    seedGate(cwd, "stage-05.backend", {
      stage: "stage-05", workstream: "backend", status: "FAIL",
      failure_reason: "CHANGES_REQUESTED",
      approvals: [], required_approvals: 2,
      changes_requested: [{ reviewer: "dev-backend", timestamp: "2026-06-09T10:00:00Z" }],
      blockers: [{ reviewer: "dev-backend", text: "add regression test" }],
    });
    seedGate(cwd, "stage-05.platform", {
      stage: "stage-05", workstream: "platform", status: "FAIL",
      failure_reason: "INSUFFICIENT_APPROVALS",
      approvals: [], required_approvals: 2, changes_requested: [], blockers: [],
    });
    seedGate(cwd, "stage-05", { status: "FAIL" });

    const r = next({ cwd });
    const allCmds = r.fix_steps.flatMap(s => s.commands);

    assert.ok(allCmds.some(c => c.includes("devteam stage build --workstream backend")),
      "rebuild backend");
    assert.ok(allCmds.some(c => c.includes("rm pipeline/gates/stage-05.platform.json")),
      "rm platform (incomplete matrix)");
    assert.ok(allCmds.some(c => c.includes("devteam stage peer-review --workstream platform")),
      "re-run platform reviewer");
    assert.ok(allCmds.some(c => c.includes("rm pipeline/gates/stage-05.backend.json")),
      "rm backend (changes requested)");
    assert.ok(allCmds.some(c => c.includes("devteam stage peer-review --workstream backend")),
      "re-run backend reviewer");
    assert.ok(allCmds.some(c => c.includes("devteam merge peer-review")), "merge peer-review");
  });

  it("no per-area gates on disk → falls back to merged-gate logic", () => {
    const cwd = track(makeTargetProject());
    seedPreReviewStages(cwd);
    // Only the merged gate exists — no stage-05.*.json files
    seedGate(cwd, "stage-05", {
      status: "FAIL",
      changes_requested: [{ reviewer: "dev-backend", workstream: "backend" }],
      approvals: [], required_approvals: 2,
      blockers: ["missing test coverage"],
    });

    const r = next({ cwd });
    assert.equal(r.action, "fix-and-retry");
    // Falls through to the merged-gate fallback path
    const allCmds = r.fix_steps.flatMap(s => s.commands);
    assert.ok(allCmds.some(c => c.includes("devteam stage peer-review")), "generic fallback present");
  });

  it("some per-area gates missing → fix steps name missing workstream + rm merged gate", () => {
    const cwd = track(makeTargetProject());
    seedPreReviewStages(cwd);
    // backend, platform, qa wrote PASS gates; frontend produced nothing
    seedGate(cwd, "stage-05.backend",  { stage: "stage-05", workstream: "backend",  status: "PASS", approvals: ["dev-platform", "dev-qa"] });
    seedGate(cwd, "stage-05.platform", { stage: "stage-05", workstream: "platform", status: "PASS", approvals: ["dev-backend", "dev-frontend"] });
    seedGate(cwd, "stage-05.qa",       { stage: "stage-05", workstream: "qa",       status: "PASS", approvals: ["dev-backend", "dev-platform"] });
    // stage-05.frontend.json is absent — frontend workstream timed out or crashed
    seedGate(cwd, "stage-05", { status: "FAIL", failure_reason: "INSUFFICIENT_APPROVALS", approvals: [], changes_requested: [] });

    const r = next({ cwd });
    assert.equal(r.action, "fix-and-retry");
    const allCmds = r.fix_steps.flatMap(s => s.commands);
    assert.ok(allCmds.some(c => c === "rm pipeline/gates/stage-05.json"),
      "clears merged gate so driver triggers continue-stage for missing workstream");
    assert.ok(allCmds.some(c => c.includes("devteam stage peer-review --workstream frontend")),
      "re-run missing frontend reviewer");
    assert.ok(allCmds.some(c => c.includes("devteam merge peer-review")), "re-merge after re-run");
  });

  it("merged gate FAIL with no blockers and no missing gates → surfaces failure_reason", () => {
    const cwd = track(makeTargetProject());
    seedPreReviewStages(cwd);
    // All per-area gates PASS, but merged is FAIL with an exotic failure_reason
    seedGate(cwd, "stage-05.backend",  { stage: "stage-05", workstream: "backend",  status: "PASS", approvals: ["dev-platform"] });
    seedGate(cwd, "stage-05.frontend", { stage: "stage-05", workstream: "frontend", status: "PASS", approvals: ["dev-backend"] });
    seedGate(cwd, "stage-05.platform", { stage: "stage-05", workstream: "platform", status: "PASS", approvals: ["dev-frontend"] });
    seedGate(cwd, "stage-05.qa",       { stage: "stage-05", workstream: "qa",       status: "PASS", approvals: ["dev-backend"] });
    seedGate(cwd, "stage-05", {
      status: "FAIL", failure_reason: "SCHEMA_INVALID",
      changes_requested: [], approvals: [], required_approvals: 0,
    });

    const r = next({ cwd });
    assert.equal(r.action, "fix-and-retry");
    const allCmds = r.fix_steps.flatMap(s => s.commands);
    // Must produce at least an rm + re-merge so the driver can clear and loop
    assert.ok(allCmds.some(c => c === "rm pipeline/gates/stage-05.json"), "clears merged gate");
    assert.ok(allCmds.some(c => c.includes("devteam merge peer-review")), "re-merge");
    // Description must mention the failure_reason
    const allDescs = r.fix_steps.map(s => s.description).join(" ");
    assert.ok(allDescs.includes("SCHEMA_INVALID"), "surfaces failure_reason in description");
  });
});

describe("next: stage-06b (accessibility-audit) fix steps", () => {
  function seedThroughBuild(cwd) {
    for (const s of ["stage-01", "stage-02", "stage-03", "stage-03b", "stage-04", "stage-04a",
                     "stage-04b", "stage-04c", "stage-04d", "stage-05", "stage-06"]) {
      seedGate(cwd, s, { status: "PASS" });
    }
  }

  it("A11Y items in noted_for_followup → devteam advise --apply <noted-id>=A", () => {
    const cwd = track(makeTargetProject());
    seedThroughBuild(cwd);
    // The build-QA workstream noted accessibility issues in its gate (realistic id pattern).
    seedGate(cwd, "stage-04.qa", {
      workstream: "qa", status: "PASS",
      noted_for_followup: [
        { id: "QA-A11Y-01", summary: "Missing aria-live on #results — accessibility gap", severity: "serious" },
        { id: "QA-A11Y-02", summary: "WCAG 2.1 SC 1.3.1: label missing for= attribute", severity: "moderate" },
      ],
    });
    seedGate(cwd, "stage-06b", { status: "FAIL", blockers: [
      { id: "A11Y-01", element: "#results div", description: "Missing aria-live.", assigned_to: "frontend" },
    ]});

    const r = next({ cwd });
    assert.equal(r.action, "fix-and-retry");
    assert.equal(r.name, "accessibility-audit");
    assert.ok(Array.isArray(r.fix_steps) && r.fix_steps.length > 0, "fix_steps present");

    const allCmds = r.fix_steps.flatMap(s => s.commands);
    // Must use the noted_for_followup IDs (QA-A11Y-*), not the blocker IDs (A11Y-*)
    assert.ok(allCmds.some(c => c.includes("devteam advise --apply")
      && c.includes("QA-A11Y-01=A") && c.includes("QA-A11Y-02=A")),
      "uses noted_for_followup IDs, not blocker IDs");
    assert.ok(!allCmds.some(c => c.includes("A11Y-01=A") && !c.includes("QA-")),
      "does not use raw blocker ID A11Y-01");
    // advise handles gate reset and re-run internally
    assert.ok(!allCmds.some(c => c.includes("rm pipeline/gates/stage-06b.json")),
      "no manual gate rm");
    assert.ok(!allCmds.some(c => c.includes("devteam stage accessibility-audit")),
      "no separate re-run");
  });

  it("no A11Y items in noted_for_followup → falls back to plain devteam advise", () => {
    const cwd = track(makeTargetProject());
    seedThroughBuild(cwd);
    seedGate(cwd, "stage-06b", {
      status: "FAIL",
      blockers: [{ id: "A11Y-01", description: "Missing aria-live.", assigned_to: "frontend" }],
    });
    // No noted_for_followup with A11Y keywords anywhere

    const r = next({ cwd });
    assert.equal(r.action, "fix-and-retry");
    const allCmds = r.fix_steps.flatMap(s => s.commands);
    assert.ok(allCmds.some(c => c === "devteam advise"), "falls back to plain devteam advise");
    assert.ok(!allCmds.some(c => c.includes("--apply")), "no --apply without noted_for_followup ids");
  });
});

describe("next: stage-06d (verification-beyond-tests) fix steps", () => {
  function seedThroughQa(cwd) {
    for (const s of ["stage-01", "stage-02", "stage-03", "stage-03b", "stage-04", "stage-04a",
                     "stage-04b", "stage-04c", "stage-04d", "stage-05", "stage-06",
                     "stage-06b", "stage-06c"]) {
      seedGate(cwd, s, { status: "PASS" });
    }
  }

  it("blocker with Fix: file path → targeted build + rm gate + re-run commands", () => {
    const cwd = track(makeTargetProject());
    seedThroughQa(cwd);
    seedGate(cwd, "stage-06d", {
      status: "FAIL",
      blockers: [
        "P11: Infinity exchange rate produces cost_cad=Infinity. Fix: src/backend/server.js:10 — change isNaN guard to (isNaN(_rawRate) || !isFinite(_rawRate))",
      ],
    });

    const r = next({ cwd });
    assert.equal(r.action, "fix-and-retry");
    assert.equal(r.name, "verification-beyond-tests");
    assert.ok(Array.isArray(r.fix_steps) && r.fix_steps.length > 0, "fix_steps present");

    const descs = r.fix_steps.map(s => s.description).join(" ");
    const allCmds = r.fix_steps.flatMap(s => s.commands);

    // File path surfaces in description
    assert.ok(descs.includes("src/backend/server.js:10"), "file path in description");
    // Workstream derived from src/backend/ path
    assert.ok(allCmds.some(c => c.includes("devteam stage build --workstream backend")),
      "backend build command");
    assert.ok(allCmds.some(c => c.includes("devteam merge build")), "merge build");
    // Gate cleared before re-run
    assert.ok(allCmds.some(c => c.includes("rm pipeline/gates/stage-06d.json")),
      "rm stage-06d gate");
    assert.ok(allCmds.some(c => c.includes("devteam stage verification-beyond-tests")),
      "re-run verification command");
  });

  it("blocker without Fix: clause → generic description, still re-runs verification", () => {
    const cwd = track(makeTargetProject());
    seedThroughQa(cwd);
    seedGate(cwd, "stage-06d", {
      status: "FAIL",
      blockers: ["Surviving mutant on critical path — manual investigation required"],
    });

    const r = next({ cwd });
    assert.equal(r.action, "fix-and-retry");
    const allCmds = r.fix_steps.flatMap(s => s.commands);
    assert.ok(allCmds.some(c => c.includes("devteam stage verification-beyond-tests")),
      "re-run verification always present");
    // No build steps without a parseable file path
    assert.ok(!allCmds.some(c => c.includes("devteam stage build")),
      "no build step when no file path");
  });
});

describe("next: structured clear_gates", () => {
  it("clearGatesFromFixSteps extracts repo-relative pipeline/gates targets, deduped", () => {
    const steps = [
      { description: "x", commands: ["rm pipeline/gates/stage-04.backend.json", "devteam stage build --headless"] },
      { description: "y", commands: ["rm -f pipeline/gates/stage-04.json", "rm pipeline/gates/stage-04.json"] },
      { description: "z", commands: ["rm /etc/passwd"] }, // outside pipeline/gates — ignored
    ];
    assert.deepEqual(clearGatesFromFixSteps(steps), [
      "pipeline/gates/stage-04.backend.json",
      "pipeline/gates/stage-04.json",
    ]);
  });

  it("next() attaches structured clear_gates on a recipe-bearing FAIL", () => {
    const cwd = track(makeTargetProject());
    for (const s of ["stage-01", "stage-02", "stage-03", "stage-03b"]) seedGate(cwd, s, { status: "PASS" });
    seedGate(cwd, "stage-04", { status: "FAIL", blockers: ["build broke"] });
    const r = next({ cwd });
    assert.equal(r.action, "fix-and-retry");
    assert.equal(r.name, "build");
    assert.ok(Array.isArray(r.clear_gates), "clear_gates present");
    assert.ok(r.clear_gates.includes("pipeline/gates/stage-04.json"),
      `expected stage-04.json in clear_gates, got ${JSON.stringify(r.clear_gates)}`);
  });
});
