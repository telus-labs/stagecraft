// Path helpers for B9 — bounded workspace isolation.
//
// When isolation === "bounded", in-flight feature artifacts live under
// pipeline/changes/<changeId>/ instead of the global pipeline/. All
// path construction in the orchestrator, headless runner, and adapters
// goes through these helpers so the change is contained in one file.
//
// changeId === null → in-place mode (the default); all helpers return
// the same paths they always did, so callers need no conditional logic.

const path = require("node:path");

// Root of the pipeline artifact tree for a given change.
// null changeId → <cwd>/pipeline  (in-place, historical behavior)
// non-null      → <cwd>/pipeline/changes/<changeId>
function pipelineRoot(cwd, changeId) {
  return changeId
    ? path.join(cwd, "pipeline", "changes", changeId)
    : path.join(cwd, "pipeline");
}

function gatesDir(cwd, changeId) {
  return path.join(pipelineRoot(cwd, changeId), "gates");
}

function logsDir(cwd, changeId) {
  return path.join(pipelineRoot(cwd, changeId), "logs");
}

// Rewrite a pipeline/-relative path to its bounded form.
//   "pipeline/brief.md"          → "pipeline/changes/<id>/brief.md"
//   "pipeline/gates/stage-01.json" → "pipeline/changes/<id>/gates/stage-01.json"
//   "AGENTS.md"                  → "AGENTS.md"  (not pipeline-relative; unchanged)
//
// Path separators are normalized to forward slashes so the comparison is
// stable across platforms and the prompt text looks consistent.
function prefixPipelineRelative(relPath, changeId) {
  if (!changeId || !relPath) return relPath;
  const normalized = relPath.replace(/\\/g, "/");
  if (!normalized.startsWith("pipeline/")) return relPath;
  return path.join("pipeline", "changes", changeId, normalized.slice("pipeline/".length));
}

module.exports = { pipelineRoot, gatesDir, logsDir, prefixPipelineRelative };
