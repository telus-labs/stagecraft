// verify.js — drift detection across brief.md, spec.feature, and
// test-report.md. This is the engine behind:
//
//   - `devteam spec verify`            (CLI surface)
//   - stage-03b's gate computation     (orchestrator)
//   - stage-06's tighter mapping check (extends 1:1 criterion→test
//                                       with scenarios in the middle)
//
// The premise of G2: three artifacts must stay in sync, and any
// drift between them should be caught structurally rather than by
// hoping a human notices.
//
//   brief.md            spec.feature       test-report.md
//   ─────────           ────────────       ──────────────
//   AC-1: text     →    Scenario @AC-1 →   row referencing AC-1
//   AC-2: text     →    Scenario @AC-2 →   row referencing AC-2
//   ...
//
// What's drift:
//   - AC in brief but no scenario in spec        → orphan_criteria
//   - Scenario in spec but no AC in brief        → orphan_scenarios
//   - AC in brief but no test row in report      → orphan_in_tests
//   - Test row referencing AC that isn't in brief→ unknown_in_tests
//
// What's NOT drift (by design):
//   - One AC mapped by multiple scenarios — sometimes a criterion
//     has multiple paths to verify; we record the count but don't
//     fail.
//   - A scenario that names multiple ACs (split across "and") —
//     valid for shared setup.
//   - Trailing whitespace, blank ACs, comment-only lines.
//
// The verifier is artifact-driven; it doesn't reach into the
// pipeline state. Give it paths or text strings and it produces a
// report. The CLI and the orchestrator both wrap it.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parse: parseGherkin, allScenarios, acIdsFor } = require("./gherkin");

// Extracts numbered AC IDs from a brief.md body. The canonical form
// is a line starting with `AC-N` (case-insensitive), e.g.:
//
//   - AC-1: Users can sign in with email + password.
//   - AC-2 — Password reset link expires in 15 minutes.
//   * AC-3. Invalid credentials show a generic error.
//
// We tolerate these surroundings (bullet markers, optional colon/dash,
// indentation) because real briefs have stylistic variation. We
// require ACs to be uniquely numbered — duplicates surface as a
// dedicated drift type.
const AC_LINE_RE = /^\s*(?:[-*+]\s+)?(AC-\d+)\b\s*[.:\-—]?\s*(.+?)\s*$/;

function extractAcsFromBrief(text) {
  const ids = [];
  const byId = new Map();
  const duplicates = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(AC_LINE_RE);
    if (!m) continue;
    const id = m[1];
    const body = (m[2] || "").trim();
    if (byId.has(id)) {
      duplicates.push({ id, line: i + 1 });
      continue;
    }
    byId.set(id, { id, body, line: i + 1 });
    ids.push(id);
  }
  return { ids, byId, duplicates };
}

// Extracts the set of AC IDs referenced anywhere in a test-report.md
// body. Looks for both `@AC-N` and bare `AC-N` tokens; either form
// counts as a reference. Returns a Map<id, lineNumbers[]> so a
// duplicate/test-count can be reported.
function extractAcRefsFromTestReport(text) {
  const refs = new Map();
  const lines = text.split(/\r?\n/);
  const RE = /\bAC-\d+\b/g;
  for (let i = 0; i < lines.length; i++) {
    let m;
    RE.lastIndex = 0;
    while ((m = RE.exec(lines[i]))) {
      const id = m[0];
      if (!refs.has(id)) refs.set(id, []);
      refs.get(id).push(i + 1);
    }
  }
  return refs;
}

// Read an artifact relative to cwd, returning "" if missing. Verify
// treats "missing" and "empty" the same — both produce the
// "everything is an orphan" drift report.
function readArtifact(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8");
}

// Compute the drift report from three (already-loaded) artifact
// bodies. `briefText` and `specText` are required for any useful
// output; `testText` is optional — if absent (e.g. before QA has
// written test-report.md), the test-side checks degrade to "not
// yet computed" rather than erroring.
function verifyTexts({ briefText, specText, testText, opts = {} }) {
  const report = {
    criteria: [],
    scenarios: [],
    test_refs: [],
    orphan_criteria: [],       // in brief, no scenario
    orphan_scenarios: [],      // in spec, no AC
    orphan_in_tests: [],       // in brief, no test row reference
    unknown_in_tests: [],      // test row references an AC not in brief
    duplicate_criteria: [],    // same AC-N appears twice in brief
    multi_mapped_criteria: [], // AC with > 1 scenario (informational)
    drift: false,
    test_phase_complete: testText != null && testText.trim().length > 0,
  };

  // -- ACs -----------------------------------------------------------
  let briefIds = [];
  const briefById = new Map();
  if (briefText != null) {
    const { ids, byId, duplicates } = extractAcsFromBrief(briefText);
    briefIds = ids;
    for (const [k, v] of byId.entries()) briefById.set(k, v);
    for (const d of duplicates) report.duplicate_criteria.push(d);
    report.criteria = ids;
  }

  // -- Scenarios -----------------------------------------------------
  const scenarioById = new Map(); // AC-id -> Scenario[]
  let scenarios = [];
  if (specText != null) {
    const parsed = parseGherkin(specText);
    scenarios = allScenarios(parsed);
    for (const sc of scenarios) {
      const ids = acIdsFor(sc);
      if (ids.length === 0) {
        report.orphan_scenarios.push({ name: sc.name, line: sc.line });
        continue;
      }
      for (const id of ids) {
        if (!scenarioById.has(id)) scenarioById.set(id, []);
        scenarioById.get(id).push({ name: sc.name, line: sc.line });
      }
    }
    report.scenarios = scenarios.map((s) => ({
      name: s.name,
      tags: s.tags,
      ac_ids: acIdsFor(s),
      line: s.line,
    }));
  }

  // -- Brief→spec drift ----------------------------------------------
  for (const id of briefIds) {
    if (!scenarioById.has(id)) {
      report.orphan_criteria.push({
        id,
        body: briefById.get(id)?.body || "",
        line: briefById.get(id)?.line || 0,
      });
    } else if (scenarioById.get(id).length > 1) {
      report.multi_mapped_criteria.push({
        id,
        scenarios: scenarioById.get(id).map((s) => s.name),
      });
    }
  }

  // -- Spec→brief drift (orphan_scenarios catches the rest) ----------
  for (const [id, list] of scenarioById.entries()) {
    if (!briefById.has(id)) {
      for (const sc of list) {
        report.orphan_scenarios.push({ name: sc.name, line: sc.line, missing_ac: id });
      }
    }
  }

  // -- Test-report side ----------------------------------------------
  if (report.test_phase_complete) {
    const testRefs = extractAcRefsFromTestReport(testText);
    report.test_refs = Array.from(testRefs.keys());
    for (const id of briefIds) {
      if (!testRefs.has(id)) {
        report.orphan_in_tests.push({ id });
      }
    }
    for (const id of testRefs.keys()) {
      if (!briefById.has(id)) {
        report.unknown_in_tests.push({ id, lines: testRefs.get(id) });
      }
    }
  }

  report.drift =
    report.orphan_criteria.length > 0 ||
    report.orphan_scenarios.length > 0 ||
    report.orphan_in_tests.length > 0 ||
    report.unknown_in_tests.length > 0 ||
    report.duplicate_criteria.length > 0;

  // multi_mapped_criteria is informational; opt-in flag can promote
  // it to drift (some teams want strict 1:1).
  if (opts.strictMapping && report.multi_mapped_criteria.length > 0) {
    report.drift = true;
  }

  return report;
}

// File-path wrapper for the common case. Returns the same drift
// report shape, with file-not-found promoted to "this artifact is
// missing" markers in the report.
function verify(cwd, opts = {}) {
  const briefPath = path.join(cwd, "pipeline", "brief.md");
  const specPath  = path.join(cwd, "pipeline", "spec.feature");
  const testPath  = path.join(cwd, "pipeline", "test-report.md");

  const briefText = readArtifact(briefPath);
  const specText  = readArtifact(specPath);
  const testText  = readArtifact(testPath);

  const report = verifyTexts({ briefText, specText, testText, opts });

  // Augment with file-status markers — the CLI uses these to
  // distinguish "no spec yet" from "spec exists but has drift".
  report.artifacts = {
    brief:        { path: briefPath, exists: briefText != null },
    spec:         { path: specPath,  exists: specText  != null },
    test_report:  { path: testPath,  exists: testText  != null },
  };

  // If the brief is missing entirely we can't compute anything
  // meaningful — surface that as a single drift flag rather than
  // returning misleading "everything is an orphan" data.
  if (briefText == null) {
    report.drift = true;
    report.errors = [{ kind: "missing_artifact", path: briefPath }];
  } else if (specText == null) {
    // Spec missing but brief present — the entire brief is orphan
    // criteria, which is exactly what the report already captures.
    // Add the marker so the CLI can render a nicer message.
    report.errors = (report.errors || []).concat([{ kind: "missing_artifact", path: specPath }]);
    report.drift = true;
  }

  return report;
}

// Generate a Gherkin scaffold from a brief's ACs. One Scenario per
// AC-N, tagged with `@AC-N` for unambiguous mapping. Steps are
// stubbed with TODOs so the spec author still has to think; we
// deliberately don't try to translate AC text into Given/When/Then
// — that translation is exactly what the spec author is for.
function generateScaffold(briefText, opts = {}) {
  const { ids, byId } = extractAcsFromBrief(briefText);
  const featureName = opts.featureName || "Feature under development";
  const lines = [];
  lines.push(`Feature: ${featureName}`);
  lines.push("");
  if (ids.length === 0) {
    lines.push("  # No AC-N entries found in brief.md.");
    lines.push("  # Number your acceptance criteria as AC-1, AC-2, ... in");
    lines.push("  # pipeline/brief.md, then re-run `devteam spec generate`.");
    lines.push("");
    return lines.join("\n");
  }
  for (const id of ids) {
    const body = (byId.get(id) || {}).body || "";
    lines.push(`  @${id}`);
    lines.push(`  Scenario: ${id} — ${body}`);
    lines.push(`    Given <TODO: precondition for ${id}>`);
    lines.push(`    When  <TODO: action being verified>`);
    lines.push(`    Then  <TODO: observable outcome>`);
    lines.push("");
  }
  return lines.join("\n");
}

module.exports = {
  extractAcsFromBrief,
  extractAcRefsFromTestReport,
  verify,
  verifyTexts,
  generateScaffold,
};
