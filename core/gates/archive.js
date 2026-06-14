// Per-attempt gate archiving.
//
// When the autonomous driver retries a failed stage, the stage gate is about to
// be cleared/overwritten by the next attempt. Before that happens, snapshot it
// to pipeline/gates/archive/<stage>.attempt-<N>.json so the *progression* of
// failed attempts survives — post-mortem you can diff attempt-1 vs attempt-2 vs
// … and see whether blockers were shrinking or stuck. This is the audit/debug
// record on its own; it is also the data a future progress-based convergence
// check would read (compare blocker counts across attempts) — but this layer
// only archives; the convergence decision stays count-based.

const fs = require("node:fs");
const path = require("node:path");

function archiveDir(gatesDir) {
  return path.join(gatesDir, "archive");
}

/**
 * Snapshot the current stage gate to archive/<stageId>.attempt-<attempt>.json.
 * Best-effort: returns the archive path, or null if there's nothing to archive
 * (gate missing) or the copy fails. Never throws — archiving must not break a run.
 *
 * @param {string} gatesDir  absolute path to pipeline/gates
 * @param {string} stageId   e.g. "stage-04"
 * @param {number} attempt   1-based attempt number being preserved
 */
function archiveGate(gatesDir, stageId, attempt) {
  const src = path.join(gatesDir, `${stageId}.json`);
  if (!fs.existsSync(src)) return null;
  try {
    const dir = archiveDir(gatesDir);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `${stageId}.attempt-${attempt}.json`);
    fs.copyFileSync(src, dest);
    return dest;
  } catch {
    return null;
  }
}

/**
 * List archived attempts for a stage, sorted ascending by attempt number.
 * @returns {Array<{file: string, attempt: number}>}
 */
function listArchives(gatesDir, stageId) {
  const dir = archiveDir(gatesDir);
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return []; }
  const escaped = stageId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${escaped}\\.attempt-(\\d+)\\.json$`);
  return files
    .map((f) => { const m = f.match(re); return m ? { file: path.join(dir, f), attempt: Number(m[1]) } : null; })
    .filter(Boolean)
    .sort((a, b) => a.attempt - b.attempt);
}

/**
 * Delete all archived attempts for a stage — used by the clear-on-re-entry and
 * clear-on-recovery paths so stale archives never outlive their failure sequence.
 * Best-effort: skips files that are already absent. Never throws.
 *
 * @param {string} gatesDir  absolute path to pipeline/gates
 * @param {string} stageId   e.g. "stage-04"
 */
function pruneArchives(gatesDir, stageId) {
  for (const { file } of listArchives(gatesDir, stageId)) {
    try { fs.unlinkSync(file); } catch { /* already gone */ }
  }
}

/**
 * Archive the stage gate if it currently has status FAIL.
 * Both core/driver.js and runStageHeadless call this so archiving always goes
 * through the same code path regardless of entry point. Best-effort: never throws.
 *
 * Attempt number: if attempt-1 does not yet exist, start at 1 (fresh sequence or
 * stale archives from a previous run without a sequence anchor). Starting at 1
 * ensures _currentSequenceArchives can identify the sequence boundary by mtime.
 * Otherwise use listArchives().length + 1 to continue the current sequence.
 *
 * @param {string} gatesDir  absolute path to pipeline/gates
 * @param {string} stageId   e.g. "stage-04"
 * @returns {string|null}    archive path if archived, null otherwise
 */
function archiveGateIfFail(gatesDir, stageId) {
  const src = path.join(gatesDir, `${stageId}.json`);
  if (!fs.existsSync(src)) return null;
  try {
    const gate = JSON.parse(fs.readFileSync(src, "utf8"));
    if (!gate || gate.status !== "FAIL") return null;
  } catch { return null; }
  const existing = listArchives(gatesDir, stageId);
  const hasAttemptOne = existing.some((a) => a.attempt === 1);
  const attempt = hasAttemptOne ? existing.length + 1 : 1;
  return archiveGate(gatesDir, stageId, attempt);
}

module.exports = { archiveGate, archiveGateIfFail, listArchives, archiveDir, pruneArchives };
