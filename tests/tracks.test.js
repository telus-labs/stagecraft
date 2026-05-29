const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { REPO_ROOT } = require("./_helpers");
const { TRACKS, STAGES_BY_TRACK, orderedStageNames, orderedStageNamesForTrack, isStageInTrack } =
  require(path.join(REPO_ROOT, "core", "pipeline", "stages"));

describe("tracks: TRACKS ↔ STAGES_BY_TRACK", () => {
  it("every track in TRACKS has an entry", () => {
    for (const t of TRACKS) {
      assert.ok(Array.isArray(STAGES_BY_TRACK[t]), `track ${t} missing from STAGES_BY_TRACK`);
      assert.ok(STAGES_BY_TRACK[t].length > 0, `track ${t} has no stages`);
    }
  });

  it("full track equals the full ordered list", () => {
    assert.deepEqual(orderedStageNamesForTrack("full"), orderedStageNames());
  });

  it("nano is the smallest track (just build + qa)", () => {
    assert.deepEqual(orderedStageNamesForTrack("nano"), ["build", "qa"]);
  });

  it("quick skips design and clarification", () => {
    const stages = orderedStageNamesForTrack("quick");
    assert.ok(!stages.includes("design"));
    assert.ok(!stages.includes("clarification"));
    assert.ok(stages.includes("build"));
    assert.ok(stages.includes("qa"));
  });

  it("hotfix omits requirements, design, clarification", () => {
    const stages = orderedStageNamesForTrack("hotfix");
    assert.ok(!stages.includes("requirements"));
    assert.ok(!stages.includes("design"));
    assert.ok(!stages.includes("clarification"));
    assert.ok(stages.includes("build"));
    assert.ok(stages.includes("retrospective"));
  });

  it("config-only and hotfix include the conditional security-review", () => {
    assert.ok(orderedStageNamesForTrack("config-only").includes("security-review"));
    assert.ok(orderedStageNamesForTrack("hotfix").includes("security-review"));
  });

  it("nano / quick / dep-update do NOT include security-review", () => {
    assert.ok(!orderedStageNamesForTrack("nano").includes("security-review"));
    assert.ok(!orderedStageNamesForTrack("quick").includes("security-review"));
    assert.ok(!orderedStageNamesForTrack("dep-update").includes("security-review"));
  });

  it("full + hotfix include red-team (always-on adversarial review)", () => {
    assert.ok(orderedStageNamesForTrack("full").includes("red-team"));
    assert.ok(orderedStageNamesForTrack("hotfix").includes("red-team"));
  });

  it("nano / quick / config-only / dep-update do NOT include red-team", () => {
    assert.ok(!orderedStageNamesForTrack("nano").includes("red-team"));
    assert.ok(!orderedStageNamesForTrack("quick").includes("red-team"));
    assert.ok(!orderedStageNamesForTrack("config-only").includes("red-team"));
    assert.ok(!orderedStageNamesForTrack("dep-update").includes("red-team"));
  });

  it("red-team sits between security-review and peer-review when both present", () => {
    const full = orderedStageNamesForTrack("full");
    const sr = full.indexOf("security-review");
    const rt = full.indexOf("red-team");
    const pr = full.indexOf("peer-review");
    assert.ok(sr < rt && rt < pr, `expected security-review(${sr}) < red-team(${rt}) < peer-review(${pr})`);
  });

  it("full + hotfix + config-only include migration-safety (conditional on data-layer diffs)", () => {
    for (const t of ["full", "hotfix", "config-only"]) {
      assert.ok(orderedStageNamesForTrack(t).includes("migration-safety"), `${t} should include migration-safety`);
    }
  });

  it("quick / nano / dep-update do NOT include migration-safety", () => {
    for (const t of ["quick", "nano", "dep-update"]) {
      assert.ok(!orderedStageNamesForTrack(t).includes("migration-safety"), `${t} should NOT include migration-safety`);
    }
  });

  it("migration-safety sits between red-team and peer-review when both present", () => {
    const full = orderedStageNamesForTrack("full");
    const rt = full.indexOf("red-team");
    const ms = full.indexOf("migration-safety");
    const pr = full.indexOf("peer-review");
    assert.ok(rt < ms && ms < pr, `expected red-team(${rt}) < migration-safety(${ms}) < peer-review(${pr})`);
  });

  it("full + quick include executable-spec (G2 — AC→Scenario→test bridge)", () => {
    assert.ok(orderedStageNamesForTrack("full").includes("executable-spec"));
    assert.ok(orderedStageNamesForTrack("quick").includes("executable-spec"));
  });

  it("hotfix / nano / config-only / dep-update do NOT include executable-spec", () => {
    for (const t of ["hotfix", "nano", "config-only", "dep-update"]) {
      assert.ok(!orderedStageNamesForTrack(t).includes("executable-spec"), `${t} should NOT include executable-spec`);
    }
  });

  it("executable-spec sits after clarification and before build (on tracks that include both)", () => {
    const full = orderedStageNamesForTrack("full");
    const cl = full.indexOf("clarification");
    const es = full.indexOf("executable-spec");
    const bu = full.indexOf("build");
    assert.ok(cl < es && es < bu, `expected clarification(${cl}) < executable-spec(${es}) < build(${bu})`);
  });

  it("orderedStageNamesForTrack(unknown) throws with a helpful message", () => {
    assert.throws(() => orderedStageNamesForTrack("bogus"), /Unknown track/);
  });
});

describe("tracks: isStageInTrack", () => {
  it("design is in full and quick — wait actually only full", () => {
    assert.equal(isStageInTrack("design", "full"), true);
    assert.equal(isStageInTrack("design", "quick"), false);
    assert.equal(isStageInTrack("design", "nano"), false);
  });

  it("build is in every track", () => {
    for (const t of TRACKS) {
      assert.equal(isStageInTrack("build", t), true, `build missing from ${t}`);
    }
  });

  it("retrospective is in full, quick, hotfix only", () => {
    assert.equal(isStageInTrack("retrospective", "full"), true);
    assert.equal(isStageInTrack("retrospective", "quick"), true);
    assert.equal(isStageInTrack("retrospective", "hotfix"), true);
    assert.equal(isStageInTrack("retrospective", "nano"), false);
    assert.equal(isStageInTrack("retrospective", "config-only"), false);
    assert.equal(isStageInTrack("retrospective", "dep-update"), false);
  });
});
