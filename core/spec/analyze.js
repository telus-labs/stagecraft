// Cross-artifact consistency analyzer (BACKLOG B8 / cmp-E-1).
//
// `core/spec/verify.js` handles the narrow brief.md ↔ spec.feature ↔
// test-report.md drift case (G2). This module extends the same idea
// across the full pipeline artifact chain:
//
//   brief.md
//      ↓ AC-N entries
//   design-spec.md           (light: drift-check is presence-only for v1)
//      ↓
//   spec.feature             (Gherkin scenarios, @AC-N tags)
//      ↓
//   pr-{area}.md             (## Verify sections with **AC-N**: bullets)
//      ↓
//   red-team-report.md       (must_address_before_peer_review items)
//      ↓
//   test-report.md           (| AC-N | ... | rows)
//      ↓
//   pipeline/gates/*.json    (gate fields claim counts; check against reality)
//
// Each drift class is computed by its own helper so adding a new
// artifact later is additive, not invasive. The output is a unified
// report with named drift sections, consumable by humans (markdown
// renderer in the CLI) or tooling (--json).
//
// Reference: docs/comparative-analysis.md § E-1.

const fs = require("node:fs");
const path = require("node:path");
const verifyModule = require("./verify");
const { loadGateSafe } = require("../gates/load-gate");

// ---------------------------------------------------------------------------
// Helpers — extract AC references from each artifact type
// ---------------------------------------------------------------------------

// pr-{area}.md ## Verify section format (from roles/{backend,frontend,
// platform}.md):
//
//   ## Verify
//
//   - **AC-1**: registered POST /users endpoint
//     - `curl -X POST ...`
//     - → `HTTP/1.1 201 Created` ...
//   - **AC-2**: ...
//
// We extract the AC-N IDs from the **AC-N** bullets inside the Verify
// section only — bullets outside Verify (e.g. in a Risk section that
// happens to mention AC-1) don't count as verification claims.
const VERIFY_SECTION_RE = /^##\s+Verify\s*$/m;
const NEXT_SECTION_RE = /^##\s+\S/m;
const AC_BULLET_RE = /^\s*-\s+\*\*(AC-\d+)\*\*/gm;

function extractVerifyAcs(prText) {
  if (typeof prText !== "string" || prText.length === 0) return [];
  const m = VERIFY_SECTION_RE.exec(prText);
  if (!m) return [];
  // Slice from start-of-Verify-section to the next ## section header.
  const start = m.index + m[0].length;
  const rest = prText.slice(start);
  const nextMatch = NEXT_SECTION_RE.exec(rest);
  const section = nextMatch ? rest.slice(0, nextMatch.index) : rest;

  const ids = [];
  const seen = new Set();
  AC_BULLET_RE.lastIndex = 0;
  let bm;
  while ((bm = AC_BULLET_RE.exec(section)) !== null) {
    const id = bm[1];
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

// Discover pipeline/pr-*.md files (one per area: backend, frontend,
// platform, qa). Returns [{ area, path, text }] for files that exist.
function discoverPrFiles(cwd) {
  const dir = path.join(cwd, "pipeline");
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const m = name.match(/^pr-([a-z][a-z-]*)\.md$/i);
    if (!m) continue;
    const full = path.join(dir, name);
    try {
      const text = fs.readFileSync(full, "utf8");
      out.push({ area: m[1].toLowerCase(), path: full, text });
    } catch {
      // unreadable — skip
    }
  }
  return out.sort((a, b) => a.area.localeCompare(b.area));
}

// Pull the must_address_before_peer_review items from the red-team
// gate (stage-04c). Each item carries { id, severity, summary, ... }.
// Returns [] if the gate doesn't exist or doesn't have the field.
function extractMustAddress(redTeamGate) {
  if (!redTeamGate || !Array.isArray(redTeamGate.must_address_before_peer_review)) {
    return [];
  }
  return redTeamGate.must_address_before_peer_review.map((item) => ({
    id: item.id || null,
    severity: item.severity || null,
    summary: item.summary || "",
  }));
}

// ---------------------------------------------------------------------------
// Gate field ↔ artifact reality checks
// ---------------------------------------------------------------------------

// stage-01 gate carries `acceptance_criteria_count`. The number should
// match the count of AC-N entries in brief.md.
function checkAcCountDrift(stage01Gate, briefAcCount) {
  if (!stage01Gate || typeof stage01Gate.acceptance_criteria_count !== "number") {
    return null;
  }
  if (stage01Gate.acceptance_criteria_count !== briefAcCount) {
    return {
      field: "stage-01.acceptance_criteria_count",
      claimed: stage01Gate.acceptance_criteria_count,
      actual: briefAcCount,
      source: "brief.md AC-N entry count",
    };
  }
  return null;
}

// stage-06 gate carries `tests_total`. Test-report.md has rows in the
// AC | Test | Result table. The row count should match (approximately —
// the table may have header + separator rows that don't count).
function checkTestsTotalDrift(stage06Gate, testReportRowCount) {
  if (!stage06Gate || typeof stage06Gate.tests_total !== "number") {
    return null;
  }
  if (testReportRowCount === null) return null; // can't compute
  if (stage06Gate.tests_total !== testReportRowCount) {
    return {
      field: "stage-06.tests_total",
      claimed: stage06Gate.tests_total,
      actual: testReportRowCount,
      source: "test-report.md row count in `| AC | Test |` table",
    };
  }
  return null;
}

// Count rows in the AC | Test | Result table in test-report.md.
// Skips header + separator (---) rows.
//
// Header detection: a line like `| AC | Test | Result |` is the header
// (literal "AC" word followed by pipe/space). Data rows like `| AC-1 |
// ... |` are NOT headers — the hyphen distinguishes them. We can't use
// `\bAC\b` because `\b` fires at the `AC`/`-` boundary inside `AC-1`,
// so we require an explicit pipe or space after the `AC` literal.
const HEADER_RE = /^\|\s*AC\s*[|\s]/i;
const SEPARATOR_RE = /^\|\s*[-:|\s]+\|\s*$/;

function countTestReportRows(testText) {
  if (typeof testText !== "string") return null;
  const lines = testText.split(/\r?\n/);
  let inTable = false;
  let count = 0;
  for (const line of lines) {
    if (!inTable) {
      if (HEADER_RE.test(line)) {
        inTable = true;
      }
      continue;
    }
    if (line.trim().length === 0 || !line.trim().startsWith("|")) {
      break;
    }
    if (SEPARATOR_RE.test(line)) continue; // separator row (---|---|---)
    if (HEADER_RE.test(line)) continue;    // header row (only if a second appears)
    count++;
  }
  return inTable ? count : null;
}

// ---------------------------------------------------------------------------
// Main analyzer
// ---------------------------------------------------------------------------

/**
 * Compute the full cross-artifact drift report from already-loaded inputs.
 *
 * @param {object} inputs
 * @param {string|null} inputs.briefText
 * @param {string|null} inputs.specText
 * @param {string|null} inputs.testText
 * @param {Array<{area, path, text}>} [inputs.prFiles]
 * @param {object|null} [inputs.redTeamGate]   parsed stage-04c.json
 * @param {object|null} [inputs.stage01Gate]   parsed stage-01.json
 * @param {object|null} [inputs.stage06Gate]   parsed stage-06.json
 * @param {object|null} [inputs.stage05Gate]   parsed stage-05.json (merged)
 * @param {object} [inputs.opts]               passed through to verifyTexts
 * @returns {object} drift report
 */
function analyzeTexts(inputs) {
  const {
    briefText, specText, testText,
    prFiles = [],
    redTeamGate, stage01Gate, stage06Gate, stage05Gate,
    opts = {},
  } = inputs;

  // Start with the existing G2 drift report — gives us criteria,
  // scenarios, test_refs, orphan_*, duplicate_criteria, etc.
  const base = verifyModule.verifyTexts({ briefText, specText, testText, opts });
  const report = {
    ...base,
    // New sections:
    verify_section: {
      // For each AC in brief, did at least one pr-{area}.md ## Verify
      // section claim verification?
      orphan_in_verify: [],     // AC in brief, no pr-*.md Verify bullet
      unknown_in_verify: [],    // pr-*.md Verify bullet for an AC not in brief
      pr_files_scanned: prFiles.map((f) => f.area),
    },
    red_team_resolution: {
      // For each must_address_before_peer_review item from stage-04c,
      // is stage-05 PASS? (If stage-05 hasn't run yet, we can't know;
      // mark as pending.)
      pending: [],              // items still on the must-address list
      stage05_status: stage05Gate ? stage05Gate.status : null,
    },
    gate_field_drift: [],        // gate field doesn't match the artifact it claims
  };

  // -- AC ↔ pr-*.md ## Verify sections -------------------------------
  if (briefText != null && prFiles.length > 0) {
    const briefIds = new Set(report.criteria);
    const verifiedIds = new Set();
    const perPr = {};
    for (const pr of prFiles) {
      const ids = extractVerifyAcs(pr.text);
      perPr[pr.area] = ids;
      for (const id of ids) verifiedIds.add(id);
    }
    report.verify_section.by_area = perPr;
    // AC in brief, no Verify bullet anywhere
    for (const id of report.criteria) {
      if (!verifiedIds.has(id)) {
        report.verify_section.orphan_in_verify.push({ id });
      }
    }
    // Verify bullet for AC not in brief
    for (const id of verifiedIds) {
      if (!briefIds.has(id)) {
        // Find which pr-files claimed it
        const claimedBy = Object.entries(perPr)
          .filter(([, ids]) => ids.includes(id))
          .map(([area]) => area);
        report.verify_section.unknown_in_verify.push({ id, claimed_by: claimedBy });
      }
    }
  }

  // -- Red-team must_address ↔ stage-05 resolution -------------------
  const mustAddress = extractMustAddress(redTeamGate);
  if (mustAddress.length > 0) {
    if (stage05Gate && stage05Gate.status === "PASS") {
      // Stage-05 advanced; must_address items should have been
      // addressed in the re-run between Stage 4c and Stage 5. We can't
      // verify the fix without code inspection, but a PASS Stage 5 with
      // a non-empty must_address from Stage 4c is an audit trail to
      // surface — either the items were fixed (good, but not provable
      // here) or they were silently bypassed (bad).
      report.red_team_resolution.note =
        "stage-05 PASS but stage-04c had " + mustAddress.length +
        " must-address items — confirm they were addressed in the build re-run";
    } else if (!stage05Gate || stage05Gate.status === "FAIL" || stage05Gate.status === "ESCALATE") {
      // Items remain unresolved.
      report.red_team_resolution.pending = mustAddress;
    }
  }

  // -- Gate field ↔ artifact reality ---------------------------------
  const acCountDrift = checkAcCountDrift(stage01Gate, report.criteria.length);
  if (acCountDrift) report.gate_field_drift.push(acCountDrift);

  const testRowCount = countTestReportRows(testText);
  const testsTotalDrift = checkTestsTotalDrift(stage06Gate, testRowCount);
  if (testsTotalDrift) report.gate_field_drift.push(testsTotalDrift);

  // -- Aggregate drift flag ------------------------------------------
  const newDrift =
    report.verify_section.orphan_in_verify.length > 0 ||
    report.verify_section.unknown_in_verify.length > 0 ||
    report.red_team_resolution.pending.length > 0 ||
    report.gate_field_drift.length > 0;
  report.drift = report.drift || newDrift;

  return report;
}

// File-path wrapper. Loads brief / spec / test-report / pr-*.md from
// pipeline/, gates from pipeline/gates/. Missing files degrade
// gracefully — each check that needs an absent artifact reports
// "not yet computed."
function analyze(cwd, opts = {}) {
  const pipeline = path.join(cwd, "pipeline");
  const briefText = readIfExists(path.join(pipeline, "brief.md"));
  const specText  = readIfExists(path.join(pipeline, "spec.feature"));
  const testText  = readIfExists(path.join(pipeline, "test-report.md"));
  const prFiles = discoverPrFiles(cwd);

  const gatesDir = path.join(pipeline, "gates");
  const redTeamGate = loadGateIfExists(path.join(gatesDir, "stage-04c.json"));
  const stage01Gate = loadGateIfExists(path.join(gatesDir, "stage-01.json"));
  const stage06Gate = loadGateIfExists(path.join(gatesDir, "stage-06.json"));
  const stage05Gate = loadGateIfExists(path.join(gatesDir, "stage-05.json"));

  return analyzeTexts({
    briefText, specText, testText, prFiles,
    redTeamGate, stage01Gate, stage06Gate, stage05Gate,
    opts,
  });
}

function readIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return fs.readFileSync(filePath, "utf8"); } catch { return null; }
}

function loadGateIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const { gate } = loadGateSafe(filePath);
  return gate;
}

module.exports = {
  analyze,
  analyzeTexts,
  extractVerifyAcs,
  extractMustAddress,
  countTestReportRows,
  discoverPrFiles,
};
