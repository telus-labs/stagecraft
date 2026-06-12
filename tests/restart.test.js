// `devteam restart <stage>` — clears a stage's gates (and optionally
// downstream gates + injected blocker sections) so the pipeline can
// re-run that stage. Tier-4 addition for the "I hit an escalation,
// now how do I redo work cleanly?" flow.

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { BIN, makeTargetProject, seedGate, cleanup } = require("./_helpers");

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
afterEach(() => { _dirs.forEach(cleanup); _dirs = []; });

function run(args, opts = {}) {
  const r = spawnSync("node", [BIN, ...args], {
    cwd: opts.cwd, encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function gatePath(cwd, name) {
  return path.join(cwd, "pipeline", "gates", `${name}.json`);
}

describe("restart: argument handling", () => {
  it("prints usage on no args (exit 2)", () => {
    const cwd = track(makeTargetProject());
    const r = run(["restart"], { cwd });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Usage: devteam restart/);
  });

  it("rejects unknown stage with a list of valid stages", () => {
    const cwd = track(makeTargetProject());
    const r = run(["restart", "totally-not-a-stage"], { cwd });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Unknown stage/);
    assert.match(r.stderr, /Known stages:/);
  });

  it("accepts the stage id form (e.g. 'stage-05') as well as the name", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-05.backend", { workstream: "backend", host: "claude-code", status: "PASS" });
    const r = run(["restart", "stage-05"], { cwd });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Removed/);
  });
});

describe("restart: gate-file removal", () => {
  it("removes the named stage's merged + per-workstream gates", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-04", { stage: "stage-04", status: "PASS" });
    seedGate(cwd, "stage-04.backend", { workstream: "backend", host: "claude-code", status: "PASS" });
    seedGate(cwd, "stage-04.frontend", { workstream: "frontend", host: "claude-code", status: "PASS" });
    seedGate(cwd, "stage-04.platform", { workstream: "platform", host: "claude-code", status: "PASS" });
    seedGate(cwd, "stage-04.qa", { workstream: "qa", host: "claude-code", status: "PASS" });

    const r = run(["restart", "build"], { cwd });
    assert.equal(r.status, 0);

    for (const name of ["stage-04", "stage-04.backend", "stage-04.frontend", "stage-04.platform", "stage-04.qa"]) {
      assert.ok(!fs.existsSync(gatePath(cwd, name)), `${name}.json should be removed`);
    }
  });

  it("does NOT remove gates for unrelated stages", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { workstream: "pm", host: "claude-code", status: "PASS" });
    seedGate(cwd, "stage-02", { workstream: "principal", host: "claude-code", status: "PASS" });
    seedGate(cwd, "stage-04", { stage: "stage-04", status: "FAIL", blockers: ["bug"] });
    seedGate(cwd, "stage-04.backend", { workstream: "backend", host: "claude-code", status: "FAIL" });

    run(["restart", "build"], { cwd });

    assert.ok(fs.existsSync(gatePath(cwd, "stage-01")), "earlier stage gate must survive");
    assert.ok(fs.existsSync(gatePath(cwd, "stage-02")), "earlier stage gate must survive");
    assert.ok(!fs.existsSync(gatePath(cwd, "stage-04")));
    assert.ok(!fs.existsSync(gatePath(cwd, "stage-04.backend")));
  });

  it("succeeds even when the stage has no gates yet (idempotent)", () => {
    const cwd = track(makeTargetProject());
    const r = run(["restart", "qa"], { cwd });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Nothing to clear/);
  });
});

describe("restart: --cascade", () => {
  it("clears the named stage AND every later stage in the active track", () => {
    const cwd = track(makeTargetProject());
    // Seed gates for stages 04 / 05 / 06 / 07 / 08 / 09 (a few that come after build on full).
    for (const s of ["stage-04", "stage-05", "stage-06", "stage-07", "stage-08", "stage-09"]) {
      seedGate(cwd, s, { stage: s, status: "PASS" });
    }
    // Also keep an earlier stage to verify cascade doesn't go backwards.
    seedGate(cwd, "stage-02", { workstream: "principal", host: "claude-code", status: "PASS" });

    const r = run(["restart", "build", "--cascade"], { cwd });
    assert.equal(r.status, 0);

    assert.ok(fs.existsSync(gatePath(cwd, "stage-02")), "earlier stage must survive cascade");
    for (const s of ["stage-04", "stage-05", "stage-06", "stage-07", "stage-08", "stage-09"]) {
      assert.ok(!fs.existsSync(gatePath(cwd, s)), `${s}.json must be removed by cascade`);
    }
  });

  it("without --cascade, leaves later stages untouched", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-04", { stage: "stage-04", status: "PASS" });
    seedGate(cwd, "stage-05", { stage: "stage-05", status: "PASS" });
    seedGate(cwd, "stage-06", { stage: "stage-06", status: "PASS" });

    run(["restart", "build"], { cwd });

    assert.ok(!fs.existsSync(gatePath(cwd, "stage-04")));
    assert.ok(fs.existsSync(gatePath(cwd, "stage-05")), "no cascade → stage-05 must survive");
    assert.ok(fs.existsSync(gatePath(cwd, "stage-06")), "no cascade → stage-06 must survive");
  });
});

describe("restart: pipeline/context.md handling", () => {
  function seedContext(cwd, content) {
    fs.mkdirSync(path.join(cwd, "pipeline"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "pipeline", "context.md"), content);
  }

  it("strips red-team-blockers section when restarting stage-04c", () => {
    const cwd = track(makeTargetProject());
    seedContext(cwd,
      "<!-- devteam:red-team-blockers:begin -->\n" +
      "## IMMEDIATE: Red-Team Blockers — Fix Before Peer Review\n\n" +
      "- R-1 [high/likely]: a finding\n\n" +
      "<!-- devteam:red-team-blockers:end -->\n\n" +
      "# Context\n\nSurvives.\n");
    seedGate(cwd, "stage-04c", { stage: "stage-04c", status: "FAIL", blockers: ["x"] });

    run(["restart", "red-team"], { cwd });

    const ctx = fs.readFileSync(path.join(cwd, "pipeline", "context.md"), "utf8");
    assert.doesNotMatch(ctx, /red-team-blockers/);
    assert.match(ctx, /# Context/);
    assert.match(ctx, /Survives/);
  });

  it("strips qa-build-blockers section when restarting build (which owns stage-04.qa)", () => {
    const cwd = track(makeTargetProject());
    seedContext(cwd,
      "<!-- devteam:qa-build-blockers:begin -->\n" +
      "QA bug list\n" +
      "<!-- devteam:qa-build-blockers:end -->\n\n" +
      "# Context\n");
    seedGate(cwd, "stage-04.qa", { workstream: "qa", host: "claude-code", status: "FAIL" });

    run(["restart", "build"], { cwd });

    const ctx = fs.readFileSync(path.join(cwd, "pipeline", "context.md"), "utf8");
    assert.doesNotMatch(ctx, /qa-build-blockers/);
  });

  it("--keep-context preserves injected sections", () => {
    const cwd = track(makeTargetProject());
    seedContext(cwd,
      "<!-- devteam:red-team-blockers:begin -->\nfindings\n<!-- devteam:red-team-blockers:end -->\n\n# Context\n");
    seedGate(cwd, "stage-04c", { stage: "stage-04c", status: "FAIL" });

    run(["restart", "red-team", "--keep-context"], { cwd });

    const ctx = fs.readFileSync(path.join(cwd, "pipeline", "context.md"), "utf8");
    assert.match(ctx, /red-team-blockers/, "--keep-context must NOT strip");
  });

  it("does not strip sections owned by unrelated stages", () => {
    const cwd = track(makeTargetProject());
    seedContext(cwd,
      "<!-- devteam:qa-build-blockers:begin -->\nQA bug\n<!-- devteam:qa-build-blockers:end -->\n\n" +
      "<!-- devteam:red-team-blockers:begin -->\nRT bug\n<!-- devteam:red-team-blockers:end -->\n\n" +
      "# Context\n");
    seedGate(cwd, "stage-04c", { stage: "stage-04c", status: "FAIL" });

    run(["restart", "red-team"], { cwd });

    const ctx = fs.readFileSync(path.join(cwd, "pipeline", "context.md"), "utf8");
    assert.doesNotMatch(ctx, /red-team-blockers/, "red-team section stripped");
    assert.match(ctx, /qa-build-blockers/, "qa section is unrelated — must survive");
  });
});

describe("restart: --dry-run", () => {
  it("prints what would happen, deletes nothing", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-04", { stage: "stage-04", status: "PASS" });
    seedGate(cwd, "stage-04.backend", { workstream: "backend", host: "claude-code", status: "PASS" });

    const r = run(["restart", "build", "--dry-run"], { cwd });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Would restart/);
    assert.match(r.stdout, /Would delete/);
    assert.match(r.stdout, /stage-04\.json/);
    assert.match(r.stdout, /stage-04\.backend\.json/);
    assert.match(r.stdout, /Re-run without --dry-run/);

    // Files must still exist
    assert.ok(fs.existsSync(gatePath(cwd, "stage-04")), "dry-run must NOT delete");
    assert.ok(fs.existsSync(gatePath(cwd, "stage-04.backend")), "dry-run must NOT delete");
  });
});

describe("restart: archive cleanup", () => {
  function archivePath(cwd, stageId, attempt) {
    return path.join(cwd, "pipeline", "gates", "archive", `${stageId}.attempt-${attempt}.json`);
  }
  function seedArchive(cwd, stageId, attempt, gate = {}) {
    const dir = path.join(cwd, "pipeline", "gates", "archive");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(archivePath(cwd, stageId, attempt), JSON.stringify({ stage: stageId, blockers: [], ...gate }, null, 2));
  }

  it("removes archive files for the restarted stage", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-04", { stage: "stage-04", status: "FAIL", blockers: ["lint"] });
    seedArchive(cwd, "stage-04", 1, { blockers: ["original blocker"] });
    seedArchive(cwd, "stage-04", 2, { blockers: ["lint"] });

    const r = run(["restart", "build"], { cwd });
    assert.equal(r.status, 0);

    assert.ok(!fs.existsSync(archivePath(cwd, "stage-04", 1)), "attempt-1 archive must be removed");
    assert.ok(!fs.existsSync(archivePath(cwd, "stage-04", 2)), "attempt-2 archive must be removed");
  });

  it("does NOT remove archives for unrelated stages", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-04", { stage: "stage-04", status: "FAIL" });
    seedArchive(cwd, "stage-04", 1, { blockers: ["build blocker"] });
    seedArchive(cwd, "stage-06b", 1, { blockers: ["a11y violation"] });

    run(["restart", "build"], { cwd });

    assert.ok(!fs.existsSync(archivePath(cwd, "stage-04", 1)), "build archive removed");
    assert.ok(fs.existsSync(archivePath(cwd, "stage-06b", 1)), "stage-06b archive must survive");
  });

  it("succeeds cleanly when no archives exist (idempotent)", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-04", { stage: "stage-04", status: "PASS" });
    const r = run(["restart", "build"], { cwd });
    assert.equal(r.status, 0);
    // No crash, just removes the gate file
    assert.ok(!fs.existsSync(gatePath(cwd, "stage-04")));
  });

  it("--cascade also removes archives for all downstream stages", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-04", { stage: "stage-04", status: "PASS" });
    seedGate(cwd, "stage-05", { stage: "stage-05", status: "PASS" });
    seedArchive(cwd, "stage-04", 1, { blockers: ["build"] });
    seedArchive(cwd, "stage-05", 1, { blockers: ["peer-review"] });

    const r = run(["restart", "build", "--cascade"], { cwd });
    assert.equal(r.status, 0);

    assert.ok(!fs.existsSync(archivePath(cwd, "stage-04", 1)), "build archive removed by cascade");
    assert.ok(!fs.existsSync(archivePath(cwd, "stage-05", 1)), "peer-review archive removed by cascade");
  });

  it("--dry-run lists archives that would be removed without deleting them", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-04", { stage: "stage-04", status: "FAIL" });
    seedArchive(cwd, "stage-04", 1, { blockers: ["blocker"] });

    const r = run(["restart", "build", "--dry-run"], { cwd });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /attempt-1\.json/, "dry-run must list archive file");
    assert.ok(fs.existsSync(archivePath(cwd, "stage-04", 1)), "dry-run must NOT delete archive");
  });
});
