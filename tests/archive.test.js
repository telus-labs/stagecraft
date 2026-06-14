// Tests for per-attempt gate archiving (core/gates/archive.js).

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { REPO_ROOT, makeTargetProject, seedGate, cleanup } = require("./_helpers");
const { archiveGate, listArchives, pruneArchives } = require(path.join(REPO_ROOT, "core", "gates", "archive"));

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
afterEach(() => { _dirs.forEach(cleanup); _dirs = []; });
function gd(cwd) { return path.join(cwd, "pipeline", "gates"); }

describe("archiveGate", () => {
  it("snapshots the stage gate to archive/<stage>.attempt-N.json", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-04", { status: "FAIL", blockers: ["a", "b"] });
    const dest = archiveGate(gd(cwd), "stage-04", 1);
    assert.ok(dest && fs.existsSync(dest), "archive file written");
    assert.match(dest, /archive\/stage-04\.attempt-1\.json$/);
    const arch = JSON.parse(fs.readFileSync(dest, "utf8"));
    assert.deepEqual(arch.blockers, ["a", "b"], "full gate content preserved");
  });

  it("returns null when the gate is absent (nothing to archive)", () => {
    const cwd = track(makeTargetProject());
    assert.equal(archiveGate(gd(cwd), "stage-09", 1), null);
  });

  it("pruneArchives deletes all archived attempts for the stage", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-04", { status: "FAIL", blockers: ["x"] });
    archiveGate(gd(cwd), "stage-04", 1);
    archiveGate(gd(cwd), "stage-04", 2);
    pruneArchives(gd(cwd), "stage-04");
    assert.equal(listArchives(gd(cwd), "stage-04").length, 0, "all archives removed");
  });

  it("pruneArchives does not remove archives for unrelated stages", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-04", { status: "FAIL" });
    archiveGate(gd(cwd), "stage-04", 1);
    seedGate(cwd, "stage-05", { status: "FAIL" });
    archiveGate(gd(cwd), "stage-05", 1);
    pruneArchives(gd(cwd), "stage-04");
    assert.equal(listArchives(gd(cwd), "stage-04").length, 0, "stage-04 archives removed");
    assert.equal(listArchives(gd(cwd), "stage-05").length, 1, "stage-05 archive untouched");
  });

  it("pruneArchives is idempotent when no archives exist", () => {
    const cwd = track(makeTargetProject());
    assert.doesNotThrow(() => pruneArchives(gd(cwd), "stage-04"));
  });

  it("listArchives returns attempts sorted ascending", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-04", { status: "FAIL", blockers: ["x"] });
    archiveGate(gd(cwd), "stage-04", 1);
    seedGate(cwd, "stage-04", { status: "FAIL", blockers: ["x", "y"] }); // overwrite, attempt 2
    archiveGate(gd(cwd), "stage-04", 2);
    const list = listArchives(gd(cwd), "stage-04");
    assert.deepEqual(list.map((x) => x.attempt), [1, 2]);
    // The earlier attempt preserved its smaller blocker set.
    assert.equal(JSON.parse(fs.readFileSync(list[0].file, "utf8")).blockers.length, 1);
    assert.equal(JSON.parse(fs.readFileSync(list[1].file, "utf8")).blockers.length, 2);
  });
});
