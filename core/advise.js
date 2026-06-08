// core/advise.js
//
// Advisory system for noted_for_followup[] items across pipeline gate files.
// Classifies downstream risk, generates ranked options, and applies operator
// decisions to pipeline/context.md.
//
// Public API:
//   runAdvise(cwd, opts?) → { items, unresolvedBlockers }
//   gatherFollowups(cwd)  → annotated item array  (exported for tests)
//   classifyItem(item, cwd) → classification string  (exported for tests)
//
// opts:
//   checkOnly  — classify only; do not apply any selections (used by cmdNext hook)
//   apply      — Map<itemId, { action, ticketId }>  (used by cmdAdvise --apply)
//   gatesDir   — override default pipeline/gates path
//   contextFile — override default pipeline/context.md path

"use strict";

const fs   = require("node:fs");
const path = require("node:path");
const { gatesDir: getGatesDir } = require("./paths");

const ADVISE_BEGIN = "<!-- devteam:advise:begin -->";
const ADVISE_END   = "<!-- devteam:advise:end -->";

// Markers that signal an item has been actioned — any of these in context.md
// means the item is addressed.
const ADDRESSED_PREFIXES = [
  "DEFERRED:", "WONTFIX:", "NOTED:", "KNOWN-FLAKY:", "BRIEF-AMEND-NEEDED:", "SCAFFOLD-PENDING:",
];

// ---------------------------------------------------------------------------
// gatherFollowups
// ---------------------------------------------------------------------------
// Reads every *.json file in pipeline/gates/ and collects noted_for_followup[]
// items.  Each item is annotated with _source (gate filename).  Deduplication
// is by item.id: later files win (merged gates overwrite workstream gates).
// ---------------------------------------------------------------------------
function gatherFollowups(cwd, opts = {}) {
  const gatesDirPath = opts.gatesDir || getGatesDir(cwd, null);
  if (!fs.existsSync(gatesDirPath)) return [];

  const files = fs.readdirSync(gatesDirPath).filter((f) => f.endsWith(".json"));
  const byId = new Map();

  for (const f of files) {
    let gate;
    try {
      gate = JSON.parse(fs.readFileSync(path.join(gatesDirPath, f), "utf8"));
    } catch {
      continue;
    }
    const items = Array.isArray(gate.noted_for_followup) ? gate.noted_for_followup : [];
    for (const item of items) {
      if (!item || !item.id) continue;
      byId.set(item.id, { ...item, _source: f });
    }
  }

  return [...byId.values()];
}

// ---------------------------------------------------------------------------
// loadAddressedItems
// ---------------------------------------------------------------------------
// Scans pipeline/context.md for advisory decision lines.  Returns a Set of
// addressed tokens: AC refs ("AC-10") and raw item IDs ("RT-3").
// ---------------------------------------------------------------------------
function loadAddressedItems(cwd, opts = {}) {
  const contextFile = opts.contextFile || path.join(cwd, "pipeline", "context.md");
  const addressed = new Set();
  if (!fs.existsSync(contextFile)) return addressed;

  const content = fs.readFileSync(contextFile, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    const matchesPrefix = ADDRESSED_PREFIXES.some((p) => trimmed.startsWith(p));
    if (!matchesPrefix) continue;
    // Extract the token(s) after the colon — may be "AC-10,AC-11" or "RT-3"
    const afterColon = trimmed.replace(/^[A-Z-]+:\s*/, "");
    // Grab everything up to the first space or em-dash or " —"
    const tokenPart = afterColon.split(/\s|—/)[0];
    for (const tok of tokenPart.split(",")) {
      const t = tok.trim();
      if (t) addressed.add(t);
    }
  }
  return addressed;
}

// ---------------------------------------------------------------------------
// extractAcRefs
// ---------------------------------------------------------------------------
// Pulls AC-N references from an item's summary and id fields.
// ---------------------------------------------------------------------------
function extractAcRefs(item) {
  const text = `${item.id || ""} ${item.summary || ""}`;
  return [...new Set((text.match(/\bAC-\d+\b/g) || []))];
}

// ---------------------------------------------------------------------------
// classifyItem
// ---------------------------------------------------------------------------
// QA_BLOCKER   — item references an AC that is missing from spec.feature
// PEER_REVIEW_RISK — no AC ref, severity high/critical (red-team finding)
// QA_NOISE     — no AC ref, timing/flakiness keywords in summary
// INFO         — everything else
// ---------------------------------------------------------------------------
function classifyItem(item, cwd) {
  const acRefs = extractAcRefs(item);

  if (acRefs.length > 0) {
    const specPath = path.join(cwd, "pipeline", "spec.feature");
    if (!fs.existsSync(specPath)) {
      // No spec yet (pre-stage-03b) — can't confirm coverage; be conservative
      return "QA_BLOCKER";
    }
    const specContent = fs.readFileSync(specPath, "utf8");
    // If ALL referenced ACs are tagged in spec.feature, this is not a coverage gap
    const allCovered = acRefs.every((ac) => new RegExp(`@${ac}\\b`).test(specContent));
    if (allCovered) return "INFO";
    return "QA_BLOCKER";
  }

  // No AC refs — classify by severity and keywords
  const severity = (item.severity || "").toLowerCase();
  if (severity === "critical" || severity === "high") return "PEER_REVIEW_RISK";

  const summaryLower = (item.summary || "").toLowerCase();
  const noiseKeywords = ["flak", "timing", "intermittent", "retry", "flaky", "ci timing", "timing issue"];
  if (noiseKeywords.some((kw) => summaryLower.includes(kw))) return "QA_NOISE";

  return "INFO";
}

// ---------------------------------------------------------------------------
// generateOptions
// ---------------------------------------------------------------------------
// Returns ranked option list for a given classification.
// Each option: { id, action, label, description, recommended }
// ---------------------------------------------------------------------------
function generateOptions(item, classification) {
  const acRefs = extractAcRefs(item);
  const hasAc = acRefs.length > 0;
  const ticketHint = hasAc ? ` (ticket: --apply ${item.id}=B:PROJ-XYZ)` : " (--apply <id>=B:PROJ-XYZ)";

  switch (classification) {
    case "QA_BLOCKER":
      return [
        { id: "A", action: "scaffold",  label: "scaffold",  recommended: true,
          description: `dispatch QA workstream to add a @wip test stub covering ${acRefs.join(", ") || item.id}` },
        { id: "B", action: "defer",     label: "defer",     recommended: false,
          description: `mark as DEFERRED in pipeline/context.md${ticketHint}` },
        { id: "C", action: "amend",     label: "amend",     recommended: false,
          description: `flag for PM to remove or scope-down ${acRefs.join(", ") || "this item"} from the brief` },
        { id: "D", action: "nothing",   label: "nothing",   recommended: false,
          description: "advance as-is; QA will block; address it there" },
      ];

    case "PEER_REVIEW_RISK":
      return [
        { id: "A", action: "defer",     label: "defer",     recommended: true,
          description: `acknowledge in pipeline/context.md${ticketHint}` },
        { id: "B", action: "nothing",   label: "nothing",   recommended: false,
          description: "advance as-is; red-team item may surface in peer-review CHANGES_REQUESTED" },
        { id: "C", action: "amend",     label: "amend",     recommended: false,
          description: "flag for PM to scope-down or remove the related requirement" },
      ];

    case "QA_NOISE":
      return [
        { id: "A", action: "nothing",     label: "nothing",     recommended: true,
          description: "record as known; QA retries on flake; no marker written" },
        { id: "B", action: "known-flaky", label: "known-flaky", recommended: false,
          description: "add KNOWN-FLAKY marker to pipeline/context.md so QA does not count a single failure as FAIL" },
        { id: "C", action: "fix-now",     label: "fix-now",     recommended: false,
          description: "dispatch build workstream to stabilize the test before advancing" },
      ];

    default: // INFO
      return [
        { id: "A", action: "nothing",   label: "nothing",   recommended: true,
          description: "no action needed; item is informational" },
        { id: "B", action: "defer",     label: "defer",     recommended: false,
          description: `log in pipeline/context.md for visibility${ticketHint}` },
      ];
  }
}

// ---------------------------------------------------------------------------
// applyOption
// ---------------------------------------------------------------------------
// Writes the operator's decision for one item into the advisory section of
// pipeline/context.md.  The full section is rebuilt on each apply call so
// re-running --apply is idempotent.
//
// Caller is responsible for writing all decisions in one call; the section
// is replaced atomically.
// ---------------------------------------------------------------------------
function applyOption(item, action, ticketId) {
  const acRefs = extractAcRefs(item);
  const refLabel = acRefs.length > 0 ? acRefs.join(",") : item.id;
  const summary = item.summary || item.id;

  switch (action) {
    case "defer":
      return `DEFERRED: ${refLabel} — ${summary} — ticket ${ticketId || "PLACEHOLDER"}`;
    case "wontfix":
      return `WONTFIX: ${refLabel} — ${summary}`;
    case "nothing":
      return `NOTED: ${item.id} — ${summary} — operator: no action`;
    case "known-flaky":
      return `KNOWN-FLAKY: ${item.id} — ${summary}`;
    case "amend":
      return `BRIEF-AMEND-NEEDED: ${refLabel} — operator: scope-down or remove before peer-review`;
    case "scaffold":
      return `SCAFFOLD-PENDING: ${refLabel} — ${summary}`;
    case "fix-now":
      return `NOTED: ${item.id} — ${summary} — operator: fix-now (dispatch build workstream)`;
    default:
      return `NOTED: ${item.id} — ${summary} — operator: ${action}`;
  }
}

// ---------------------------------------------------------------------------
// writeAdviseSection
// ---------------------------------------------------------------------------
// Replaces (or inserts) the <!-- devteam:advise:begin/end --> section in
// pipeline/context.md with the given decision lines.
// ---------------------------------------------------------------------------
function writeAdviseSection(cwd, decisionLines, opts = {}) {
  const contextFile = opts.contextFile || path.join(cwd, "pipeline", "context.md");
  const section = [
    ADVISE_BEGIN,
    "## Advisory decisions (devteam advise)",
    "",
    ...decisionLines,
    "",
    ADVISE_END,
  ].join("\n");

  let content = "";
  if (fs.existsSync(contextFile)) {
    content = fs.readFileSync(contextFile, "utf8");
  }

  if (content.includes(ADVISE_BEGIN)) {
    const start = content.indexOf(ADVISE_BEGIN);
    const end   = content.indexOf(ADVISE_END) + ADVISE_END.length;
    content = content.slice(0, start) + section + content.slice(end);
  } else {
    content = content ? content + "\n\n" + section : section;
  }

  fs.mkdirSync(path.dirname(contextFile), { recursive: true });
  fs.writeFileSync(contextFile, content, "utf8");
}

// ---------------------------------------------------------------------------
// runAdvise
// ---------------------------------------------------------------------------
// opts.checkOnly  — classify only, return result without writing
// opts.apply      — Map<itemId, { action, ticketId }>
// opts.gatesDir   — override gates directory
// opts.contextFile — override context.md path
// ---------------------------------------------------------------------------
function runAdvise(cwd, opts = {}) {
  const allItems   = gatherFollowups(cwd, opts);
  const addressed  = loadAddressedItems(cwd, opts);

  const items = allItems.map((item) => {
    const acRefs = extractAcRefs(item);
    // An item is addressed if its raw id OR any of its AC refs appear in the addressed set
    const isAddressed = addressed.has(item.id) || acRefs.some((ac) => addressed.has(ac));
    const classification = classifyItem(item, cwd);
    const options = generateOptions(item, classification);
    return { item, classification, addressed: isAddressed, options };
  });

  const unresolvedBlockers = items.filter(
    (r) => !r.addressed && (r.classification === "QA_BLOCKER" || r.classification === "PEER_REVIEW_RISK")
  ).length;

  if (opts.checkOnly || !opts.apply || opts.apply.size === 0) {
    return { items, unresolvedBlockers };
  }

  // Apply selections — build new decision lines then write the section once
  const contextFile = opts.contextFile || path.join(cwd, "pipeline", "context.md");

  // Collect existing decision lines (preserve previously applied decisions)
  const existingLines = [];
  if (fs.existsSync(contextFile)) {
    const raw = fs.readFileSync(contextFile, "utf8");
    if (raw.includes(ADVISE_BEGIN)) {
      const start = raw.indexOf(ADVISE_BEGIN) + ADVISE_BEGIN.length;
      const end   = raw.indexOf(ADVISE_END);
      const section = raw.slice(start, end);
      for (const line of section.split("\n")) {
        const t = line.trim();
        if (t && !t.startsWith("## Advisory")) existingLines.push(t);
      }
    }
  }

  const scaffoldCommands = [];
  const newLines = [];

  for (const [itemId, { action, ticketId }] of opts.apply) {
    // Skip "nothing" — recorded only if there's no existing line for this item
    const record = applyOption({ id: itemId, ...allItems.find((i) => i.id === itemId) }, action, ticketId);
    if (action === "scaffold") {
      scaffoldCommands.push(
        `To scaffold for ${itemId}: devteam stage build --workstream qa --patch --skip-preflight`
      );
    }
    // Replace existing line for this item id if present
    const existingIdx = existingLines.findIndex((l) => l.includes(itemId));
    if (existingIdx >= 0) {
      existingLines[existingIdx] = record;
    } else {
      newLines.push(record);
    }
  }

  const allLines = [...existingLines, ...newLines].filter(Boolean);
  writeAdviseSection(cwd, allLines, opts);

  // Re-compute addressed set after writing
  const updatedAddressed = loadAddressedItems(cwd, opts);
  const updatedItems = items.map((r) => {
    const acRefs = extractAcRefs(r.item);
    const isAddressed = updatedAddressed.has(r.item.id) || acRefs.some((ac) => updatedAddressed.has(ac));
    return { ...r, addressed: isAddressed };
  });

  const updatedUnresolvedBlockers = updatedItems.filter(
    (r) => !r.addressed && (r.classification === "QA_BLOCKER" || r.classification === "PEER_REVIEW_RISK")
  ).length;

  return {
    items: updatedItems,
    unresolvedBlockers: updatedUnresolvedBlockers,
    scaffoldCommands,
  };
}

module.exports = { runAdvise, gatherFollowups, classifyItem, generateOptions };
