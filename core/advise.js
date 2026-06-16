// core/advise.js
//
// Advisory system for noted_for_followup[] items across pipeline gate files.
// Classifies downstream risk, generates ranked options, and applies stage-manager
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
    for (const raw of items) {
      // Agents sometimes write plain strings ("RT-02: summary") instead of
      // structured objects. Normalise either form so advise can process them.
      let item = raw;
      if (typeof raw === "string") {
        const m = raw.match(/^([^\s:]+):\s*(.*)/s);
        item = m ? { id: m[1], text: m[2].trim() } : { id: raw, text: raw };
      }
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
  // B9 exemption: advise.js is an interactive advisory command; it always reads
  // from the in-place pipeline/. Callers may pass opts.contextFile to override.
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
// Pulls AC-N references from an item's text fields.
// Gates may use either "text" (build/QA workstream format) or "summary"
// (red-team stage-04c format) — check both.
// ---------------------------------------------------------------------------
function extractAcRefs(item) {
  const content = `${item.id || ""} ${item.text || ""} ${item.summary || ""}`;
  return [...new Set((content.match(/\bAC-\d+\b/g) || []))];
}

// Normalise the human-readable description field across gate formats.
function itemText(item) {
  return item.text || item.summary || "";
}

// ---------------------------------------------------------------------------
// classifyItem
// ---------------------------------------------------------------------------
// track_for (when present) is the agent's own recommendation — use it first:
//   "brief-amendment"  → PEER_REVIEW_RISK  (brief needs amending before peer-review)
//   "lessons-learned"  → QA_NOISE          (informational; no gate impact)
//   "ticket"           → PEER_REVIEW_RISK or QA_BLOCKER based on AC refs
//
// Fallback (no track_for or unrecognised value):
//   QA_BLOCKER   — item references an AC that is missing from spec.feature
//   PEER_REVIEW_RISK — no AC ref, severity high/critical (red-team finding)
//   QA_NOISE     — no AC ref, timing/flakiness keywords in text
//   INFO         — everything else
// ---------------------------------------------------------------------------
function classifyItem(item, cwd, opts = {}) {
  const trackFor = (item.track_for || "").toLowerCase();

  // Items sourced from the accessibility gate are A11Y_FIX only when the gate
  // is FAIL — meaning they are actively blocking the pipeline. When the gate is
  // PASS (e.g. after a successful fix re-run), the items are moderate/minor
  // noted_for_followup entries; classify as INFO so they don't count as blockers.
  if ((item._source || "").includes("stage-06b")) {
    // B9 exemption: advise reads in-place gates; callers may pass opts.gatesDir.
    const gatesPath = opts.gatesDir || path.join(cwd, "pipeline", "gates");
    const gatePath = path.join(gatesPath, "stage-06b.json");
    try {
      const gate = JSON.parse(fs.readFileSync(gatePath, "utf8"));
      if (gate.status === "FAIL") return "A11Y_FIX";
    } catch { /* gate missing or unreadable — treat as not-FAIL */ }
    return "INFO";
  }

  // Agent-provided track_for overrides heuristics
  if (trackFor === "brief-amendment") return "PEER_REVIEW_RISK";
  if (trackFor === "lessons-learned") return "QA_NOISE";
  if (trackFor === "ticket") {
    const acRefs = extractAcRefs(item);
    return acRefs.length > 0 ? "QA_BLOCKER" : "PEER_REVIEW_RISK";
  }

  // Heuristic fallback
  const acRefs = extractAcRefs(item);
  if (acRefs.length > 0) {
    // B9 exemption: advise reads in-place spec (spec.feature is global project artifact).
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

  const textLower = itemText(item).toLowerCase();
  const noiseKeywords = ["flak", "timing", "intermittent", "retry", "flaky", "overhead", "ci timing", "timing issue"];
  if (noiseKeywords.some((kw) => textLower.includes(kw))) return "QA_NOISE";

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
  const needsIdQuote = /[ \t()[\]{};|&]/.test(item.id);
  const ticketHint = (letter) => {
    if (hasAc) {
      const arg = `${item.id}=${letter}:PROJ-XYZ`;
      return ` (ticket: --apply ${needsIdQuote ? `'${arg}'` : arg})`;
    }
    return ` (--apply <id>=${letter}:PROJ-XYZ)`;
  };
  const trackFor = (item.track_for || "").toLowerCase();

  switch (classification) {
    case "A11Y_FIX":
      return [
        { id: "A", action: "fix",     label: "fix",     recommended: true,
          description: "dispatches the frontend agent headlessly to apply the HTML fix now, then re-runs the accessibility audit to verify" },
        { id: "B", action: "defer",   label: "defer",   recommended: false,
          description: `defer with ticket — mark DEFERRED in pipeline/context.md${ticketHint("B")}` },
        { id: "C", action: "amend",   label: "amend",   recommended: false,
          description: "flag for PM to remove the accessibility requirement from scope" },
        { id: "D", action: "nothing", label: "nothing", recommended: false,
          description: "advance as-is; accessibility gate remains FAIL" },
      ];

    case "QA_BLOCKER":
      return [
        { id: "A", action: "scaffold",  label: "scaffold",  recommended: true,
          description: `prints the command to run: devteam stage build --workstream qa --patch (writes SCAFFOLD-PENDING; you run the command)` },
        { id: "B", action: "defer",     label: "defer",     recommended: false,
          description: `mark as DEFERRED in pipeline/context.md${ticketHint("B")}` },
        { id: "C", action: "amend",     label: "amend",     recommended: false,
          description: `flag for PM to remove or scope-down ${acRefs.join(", ") || "this item"} from the brief` },
        { id: "D", action: "nothing",   label: "nothing",   recommended: false,
          description: "advance as-is; QA will block; address it there" },
      ];

    case "PEER_REVIEW_RISK":
      // When track_for says "brief-amendment", the agent already knows the AC can't be
      // fully tested as written — recommend amend as the right resolution.
      if (trackFor === "brief-amendment") {
        return [
          { id: "A", action: "amend",   label: "amend",   recommended: true,
            description: `flag for PM to scope-down or remove ${acRefs.join(", ") || "this item"} from the brief` },
          { id: "B", action: "defer",   label: "defer",   recommended: false,
            description: `defer with ticket${ticketHint("B")}` },
          { id: "C", action: "nothing", label: "nothing", recommended: false,
            description: "advance as-is; peer-review may flag the untestable AC" },
        ];
      }
      return [
        { id: "A", action: "defer",     label: "defer",     recommended: true,
          description: `acknowledge in pipeline/context.md${ticketHint("A")}` },
        { id: "B", action: "nothing",   label: "nothing",   recommended: false,
          description: "advance as-is; red-team item may surface in peer-review CHANGES_REQUESTED" },
        { id: "C", action: "amend",     label: "amend",     recommended: false,
          description: "flag for PM to scope-down or remove the related requirement" },
      ];

    case "QA_NOISE":
      // When track_for says "lessons-learned", prefer known-flaky over nothing so
      // there is an explicit record (QA retries once before counting a failure).
      if (trackFor === "lessons-learned") {
        return [
          { id: "A", action: "known-flaky", label: "known-flaky", recommended: true,
            description: "add KNOWN-FLAKY marker so QA retries once before counting a failure" },
          { id: "B", action: "nothing",     label: "nothing",     recommended: false,
            description: "record as known; no marker written; QA counts first failure" },
          { id: "C", action: "fix-now",     label: "fix-now",     recommended: false,
            description: "dispatch build workstream to stabilize the test before advancing" },
        ];
      }
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
          description: `attach a ticket reference to this acknowledgement — use when your team requires all findings to be tracked${ticketHint("B")}` },
      ];
  }
}

// ---------------------------------------------------------------------------
// applyOption
// ---------------------------------------------------------------------------
// Writes the stage manager's decision for one item into the advisory section of
// pipeline/context.md.  The full section is rebuilt on each apply call so
// re-running --apply is idempotent.
//
// Caller is responsible for writing all decisions in one call; the section
// is replaced atomically.
// ---------------------------------------------------------------------------
function applyOption(item, action, ticketId) {
  const acRefs = extractAcRefs(item);
  const refLabel = acRefs.length > 0 ? acRefs.join(",") : item.id;
  const summary = itemText(item) || item.id;

  switch (action) {
    case "defer":
      return `DEFERRED: ${refLabel} — ${summary} — ticket ${ticketId || "PLACEHOLDER"}`;
    case "wontfix":
      return `WONTFIX: ${refLabel} — ${summary}`;
    case "nothing":
      return `NOTED: ${item.id} — ${summary} — stage manager: no action`;
    case "known-flaky":
      return `KNOWN-FLAKY: ${item.id} — ${summary}`;
    case "amend":
      return `BRIEF-AMEND-NEEDED: ${refLabel} — stage manager: scope-down or remove before peer-review`;
    case "scaffold":
      return `SCAFFOLD-PENDING: ${refLabel} — ${summary}`;
    case "fix":
      return `NOTED: ${item.id} — ${summary} — stage manager: fix-accepted (edit HTML then re-run accessibility-audit)`;
    case "fix-now":
      return `NOTED: ${item.id} — ${summary} — stage manager: fix-now (dispatch build workstream)`;
    default:
      return `NOTED: ${item.id} — ${summary} — stage manager: ${action}`;
  }
}

// ---------------------------------------------------------------------------
// writeAdviseSection
// ---------------------------------------------------------------------------
// Replaces (or inserts) the <!-- devteam:advise:begin/end --> section in
// pipeline/context.md with the given decision lines.
// ---------------------------------------------------------------------------
function writeAdviseSection(cwd, decisionLines, opts = {}) {
  // B9 exemption: advise writes to in-place context.md; callers may pass opts.contextFile.
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
    const classification = classifyItem(item, cwd, opts);
    const options = generateOptions(item, classification);
    return { item, classification, addressed: isAddressed, options };
  });

  const unresolvedBlockers = items.filter(
    (r) => !r.addressed && (r.classification === "QA_BLOCKER" || r.classification === "PEER_REVIEW_RISK" || r.classification === "A11Y_FIX")
  ).length;

  if (opts.checkOnly || !opts.apply || opts.apply.size === 0) {
    return { items, unresolvedBlockers };
  }

  // Apply selections — build new decision lines then write the section once
  // B9 exemption: advise writes to in-place context.md; callers may pass opts.contextFile.
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
    (r) => !r.addressed && (r.classification === "QA_BLOCKER" || r.classification === "PEER_REVIEW_RISK" || r.classification === "A11Y_FIX")
  ).length;

  return {
    items: updatedItems,
    unresolvedBlockers: updatedUnresolvedBlockers,
    scaffoldCommands,
  };
}

module.exports = { runAdvise, gatherFollowups, classifyItem, generateOptions };
