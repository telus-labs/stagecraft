"use strict";

const path = require("node:path");
const { generateHelp } = require(path.join(__dirname, "..", "flags"));
const { getOrchestrator } = require(path.join(__dirname, "..", "get-orchestrator"));

const name = "advise";

const flags = {
  cwd:          { type: "string",  description: "Target project directory" },
  feature:      { type: "string",  description: "Feature name (bounded isolation mode)" },
  apply:        { type: "string",  description: "Apply selections, e.g. AC-11=A,AC-12=B" },
  json:         { type: "boolean", description: "JSON output" },
  "timeout-ms": { type: "number",  description: "Timeout for a11y-fixer dispatch (ms)" },
  help:         { type: "boolean", description: "Show this help" },
};

// ---------------------------------------------------------------------------
// advise — devteam advise [--apply <selections>] [--json]
//
// Surfaces noted_for_followup[] items from completed gate files, classifies
// their downstream risk (QA_BLOCKER, PEER_REVIEW_RISK, QA_NOISE, INFO),
// and optionally applies stage-manager selections to pipeline/context.md.
//
// Apply format: --apply AC-11=A,AC-10=B:PROJ-123,AC-12=A
//   <itemId>=<optionLetter>[:<ticketId>]
// ---------------------------------------------------------------------------
async function run(positional, _flags) {
  if (_flags.help) { console.log(generateHelp("devteam advise [options]", flags)); process.exit(0); }
  const cwd = _flags.cwd || process.cwd();
  const { loadConfig, checkBoundedFence } = require(path.join(__dirname, "..", "..", "config"));
  const config = loadConfig(cwd);
  checkBoundedFence(config, "advise");
  const { resolveChangeId } = require(path.join(__dirname, "..", "resolve-change-id"));
  const changeId = resolveChangeId(_flags, config);
  const { gatesDir: getGatesDir, pipelineRoot } = require(path.join(__dirname, "..", "..", "paths"));
  const adviseOpts = changeId
    ? { gatesDir: getGatesDir(cwd, changeId), contextFile: path.join(pipelineRoot(cwd, changeId), "context.md") }
    : {};
  const { runAdvise } = require(path.join(__dirname, "..", "..", "advise"));

  // Parse --apply selections into Map<itemId, { action, ticketId }>
  // advise declares --apply as string so parseFlags ensures it always has a
  // value when present (bare --apply exits 2 "requires a value" in the parser).
  let applyMap = new Map();
  if (_flags.apply) {
    for (const sel of String(_flags.apply).split(",")) {
      const [lhs, rhs = "A"] = sel.trim().split("=");
      const itemId = lhs.trim();
      const [letter, ticketId] = rhs.trim().split(":");
      if (!itemId || !letter) continue;
      applyMap.set(itemId, { letter: letter.toUpperCase(), ticketId });
    }
  }

  const result = runAdvise(cwd, { ...adviseOpts, checkOnly: applyMap.size === 0 && !_flags.apply });

  // If --apply was given, resolve option letters to actions using the item's generated options
  if (applyMap.size > 0) {
    const resolvedMap = new Map();
    for (const [itemId, { letter, ticketId }] of applyMap) {
      const match = result.items.find((r) => r.item.id === itemId);
      if (!match) {
        console.error(`[advise] Unknown item id "${itemId}" — skipping`);
        continue;
      }
      const opt = match.options.find((o) => o.id === letter);
      if (!opt) {
        console.error(`[advise] Option "${letter}" not valid for "${itemId}" — skipping`);
        continue;
      }
      resolvedMap.set(itemId, { action: opt.action, ticketId });
    }

    // A11Y_FIX "fix" actions: dispatch the frontend agent to apply the HTML
    // fix, then re-run the accessibility audit to verify. Replace the action
    // with the outcome so applyOption writes the right marker.
    const fixItems = [...resolvedMap.entries()].filter(([, { action }]) => action === "fix");
    if (fixItems.length > 0) {
      const { fixA11yBlockers } = require(path.join(__dirname, "..", "..", "a11y-fixer"));
      const gatesDir = getGatesDir(cwd, changeId);
      const a11yGatePath = path.join(gatesDir, "stage-06b.json");
      let a11yBlockers = [];
      try {
        const fs = require("node:fs");
        const gate = JSON.parse(fs.readFileSync(a11yGatePath, "utf8"));
        a11yBlockers = gate.blockers || [];
      } catch { /* gate absent or unreadable — fixA11yBlockers handles it */ }

      const fixResult = await fixA11yBlockers(cwd, a11yBlockers, {
        timeoutMs: typeof _flags.timeoutMs === "number" ? _flags.timeoutMs : 0,
      });

      // Encode outcome into the action string; applyOption's default branch writes:
      //   NOTED: <id> — <summary> — stage manager: <action>
      const outcomeAction = fixResult.status === "PASS"
        ? "fix-applied-and-verified"
        : fixResult.status === "dispatch-failed"
          ? `fix-dispatch-failed${fixResult.reason ? ` (${fixResult.reason})` : ""}`
          : `fix-attempted — ${fixResult.remainingBlockers.length} blocker(s) remain`;

      for (const [itemId] of fixItems) {
        resolvedMap.set(itemId, { ...resolvedMap.get(itemId), action: outcomeAction });
      }
    }

    if (resolvedMap.size > 0) {
      const applied = runAdvise(cwd, { ...adviseOpts, apply: resolvedMap });
      if (_flags.json) { console.log(JSON.stringify(applied, null, 2)); return; }
      // Fix items may disappear from gates after the re-run replaces the gate;
      // print their ✓ lines directly from the fixItems list rather than relying
      // on applied.items (which won't contain them).
      const fixItemIds = new Set(fixItems.map(([id]) => id));
      for (const [itemId] of fixItems) {
        const { action } = resolvedMap.get(itemId);
        console.log(`  ✓ ${itemId} — ${action}`);
      }
      for (const r of applied.items) {
        if (resolvedMap.has(r.item.id) && !fixItemIds.has(r.item.id)) {
          const { action } = resolvedMap.get(r.item.id);
          console.log(`  ✓ ${r.item.id} — ${action}${r.addressed ? "" : " (SCAFFOLD-PENDING: run command shown above)"}`);
        }
      }
      if (applied.scaffoldCommands && applied.scaffoldCommands.length > 0) {
        console.log("\n  Scaffold commands to run:");
        for (const cmd of applied.scaffoldCommands) console.log(`    $ ${cmd}`);
      }
      if (applied.unresolvedBlockers === 0) {
        console.log("\n  All noted_for_followup items addressed.");
        process.exit(0);
      } else {
        console.log(`\n  ${applied.unresolvedBlockers} unresolved BLOCKER item(s) remain.`);
        process.exit(1);
      }
    }
    return;
  }

  if (_flags.json) { console.log(JSON.stringify(result, null, 2)); return; }

  // Surface active pipeline blockers before the follow-up items section so the
  // stage manager sees the full picture, not just the noted_for_followup slice.
  try {
    const { next } = getOrchestrator();
    const nr = next({ cwd, changeId });
    if (nr.action === "fix-and-retry" || nr.action === "resolve-escalation") {
      const icon = nr.action === "resolve-escalation" ? "🚨" : "❌";
      console.log(`${icon} Active pipeline blocker: ${nr.action} — ${nr.name || ""} (${nr.stage || ""})`);
      if (nr.reason) console.log(`   ${nr.reason}`);
      if (nr.blockers && nr.blockers.length) {
        for (const b of nr.blockers) console.log(`   blocker: ${typeof b === "object" ? (b.message || b.summary || JSON.stringify(b)) : b}`);
      }
      console.log(`   Run \`devteam next\` for the full fix steps.\n`);
    }
  } catch { /* advisory check must never break advise */ }

  if (result.items.length === 0) {
    console.log("[advise] No noted_for_followup items in completed gates.");
    return;
  }

  const allAddressed = result.items.every((r) => r.addressed);
  if (allAddressed) {
    console.log("[advise] All noted_for_followup items addressed.");
    return;
  }

  const riskLabel = { A11Y_FIX: "A11Y FIX", QA_BLOCKER: "QA BLOCKER", PEER_REVIEW_RISK: "PEER-REVIEW RISK", QA_NOISE: "QA NOISE", INFO: "INFO" };
  console.log("\nFollow-up items in completed stage gates:\n");

  for (const { item, classification, addressed, options } of result.items) {
    if (addressed) {
      console.log(`  ${item.id} — ${item.text || item.summary || "(no summary)"}  [${item._source}]`);
      console.log(`    Status: ADDRESSED\n`);
      continue;
    }
    console.log(`  ${item.id} — ${item.text || item.summary || "(no summary)"}  [${item._source}]`);
    console.log(`    Risk: ${riskLabel[classification] || classification}`);
    console.log("    Options:");
    for (const opt of options) {
      const rec = opt.recommended ? "  ← recommended" : "";
      console.log(`      [${opt.id}] ${opt.label.padEnd(12)} — ${opt.description}${rec}`);
    }
    console.log();
  }

  const pending = result.items.filter((r) => !r.addressed);
  const selExample = pending.map((r) => {
    const rec = r.options.find((o) => o.recommended);
    return `${r.item.id}=${rec ? rec.id : "A"}`;
  }).join(",");
  console.log(`Apply: devteam advise --apply ${selExample}\n`);

  process.exit(result.unresolvedBlockers > 0 ? 1 : 0);
}

module.exports = { name, flags, run };
