"use strict";

const path = require("node:path");
const { generateHelp } = require(path.join(__dirname, "..", "flags"));

const name = "consistency";

const flags = {
  cwd:    { type: "string",  description: "Target project directory" },
  strict: { type: "boolean", description: "Stricter drift checks" },
  json:   { type: "boolean", description: "JSON output" },
  help:   { type: "boolean", description: "Show this help" },
};

function run(positional, _flags) {
  if (_flags.help) { console.log(generateHelp("devteam consistency analyze [options]", flags)); process.exit(0); }
  const sub = positional[0];
  const cwd = _flags.cwd || process.cwd();

  if (sub === "analyze") {
    const { analyze } = require(path.join(__dirname, "..", "..", "spec", "analyze"));
    const report = analyze(cwd, { strictMapping: !!_flags.strict });

    if (_flags.json) {
      console.log(JSON.stringify(report, null, 2));
      process.exit(report.drift ? 1 : 0);
    }

    // Markdown-ish stdout report.
    console.log(`Cross-artifact consistency analysis — ${cwd}`);
    console.log("");
    console.log(`  Acceptance criteria in brief:           ${report.criteria.length}`);
    console.log(`  Scenarios in spec.feature:              ${report.scenarios.length}`);
    if (report.test_phase_complete) {
      console.log(`  AC references in test-report:           ${report.test_refs.length}`);
    }
    if (report.verify_section.pr_files_scanned.length > 0) {
      console.log(`  pr-*.md files scanned:                  ${report.verify_section.pr_files_scanned.join(", ")}`);
    }
    console.log("");

    let issues = 0;

    // -- Existing G2 drift (delegate sections) ---------------------
    if (report.orphan_criteria.length > 0) {
      issues++;
      console.log(`  ❌ ${report.orphan_criteria.length} orphan AC (in brief, no scenario):`);
      for (const oc of report.orphan_criteria) console.log(`     - ${oc.id}: ${oc.body || "(no text)"}`);
    }
    if (report.orphan_scenarios.length > 0) {
      issues++;
      console.log(`  ❌ ${report.orphan_scenarios.length} orphan scenario(s) (in spec, no AC tag or AC missing from brief):`);
      for (const os of report.orphan_scenarios) {
        const tail = os.missing_ac ? ` (refs ${os.missing_ac}, not in brief)` : ` (no @AC-N tag)`;
        console.log(`     - "${os.name}" (line ${os.line})${tail}`);
      }
    }
    if (report.duplicate_criteria.length > 0) {
      issues++;
      console.log(`  ❌ ${report.duplicate_criteria.length} duplicate AC ID(s) in brief:`);
      for (const d of report.duplicate_criteria) console.log(`     - ${d.id} appears more than once`);
    }
    if (report.orphan_in_tests.length > 0) {
      issues++;
      console.log(`  ❌ ${report.orphan_in_tests.length} AC(s) in brief, not in test-report:`);
      for (const o of report.orphan_in_tests) console.log(`     - ${o.id}`);
    }
    if (report.unknown_in_tests.length > 0) {
      issues++;
      console.log(`  ❌ ${report.unknown_in_tests.length} AC ref(s) in test-report, not in brief:`);
      for (const u of report.unknown_in_tests) console.log(`     - ${u.id}`);
    }

    // -- New: pr-*.md ## Verify sections ----------------------------
    if (report.verify_section.orphan_in_verify.length > 0) {
      issues++;
      console.log(`  ❌ ${report.verify_section.orphan_in_verify.length} AC(s) in brief, no \`## Verify\` bullet in any pr-*.md:`);
      for (const o of report.verify_section.orphan_in_verify) console.log(`     - ${o.id}`);
    }
    if (report.verify_section.unknown_in_verify.length > 0) {
      issues++;
      console.log(`  ❌ ${report.verify_section.unknown_in_verify.length} \`## Verify\` bullet(s) for AC not in brief:`);
      for (const u of report.verify_section.unknown_in_verify) {
        console.log(`     - ${u.id} (claimed by: ${u.claimed_by.join(", ")})`);
      }
    }

    // -- New: red-team resolution ----------------------------------
    if (report.red_team_resolution.pending.length > 0) {
      issues++;
      console.log(`  ❌ ${report.red_team_resolution.pending.length} red-team must-address item(s) unresolved (stage-05 not PASS):`);
      for (const m of report.red_team_resolution.pending) {
        console.log(`     - ${m.id || "?"} (${m.severity || "?"}): ${m.summary || "(no summary)"}`);
      }
    } else if (report.red_team_resolution.note) {
      // Informational, not a blocker
      console.log(`  ⚠️  ${report.red_team_resolution.note}`);
    }

    // -- New: gate field ↔ artifact reality -------------------------
    if (report.gate_field_drift.length > 0) {
      issues++;
      console.log(`  ❌ ${report.gate_field_drift.length} gate field(s) drifted from artifact reality:`);
      for (const d of report.gate_field_drift) {
        console.log(`     - ${d.field}: gate claims ${d.claimed}, ${d.source} shows ${d.actual}`);
      }
    }

    if (issues === 0) {
      console.log("  ✅ No drift detected across the artifact chain.");
      console.log("");
      process.exit(0);
    }

    console.log("");
    console.log(`  ${issues} drift class(es) detected. Pipeline coherence is broken.`);
    console.log("");
    console.log("  Fix recommendations:");
    console.log("    • orphan AC / orphan scenario       → see `devteam spec verify` guidance");
    console.log("    • orphan_in_verify                  → developer add a `## Verify` bullet to pr-{area}.md");
    console.log("    • unknown_in_verify                 → either remove the spurious bullet or add the AC to brief.md");
    console.log("    • red-team must-address unresolved  → run the patch loop (see docs/runbooks/fix-and-retry.md § Case 1)");
    console.log("    • gate_field_drift                  → re-run the originating stage (the gate's claim is stale)");
    process.exit(1);
  }

  // Default / help.
  console.error("Usage: devteam consistency analyze [--strict] [--json] [--cwd <dir>]");
  console.error("");
  console.error("Cross-artifact drift check across the full pipeline chain:");
  console.error("  brief → spec → pr-*.md ## Verify → red-team must-address →");
  console.error("  test-report → gate field reality.");
  console.error("");
  console.error("Generalizes `devteam spec verify` (which covers brief ↔ spec ↔ tests");
  console.error("only) to every intermediate artifact + the gate-vs-reality dimension.");
  process.exit(2);
}

module.exports = { name, flags, run };
