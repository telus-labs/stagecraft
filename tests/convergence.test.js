// Tests for progress-based convergence detection (core/gates/convergence.js).
// Verifies the three public functions: detectNoProgress, countArchivedAttempts,
// and noProgressEvidence. Archive fixture helpers create the on-disk state that
// the comparison logic reads.

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { REPO_ROOT, makeTargetProject, cleanup } = require("./_helpers");
const { archiveGate } = require(path.join(REPO_ROOT, "core", "gates", "archive"));
const {
  detectNoProgress,
  countArchivedAttempts,
  noProgressEvidence,
} = require(path.join(REPO_ROOT, "core", "gates", "convergence"));

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
afterEach(() => { _dirs.forEach(cleanup); _dirs = []; });

function gd(cwd) { return path.join(cwd, "pipeline", "gates"); }

// Write a gate directly into the archive directory without going through
// archiveGate() — gives full control over what each archive attempt contains.
function seedArchive(cwd, stageId, attempt, gate) {
  const dir = path.join(gd(cwd), "archive");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${stageId}.attempt-${attempt}.json`);
  fs.writeFileSync(file, JSON.stringify({ stage: stageId, blockers: [], ...gate }, null, 2));
  return file;
}

// ─── detectNoProgress ─────────────────────────────────────────────────────────

describe("detectNoProgress: returns false with insufficient data", () => {
  it("no archives → noProgress false", () => {
    const cwd = track(makeTargetProject());
    assert.deepEqual(detectNoProgress(gd(cwd), "stage-04"), { noProgress: false });
  });

  it("only one archive → noProgress false (need two to compare)", () => {
    const cwd = track(makeTargetProject());
    seedArchive(cwd, "stage-04", 1, { blockers: ["failing test"] });
    assert.deepEqual(detectNoProgress(gd(cwd), "stage-04"), { noProgress: false });
  });

  it("two archives with EMPTY blocker sets → noProgress false (empty is not stuck)", () => {
    const cwd = track(makeTargetProject());
    seedArchive(cwd, "stage-04", 1, { blockers: [] });
    seedArchive(cwd, "stage-04", 2, { blockers: [] });
    assert.deepEqual(detectNoProgress(gd(cwd), "stage-04"), { noProgress: false });
  });
});

describe("detectNoProgress: trips on identical non-empty blocker sets", () => {
  it("two archives with identical single blocker → noProgress true", () => {
    const cwd = track(makeTargetProject());
    seedArchive(cwd, "stage-04", 1, { blockers: ["unit tests failing"] });
    seedArchive(cwd, "stage-04", 2, { blockers: ["unit tests failing"] });
    const r = detectNoProgress(gd(cwd), "stage-04");
    assert.equal(r.noProgress, true);
    assert.deepEqual(r.stuckBlockers, ["unit tests failing"]);
    assert.deepEqual(r.attempts, [1, 2]);
  });

  it("two archives with identical multiple blockers (sorted) → noProgress true", () => {
    const cwd = track(makeTargetProject());
    seedArchive(cwd, "stage-04", 1, { blockers: ["types fail", "lint error"] });
    seedArchive(cwd, "stage-04", 2, { blockers: ["lint error", "types fail"] }); // order flipped
    const r = detectNoProgress(gd(cwd), "stage-04");
    assert.equal(r.noProgress, true, "blockers compared after sort — order must not matter");
  });

  it("compares only the LAST two archives (earlier ones don't affect result)", () => {
    const cwd = track(makeTargetProject());
    seedArchive(cwd, "stage-04", 1, { blockers: ["original"] });
    seedArchive(cwd, "stage-04", 2, { blockers: ["changed"] });    // progress!
    seedArchive(cwd, "stage-04", 3, { blockers: ["changed"] });    // now stuck
    const r = detectNoProgress(gd(cwd), "stage-04");
    assert.equal(r.noProgress, true);
    assert.deepEqual(r.attempts, [2, 3], "only the last two archives compared");
  });
});

describe("detectNoProgress: returns false when blockers differ", () => {
  it("two archives with different blocker sets → noProgress false", () => {
    const cwd = track(makeTargetProject());
    seedArchive(cwd, "stage-04", 1, { blockers: ["original blocker"] });
    seedArchive(cwd, "stage-04", 2, { blockers: ["fixed that, new blocker"] });
    assert.deepEqual(detectNoProgress(gd(cwd), "stage-04"), { noProgress: false });
  });

  it("second attempt adds a blocker → different → noProgress false", () => {
    const cwd = track(makeTargetProject());
    seedArchive(cwd, "stage-04", 1, { blockers: ["lint"] });
    seedArchive(cwd, "stage-04", 2, { blockers: ["lint", "types"] }); // more blockers
    assert.deepEqual(detectNoProgress(gd(cwd), "stage-04"), { noProgress: false });
  });

  it("unreadable archive file → noProgress false (best-effort, never throws)", () => {
    const cwd = track(makeTargetProject());
    seedArchive(cwd, "stage-04", 1, { blockers: ["x"] });
    const f2 = seedArchive(cwd, "stage-04", 2, { blockers: ["x"] });
    fs.writeFileSync(f2, "NOT JSON"); // corrupt
    assert.doesNotThrow(() => detectNoProgress(gd(cwd), "stage-04"));
    assert.deepEqual(detectNoProgress(gd(cwd), "stage-04"), { noProgress: false });
  });
});

// ─── countArchivedAttempts ────────────────────────────────────────────────────

describe("countArchivedAttempts", () => {
  it("no archives → 0", () => {
    const cwd = track(makeTargetProject());
    assert.equal(countArchivedAttempts(gd(cwd), "stage-04"), 0);
  });

  it("counts only archives for the requested stage", () => {
    const cwd = track(makeTargetProject());
    seedArchive(cwd, "stage-04", 1, { blockers: [] });
    seedArchive(cwd, "stage-04", 2, { blockers: [] });
    seedArchive(cwd, "stage-05", 1, { blockers: [] }); // different stage
    assert.equal(countArchivedAttempts(gd(cwd), "stage-04"), 2);
    assert.equal(countArchivedAttempts(gd(cwd), "stage-05"), 1);
  });

  it("works with archives created via archiveGate()", () => {
    const cwd = track(makeTargetProject());
    const src = path.join(gd(cwd), "stage-04.json");
    fs.mkdirSync(gd(cwd), { recursive: true });
    fs.writeFileSync(src, JSON.stringify({ stage: "stage-04", blockers: ["x"] }));
    archiveGate(gd(cwd), "stage-04", 1);
    archiveGate(gd(cwd), "stage-04", 2);
    assert.equal(countArchivedAttempts(gd(cwd), "stage-04"), 2);
  });
});

// ─── noProgressEvidence ───────────────────────────────────────────────────────

describe("noProgressEvidence", () => {
  it("single blocker → 'blocker X identical across attempts N,M'", () => {
    const s = noProgressEvidence(["unit tests failing"], [1, 2]);
    assert.match(s, /blocker 'unit tests failing' identical across attempts 1,2/);
  });

  it("multiple blockers → count + preview + attempts", () => {
    const s = noProgressEvidence(["lint", "types", "coverage"], [2, 3]);
    assert.match(s, /3 blockers identical across attempts 2,3/);
    assert.match(s, /'lint'/);
    assert.match(s, /'types'/);
    assert.match(s, /'coverage'/);
  });

  it("more than 3 blockers → ellipsis after preview", () => {
    const s = noProgressEvidence(["a", "b", "c", "d", "e"], [1, 2]);
    assert.match(s, /5 blockers identical across attempts 1,2/);
    assert.match(s, /…/);
  });

  it("empty blockers → 'blockers unchanged across attempts N,M'", () => {
    const s = noProgressEvidence([], [3, 4]);
    assert.match(s, /blockers unchanged across attempts 3,4/);
  });
});
