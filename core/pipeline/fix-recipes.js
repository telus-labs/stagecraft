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

const fs = require("node:fs");

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

// ── stage-04c: red-team ───────────────────────────────────────────────────────

register("stage-04c", (gate, ctx) => {
  const findings = gate.must_address_before_peer_review || [];
  const wsSet = new Set(gate.affected_workstreams || []);
  for (const f of findings) {
    if (typeof f === "object" && f !== null) {
      if (f.workstream) wsSet.add(f.workstream);
      if (f.assigned_to) wsSet.add(f.assigned_to);
      for (const w of _wsFromText(f.file || "")) wsSet.add(w);
      for (const w of _wsFromText(f.summary || "")) wsSet.add(w);
    }
  }
  for (const b of (gate.blockers || [])) {
    if (typeof b !== "object" || b === null) continue;
    if (b.assigned_to) wsSet.add(b.assigned_to);
    else if (b.workstream) wsSet.add(b.workstream);
    for (const w of _wsFromText(b.file || "")) wsSet.add(w);
    for (const w of _wsFromText(b.summary || "")) wsSet.add(w);
  }
  const ws = [...wsSet];

  const redTeamPath = "pipeline/gates/stage-04c.json";
  const steps = [];

  if (findings.length) {
    steps.push({
      description: `Address ${findings.length} must-fix finding${findings.length !== 1 ? "s" : ""} before peer review`,
      commands: [],
    });
  }

  let buildClearGates;
  if (ws.length) {
    buildClearGates = buildGatePaths(ws);
    steps.push({
      description: `Clear affected build workstream gate${ws.length !== 1 ? "s" : ""}: ${ws.join(", ")}`,
      commands: formatGateClear(buildClearGates),
    });
  } else {
    // Last resort: scan for actual stage-04 workstream gate files on disk.
    let actualGateFiles = [];
    if (ctx.gatesDir) {
      try {
        actualGateFiles = fs.readdirSync(ctx.gatesDir)
          .filter((f) => /^stage-04\..+\.json$/.test(f));
      } catch { /* gatesDir unreadable — keep empty */ }
    }
    if (actualGateFiles.length > 0) {
      // Extract workstream names ("stage-04.backend.json" → "backend") and use
      // buildGatePaths so the merged stage-04.json is always included alongside
      // the per-area gates.
      const diskWs = actualGateFiles.map((f) => f.replace(/^stage-04\./, "").replace(/\.json$/, ""));
      buildClearGates = buildGatePaths(diskWs);
      steps.push({
        description: `Clear affected build workstream gate${diskWs.length !== 1 ? "s" : ""}: ${diskWs.join(", ")}`,
        commands: formatGateClear(buildClearGates),
      });
    } else {
      // No workstream identified from gate data and no gate files found on disk —
      // clear all known build workstream gates as a safe last resort.
      buildClearGates = buildGatePaths(["backend", "frontend", "platform", "qa"]);
      steps.push({
        description: "Clear all build workstream gates (workstream not identified from gate data)",
        commands: formatGateClear(buildClearGates),
      });
    }
  }

  steps.push({
    description: "Re-run build with red-team findings as context",
    commands: ["devteam stage build --patch --from red-team --skip-completed --headless"],
  });
  steps.push({ description: "Merge build workstream gates", commands: ["devteam merge build"] });
  steps.push({
    description: "Re-run red team",
    commands: [...formatGateClear([redTeamPath]), "devteam stage red-team --headless"],
  });

  const clear_gates = [...(buildClearGates || []), redTeamPath];
  return { clear_gates, steps };
});

// ── stage-04: build (merged gate) ────────────────────────────────────────────

register("stage-04", (gate, _ctx) => {
  const ws = _wsFromWorkstreams(gate).length
    ? _wsFromWorkstreams(gate)
    : _wsFromBlockers(gate);

  let clear_gates;
  const steps = [];
  if (ws.length) {
    clear_gates = buildGatePaths(ws);
    steps.push({
      description: `Clear failing workstream gate${ws.length !== 1 ? "s" : ""}: ${ws.join(", ")}`,
      commands: formatGateClear(clear_gates),
    });
  } else {
    clear_gates = ["pipeline/gates/stage-04.json"];
    steps.push({
      description: "Clear the merged build gate",
      commands: formatGateClear(clear_gates),
    });
  }
  steps.push({
    description: "Re-run build in patch mode",
    commands: ["devteam stage build --patch --from build --skip-completed --headless"],
  });
  steps.push({ description: "Merge workstream gates", commands: ["devteam merge build"] });
  return { clear_gates, steps };
});

// ── Public API ────────────────────────────────────────────────────────────────

function getRecipe(stageId) {
  return RECIPES.get(stageId) || { stage: stageId, diagnose: DEFAULT_DIAGNOSE };
}

module.exports = { getRecipe, formatGateClear, buildGatePaths };
