// Progress-based convergence detection (ADR-003 / BACKLOG G10, Phase 4.2).
//
// The fix-and-retry breaker trips on NO PROGRESS — blockers identical across
// consecutive archived attempts — not just attempt count. Per-attempt gate
// archiving (core/gates/archive.js, commit 3d0b16f) is the data layer; this
// module is the decision layer.
//
// Design rules (ADR-003):
// - Prefer orchestrator-stamped fields over model-asserted ones. The blocker
//   comparison is over ARCHIVED gate data (written by the orchestrator at retry
//   time), not the current live gate (which the agent may have just written).
// - Remove agent-falsifiable inputs: countArchivedAttempts() counts archived
//   files instead of trusting the model-written gate.retry_number.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { listArchives } = require("./archive");

// Normalize a gate's blocker list to a stable fingerprint for comparison.
// Blockers are model-written, so we sort to remove ordering artifacts.
function normalizeBlockers(gate) {
  const raw = Array.isArray(gate.blockers) ? gate.blockers : [];
  return raw
    .map((b) =>
      (typeof b === "string" ? b : (b.text || b.summary || b.message || JSON.stringify(b))).trim(),
    )
    .sort()
    .join("\x00");
}

/**
 * Compare the last two archived attempts for a stage.
 *
 * Returns { noProgress: false } when fewer than 2 archives exist, when blockers
 * changed, when either archive is unreadable, or when both fingerprints are
 * empty (no blockers → treat as progress, not stuck).
 *
 * Returns { noProgress: true, stuckBlockers, attempts: [N-1, N] } when the last
 * two archived attempts carry identical non-empty blocker sets — the breaker
 * should trip.
 *
 * @param {string} gatesDir  absolute path to pipeline/gates
 * @param {string} stageId   e.g. "stage-04"
 */
function detectNoProgress(gatesDir, stageId) {
  const archives = listArchives(gatesDir, stageId);
  if (archives.length < 2) return { noProgress: false };

  const prev = archives[archives.length - 2];
  const last = archives[archives.length - 1];
  let prevGate, lastGate;
  try {
    prevGate = JSON.parse(fs.readFileSync(prev.file, "utf8"));
    lastGate = JSON.parse(fs.readFileSync(last.file, "utf8"));
  } catch {
    return { noProgress: false }; // unreadable archive → don't trip; post-mortem can investigate
  }

  const prevFp = normalizeBlockers(prevGate);
  const lastFp = normalizeBlockers(lastGate);
  if (prevFp !== lastFp || prevFp === "") return { noProgress: false };

  return {
    noProgress: true,
    stuckBlockers: Array.isArray(lastGate.blockers) ? lastGate.blockers : [],
    attempts: [prev.attempt, last.attempt],
  };
}

/**
 * Count archived attempts for a stage — agent-independent attempt counter.
 * Use instead of the model-written gate.retry_number on the interactive path.
 *
 * @param {string} gatesDir  absolute path to pipeline/gates
 * @param {string} stageId   e.g. "stage-04"
 * @returns {number}
 */
function countArchivedAttempts(gatesDir, stageId) {
  return listArchives(gatesDir, stageId).length;
}

/**
 * Build the human-readable no-progress evidence string for halt output.
 *
 * Examples:
 *   blocker 'tests failing' identical across attempts 1,2
 *   3 blockers identical across attempts 2,3: 'lint', 'types', 'coverage'
 *   blockers unchanged across attempts 1,2   (empty blockers edge case)
 *
 * @param {Array} stuckBlockers  the blockers that didn't change
 * @param {number[]} attempts    [prevAttempt, lastAttempt]
 * @returns {string}
 */
function noProgressEvidence(stuckBlockers, attempts) {
  const attStr = attempts.join(",");
  if (!stuckBlockers || stuckBlockers.length === 0) {
    return `blockers unchanged across attempts ${attStr}`;
  }
  const fmt = (b) => `'${typeof b === "string" ? b : JSON.stringify(b)}'`;
  if (stuckBlockers.length === 1) {
    return `blocker ${fmt(stuckBlockers[0])} identical across attempts ${attStr}`;
  }
  const preview = stuckBlockers.slice(0, 3).map(fmt).join(", ");
  const tail = stuckBlockers.length > 3 ? "…" : "";
  return `${stuckBlockers.length} blockers identical across attempts ${attStr}: ${preview}${tail}`;
}

/**
 * Detect whether the auto-fix build made no content changes to the files
 * named in the most recent archived failure's blockers.
 *
 * Call this once per fix-and-retry iteration. On the first call (no prior
 * fingerprint in runState) it stores a baseline and returns { noSourceChange: false }.
 * On subsequent calls it compares against the stored baseline; if the file
 * content is identical the breaker trips.
 *
 * Returns { noSourceChange: false } in all safe-fallback cases:
 *   - fewer than 1 archive exists
 *   - no blocker in the archive has a `file` field
 *   - any unexpected I/O error
 *
 * @param {string} cwd        project root
 * @param {string} gatesDir   absolute path to pipeline/gates
 * @param {string} stageId    e.g. "stage-04"
 * @param {object} runState   driver's mutable run-state; must have srcFingerprints: {}
 * @returns {{ noSourceChange: boolean, lastAttempt?: number, files?: string[] }}
 */
function detectNoSourceChange(cwd, gatesDir, stageId, runState) {
  try {
    const archives = listArchives(gatesDir, stageId);
    if (archives.length < 1) return { noSourceChange: false };

    const lastArchive = archives[archives.length - 1];
    let lastGate;
    try {
      lastGate = JSON.parse(fs.readFileSync(lastArchive.file, "utf8"));
    } catch {
      return { noSourceChange: false };
    }

    // Collect unique file paths from blocker `file` fields (sorted for stability).
    const fileSet = new Set();
    if (Array.isArray(lastGate.blockers)) {
      for (const b of lastGate.blockers) {
        if (b && typeof b === "object" && typeof b.file === "string" && b.file) {
          fileSet.add(b.file);
        }
      }
    }
    if (fileSet.size === 0) return { noSourceChange: false };

    const sortedFiles = [...fileSet].sort();

    // Hash the current content of each blocker-referenced file.
    // Missing/unreadable files contribute an empty string (best-effort).
    const parts = sortedFiles.map((rel) => {
      let content = "";
      try { content = fs.readFileSync(path.join(cwd, rel), "utf8"); } catch { /* absent → "" */ }
      return `${rel}:${crypto.createHash("sha256").update(content).digest("hex")}`;
    });
    const fingerprint = parts.join("\n");

    const prior = runState.srcFingerprints[stageId];
    runState.srcFingerprints[stageId] = fingerprint;

    if (prior !== undefined && prior === fingerprint) {
      return { noSourceChange: true, lastAttempt: lastArchive.attempt, files: sortedFiles };
    }
    return { noSourceChange: false };
  } catch {
    return { noSourceChange: false };
  }
}

/**
 * Build the human-readable no-source-change evidence string for halt output.
 *
 * @param {number}   lastAttempt  attempt number of the archive that triggered the check
 * @param {string[]} files        blocker-referenced file paths that were unchanged
 * @returns {string}
 */
function noSourceChangeEvidence(lastAttempt, files) {
  const fileList = Array.isArray(files) && files.length > 0 ? ` [${files.join(", ")}]` : "";
  return `build agent made no content changes to defect files${fileList} after attempt ${lastAttempt} — blocker likely requires a config-level edit outside the lint/test surface`;
}

module.exports = { detectNoProgress, countArchivedAttempts, noProgressEvidence, detectNoSourceChange, noSourceChangeEvidence };
