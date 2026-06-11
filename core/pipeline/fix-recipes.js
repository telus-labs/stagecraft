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
const path = require("node:path");
const { loadGateSafe } = require("../gates/load-gate");

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

// ── stage-05: peer-review ─────────────────────────────────────────────────────
//
// Three sub-cases: (1) per-area FAIL gates on disk, (2) missing per-area gates
// (workstream timed out), (3) merged-gate-only fallback.
//
// Known debt: stage-05 is also specially-cased in rolesForStage,
// requiredApprovalsFor, and computeDispatchPlan (stages.js / orchestrator.js)
// because peer-review uses "areas" not "roles". Unifying that model is out of
// scope here — see plans/phase-3-structural-debt.md §3.2 note.

register("stage-05", (gate, ctx) => {
  const gatesDir = ctx.gatesDir;
  const stageDef = ctx.stageDef;
  const steps = [];
  const clear_gates = [];

  // --- Read per-area gates from disk ---
  // Pattern: stage-05.<area>.json (not stage-05.json itself, not fanout .<host>.json).
  let perAreaFail = [];   // { area, gate } for FAIL per-area gates
  let perAreaPass = [];   // { area } for PASS/WARN per-area gates (informational)
  if (gatesDir) {
    try {
      const perAreaRe = /^stage-05\.([a-z]+)\.json$/;
      const files = fs.readdirSync(gatesDir).filter(f => perAreaRe.test(f));
      for (const f of files) {
        const area = f.match(perAreaRe)[1];
        const { gate: aGate, error } = loadGateSafe(path.join(gatesDir, f));
        if (error || !aGate) continue;
        if (aGate.status === "FAIL") perAreaFail.push({ area, gate: aGate });
        else perAreaPass.push({ area });
      }
    } catch { /* gatesDir unreadable — fall through to merged-gate path */ }
  }

  // Split failing areas by root cause.
  // failure_reason is written by approval-derivation.js:
  //   "CHANGES_REQUESTED" — reviewer explicitly requested code changes
  //   "INSUFFICIENT_APPROVALS" — reviewer covered wrong areas / didn't reach quorum
  const codeChangesAreas = perAreaFail.filter(a => a.gate.failure_reason === "CHANGES_REQUESTED");
  const incompleteAreas  = perAreaFail.filter(a => a.gate.failure_reason === "INSUFFICIENT_APPROVALS"
                                                 || !a.gate.failure_reason);

  if (perAreaFail.length > 0) {
    // ── Code changes requested ──────────────────────────────────────────────
    if (codeChangesAreas.length > 0) {
      // Collect all blocker texts from FAIL areas so the operator sees them.
      const allBlockers = codeChangesAreas.flatMap(({ area, gate: aGate }) =>
        (aGate.blockers || []).map(b => {
          const text = typeof b === "string" ? b : b.text;
          return text ? `[${area}] ${text}` : null;
        }).filter(Boolean)
      );
      steps.push({
        description: allBlockers.length
          ? `Address reviewer changes for area${codeChangesAreas.length !== 1 ? "s" : ""} `
            + `${codeChangesAreas.map(a => a.area).join(", ")}: ${allBlockers.join("; ")}`
          : `Address changes requested in area${codeChangesAreas.length !== 1 ? "s" : ""}: `
            + codeChangesAreas.map(a => a.area).join(", "),
        commands: [],
      });

      // Derive build workstreams to rebuild from the areas that have blockers.
      const wsSet = new Set();
      for (const { area, gate: aGate } of codeChangesAreas) {
        wsSet.add(area);
        for (const b of (aGate.blockers || [])) {
          const text = typeof b === "string" ? b : b.text;
          if (text) _wsFromText(text).forEach(w => wsSet.add(w));
        }
        for (const cr of (aGate.changes_requested || [])) {
          if (cr.workstream) wsSet.add(cr.workstream);
        }
      }
      const ws = [...wsSet];
      if (ws.length) {
        // Include gate clears so the autonomous driver re-enters build for the
        // affected workstreams. Without clearing stage-04.json, next() sees
        // build PASS and skips it, re-running the reviewer against unfixed code.
        const buildPaths = buildGatePaths(ws);
        buildPaths.forEach(p => { if (!clear_gates.includes(p)) clear_gates.push(p); });
        steps.push({
          description: `Re-run build workstream${ws.length !== 1 ? "s" : ""}: ${ws.join(", ")}`,
          commands: [
            ...formatGateClear(buildPaths),
            ...ws.map(w => `devteam stage build --workstream ${w} --patch --from peer-review --headless`),
          ],
        });
        steps.push({ description: "Merge build workstream gates", commands: ["devteam merge build"] });
      }
    }

    // ── Incomplete matrix (reviewer covered wrong areas or didn't reach quorum) ──
    if (incompleteAreas.length > 0) {
      const areaNames = incompleteAreas.map(a => a.area);
      const needed = incompleteAreas.map(({ area, gate: aGate }) => {
        const have = (aGate.approvals || []).length;
        const req  = aGate.required_approvals || 2;
        return `${area} (${have}/${req})`;
      }).join(", ");
      const incompleteGatePaths = areaNames.map(area => `pipeline/gates/stage-05.${area}.json`);
      incompleteGatePaths.forEach(p => { if (!clear_gates.includes(p)) clear_gates.push(p); });
      steps.push({
        description: `Review matrix incomplete for area${incompleteAreas.length !== 1 ? "s" : ""}: ${needed}`
          + ` — reviewer(s) must add '## Review of <area>' + 'REVIEW: APPROVED/CHANGES REQUESTED' for each area`,
        commands: formatGateClear(incompleteGatePaths),
      });
      steps.push({
        description: `Re-run reviewer${incompleteAreas.length !== 1 ? "s" : ""} for failing area${incompleteAreas.length !== 1 ? "s" : ""}`,
        commands: areaNames.map(area => `devteam stage peer-review --workstream ${area} --headless`),
      });
    }

    // Final step: rebuild merged gate and re-run review for code-change areas.
    if (codeChangesAreas.length > 0) {
      const areasToReview = codeChangesAreas.map(a => a.area);
      const reviewGatePaths = areasToReview.map(area => `pipeline/gates/stage-05.${area}.json`);
      reviewGatePaths.forEach(p => { if (!clear_gates.includes(p)) clear_gates.push(p); });
      steps.push({
        description: `Re-run peer review for area${areasToReview.length !== 1 ? "s" : ""}: ${areasToReview.join(", ")}`,
        commands: [
          ...formatGateClear(reviewGatePaths),
          ...areasToReview.map(area => `devteam stage peer-review --workstream ${area} --headless`),
        ],
      });
    }
    steps.push({ description: "Rebuild merged peer-review gate", commands: ["devteam merge peer-review"] });
    return { clear_gates, steps };
  }

  // --- Missing per-area gates: workstream dispatched but wrote no gate file ---
  // Compare expected roles (stageDef.roles) against gates actually found on disk.
  // A missing gate means the workstream timed out or crashed without writing output.
  if (gatesDir) {
    const expectedRoles = (stageDef.roles || []).filter(r => typeof r === "string");
    const foundAreas = new Set([...perAreaFail.map(a => a.area), ...perAreaPass.map(a => a.area)]);
    const missingAreas = expectedRoles.filter(r => !foundAreas.has(r));
    if (missingAreas.length > 0) {
      const mergedPath = "pipeline/gates/stage-05.json";
      clear_gates.push(mergedPath);
      steps.push({
        description: `Peer-review workstream${missingAreas.length !== 1 ? "s" : ""} wrote no gate: `
          + `${missingAreas.join(", ")} — re-run to complete the review matrix`,
        commands: [
          ...formatGateClear([mergedPath]),
          ...missingAreas.map(area => `devteam stage peer-review --workstream ${area} --headless`),
        ],
      });
      steps.push({ description: "Rebuild merged peer-review gate", commands: ["devteam merge peer-review"] });
      return { clear_gates, steps };
    }
  }

  // --- Fallback: merged gate only (no per-area files readable) ---
  const changesRequested = gate.changes_requested || [];
  const approvals = gate.approvals || [];
  const required = gate.required_approvals || 0;

  if (changesRequested.length) {
    const wsSet = new Set(changesRequested.map(c => c.workstream).filter(Boolean));
    if (!wsSet.size) {
      for (const b of (gate.blockers || [])) {
        if (typeof b === "string") _wsFromText(b).forEach(w => wsSet.add(w));
      }
    }
    const ws = [...wsSet];

    const reviewerList = changesRequested
      .map(c => {
        if (typeof c === "string") return c;
        const r = c.reviewer, w = c.workstream;
        if (r && w && r !== w) return `${r} (${w} area)`;
        return r || w || JSON.stringify(c);
      })
      .join(", ");

    const blockerLines = (gate.blockers || []).filter(b => typeof b === "string");
    steps.push({
      description: blockerLines.length
        ? `Address changes requested by ${reviewerList} — ${blockerLines.join("; ")}`
        : `Address changes requested by: ${reviewerList}`,
      commands: [],
    });

    if (ws.length) {
      steps.push({
        description: `Re-run build workstream${ws.length !== 1 ? "s" : ""}: ${ws.join(", ")}`,
        commands: ws.map(w => `devteam stage build --workstream ${w} --headless`),
      });
      steps.push({ description: "Merge workstream gates", commands: ["devteam merge build"] });
    }
  } else if (required && approvals.length < required) {
    steps.push({
      description: `Obtain ${required - approvals.length} more approval${required - approvals.length !== 1 ? "s" : ""} (${approvals.length}/${required} so far)`,
      commands: [],
    });
  } else {
    // Merged gate is FAIL but has no changes_requested and no approval deficit.
    // Surface whatever the gate contains so the operator has something to act on.
    const reason = gate.failure_reason
      ? `failure_reason: "${gate.failure_reason}"`
      : "inspect pipeline/gates/stage-05.json for the specific failure";
    const mergedPath = "pipeline/gates/stage-05.json";
    clear_gates.push(mergedPath);
    steps.push({
      description: `Merged peer-review gate FAIL with no specific blockers — ${reason}`,
      commands: [...formatGateClear([mergedPath]), "devteam merge peer-review"],
    });
  }
  steps.push({ description: "Re-run peer review", commands: ["devteam stage peer-review --headless"] });
  return { clear_gates, steps };
});

// ── stage-06: qa ─────────────────────────────────────────────────────────────

register("stage-06", (gate, _ctx) => {
  const failing = gate.failing_tests || [];
  const wsSet = new Set();
  for (const t of failing) { if (t.assigned_to) wsSet.add(t.assigned_to); }
  const ws = [...wsSet];

  if (!ws.length) return { clear_gates: [], steps: null };

  const clear_gates = buildGatePaths(ws);
  const steps = [
    {
      description: `Fix failing tests in: ${ws.join(", ")}`,
      commands: formatGateClear(clear_gates),
    },
    {
      description: "Re-run build with QA context",
      commands: ["devteam stage build --patch --from qa --skip-completed --headless"],
    },
    { description: "Merge workstream gates", commands: ["devteam merge build"] },
    { description: "Re-run QA", commands: ["devteam stage qa --headless"] },
  ];
  return { clear_gates, steps };
});

// ── stage-06b: accessibility-audit ───────────────────────────────────────────
//
// IDs come from noted_for_followup across gate files (the same source devteam
// advise reads), NOT from stage-06b.blockers — the blocker IDs (e.g. "A11Y-01")
// differ from the noted_for_followup IDs that advise can resolve (e.g. "QA-A11Y-01").
// advise handles gate reset and re-run internally — no rm commands needed.

register("stage-06b", (gate, ctx) => {
  const A11Y_RE = /a11y|accessibility|aria|wcag/i;
  const a11yIds = [];
  const seen = new Set();

  if (ctx.gatesDir) {
    try {
      const gateFiles = fs.readdirSync(ctx.gatesDir).filter((f) => f.endsWith(".json"));
      for (const f of gateFiles) {
        let g;
        try { g = JSON.parse(fs.readFileSync(path.join(ctx.gatesDir, f), "utf8")); } catch { continue; }
        for (const item of Array.isArray(g.noted_for_followup) ? g.noted_for_followup : []) {
          const id = item && item.id;
          if (!id || seen.has(id)) continue;
          const text = item.summary || item.text || "";
          if (A11Y_RE.test(id) || A11Y_RE.test(text)) {
            seen.add(id);
            a11yIds.push(id);
          }
        }
      }
    } catch { /* unreadable gatesDir — fall through */ }
  }

  if (a11yIds.length) {
    const applyArg = a11yIds.map((id) => `${id}=A`).join(",");
    return {
      clear_gates: [],
      steps: [{
        description: "Dispatch accessibility fixer — stagecraft applies the ARIA/HTML fix and re-runs the audit",
        commands: [`devteam advise --apply ${applyArg}`],
      }],
    };
  }
  // No A11Y items found in noted_for_followup — show the panel so the operator can confirm.
  return {
    clear_gates: [],
    steps: [{
      description: "Run devteam advise — select option A for each A11Y_FIX item to dispatch the automated fixer",
      commands: ["devteam advise"],
    }],
  };
});

// ── stage-06d: verification-beyond-tests ─────────────────────────────────────
//
// Blockers often carry a "Fix: <file>:<line> — <remedy>" clause; parse that to
// derive which workstream owns the fix and what file to edit.

register("stage-06d", (gate, _ctx) => {
  const blockers = gate.blockers || [];
  const wsSet = new Set();
  const fileHints = [];
  const verifPath = "pipeline/gates/stage-06d.json";

  const FIX_FILE_RE = /Fix:\s*([\w./\\-]+(?::\d+)?)/i;
  for (const b of blockers) {
    const text = typeof b === "string" ? b : (b && b.text) || "";
    if (!text) continue;
    const m = text.match(FIX_FILE_RE);
    if (m) {
      fileHints.push(m[1]);
      _wsFromText(m[1]).forEach(w => wsSet.add(w));
    }
    _wsFromText(text).forEach(w => wsSet.add(w));
  }
  const ws = [...wsSet];

  const steps = [];
  let buildClearGates;
  if (ws.length) {
    const fileClause = fileHints.length ? ` (${fileHints.join(", ")})` : "";
    buildClearGates = buildGatePaths(ws);
    steps.push({
      description: `Rebuild workstream${ws.length !== 1 ? "s" : ""} ${ws.join(", ")}${fileClause} — build agent applies the fix`,
      commands: [...formatGateClear(buildClearGates), ...ws.map(w => `devteam stage build --workstream ${w} --patch --from verification-beyond-tests --headless`)],
    });
    steps.push({ description: "Merge build workstream gates", commands: ["devteam merge build"] });
  } else {
    // Workstream not identified — clear all build gates and dispatch globally.
    buildClearGates = buildGatePaths(["backend", "frontend", "platform", "qa"]);
    steps.push({
      description: "Re-run build with verification findings as context — build agent applies the fix",
      commands: formatGateClear(buildClearGates),
    });
    steps.push({
      description: "Dispatch build",
      commands: ["devteam stage build --patch --from verification-beyond-tests --headless"],
    });
    steps.push({ description: "Merge build workstream gates", commands: ["devteam merge build"] });
  }
  steps.push({
    description: "Re-run verification",
    commands: [...formatGateClear([verifPath]), "devteam stage verification-beyond-tests --headless"],
  });
  const clear_gates = [...buildClearGates, verifPath];
  return { clear_gates, steps };
});

// ── stage-07: sign-off ────────────────────────────────────────────────────────

register("stage-07", (_gate, _ctx) => ({
  clear_gates: [],
  steps: [
    { description: "Obtain PM sign-off (and deploy request if applicable)", commands: [] },
    { description: "Re-run sign-off", commands: ["devteam stage sign-off --headless"] },
  ],
}));

// ── Public API ────────────────────────────────────────────────────────────────

function getRecipe(stageId) {
  return RECIPES.get(stageId) || { stage: stageId, diagnose: DEFAULT_DIAGNOSE };
}

module.exports = { getRecipe, formatGateClear, buildGatePaths };
