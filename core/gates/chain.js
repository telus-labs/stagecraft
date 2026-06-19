// Tamper-evident gate chain (C6).
//
// Each STAGE-LEVEL gate records a hash of its predecessor stage gate. Mutating
// an earlier gate changes its hash, so the next gate's recorded `prev_hash` no
// longer matches — `verifyChain` detects and locates the break. This makes the
// C4 provenance (model / params / prompt hash) and the autonomous-run authority
// records tamper-evident, which is the EU AI Act / SOC 2 ask.
//
// Scope: stage-level gates only (merged gates + single-role stage gates), in
// resolved track order — per-workstream gates roll up into the stage gate,
// which is what chains. The chain is the linear stage-01 → … → stage-09 spine.
//
// Hashing: canonical (sorted-key) JSON of the predecessor's FULL content —
// INCLUDING its own `chain` field, so the chain is transitive (re-stamping a
// tampered middle gate just moves the break downstream). Canonicalization means
// key order / whitespace never false-positive; any content change does.
//
// The predecessor of stage N = the nearest earlier stage in track order whose
// gate file currently exists (so skipped conditional stages are transparently
// stepped over). Both stamping and verifying use this same rule, so they agree.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { sha256 } = require("../reproducibility");
const { getStage, orderedStageNamesForTrack } = require("../pipeline/stages");
const { loadGateSafe } = require("./load-gate");

const CHAIN_ALGO = "sha256-canonical-json";
const MAC_ALGO = "hmac-sha256-canonical-json";
const MAC_PREFIX = "hmac-sha256:";

// Recursively sort object keys so serialization is order-independent.
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canonicalize(value[k]);
    return out;
  }
  return value;
}

function canonicalGateHash(gate) {
  return sha256(JSON.stringify(canonicalize(gate)));
}

// The MAC authenticates the complete gate, including chain metadata, while
// excluding only its own value. mac_algo remains covered by the signature.
function signingPayload(gate) {
  const payload = { ...gate };
  if (gate.chain && typeof gate.chain === "object") {
    payload.chain = { ...gate.chain };
    delete payload.chain.mac;
  }
  return payload;
}

function canonicalGateMac(gate, secret) {
  if (typeof secret !== "string" || secret.length === 0) return null;
  const digest = crypto.createHmac("sha256", secret)
    .update(JSON.stringify(canonicalize(signingPayload(gate))))
    .digest("hex");
  return `${MAC_PREFIX}${digest}`;
}

function hasValidMacFormat(mac) {
  return typeof mac === "string" && /^hmac-sha256:[a-f0-9]{64}$/.test(mac);
}

function macMatches(recorded, expected) {
  if (!hasValidMacFormat(recorded)) return false;
  const recordedBytes = Buffer.from(recorded, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return recordedBytes.length === expectedBytes.length
    && crypto.timingSafeEqual(recordedBytes, expectedBytes);
}

function signingSecret(options) {
  if (Object.prototype.hasOwnProperty.call(options, "secret")) return options.secret;
  return process.env.DEVTEAM_SIGNING_SECRET;
}

function stageGatePath(gatesDir, stageId) {
  return path.join(gatesDir, `${stageId}.json`);
}

// Ordered [{name, id}] for the track (id = "stage-NN").
function orderedStages(track) {
  return orderedStageNamesForTrack(track).map((name) => ({ name, id: getStage(name).stage }));
}

// Nearest earlier stage (in track order) with an existing, readable gate file.
// Returns { id, gate } or null (genesis / no predecessor).
function predecessorGate(gatesDir, track, stageId) {
  const ordered = orderedStages(track);
  const idx = ordered.findIndex((s) => s.id === stageId);
  if (idx <= 0) return null;
  for (let i = idx - 1; i >= 0; i--) {
    const p = stageGatePath(gatesDir, ordered[i].id);
    if (!fs.existsSync(p)) continue;
    const { gate, error } = loadGateSafe(p);
    if (!error && gate) return { id: ordered[i].id, gate };
  }
  return null;
}

/**
 * Stamp the `chain` field onto a stage gate, committing to its predecessor.
 * Best-effort: returns { ok:false } when the gate is missing/unreadable.
 */
function stampChain(gatesDir, stageName, track, options = {}) {
  const def = getStage(stageName);
  const stageId = def ? def.stage : stageName;
  const gp = stageGatePath(gatesDir, stageId);
  const { gate, error } = loadGateSafe(gp);
  if (error || !gate) return { ok: false, reason: error || "gate not found" };
  const secret = signingSecret(options);
  if (gate.chain?.mac && (typeof secret !== "string" || secret.length === 0)) {
    return { ok: false, reason: "refusing to overwrite a signed gate without DEVTEAM_SIGNING_SECRET" };
  }
  const pred = predecessorGate(gatesDir, track, stageId);
  gate.chain = {
    prev_stage: pred ? pred.id : null,
    prev_hash: pred ? canonicalGateHash(pred.gate) : null,
    algo: CHAIN_ALGO,
  };
  if (typeof secret === "string" && secret.length > 0) {
    gate.chain.mac_algo = MAC_ALGO;
    gate.chain.mac = canonicalGateMac(gate, secret);
  }
  fs.writeFileSync(gp, JSON.stringify(gate, null, 2) + "\n", "utf8");
  return {
    ok: true,
    prev_stage: gate.chain.prev_stage,
    prev_hash: gate.chain.prev_hash,
    signed: Boolean(gate.chain.mac),
  };
}

/**
 * Walk the chain in track order. Returns:
 *   { ok, checked, breaks:[{stage, prev_stage, recorded, recomputed}], unstamped:[stageId] }
 * `ok` is false if any stamped gate's recorded prev_hash disagrees with the
 * recomputed predecessor hash. Unstamped stage gates are reported separately
 * (a visible gap, never a silent pass).
 */
function verifyChain(gatesDir, track, options = {}) {
  const ordered = orderedStages(track);
  const breaks = [];
  const unstamped = [];
  const unsigned = [];
  const invalid_macs = [];
  const unverified_signatures = [];
  const resolved = []; // gates carrying autonomous-decision authority provenance
  const secret = signingSecret(options);
  const requireSigned = options.requireSigned === true;
  let checked = 0;
  for (const s of ordered) {
    const gp = stageGatePath(gatesDir, s.id);
    if (!fs.existsSync(gp)) continue;
    const { gate, error } = loadGateSafe(gp);
    if (error || !gate) continue;
    if (gate.resolved_by) resolved.push({ stage: s.id, ...gate.resolved_by });
    if (!gate.chain) { unstamped.push(s.id); continue; }
    checked++;
    const pred = predecessorGate(gatesDir, track, s.id);
    const recomputed = pred ? canonicalGateHash(pred.gate) : null;
    const recorded = gate.chain.prev_hash || null;
    if (recorded !== (recomputed || null)) {
      breaks.push({ stage: s.id, prev_stage: pred ? pred.id : null, recorded, recomputed });
    }
    if (!gate.chain.mac) {
      unsigned.push(s.id);
    } else if (gate.chain.mac_algo !== MAC_ALGO) {
      invalid_macs.push({ stage: s.id, reason: "unsupported-mac-algorithm", algorithm: gate.chain.mac_algo || null });
    } else if (!hasValidMacFormat(gate.chain.mac)) {
      invalid_macs.push({ stage: s.id, reason: "malformed-mac" });
    } else if (typeof secret !== "string" || secret.length === 0) {
      unverified_signatures.push(s.id);
    } else {
      const expected = canonicalGateMac(gate, secret);
      if (!macMatches(gate.chain.mac, expected)) {
        invalid_macs.push({ stage: s.id, reason: "mac-mismatch" });
      }
    }
  }
  const signedPolicyFailures = requireSigned
    ? [...unsigned, ...unstamped, ...unverified_signatures]
    : [];
  return {
    ok: breaks.length === 0 && invalid_macs.length === 0 && signedPolicyFailures.length === 0,
    checked,
    breaks,
    unstamped,
    unsigned,
    invalid_macs,
    unverified_signatures,
    require_signed: requireSigned,
    resolved,
  };
}

/**
 * (Re)stamp every existing stage gate in forward order, so each commits to its
 * predecessor's current content. Use after a deliberate earlier-stage re-run.
 */
function stampAll(gatesDir, track, options = {}) {
  const stamped = [];
  const signed = [];
  const failed = [];
  for (const s of orderedStages(track)) {
    if (!fs.existsSync(stageGatePath(gatesDir, s.id))) continue;
    const r = stampChain(gatesDir, s.name, track, options);
    if (r.ok) {
      stamped.push(s.id);
      if (r.signed) signed.push(s.id);
    } else {
      failed.push({ stage: s.id, reason: r.reason });
    }
  }
  return { stamped, signed, failed };
}

module.exports = {
  canonicalGateHash,
  canonicalGateMac,
  stampChain,
  verifyChain,
  stampAll,
  CHAIN_ALGO,
  MAC_ALGO,
};
