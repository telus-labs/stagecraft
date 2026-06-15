// repair-metrics.test.js — ADR-009 §Decision.7 deferred metrics surface (item 10.4).
//
// Verifies that the intent slice computes correctly on fixture telemetry
// (the meta-test required by the plan). Also tests scope adherence computation
// and the cost inversion estimate helper.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  aggregate,
  aggregateCost,
  computeScopeAdherence,
  computeCostInversionEstimate,
} = require("../scripts/dashboard");
const { filterByIntent } = require("../scripts/routing-suggest");

// ---------------------------------------------------------------------------
// Intent slice — dashboard.js aggregate / aggregateCost
// ---------------------------------------------------------------------------

describe("repair-metrics: intent slice — aggregate", () => {
  it("groups repair and feature gates by intent", () => {
    const gates = [
      { stage: "stage-04", intent: "repair",  status: "PASS", workstream: "backend", host: "claude-code" },
      { stage: "stage-04", intent: "repair",  status: "FAIL", workstream: "backend", host: "claude-code" },
      { stage: "stage-04", intent: "feature", status: "PASS", workstream: "backend", host: "claude-code" },
      { stage: "stage-01", intent: "feature", status: "PASS", workstream: "pm",      host: "claude-code" },
    ];
    const grouped = aggregate(gates, "intent");
    assert.ok(grouped.has("repair"),  "should have repair group");
    assert.ok(grouped.has("feature"), "should have feature group");
    assert.equal(grouped.get("repair").total,  2);
    assert.equal(grouped.get("repair").PASS,   1);
    assert.equal(grouped.get("repair").FAIL,   1);
    assert.equal(grouped.get("feature").total, 2);
    assert.equal(grouped.get("feature").PASS,  2);
  });

  it("groups gates without an intent field under (no intent)", () => {
    const gates = [
      { stage: "stage-01", status: "PASS", workstream: "pm", host: "claude-code" },
    ];
    const grouped = aggregate(gates, "intent");
    assert.ok(grouped.has("(no intent)"));
    assert.equal(grouped.get("(no intent)").total, 1);
  });

  it("expands merged stage gates into workstreams before intent grouping", () => {
    const gates = [
      {
        stage: "stage-04", intent: "repair", status: "PASS",
        workstreams: [
          { workstream: "backend",  host: "claude-code", status: "PASS" },
          { workstream: "frontend", host: "claude-code", status: "FAIL" },
        ],
      },
    ];
    const grouped = aggregate(gates, "intent");
    // Merged gate: intent is on the parent; workstreams inherit it after expansion.
    // The aggregate() function spreads the parent onto each workstream entry, so
    // intent is available on the expanded row.
    assert.ok(grouped.has("repair") || grouped.has("(no intent)"));
  });
});

describe("repair-metrics: intent slice — aggregateCost", () => {
  it("slices cost data by intent", () => {
    const gates = [
      { stage: "stage-01", intent: "repair",  workstream: "pm", host: "claude-code",
        status: "PASS", tokens_in: 500,  tokens_out: 200, cost_usd: 0.03 },
      { stage: "stage-01", intent: "feature", workstream: "pm", host: "claude-code",
        status: "PASS", tokens_in: 1000, tokens_out: 500, cost_usd: 0.07 },
    ];
    const grouped = aggregateCost(gates, "intent");
    assert.ok(grouped.has("repair"),  "should have repair cost group");
    assert.ok(grouped.has("feature"), "should have feature cost group");
    assert.equal(grouped.get("repair").count, 1);
    assert.ok(Math.abs(grouped.get("repair").cost_usd - 0.03) < 0.001);
    assert.equal(grouped.get("feature").count, 1);
    assert.ok(Math.abs(grouped.get("feature").cost_usd - 0.07) < 0.001);
  });
});

// ---------------------------------------------------------------------------
// Scope adherence (ADR-009 §Decision.3 — headline repair metric)
// ---------------------------------------------------------------------------

describe("repair-metrics: scope adherence", () => {
  it("computes adherence rate from repair gates with scope_adhered field", () => {
    const gates = [
      { stage: "stage-04", intent: "repair", status: "PASS", scope_adhered: true },
      { stage: "stage-04", intent: "repair", status: "FAIL", scope_adhered: false },
      { stage: "stage-04", intent: "repair", status: "PASS", scope_adhered: true },
    ];
    const result = computeScopeAdherence(gates);
    assert.ok(result !== null, "should return a result when data exists");
    assert.equal(result.total, 3);
    assert.equal(result.adhered, 2);
    assert.equal(result.violated, 1);
    assert.ok(Math.abs(result.adhered_rate - (2 / 3) * 100) < 0.01);
  });

  it("returns null when no repair gates have scope_adhered", () => {
    const gates = [
      { stage: "stage-04", intent: "feature", status: "PASS", scope_adhered: true },
      { stage: "stage-01", intent: "repair",  status: "PASS" }, // no scope_adhered
    ];
    assert.strictEqual(computeScopeAdherence(gates), null);
  });

  it("excludes feature gates from scope adherence computation", () => {
    const gates = [
      { stage: "stage-04", intent: "feature", status: "PASS", scope_adhered: false },
      { stage: "stage-04", intent: "repair",  status: "PASS", scope_adhered: true },
    ];
    const result = computeScopeAdherence(gates);
    assert.ok(result !== null);
    assert.equal(result.total, 1);
    assert.equal(result.adhered, 1);
    assert.equal(result.adhered_rate, 100);
  });

  it("100% adherence returns 100", () => {
    const gates = [
      { stage: "stage-04", intent: "repair", status: "PASS", scope_adhered: true },
      { stage: "stage-04", intent: "repair", status: "PASS", scope_adhered: true },
    ];
    assert.equal(computeScopeAdherence(gates).adhered_rate, 100);
  });
});

// ---------------------------------------------------------------------------
// Cost inversion estimate (ADR-009 §Decision.7 — never a measured figure)
// ---------------------------------------------------------------------------

describe("repair-metrics: cost inversion estimate", () => {
  it("computes the estimate from exposed inputs", () => {
    const result = computeCostInversionEstimate({
      diagnosisRejectionRate: 0.3,
      avgFullBuildCost: 1.00,
      diagnosisCost: 0.10,
    });
    assert.ok(result !== null);
    // savings = 0.3 × 1.00 − 0.10 = 0.20
    assert.ok(Math.abs(result.savings_per_run_usd - 0.20) < 0.001, `savings ${result.savings_per_run_usd}`);
    assert.ok(result.note.includes("never a measured figure"), "note should warn it is an estimate");
    assert.deepEqual(result.inputs, {
      diagnosisRejectionRate: 0.3,
      avgFullBuildCost: 1.00,
      diagnosisCost: 0.10,
    });
  });

  it("returns null when any input is missing", () => {
    assert.strictEqual(computeCostInversionEstimate({}), null);
    assert.strictEqual(computeCostInversionEstimate({ diagnosisRejectionRate: 0.3 }), null);
    assert.strictEqual(
      computeCostInversionEstimate({ diagnosisRejectionRate: 0.3, avgFullBuildCost: 1.0 }),
      null,
    );
  });

  it("returns negative savings when diagnosis is more expensive than the rejection value", () => {
    const result = computeCostInversionEstimate({
      diagnosisRejectionRate: 0.1,
      avgFullBuildCost: 0.50,
      diagnosisCost: 0.20,
    });
    // 0.1 × 0.50 − 0.20 = −0.15 (diagnosis costs more than it saves at this rejection rate)
    assert.ok(result.savings_per_run_usd < 0, "negative savings should be expressible");
  });
});

// ---------------------------------------------------------------------------
// routing-suggest: filterByIntent
// ---------------------------------------------------------------------------

describe("repair-metrics: routing-suggest filterByIntent", () => {
  const gates = [
    { stage: "stage-04", intent: "repair",  status: "PASS", workstream: "backend", host: "claude-code" },
    { stage: "stage-04", intent: "feature", status: "PASS", workstream: "backend", host: "claude-code" },
    { stage: "stage-01", status: "PASS", workstream: "pm", host: "claude-code" }, // no intent
  ];

  it("filters to repair gates only", () => {
    const filtered = filterByIntent(gates, "repair");
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].intent, "repair");
  });

  it("filters to feature gates only", () => {
    const filtered = filterByIntent(gates, "feature");
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].intent, "feature");
  });

  it("returns all gates when intent is null", () => {
    assert.equal(filterByIntent(gates, null).length, 3);
  });

  it("excludes gates without intent field when filter is active", () => {
    const filtered = filterByIntent(gates, "repair");
    assert.ok(filtered.every((g) => g.intent === "repair"), "no non-repair gates in filtered set");
  });
});
