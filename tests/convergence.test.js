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
  detectNoSourceChange,
  noSourceChangeEvidence,
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

// ─── detectNoSourceChange ─────────────────────────────────────────────────────

describe("detectNoSourceChange: safe-fallback cases", () => {
  it("no archives → { noSourceChange: false } without crashing", () => {
    const cwd = track(makeTargetProject());
    const state = { srcFingerprints: {} };
    assert.deepEqual(detectNoSourceChange(cwd, gd(cwd), "stage-04", state), { noSourceChange: false });
  });

  it("blockers with no file fields → { noSourceChange: false } regardless of content", () => {
    const cwd = track(makeTargetProject());
    seedArchive(cwd, "stage-04", 1, { blockers: [{ text: "lint error" }, "plain string"] });
    const state = { srcFingerprints: {} };
    assert.deepEqual(detectNoSourceChange(cwd, gd(cwd), "stage-04", state), { noSourceChange: false });
  });

  it("blocker references a missing file → no crash, first call stores baseline and returns false", () => {
    const cwd = track(makeTargetProject());
    seedArchive(cwd, "stage-04", 1, { blockers: [{ text: "missing", file: "nonexistent.txt" }] });
    const state = { srcFingerprints: {} };
    let r;
    assert.doesNotThrow(() => { r = detectNoSourceChange(cwd, gd(cwd), "stage-04", state); });
    assert.equal(r.noSourceChange, false, "first call stores baseline; returns false regardless");
    assert.ok(state.srcFingerprints["stage-04"], "fingerprint still stored even for a missing file");
  });
});

describe("detectNoSourceChange: baseline capture and comparison", () => {
  it("first call stores baseline and returns { noSourceChange: false }", () => {
    const cwd = track(makeTargetProject());
    fs.writeFileSync(path.join(cwd, "Dockerfile"), "FROM node:18-alpine\n");
    seedArchive(cwd, "stage-04", 1, { blockers: [{ text: "EOL image", file: "Dockerfile" }] });
    const state = { srcFingerprints: {} };
    const r = detectNoSourceChange(cwd, gd(cwd), "stage-04", state);
    assert.equal(r.noSourceChange, false);
    assert.ok(state.srcFingerprints["stage-04"], "fingerprint stored in runState after first call");
  });

  it("second call with unchanged file content → { noSourceChange: true }", () => {
    const cwd = track(makeTargetProject());
    fs.writeFileSync(path.join(cwd, "Dockerfile"), "FROM node:18-alpine\n");
    seedArchive(cwd, "stage-04", 1, { blockers: [{ text: "EOL image", file: "Dockerfile" }] });
    const state = { srcFingerprints: {} };
    detectNoSourceChange(cwd, gd(cwd), "stage-04", state); // first call: store baseline
    // File is not modified between calls (simulates agent that didn't touch Dockerfile)
    const r = detectNoSourceChange(cwd, gd(cwd), "stage-04", state);
    assert.equal(r.noSourceChange, true);
    assert.equal(r.lastAttempt, 1);
    assert.deepEqual(r.files, ["Dockerfile"]);
  });

  it("second call with changed file content → { noSourceChange: false }", () => {
    const cwd = track(makeTargetProject());
    const dockerfile = path.join(cwd, "Dockerfile");
    fs.writeFileSync(dockerfile, "FROM node:18-alpine\n");
    seedArchive(cwd, "stage-04", 1, { blockers: [{ text: "EOL image", file: "Dockerfile" }] });
    const state = { srcFingerprints: {} };
    detectNoSourceChange(cwd, gd(cwd), "stage-04", state); // first call: store baseline
    fs.writeFileSync(dockerfile, "FROM node:22-alpine\n"); // agent fixed the file
    const r = detectNoSourceChange(cwd, gd(cwd), "stage-04", state);
    assert.equal(r.noSourceChange, false, "file content changed → not stuck");
  });

  it("multiple blocker files: fires only when ALL named files are unchanged", () => {
    const cwd = track(makeTargetProject());
    fs.writeFileSync(path.join(cwd, "Dockerfile"), "FROM node:18-alpine\n");
    fs.writeFileSync(path.join(cwd, "package.json"), '{"version":"1.0.0"}\n');
    seedArchive(cwd, "stage-04", 1, {
      blockers: [
        { text: "EOL image", file: "Dockerfile" },
        { text: "outdated dep", file: "package.json" },
      ],
    });
    const state = { srcFingerprints: {} };
    detectNoSourceChange(cwd, gd(cwd), "stage-04", state); // store baseline
    // Agent only updated package.json, not Dockerfile
    fs.writeFileSync(path.join(cwd, "package.json"), '{"version":"1.0.1"}\n');
    const r = detectNoSourceChange(cwd, gd(cwd), "stage-04", state);
    assert.equal(r.noSourceChange, false, "fingerprint changed because package.json changed");
  });

  it("uses the LAST archive's blocker files (not an earlier archive's)", () => {
    const cwd = track(makeTargetProject());
    fs.writeFileSync(path.join(cwd, "Dockerfile"), "FROM node:18-alpine\n");
    fs.writeFileSync(path.join(cwd, "package.json"), '{"version":"1.0.0"}\n');
    // Archive 1 names Dockerfile; archive 2 names package.json only.
    seedArchive(cwd, "stage-04", 1, { blockers: [{ text: "old", file: "Dockerfile" }] });
    seedArchive(cwd, "stage-04", 2, { blockers: [{ text: "new", file: "package.json" }] });
    const state = { srcFingerprints: {} };
    detectNoSourceChange(cwd, gd(cwd), "stage-04", state); // store baseline (watches package.json per archive 2)
    // Update package.json — the file archive 2 references — change must be detected.
    // If the function incorrectly used archive 1's list (Dockerfile) it would not
    // detect this change and would wrongly return noSourceChange: true.
    fs.writeFileSync(path.join(cwd, "package.json"), '{"version":"1.0.1"}\n');
    const r = detectNoSourceChange(cwd, gd(cwd), "stage-04", state);
    assert.equal(r.noSourceChange, false, "archive 2's file (package.json) changed → change detected correctly");
  });
});

// ─── noSourceChangeEvidence ───────────────────────────────────────────────────

describe("noSourceChangeEvidence", () => {
  it("includes file names and attempt number", () => {
    const s = noSourceChangeEvidence(1, ["Dockerfile"]);
    assert.match(s, /Dockerfile/);
    assert.match(s, /attempt 1/);
  });

  it("lists multiple files", () => {
    const s = noSourceChangeEvidence(2, ["Dockerfile", "package.json"]);
    assert.match(s, /Dockerfile/);
    assert.match(s, /package\.json/);
    assert.match(s, /attempt 2/);
  });

  it("handles empty file list gracefully", () => {
    const s = noSourceChangeEvidence(1, []);
    assert.ok(typeof s === "string" && s.length > 0);
    assert.match(s, /attempt 1/);
  });
});

// ─── stale-archive guard (_currentSequenceArchives, tested via public API) ────
//
// The guard filters archives from previous sequences by comparing mtime of each
// archive against the mtime of attempt-1 (the "start of the current sequence").
// Tests use fs.utimesSync to place stale archives in the past.

describe("detectNoProgress: stale archives from a previous sequence are ignored", () => {
  it("stale attempt-2,3 (old mtime) + fresh attempt-1 → noProgress false (guard fires)", () => {
    const cwd = track(makeTargetProject());
    const dir = path.join(gd(cwd), "archive");
    fs.mkdirSync(dir, { recursive: true });

    const past = new Date(Date.now() - 3_600_000); // 1 hour ago
    // Stale archives from a previous run — identical blockers
    for (const n of [2, 3]) {
      const p = path.join(dir, `stage-04.attempt-${n}.json`);
      fs.writeFileSync(p, JSON.stringify({ stage: "stage-04", blockers: ["stuck blocker"] }));
      fs.utimesSync(p, past, past);
    }
    // Fresh attempt-1 written NOW (current sequence)
    seedArchive(cwd, "stage-04", 1, { blockers: ["stuck blocker"] }); // same text, new mtime

    // Without the guard: last two = stale-2 and stale-3 → identical → noProgress true
    // With the guard: stale-2,3 excluded → only attempt-1 → noProgress false
    assert.deepEqual(detectNoProgress(gd(cwd), "stage-04"), { noProgress: false });
  });

  it("all archives from the same run (no old mtimes) → guard is transparent", () => {
    const cwd = track(makeTargetProject());
    seedArchive(cwd, "stage-04", 1, { blockers: ["original"] });
    seedArchive(cwd, "stage-04", 2, { blockers: ["original"] }); // same → should still trip
    const r = detectNoProgress(gd(cwd), "stage-04");
    assert.equal(r.noProgress, true, "current-sequence identical blockers still detected");
  });
});

describe("countArchivedAttempts: stale archives from a previous sequence are excluded", () => {
  it("stale attempt-2,3 (old mtime) + fresh attempt-1 → count is 1 not 3", () => {
    const cwd = track(makeTargetProject());
    const dir = path.join(gd(cwd), "archive");
    fs.mkdirSync(dir, { recursive: true });

    const past = new Date(Date.now() - 3_600_000);
    for (const n of [2, 3]) {
      const p = path.join(dir, `stage-04.attempt-${n}.json`);
      fs.writeFileSync(p, JSON.stringify({ stage: "stage-04", blockers: [] }));
      fs.utimesSync(p, past, past);
    }
    seedArchive(cwd, "stage-04", 1, { blockers: [] });

    // Without guard: count=3; with guard: stale-2,3 excluded → count=1
    assert.equal(countArchivedAttempts(gd(cwd), "stage-04"), 1);
  });

  it("no attempt-1 present → guard is bypassed (trust all archives)", () => {
    const cwd = track(makeTargetProject());
    const dir = path.join(gd(cwd), "archive");
    fs.mkdirSync(dir, { recursive: true });

    const past = new Date(Date.now() - 3_600_000);
    for (const n of [2, 3]) {
      const p = path.join(dir, `stage-04.attempt-${n}.json`);
      fs.writeFileSync(p, JSON.stringify({ stage: "stage-04", blockers: [] }));
      fs.utimesSync(p, past, past);
    }
    // No attempt-1 → guard cannot determine sequence boundary → trusts all
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
