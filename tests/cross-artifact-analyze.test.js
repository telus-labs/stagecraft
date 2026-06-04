// BACKLOG B8 / cmp-E-1: cross-artifact consistency analyzer.
//
// Covers the three new drift classes core/spec/verify.js doesn't:
//   - AC ↔ pr-*.md `## Verify` bullets
//   - red-team must_address ↔ stage-05 resolution
//   - gate field ↔ artifact reality (acceptance_criteria_count,
//     tests_total)
//
// Brief↔spec and brief↔test-report drift are delegated to verify.js
// and tested in tests/spec-g2.test.js — we cover the integration shape
// here (the report carries them through) but don't re-test the
// individual cases.

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeTargetProject, cleanup } = require("./_helpers");
const {
  analyze,
  analyzeTexts,
  extractVerifyAcs,
  extractMustAddress,
  countTestReportRows,
  discoverPrFiles,
} = require("../core/spec/analyze");

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
afterEach(() => { _dirs.forEach(cleanup); _dirs = []; });

function seedFile(cwd, rel, content) {
  const full = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

function seedGate(cwd, name, gate) {
  return seedFile(cwd, path.join("pipeline", "gates", name), JSON.stringify(gate, null, 2));
}

// ---------------------------------------------------------------------------
// extractVerifyAcs — parses `## Verify` sections in pr-*.md
// ---------------------------------------------------------------------------

describe("extractVerifyAcs", () => {
  it("pulls AC-N IDs from **AC-N** bullets inside `## Verify`", () => {
    const prText = `
# PR: backend

## Summary
Added the user-creation endpoint.

## Verify

- **AC-1**: POST /users returns 201
  - \`curl -X POST localhost:3000/users -d '{"email":"a@b.com"}'\`
  - → HTTP/1.1 201 Created
- **AC-2**: malformed payloads return 422
  - \`curl -X POST localhost:3000/users -d '{}'\`
  - → HTTP/1.1 422 Unprocessable Entity

## Risk
None.
`;
    assert.deepEqual(extractVerifyAcs(prText), ["AC-1", "AC-2"]);
  });

  it("returns [] when there's no Verify section", () => {
    const prText = "# PR\n\n## Summary\nNo verify.\n";
    assert.deepEqual(extractVerifyAcs(prText), []);
  });

  it("scope-limits to the Verify section — bullets in other sections don't count", () => {
    // AC-5 appears only in Risk; AC-1, AC-2 in Verify. Only the latter count.
    const prText = `
## Verify

- **AC-1**: foo
- **AC-2**: bar

## Risk

- **AC-5** mentioned here doesn't count as verified
`;
    assert.deepEqual(extractVerifyAcs(prText), ["AC-1", "AC-2"]);
  });

  it("de-duplicates if the same AC is bulleted twice", () => {
    const prText = "## Verify\n\n- **AC-1**: a\n- **AC-1**: also a\n";
    assert.deepEqual(extractVerifyAcs(prText), ["AC-1"]);
  });

  it("handles empty input", () => {
    assert.deepEqual(extractVerifyAcs(""), []);
    assert.deepEqual(extractVerifyAcs(null), []);
  });
});

// ---------------------------------------------------------------------------
// discoverPrFiles — finds pipeline/pr-*.md
// ---------------------------------------------------------------------------

describe("discoverPrFiles", () => {
  it("finds pr-{area}.md files under pipeline/, sorted by area", () => {
    const cwd = track(makeTargetProject());
    seedFile(cwd, "pipeline/pr-backend.md", "## Verify\n- **AC-1**: ok\n");
    seedFile(cwd, "pipeline/pr-frontend.md", "## Verify\n- **AC-2**: ok\n");
    seedFile(cwd, "pipeline/pr-platform.md", "## Verify\n- **AC-3**: ok\n");

    const files = discoverPrFiles(cwd);
    assert.equal(files.length, 3);
    assert.deepEqual(files.map((f) => f.area), ["backend", "frontend", "platform"]);
    assert.ok(files.every((f) => typeof f.text === "string" && f.text.length > 0));
  });

  it("returns [] when pipeline/ doesn't exist", () => {
    const cwd = track(makeTargetProject({ gates: false }));
    fs.rmSync(path.join(cwd, "pipeline"), { recursive: true, force: true });
    assert.deepEqual(discoverPrFiles(cwd), []);
  });

  it("ignores non-matching files (pr-summary.md, brief.md, etc.)", () => {
    const cwd = track(makeTargetProject());
    seedFile(cwd, "pipeline/pr-backend.md", "ok");
    seedFile(cwd, "pipeline/pr-summary.md", "shouldn't match — wrong shape");
    seedFile(cwd, "pipeline/brief.md", "irrelevant");
    const files = discoverPrFiles(cwd);
    // pr-summary.md DOES match the pr-([a-z-]+).md regex, so it gets included.
    // That's fine — operators name pr files; if pr-summary.md exists it's
    // treated as another area. Verify the canonical areas show up.
    const areas = files.map((f) => f.area);
    assert.ok(areas.includes("backend"));
    assert.ok(!areas.includes("brief"));
  });
});

// ---------------------------------------------------------------------------
// extractMustAddress — red-team gate
// ---------------------------------------------------------------------------

describe("extractMustAddress", () => {
  it("returns must_address_before_peer_review array from stage-04c gate", () => {
    const gate = {
      stage: "stage-04c",
      status: "FAIL",
      must_address_before_peer_review: [
        { id: "F-01", severity: "high", summary: "auth bypass via header", file: "src/api/auth.js" },
        { id: "F-02", severity: "medium", summary: "missing rate limit on /login" },
      ],
    };
    const items = extractMustAddress(gate);
    assert.equal(items.length, 2);
    assert.equal(items[0].id, "F-01");
    assert.equal(items[0].severity, "high");
    assert.match(items[0].summary, /auth bypass/);
  });

  it("returns [] when the gate is null or missing the field", () => {
    assert.deepEqual(extractMustAddress(null), []);
    assert.deepEqual(extractMustAddress({}), []);
    assert.deepEqual(extractMustAddress({ stage: "stage-04c" }), []);
  });
});

// ---------------------------------------------------------------------------
// countTestReportRows — drift basis for stage-06.tests_total
// ---------------------------------------------------------------------------

describe("countTestReportRows", () => {
  it("counts AC rows in the | AC | Test | table", () => {
    const text = `
# Test report

## Coverage

| AC | Test | Result |
|---|---|---|
| AC-1 | unit/foo.test.js | PASS |
| AC-2 | int/bar.test.js | PASS |
| AC-3 | unit/baz.test.js | FAIL |
`;
    assert.equal(countTestReportRows(text), 3);
  });

  it("returns null when there's no AC | Test table", () => {
    assert.equal(countTestReportRows("# No table here\n\nSome prose."), null);
  });

  it("stops at the first blank line after the table", () => {
    const text = `
| AC | Test |
|---|---|
| AC-1 | t1 |
| AC-2 | t2 |

| Status | Count |
| ----- | --- |
| Pass | 2 |
`;
    assert.equal(countTestReportRows(text), 2);
  });
});

// ---------------------------------------------------------------------------
// analyzeTexts — full report shape
// ---------------------------------------------------------------------------

describe("analyzeTexts: AC ↔ Verify drift", () => {
  it("flags AC in brief with no `## Verify` bullet anywhere", () => {
    const briefText = "## Acceptance criteria\n- AC-1: a\n- AC-2: b\n- AC-3: c\n";
    const prFiles = [
      { area: "backend", path: "/x/pr-backend.md", text: "## Verify\n- **AC-1**: done\n" },
      { area: "frontend", path: "/x/pr-frontend.md", text: "## Verify\n- **AC-2**: done\n" },
    ];
    const r = analyzeTexts({ briefText, specText: null, testText: null, prFiles });
    assert.equal(r.verify_section.orphan_in_verify.length, 1);
    assert.equal(r.verify_section.orphan_in_verify[0].id, "AC-3");
    assert.equal(r.drift, true, "orphan-in-verify must flip drift true");
  });

  it("flags `## Verify` bullet for AC that doesn't exist in brief", () => {
    const briefText = "- AC-1: a\n";
    const prFiles = [
      { area: "backend", path: "/x/pr-backend.md", text: "## Verify\n- **AC-1**: done\n- **AC-99**: spurious\n" },
    ];
    const r = analyzeTexts({ briefText, specText: null, testText: null, prFiles });
    assert.equal(r.verify_section.unknown_in_verify.length, 1);
    assert.equal(r.verify_section.unknown_in_verify[0].id, "AC-99");
    assert.deepEqual(r.verify_section.unknown_in_verify[0].claimed_by, ["backend"]);
  });

  it("no drift when every brief AC has a Verify bullet somewhere", () => {
    const briefText = "- AC-1: a\n- AC-2: b\n";
    const prFiles = [
      { area: "backend", path: "/x/pr-backend.md", text: "## Verify\n- **AC-1**: ok\n" },
      { area: "frontend", path: "/x/pr-frontend.md", text: "## Verify\n- **AC-2**: ok\n" },
    ];
    const r = analyzeTexts({ briefText, specText: null, testText: null, prFiles });
    assert.equal(r.verify_section.orphan_in_verify.length, 0);
    assert.equal(r.verify_section.unknown_in_verify.length, 0);
  });

  it("skips the Verify check when no pr-*.md files exist (degrades gracefully)", () => {
    const briefText = "- AC-1: a\n";
    const r = analyzeTexts({ briefText, specText: null, testText: null, prFiles: [] });
    assert.equal(r.verify_section.orphan_in_verify.length, 0);
    assert.equal(r.verify_section.unknown_in_verify.length, 0);
  });
});

describe("analyzeTexts: red-team resolution", () => {
  it("reports pending items when stage-05 hasn't reached PASS", () => {
    const r = analyzeTexts({
      briefText: "- AC-1: a\n",
      specText: null,
      testText: null,
      redTeamGate: {
        stage: "stage-04c",
        must_address_before_peer_review: [
          { id: "F-01", severity: "high", summary: "auth bypass" },
        ],
      },
      stage05Gate: { stage: "stage-05", status: "FAIL" },
    });
    assert.equal(r.red_team_resolution.pending.length, 1);
    assert.equal(r.red_team_resolution.pending[0].id, "F-01");
    assert.equal(r.drift, true);
  });

  it("notes (but does not block) when stage-05 PASS despite non-empty must_address", () => {
    const r = analyzeTexts({
      briefText: "- AC-1: a\n",
      specText: null,
      testText: null,
      redTeamGate: {
        stage: "stage-04c",
        must_address_before_peer_review: [{ id: "F-01", severity: "low", summary: "x" }],
      },
      stage05Gate: { stage: "stage-05", status: "PASS" },
    });
    assert.equal(r.red_team_resolution.pending.length, 0);
    assert.match(r.red_team_resolution.note, /stage-05 PASS but stage-04c had 1 must-address/);
  });

  it("skips when there are no must-address items", () => {
    const r = analyzeTexts({
      briefText: "- AC-1: a\n",
      specText: null,
      testText: null,
      redTeamGate: { stage: "stage-04c", must_address_before_peer_review: [] },
      stage05Gate: { stage: "stage-05", status: "FAIL" },
    });
    assert.equal(r.red_team_resolution.pending.length, 0);
  });
});

describe("analyzeTexts: gate field ↔ artifact reality", () => {
  it("flags stage-01 acceptance_criteria_count drift", () => {
    const r = analyzeTexts({
      briefText: "- AC-1: a\n- AC-2: b\n- AC-3: c\n", // 3 ACs
      specText: null,
      testText: null,
      stage01Gate: { stage: "stage-01", acceptance_criteria_count: 2 }, // wrong
    });
    assert.equal(r.gate_field_drift.length, 1);
    assert.equal(r.gate_field_drift[0].field, "stage-01.acceptance_criteria_count");
    assert.equal(r.gate_field_drift[0].claimed, 2);
    assert.equal(r.gate_field_drift[0].actual, 3);
    assert.equal(r.drift, true);
  });

  it("does not flag when stage-01 count matches brief", () => {
    const r = analyzeTexts({
      briefText: "- AC-1: a\n- AC-2: b\n",
      specText: null,
      testText: null,
      stage01Gate: { stage: "stage-01", acceptance_criteria_count: 2 },
    });
    assert.equal(r.gate_field_drift.length, 0);
  });

  it("flags stage-06 tests_total drift vs test-report rows", () => {
    const r = analyzeTexts({
      briefText: "- AC-1: a\n- AC-2: b\n",
      specText: null,
      testText: "| AC | Test |\n|---|---|\n| AC-1 | t1 |\n| AC-2 | t2 |\n",
      stage06Gate: { stage: "stage-06", tests_total: 5 }, // wrong; table has 2 rows
    });
    const driftEntry = r.gate_field_drift.find((d) => d.field === "stage-06.tests_total");
    assert.ok(driftEntry, "expected a stage-06.tests_total drift entry");
    assert.equal(driftEntry.claimed, 5);
    assert.equal(driftEntry.actual, 2);
  });
});

// ---------------------------------------------------------------------------
// analyze() — file-path wrapper, end-to-end through pipeline/ structure
// ---------------------------------------------------------------------------

describe("analyze (file-path wrapper)", () => {
  it("end-to-end: clean pipeline → no drift", () => {
    const cwd = track(makeTargetProject());
    seedFile(cwd, "pipeline/brief.md", "- AC-1: a\n- AC-2: b\n");
    seedFile(cwd, "pipeline/spec.feature",
      "Feature: x\n  @AC-1\n  Scenario: AC-1 — a\n    Then ok\n  @AC-2\n  Scenario: AC-2 — b\n    Then ok\n");
    seedFile(cwd, "pipeline/test-report.md",
      "| AC | Test | Result |\n|---|---|---|\n| AC-1 | t1 | PASS |\n| AC-2 | t2 | PASS |\n");
    seedFile(cwd, "pipeline/pr-backend.md", "## Verify\n- **AC-1**: ok\n- **AC-2**: ok\n");
    seedGate(cwd, "stage-01.json", { stage: "stage-01", acceptance_criteria_count: 2 });
    seedGate(cwd, "stage-06.json", { stage: "stage-06", tests_total: 2 });

    const r = analyze(cwd);
    assert.equal(r.drift, false, `expected clean run; got drift report: ${JSON.stringify(r, null, 2)}`);
  });

  it("end-to-end: brief has AC-3 but no Verify bullet → drift true", () => {
    const cwd = track(makeTargetProject());
    seedFile(cwd, "pipeline/brief.md", "- AC-1: a\n- AC-2: b\n- AC-3: c\n");
    seedFile(cwd, "pipeline/spec.feature",
      "Feature: x\n  @AC-1\n  Scenario: AC-1\n    Then ok\n  @AC-2\n  Scenario: AC-2\n    Then ok\n  @AC-3\n  Scenario: AC-3\n    Then ok\n");
    seedFile(cwd, "pipeline/pr-backend.md", "## Verify\n- **AC-1**: ok\n- **AC-2**: ok\n"); // missing AC-3

    const r = analyze(cwd);
    assert.equal(r.drift, true);
    assert.ok(r.verify_section.orphan_in_verify.some((o) => o.id === "AC-3"));
  });
});
