// The peer-review gate skeleton rendered into the prompt must match the track's
// review sizing. The static stage definition says matrix/2; a loop reviewer saw
// that, saw scoped/1 in rules/stage-05.md, read run-plan.json three times to
// reconcile them, and wrote the gate as scoped/1 anyway (run D, 2026-09-05).

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { REPO_ROOT } = require("./_helpers");
const { loadAdapter } = require("./_host-plugins");
const { buildDescriptor } = require(path.join(REPO_ROOT, "core", "orchestrator"));
const { getStage } = require(path.join(REPO_ROOT, "core", "pipeline", "stages"));

const stage = getStage("peer-review");
const shape = (track, role, roles) => buildDescriptor(stage, role, { track, rolesInStage: roles }).expectedGate;

describe("peer-review expectedGate follows the track's review sizing", () => {
  test("single-reviewer tracks render scoped / 1", () => {
    for (const [track, role] of [["loop", "backend"], ["nano", "backend"], ["refactor", "backend"], ["review-pr", "reviewer"]]) {
      const g = shape(track, role, [role]);
      assert.equal(g.review_shape, "scoped", `${track}: review_shape`);
      assert.equal(g.required_approvals, 1, `${track}: required_approvals`);
    }
  });

  test("matrix tracks render matrix / 2", () => {
    for (const track of ["full", "quick", "hotfix", "dep-update", "config-only"]) {
      const g = shape(track, "backend", ["backend", "frontend", "platform", "qa"]);
      assert.equal(g.review_shape, "matrix", `${track}: review_shape`);
      assert.equal(g.required_approvals, 2, `${track}: required_approvals`);
    }
  });

  test("the rest of the skeleton is untouched", () => {
    const g = shape("loop", "backend", ["backend"]);
    assert.deepEqual(Object.keys(g).sort(), ["approvals", "changes_requested", "escalated_to_principal", "required_approvals", "review_shape"]);
    assert.deepEqual(g.approvals, []);
    assert.equal(g.escalated_to_principal, false);
  });

  test("stages whose gate has no review_shape are unchanged", () => {
    const req = buildDescriptor(getStage("requirements"), "pm", { track: "loop" }).expectedGate;
    assert.equal("review_shape" in (req || {}), false);
    const adversarial = buildDescriptor(stage, "reviewer", { track: "full", reviewMode: "adversarial", rolesInStage: ["reviewer", "critic"] }).expectedGate;
    assert.equal(adversarial.mode, "adversarial");
    assert.equal("review_shape" in adversarial, false);
  });
});

describe("the rendered loop prompt shows scoped / 1 in its gate block", () => {
  test("omp host, loop track", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "devteam-skeleton-"));
    try {
      fs.mkdirSync(path.join(cwd, ".devteam"), { recursive: true });
      fs.writeFileSync(path.join(cwd, ".devteam", "config.yml"), "routing:\n  default_host: omp\n");
      fs.writeFileSync(path.join(cwd, "AGENTS.md"), "# Project context\n");
      const adapter = loadAdapter("omp");
      adapter.install(cwd, { force: true });
      const descriptor = buildDescriptor(stage, "backend", { cwd, track: "loop", rolesInStage: ["backend"] });
      const prompt = adapter.renderStagePrompt(descriptor, { track: "loop", orchestrator: "devteam@test", cwd, feature: "x" });
      assert.match(prompt, /"review_shape": "scoped"/);
      assert.match(prompt, /"required_approvals": 1/);
      assert.doesNotMatch(prompt, /"review_shape": "matrix"/);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
