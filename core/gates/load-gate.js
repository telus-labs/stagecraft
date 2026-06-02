// Safe gate-file reader. Returns { gate, error } instead of throwing on
// malformed JSON, oversized files, or read errors. Callers should branch
// on `error` and surface a friendly message — a partial or hand-edited
// gate file should never crash the orchestrator or CLI with a raw
// "Unexpected token" stack trace.
//
// The size cap matches the validator's MAX_GATE_BYTES (1 MB). Gates are
// typically <1 KB; a runaway producer writing a gigabyte-sized blockers
// string would OOM an unguarded reader.

const fs = require("node:fs");

const MAX_GATE_BYTES = 1_000_000;

function loadGateSafe(fullPath) {
  try {
    const stat = fs.statSync(fullPath);
    if (stat.size > MAX_GATE_BYTES) {
      return {
        gate: null,
        error: `gate file exceeds ${MAX_GATE_BYTES} bytes (size: ${stat.size}): ${fullPath}`,
      };
    }
    const raw = fs.readFileSync(fullPath, "utf8");
    return { gate: JSON.parse(raw), error: null };
  } catch (e) {
    if (e.code === "ENOENT") {
      return { gate: null, error: `gate file not found: ${fullPath}` };
    }
    if (e instanceof SyntaxError) {
      return { gate: null, error: `malformed JSON in ${fullPath}: ${e.message}` };
    }
    return { gate: null, error: `${e.message} (${fullPath})` };
  }
}

module.exports = { loadGateSafe, MAX_GATE_BYTES };
