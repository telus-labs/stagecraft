// core/pricing.js — pricing-table lookup, cost computation, USD formatting.

const test = require("node:test");
const assert = require("node:assert/strict");
const { pricingFor, computeCostUsd, formatUsd, PRICING_USD_PER_MTOK } = require("../core/pricing");

test("pricingFor: exact model id returns the record", () => {
  const r = pricingFor("claude-opus-4-7");
  assert.ok(r);
  assert.equal(r.input, 15.00);
  assert.equal(r.output, 75.00);
});

test("pricingFor: prefix match for dated suffix", () => {
  // A versioned model id like "claude-opus-4-7-20250515" should still resolve.
  const r = pricingFor("claude-opus-4-7-20250515");
  assert.ok(r);
  assert.equal(r.input, 15.00);
});

test("pricingFor: longer prefix wins over shorter (specificity)", () => {
  // If "claude-haiku-4" and "claude-haiku-4-5" both exist, "claude-haiku-4-5-..."
  // should resolve to the more specific entry.
  const r = pricingFor("claude-haiku-4-5-pinned");
  assert.ok(r);
  assert.equal(r.input, 0.80); // matches haiku-4-5 specifically
});

test("pricingFor: unknown model returns null", () => {
  assert.equal(pricingFor("definitely-not-a-real-model-xyzzy"), null);
});

test("pricingFor: empty / nullish input returns null", () => {
  assert.equal(pricingFor(""), null);
  assert.equal(pricingFor(null), null);
  assert.equal(pricingFor(undefined), null);
  assert.equal(pricingFor(123), null);
});

test("computeCostUsd: standard computation", () => {
  // claude-opus-4-7: $15/Mtok in, $75/Mtok out
  // 100k in, 50k out
  // = 0.1 * 15 + 0.05 * 75 = 1.5 + 3.75 = 5.25
  const c = computeCostUsd({ model: "claude-opus-4-7", tokens_in: 100_000, tokens_out: 50_000 });
  assert.equal(c, 5.25);
});

test("computeCostUsd: returns null when model is unknown", () => {
  const c = computeCostUsd({ model: "not-a-model", tokens_in: 100, tokens_out: 50 });
  assert.equal(c, null);
});

test("computeCostUsd: returns null when token counts are missing", () => {
  assert.equal(computeCostUsd({ model: "claude-opus-4-7" }), null);
  assert.equal(computeCostUsd({ model: "claude-opus-4-7", tokens_in: 100 }), null);
  assert.equal(computeCostUsd({ tokens_in: 100, tokens_out: 50 }), null);
});

test("computeCostUsd: zero tokens → $0", () => {
  const c = computeCostUsd({ model: "claude-opus-4-7", tokens_in: 0, tokens_out: 0 });
  assert.equal(c, 0);
});

test("formatUsd: handles the four magnitude ranges", () => {
  assert.equal(formatUsd(0), "$0.00");
  assert.equal(formatUsd(0.0042), "$0.0042");   // micro: 4 decimals
  assert.equal(formatUsd(0.42), "$0.420");      // sub-dollar: 3 decimals
  assert.equal(formatUsd(42.5), "$42.50");      // dollar+: 2 decimals
});

test("formatUsd: returns em-dash for null/undefined/NaN", () => {
  assert.equal(formatUsd(null), "—");
  assert.equal(formatUsd(undefined), "—");
  assert.equal(formatUsd(NaN), "—");
});

test("PRICING_USD_PER_MTOK covers three families", () => {
  // Sanity check that the table includes at least one model per family.
  const keys = Object.keys(PRICING_USD_PER_MTOK);
  assert.ok(keys.some((k) => k.startsWith("claude-")), "no Claude entries");
  assert.ok(keys.some((k) => k.startsWith("gpt-") || k.startsWith("o1")), "no OpenAI entries");
  assert.ok(keys.some((k) => k.startsWith("gemini-")), "no Gemini entries");
});
