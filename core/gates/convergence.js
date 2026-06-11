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

module.exports = { detectNoProgress, countArchivedAttempts, noProgressEvidence };
