// Model pricing table — USD per million input/output tokens.
//
// Updated 2026-05. Sourced from official pricing pages at the time of
// writing. Prices change; treat the dollar figures here as estimates,
// not invoices. The pricing table is intentionally small and easy to
// audit — adding a model is one line.
//
// Lookup is exact-match first, then prefix-match (so "claude-opus-4-7"
// matches a model id of "claude-opus-4-7-2025-05" etc.). Unknown
// models return null; callers must handle that path.

const PRICING_USD_PER_MTOK = {
  // Anthropic — Claude 4 family
  "claude-opus-4-7":      { input: 15.00, output: 75.00 },
  "claude-opus-4-6":      { input: 15.00, output: 75.00 },
  "claude-sonnet-4-6":    { input:  3.00, output: 15.00 },
  "claude-sonnet-4":      { input:  3.00, output: 15.00 },
  "claude-haiku-4-5":     { input:  0.80, output:  4.00 },
  "claude-haiku-4":       { input:  0.80, output:  4.00 },

  // OpenAI — GPT family
  "gpt-5":                { input: 10.00, output: 30.00 },
  "gpt-5-mini":           { input:  0.50, output:  2.00 },
  "gpt-4o":               { input:  2.50, output: 10.00 },
  "gpt-4o-mini":          { input:  0.15, output:  0.60 },
  "o1":                   { input: 15.00, output: 60.00 },
  "o1-mini":              { input:  3.00, output: 12.00 },

  // Google — Gemini family
  "gemini-2.5-pro":       { input:  1.25, output: 10.00 },
  "gemini-2.5-flash":     { input:  0.075, output: 0.30 },
  "gemini-2.0-flash":     { input:  0.075, output: 0.30 },
};

// Return the pricing record for a model id, or null if unknown.
function pricingFor(model) {
  if (!model || typeof model !== "string") return null;
  if (PRICING_USD_PER_MTOK[model]) return PRICING_USD_PER_MTOK[model];
  // Prefix match — a dated suffix should still resolve to the family.
  // Iterate in order of decreasing key length so the most specific
  // match wins (e.g. "claude-opus-4-7" before "claude-opus-4").
  const keys = Object.keys(PRICING_USD_PER_MTOK).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (model.startsWith(key)) return PRICING_USD_PER_MTOK[key];
  }
  return null;
}

// Compute USD cost for a single dispatch. Returns null when any input
// is missing — cost is opt-in; absent data is not zero cost.
function computeCostUsd({ model, tokens_in, tokens_out }) {
  const p = pricingFor(model);
  if (!p) return null;
  if (typeof tokens_in !== "number" || typeof tokens_out !== "number") return null;
  return (tokens_in / 1_000_000) * p.input + (tokens_out / 1_000_000) * p.output;
}

// Format a USD number for terminal display: "$0.0042" / "$1.23" / "$42.50".
// Returns the literal "—" for null (unknown), so columns line up.
function formatUsd(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

module.exports = {
  PRICING_USD_PER_MTOK,
  pricingFor,
  computeCostUsd,
  formatUsd,
};
