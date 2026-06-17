// Unit tests for groupByTier and the grouped devteam advise output.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { REPO_ROOT, makeTargetProject, cleanup, runCLI } = require("./_helpers");
const { groupByTier, runAdvise } = require(path.join(REPO_ROOT, "core", "advise"));

// ---------------------------------------------------------------------------
// groupByTier unit tests
// ---------------------------------------------------------------------------

describe("groupByTier", () => {
  it("partitions items into tier buckets", () => {
    const items = [
      { item: { id: "B1" }, classification: "QA_BLOCKER",       addressed: false },
      { item: { id: "P1" }, classification: "PEER_REVIEW_RISK", addressed: false },
      { item: { id: "N1" }, classification: "QA_NOISE",         addressed: false },
      { item: { id: "I1" }, classification: "INFO",              addressed: false },
      { item: { id: "A1" }, classification: "QA_BLOCKER",       addressed: true  },
    ];
    const tiers = groupByTier(items);
    assert.equal(tiers.QA_BLOCKER.length, 1);
    assert.equal(tiers.PEER_REVIEW_RISK.length, 1);
    assert.equal(tiers.QA_NOISE.length, 1);
    assert.equal(tiers.INFO.length, 1);
    assert.equal(tiers.addressed.length, 1);
    assert.equal(tiers.addressed[0].item.id, "A1");
  });

  it("unknown classification falls into INFO", () => {
    const items = [{ item: { id: "X1" }, classification: "UNKNOWN", addressed: false }];
    const tiers = groupByTier(items);
    assert.equal(tiers.INFO.length, 1);
  });

  it("empty input produces empty buckets", () => {
    const tiers = groupByTier([]);
    assert.equal(tiers.QA_BLOCKER.length, 0);
    assert.equal(tiers.addressed.length, 0);
  });

  it("all addressed items go only to addressed bucket", () => {
    const items = [
      { item: { id: "A1" }, classification: "QA_BLOCKER",       addressed: true },
      { item: { id: "A2" }, classification: "PEER_REVIEW_RISK", addressed: true },
    ];
    const tiers = groupByTier(items);
    assert.equal(tiers.addressed.length, 2);
    assert.equal(tiers.QA_BLOCKER.length, 0);
    assert.equal(tiers.PEER_REVIEW_RISK.length, 0);
  });
});

// ---------------------------------------------------------------------------
// devteam advise CLI output tests
// ---------------------------------------------------------------------------

describe("devteam advise grouped output", () => {
  it("groups items by tier with section headers", () => {
    const cwd = makeTargetProject();
    try {
      fs.mkdirSync(path.join(cwd, "pipeline", "gates"), { recursive: true });
      fs.writeFileSync(path.join(cwd, "pipeline", "gates", "stage-04c.json"), JSON.stringify({
        status: "PASS",
        noted_for_followup: [
          { id: "RT-01", text: "high severity finding", severity: "high" },
          { id: "RT-02", text: "another peer risk", severity: "high" },
        ],
      }));
      fs.writeFileSync(path.join(cwd, "pipeline", "gates", "stage-06e.json"), JSON.stringify({
        status: "PASS",
        noted_for_followup: [
          { id: "PERF-NF-01", text: "perf budget missing", track_for: "ticket" },
        ],
      }));
      const r = runCLI(["advise"], { cwd });
      // QA BLOCKER section (PERF-NF-01 has track_for: ticket with AC ref → QA_BLOCKER)
      // PEER-REVIEW RISK section (RT-01, RT-02 → high severity → PEER_REVIEW_RISK)
      assert.match(r.stdout, /PEER-REVIEW RISK \(\d+\)/);
      assert.match(r.stdout, /RT-01/);
      assert.match(r.stdout, /RT-02/);
    } finally {
      cleanup(cwd);
    }
  });

  it("collapses addressed items into a one-line summary alongside actionable items", () => {
    const cwd = makeTargetProject();
    try {
      fs.mkdirSync(path.join(cwd, "pipeline", "gates"), { recursive: true });
      fs.writeFileSync(path.join(cwd, "pipeline", "gates", "stage-04.json"), JSON.stringify({
        status: "PASS",
        noted_for_followup: [
          { id: "NF-01", text: "something addressed" },
          { id: "RT-99", text: "a peer risk finding", severity: "high" },
        ],
      }));
      // Mark NF-01 addressed; RT-99 left actionable
      fs.mkdirSync(path.join(cwd, "pipeline"), { recursive: true });
      fs.writeFileSync(
        path.join(cwd, "pipeline", "context.md"),
        "NOTED: NF-01 — something addressed — stage manager: no action\n",
      );
      const r = runCLI(["advise"], { cwd });
      assert.match(r.stdout, /✓ 1 addressed: NF-01/);
      // Should NOT print a full "Status: ADDRESSED" block for NF-01
      assert.doesNotMatch(r.stdout, /Status: ADDRESSED/);
      // Actionable RT-99 still rendered
      assert.match(r.stdout, /RT-99/);
    } finally {
      cleanup(cwd);
    }
  });

  it("--json includes by_tier field", () => {
    const cwd = makeTargetProject();
    try {
      fs.mkdirSync(path.join(cwd, "pipeline", "gates"), { recursive: true });
      fs.writeFileSync(path.join(cwd, "pipeline", "gates", "stage-04c.json"), JSON.stringify({
        status: "PASS",
        noted_for_followup: [{ id: "RT-01", text: "a finding", severity: "high" }],
      }));
      const r = runCLI(["advise", "--json"], { cwd });
      assert.equal(r.status, 0, r.stderr);
      const parsed = JSON.parse(r.stdout);
      assert.ok("by_tier" in parsed, "JSON output must include by_tier");
      assert.ok(Array.isArray(parsed.by_tier.PEER_REVIEW_RISK), "by_tier.PEER_REVIEW_RISK must be an array");
      assert.ok(Array.isArray(parsed.by_tier.addressed), "by_tier.addressed must be an array");
    } finally {
      cleanup(cwd);
    }
  });

  it("omits tiers with zero items", () => {
    const cwd = makeTargetProject();
    try {
      fs.mkdirSync(path.join(cwd, "pipeline", "gates"), { recursive: true });
      fs.writeFileSync(path.join(cwd, "pipeline", "gates", "stage-04c.json"), JSON.stringify({
        status: "PASS",
        noted_for_followup: [{ id: "RT-01", text: "a finding", severity: "high" }],
      }));
      const r = runCLI(["advise"], { cwd });
      // QA BLOCKER and INFO sections should NOT appear (no items in those tiers)
      assert.doesNotMatch(r.stdout, /── QA BLOCKER/);
      assert.doesNotMatch(r.stdout, /── INFO/);
      assert.match(r.stdout, /PEER-REVIEW RISK/);
    } finally {
      cleanup(cwd);
    }
  });
});

// ---------------------------------------------------------------------------
// loadAddressedItems regression — long-text item ids must persist across runs
// ---------------------------------------------------------------------------

describe("devteam advise addressed-item persistence", () => {
  it("long-text id items remain addressed after --apply", () => {
    const cwd = makeTargetProject();
    try {
      fs.mkdirSync(path.join(cwd, "pipeline", "gates"), { recursive: true });
      // Gate entry with no structured id — full text becomes item.id
      const longText = "If a future milestone adds a dashboard, stage-06b must be re-run against those surfaces.";
      fs.writeFileSync(path.join(cwd, "pipeline", "gates", "stage-06b.json"), JSON.stringify({
        status: "PASS",
        noted_for_followup: [longText],
      }));

      // Apply "nothing" to the long-text item — simulates devteam advise --apply '<text>=A'
      fs.mkdirSync(path.join(cwd, "pipeline"), { recursive: true });
      const first = runAdvise(cwd, { checkOnly: true });
      assert.equal(first.items.length, 1, "should find 1 item before apply");
      const itemId = first.items[0].item.id;
      assert.equal(itemId, longText, "item.id should be the full text");

      // Apply via runAdvise (mirrors what devteam advise --apply does)
      const applyMap = new Map([[itemId, { action: "nothing", ticketId: undefined }]]);
      runAdvise(cwd, { apply: applyMap });

      // Second run — item must now appear as addressed
      const second = runAdvise(cwd, { checkOnly: true });
      const record = second.items.find((r) => r.item.id === itemId);
      assert.ok(record, "item should still appear in second run");
      assert.equal(record.addressed, true, "item must be addressed after --apply");
    } finally {
      cleanup(cwd);
    }
  });

  it("repairs orphaned advise begin marker without losing context", () => {
    const cwd = makeTargetProject();
    try {
      fs.mkdirSync(path.join(cwd, "pipeline", "gates"), { recursive: true });
      fs.writeFileSync(path.join(cwd, "pipeline", "gates", "stage-04c.json"), JSON.stringify({
        status: "PASS",
        noted_for_followup: [{ id: "RT-01", text: "follow-up", severity: "high" }],
      }));
      fs.mkdirSync(path.join(cwd, "pipeline"), { recursive: true });
      fs.writeFileSync(
        path.join(cwd, "pipeline", "context.md"),
        "# Context\n\nBefore orphan.\n\n<!-- devteam:advise:begin -->\norphaned decision\n\nAfter orphan that should survive.\n",
      );

      runAdvise(cwd, { apply: new Map([["RT-01", { action: "nothing" }]]) });

      const ctx = fs.readFileSync(path.join(cwd, "pipeline", "context.md"), "utf8");
      assert.match(ctx, /Advisory decisions/);
      assert.match(ctx, /NOTED: RT-01/);
      assert.match(ctx, /Before orphan/);
      assert.match(ctx, /orphaned decision/);
      assert.match(ctx, /After orphan that should survive/);
      assert.equal((ctx.match(/devteam:advise:begin/g) || []).length, 1, "only one begin marker");
      assert.equal((ctx.match(/devteam:advise:end/g) || []).length, 1, "only one end marker");
    } finally {
      cleanup(cwd);
    }
  });
});
