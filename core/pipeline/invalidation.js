// DAG-derived gate invalidation helper (Phase 5.1,
// plans/phase-5-state-integrity.md §5.1).
//
// Problem (the #109 class, generalized): fix recipes hand-listed clear_gates
// per stage. #108/#109 happened because the build-retry path forgot
// stage-04a.json; a build recipe applied at stage-06d leaves stage-05
// (peer-review) and stage-06 (QA) PASS gates standing, so rewritten code
// re-enters the pipeline without re-review or re-QA.
//
// Solution: compute invalidation instead of hand-listing it. This module is
// the single derivation point. Recipes declare only the root stage(s) they
// clear; this helper adds every existing gate file for stages ordered after
// the root and up to the failing stage.
//
// Chain re-stamping invariant: clearing downstream gates breaks the C6 chain
// for those stages. runStageHeadless (single-role) and mergeWorkstreamGates
// (multi-role) automatically re-stamp the chain when each cleared stage is
// re-dispatched by the fix-and-retry loop. The driver guarantees every
// cleared stage is re-run before next() can advance past it.
//
// changeId-aware (Phase 5.4): when changeId is non-null, returned paths are
// prefixed via prefixPipelineRelative so bounded-mode runs get the correct
// pipeline/changes/<changeId>/gates/ form. Phase 5.4 depends on this being
// changeId-aware from the start.

"use strict";

const fs = require("node:fs");
const { STAGES } = require("./stages");
const { prefixPipelineRelative } = require("../paths");

// Map stage ID (e.g. "stage-04a") → stage name (e.g. "pre-review").
function _stageNameForId(stageId) {
  for (const [name, def] of Object.entries(STAGES)) {
    if (def && def.stage === stageId) return name;
  }
  return null;
}

/**
 * Derive the set of existing downstream stage gate files that must be cleared
 * when a recipe clears a root stage's gates.
 *
 * Given a root stage (whose gates the recipe has decided to clear) and the
 * failing stage (whose recipe fired), returns the relative paths of every
 * existing gate file for stages ordered strictly after rootStageId and up to
 * and including failingStageId, in pipeline order.
 *
 * Conditional stages that never ran produce no gate files and are naturally
 * excluded — the helper only returns paths for files that actually exist on
 * disk.
 *
 * Returns [] when stageList is absent or empty (safe for old calling code
 * that does not yet pass stageList in ctx).
 *
 * @param {object}   opts
 * @param {string}   opts.rootStageId    - stage ID of the cleared root (e.g. "stage-04")
 * @param {string}   opts.failingStageId - stage ID of the failing stage (e.g. "stage-06d")
 * @param {string[]} opts.stageList      - ordered stage names for the active track
 * @param {string}   opts.gatesDir       - absolute path to the gates directory
 * @param {string|null} [opts.changeId]  - bounded-mode changeId for path prefixing
 * @returns {string[]} relative gate paths (e.g. ["pipeline/gates/stage-04a.json"])
 */
function derivedClearGates({ rootStageId, failingStageId, stageList, gatesDir, changeId = null }) {
  if (!stageList || stageList.length === 0 || !gatesDir) return [];

  const rootName    = _stageNameForId(rootStageId);
  const failingName = _stageNameForId(failingStageId);
  if (!rootName || !failingName) return [];

  const rootIdx    = stageList.indexOf(rootName);
  const failingIdx = stageList.indexOf(failingName);

  // Either stage not in the active track, or root is not upstream of failing.
  if (rootIdx === -1 || failingIdx === -1 || rootIdx >= failingIdx) return [];

  // Stages strictly after the root and up to and including the failing stage.
  const downstream = stageList.slice(rootIdx + 1, failingIdx + 1);

  let dirContents;
  try { dirContents = fs.readdirSync(gatesDir); } catch { return []; }

  const result = [];
  for (const stageName of downstream) {
    const stageDef = STAGES[stageName];
    if (!stageDef) continue;
    const stageId = stageDef.stage; // e.g. "stage-04a"

    // Merged / single-role gate (e.g. "stage-04a.json").
    if (dirContents.includes(`${stageId}.json`)) {
      result.push(prefixPipelineRelative(`pipeline/gates/${stageId}.json`, changeId));
    }
    // Workstream and fanout gates (e.g. "stage-05.backend.json",
    // "stage-05.backend.claude-code.json"). Pattern: starts with stageId+"."
    // and ends with ".json", with at least one additional segment between
    // the dots. The trailing ".json" being separate means "stage-04a.json"
    // does NOT match the workstream pattern for stageId "stage-04".
    const wsRe = new RegExp(`^${stageId}\\..+\\.json$`);
    for (const f of dirContents) {
      if (wsRe.test(f)) {
        result.push(prefixPipelineRelative(`pipeline/gates/${f}`, changeId));
      }
    }
  }

  return result;
}

module.exports = { derivedClearGates };
