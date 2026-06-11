// Per-stage fix-step recipes for computeFixSteps (core/orchestrator.js).
//
// Data-first: each recipe produces clear_gates (repo-relative gate paths)
// directly; human-readable "rm ..." command strings are DERIVED by
// formatGateClear(). This inverts the prior flow where rm strings were
// generated first and parsed back into structured data by
// clearGatesFromFixSteps (orchestrator.js — see item 3.2 in
// plans/phase-3-structural-debt.md).
//
// API:
//   getRecipe(stageId) → { stage, diagnose(gate, ctx) }
//   diagnose(gate, ctx) → { clear_gates: string[], steps: Array|null }
//   ctx: { gatesDir: string, stageDef: object }
//
// Stages without special cases resolve to the DEFAULT recipe (steps: null).

"use strict";

// ── Workstream-attribution helpers (shared with orchestrator.js during migration) ──

function _wsFromWorkstreams(gate) {
  if (!Array.isArray(gate.workstreams)) return [];
  return gate.workstreams
    .filter(w => w.status === "FAIL" || w.status === "ESCALATE")
    .map(w => w.role);
}

function _wsFromBlockers(gate) {
  if (!Array.isArray(gate.blockers)) return [];
  const set = new Set();
  for (const b of gate.blockers) {
    if (typeof b === "object" && b.assigned_to) set.add(b.assigned_to);
  }
  return [...set];
}

// Heuristic: map free-text blocker strings to build workstream roles by
// file-path patterns.
function _wsFromText(text) {
  const ws = new Set();
  if (/\.test\.[jt]sx?|\.spec\.[jt]sx?|spec\.feature|__tests__|\/tests?\//i.test(text)) ws.add("qa");
  if (/src[/\\]backend[/\\]|\/api\/|\/routes\/|\/controller/i.test(text)) ws.add("backend");
  if (/src[/\\]frontend[/\\]|\/components?\//i.test(text)) ws.add("frontend");
  if (/src[/\\]infra[/\\]|Dockerfile|docker-compose/i.test(text)) ws.add("platform");
  return [...ws];
}

// ── Formatter ────────────────────────────────────────────────────────────────

// Single formatter: gate paths → rm command strings.
// This is the one place where structured clear_gates become shell strings.
function formatGateClear(clearGates) {
  return clearGates.map(g => `rm ${g}`);
}

// Build the standard set of clear_gates paths for a stage-04 (build) retry:
// one per workstream gate + the merged stage-04.json.
function buildGatePaths(workstreams) {
  return [
    ...workstreams.map(w => `pipeline/gates/stage-04.${w}.json`),
    "pipeline/gates/stage-04.json",
  ];
}

// ── Recipe registry ───────────────────────────────────────────────────────────

const RECIPES = new Map();

function register(stageId, diagnose) {
  RECIPES.set(stageId, { stage: stageId, diagnose });
}

const DEFAULT_DIAGNOSE = (_gate, _ctx) => ({ clear_gates: [], steps: null });

// ── stage-04a: pre-review ─────────────────────────────────────────────────────

register("stage-04a", (gate, _ctx) => {
  const issues = [];
  if (gate.lint_passed === false) issues.push("lint errors");
  if (gate.tests_passed === false) issues.push("failing tests");
  if (gate.dependency_review_passed === false) issues.push("SCA / dependency findings");
  if (gate.license_check_passed === false) issues.push("license violations");

  const ws = _wsFromBlockers(gate);
  if (!ws.length && gate.workstream) ws.push(gate.workstream);

  const buildPaths = ws.length ? buildGatePaths(ws) : [];
  const prReviewPaths = ["pipeline/gates/stage-04a.json"];
  const clear_gates = [...buildPaths, ...prReviewPaths];

  const steps = [];
  steps.push({
    description: issues.length
      ? `Fix pre-review failures: ${issues.join(", ")}`
      : "Address pre-review blockers listed above",
    commands: [],
  });
  if (ws.length) {
    steps.push({
      description: `Clear build workstream gate${ws.length > 1 ? "s" : ""}: ${ws.join(", ")}`,
      commands: formatGateClear(buildPaths),
    });
  }
  steps.push({
    description: "Re-run build with pre-review blockers as context",
    commands: ["devteam stage build --patch --from pre-review --skip-completed --headless"],
  });
  steps.push({ description: "Merge build workstream gates", commands: ["devteam merge build"] });
  steps.push({
    description: "Re-run pre-review",
    commands: [...formatGateClear(prReviewPaths), "devteam stage pre-review --headless"],
  });
  return { clear_gates, steps };
});

// ── Public API ────────────────────────────────────────────────────────────────

function getRecipe(stageId) {
  return RECIPES.get(stageId) || { stage: stageId, diagnose: DEFAULT_DIAGNOSE };
}

module.exports = { getRecipe, formatGateClear, buildGatePaths };
