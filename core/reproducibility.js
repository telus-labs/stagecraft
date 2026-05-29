// Reproducibility helpers for C4.
//
// LLM runs aren't deterministic in the strict sense — even at
// temperature 0, model serving infrastructure varies across versions.
// But they CAN be auditable: every gate can record exactly what
// produced it (model id, temperature, seed, max_tokens, the hash of
// the system prompt, the hash of the tools surface).
//
// Six months later, the gate tells you:
//   - what model version ran this stage
//   - what parameters it was invoked with
//   - whether the same configuration would produce the same call today
//     (by comparing system_prompt_hash + tools_hash against current)
//
// This is what makes "we ran this through Stagecraft on 2026-05-15"
// a complete claim instead of a hopeful one. Pairs with E6 (replay,
// not yet built) and matters concretely for SOC 2 / EU AI Act / any
// audit that asks "show me how this change was developed."

const crypto = require("node:crypto");

// Fields the gate JSON can carry to fully fingerprint a workstream
// dispatch. All optional — agents fill them in when they know.
const REPRODUCIBILITY_FIELDS = [
  "model",              // already from D6 — adapter-namespaced (claude-opus-4-7)
  "model_version",      // more specific — vendor's exact version string
  "temperature",
  "seed",
  "max_tokens",
  "system_prompt_hash",
  "tools_hash",
];

// SHA-256 of any string, returned as the standard `sha256:<hex>` form.
// Using a prefix instead of raw hex makes the field self-documenting
// (you know what algorithm produced it without external schema).
function sha256(input) {
  const h = crypto.createHash("sha256");
  h.update(input, "utf8");
  return `sha256:${h.digest("hex")}`;
}

// Hash the rendered system prompt for a workstream. The orchestrator
// computes this when it renders the prompt and includes it in the
// gate skeleton; agents don't have to compute their own hash. Stable
// across invocations as long as the role brief + skill + rules + the
// readFirst content + the descriptor itself are unchanged.
function hashSystemPrompt(promptText) {
  if (typeof promptText !== "string") return null;
  // Normalize trailing whitespace per line — agents sometimes strip
  // CR/LF differently between platforms, and that shouldn't change
  // the hash for the same "logical" prompt.
  const normalized = promptText
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .join("\n");
  return sha256(normalized);
}

// Hash the list of available tools a host exposes to the model. The
// list is sorted to make ordering-invariant — what matters is which
// tools the model could invoke, not what order they were listed.
function hashTools(toolNames) {
  if (!Array.isArray(toolNames) || toolNames.length === 0) return null;
  const sorted = [...new Set(toolNames)].sort();
  return sha256(sorted.join("\n"));
}

// Reduce a gate object to the subset of fields that matter for replay.
// Missing fields are kept as `null` so downstream diff logic can detect
// "absent" vs "different" — both are useful signals during an audit.
function reproducibilityFingerprint(gate) {
  const fp = {};
  for (const f of REPRODUCIBILITY_FIELDS) {
    fp[f] = gate && f in gate ? gate[f] : null;
  }
  // Carry identity so the fingerprint is self-describing.
  if (gate) {
    fp.stage = gate.stage || null;
    fp.workstream = gate.workstream || null;
    fp.host = gate.host || null;
    fp.timestamp = gate.timestamp || null;
    fp.orchestrator = gate.orchestrator || null;
  }
  return fp;
}

// Compare two gate fingerprints. Returns an array of differences, each
// shaped { field, before, after, kind }. `kind` is one of:
//   - "match"    — both sides agree (only emitted when verbose=true)
//   - "absent"   — one side has the field, the other doesn't
//   - "drift"    — both sides have the field but values differ
//
// Use case: `devteam reproduce <stage>` shows the user what would
// have to change to reproduce a past run from the current config.
function compareFingerprints(before, after, opts = {}) {
  const diffs = [];
  for (const f of REPRODUCIBILITY_FIELDS) {
    const b = before ? before[f] : null;
    const a = after ? after[f] : null;
    if (b === null && a === null) continue;
    if (b === null || a === null) {
      diffs.push({ field: f, before: b, after: a, kind: "absent" });
    } else if (b !== a) {
      diffs.push({ field: f, before: b, after: a, kind: "drift" });
    } else if (opts.verbose) {
      diffs.push({ field: f, before: b, after: a, kind: "match" });
    }
  }
  return diffs;
}

// Convenience: classify a gate's "replay readiness" — how confidently
// we could reproduce the run from the recorded fields. Used by the
// `devteam reproduce` subcommand's summary line.
function replayReadiness(gate) {
  const fp = reproducibilityFingerprint(gate);
  const required = ["model", "system_prompt_hash"];     // minimum
  const helpful  = ["temperature", "seed", "max_tokens", "tools_hash", "model_version"];
  const missingRequired = required.filter((f) => fp[f] === null);
  const missingHelpful  = helpful.filter((f) => fp[f] === null);
  if (missingRequired.length > 0) {
    return {
      level: "incomplete",
      reason: `missing required fields: ${missingRequired.join(", ")}`,
      missing_required: missingRequired,
      missing_helpful: missingHelpful,
    };
  }
  if (missingHelpful.length > 0) {
    return {
      level: "partial",
      reason: `model + prompt-hash recorded; missing helpful: ${missingHelpful.join(", ")}`,
      missing_required: [],
      missing_helpful: missingHelpful,
    };
  }
  return { level: "full", reason: "all reproducibility fields recorded", missing_required: [], missing_helpful: [] };
}

module.exports = {
  REPRODUCIBILITY_FIELDS,
  sha256,
  hashSystemPrompt,
  hashTools,
  reproducibilityFingerprint,
  compareFingerprints,
  replayReadiness,
};
