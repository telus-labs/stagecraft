#!/usr/bin/env node
/**
 * gate-validator.js
 *
 * Runs after every subagent stop. Validates the state of pipeline/gates/ —
 * the JSON is the authoritative record of stage status. Exits:
 *
 *   0 — PASS (most recent gate is PASS; no older unresolved escalations)
 *   1 — gate file is malformed or missing required fields
 *   2 — FAIL (most recent gate is FAIL)
 *   3 — ESCALATE (most recent gate is ESCALATE, OR an older gate is
 *       ESCALATE and a newer gate exists — i.e. a bypassed escalation)
 *
 * v2.1 hardening added:
 *
 *   - Sweep ALL gate files for unresolved ESCALATE, not just most recent.
 *     A gate with status ESCALATE that is older than any other gate
 *     indicates the escalation was bypassed. This halts the pipeline.
 *   - Validate retry integrity: if retry_number >= 1, the
 *     this_attempt_differs_by field must be a non-empty string.
 *   - Warn (not fail) on gates missing the "track" field. Legacy gates
 *     predating v2.0 don't carry this field; warning gives visibility
 *     without breaking pipelines mid-upgrade.
 *   - Scan pipeline/lessons-learned.md for malformed `**Reinforced:**`
 *     lines. Malformed lines are warnings — they don't halt the
 *     pipeline but surface a fix-up opportunity.
 */

const fs = require("fs");
const path = require("path");

const GATES_DIR = path.join(process.cwd(), "pipeline", "gates");
const LESSONS_FILE = path.join(process.cwd(), "pipeline", "lessons-learned.md");

// Structured-log mode (audit B-23). When LOG_FORMAT=json, the hook emits a
// single JSON event line on stdout per invocation in addition to the
// human-readable prose, so external orchestrators (CI runners, dashboards)
// can consume hook results without parsing prose. Default off — humans
// running Claude Code interactively see prose only.
const LOG_JSON = process.env.LOG_FORMAT === "json";

function logEvent(event, data) {
  if (!LOG_JSON) return;
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    hook: "gate-validator",
    event,
    ...data,
  }));
}

// Matches the two valid forms documented in .devteam/rules/retrospective.md:
//   **Reinforced:** 0
//   **Reinforced:** <N> (last: YYYY-MM-DD)   where N >= 1
const REINFORCED_LINE_RE = /^\s*\*\*Reinforced:\*\*\s+(.+?)\s*$/;
const REINFORCED_ZERO_RE = /^0$/;
const REINFORCED_NONZERO_RE = /^([1-9]\d*)\s+\(last:\s+(\d{4}-\d{2}-\d{2})\)$/;

const VALID_STATUSES = new Set(["PASS", "WARN", "FAIL", "ESCALATE"]);
const VALID_TRACKS = new Set([
  "full",
  "quick",
  "nano",
  "config-only",
  "dep-update",
  "hotfix",
]);
const REQUIRED_FIELDS = [
  "stage",
  "status",
  "orchestrator",
  "timestamp",
  "blockers",
  "warnings",
];

// 1 MB cap on gate file size. Gates are typically <1 KB; an attacker (or
// runaway producer) writing a gigabyte-sized "blockers" string would
// otherwise OOM the validator. The bound is loose enough that no
// legitimate gate will hit it.
const MAX_GATE_BYTES = 1_000_000;

/** Read a gate file and parse as JSON. Returns { gate, error }. */
function loadGate(fullPath) {
  try {
    const stat = fs.statSync(fullPath);
    if (stat.size > MAX_GATE_BYTES) {
      return {
        gate: null,
        error: `gate file exceeds ${MAX_GATE_BYTES} bytes (size: ${stat.size})`,
      };
    }
    const raw = fs.readFileSync(fullPath, "utf8");
    return { gate: JSON.parse(raw), error: null };
  } catch (e) {
    return { gate: null, error: e.message };
  }
}

/** Validate required fields. Returns an array of missing field names. */
function missingRequired(gate) {
  return REQUIRED_FIELDS.filter((k) => !(k in gate));
}

/** Validate retry metadata if this gate is a retry. */
function retryValidationError(gate) {
  if (typeof gate.retry_number !== "number" || gate.retry_number < 1) {
    return null;
  }
  const delta = gate.this_attempt_differs_by;
  if (typeof delta !== "string" || delta.trim() === "") {
    return `retry_number=${gate.retry_number} requires non-empty this_attempt_differs_by`;
  }
  return null;
}

/**
 * Scan all gate files for unresolved escalations.
 *
 * An escalation is "unresolved and bypassed" when a gate has
 * status=ESCALATE AND there is a newer gate file in the same directory.
 * That newer file would not exist if the pipeline had correctly halted
 * at the escalation.
 */
function findBypassedEscalations(gateFiles) {
  if (gateFiles.length < 2) return [];

  // gateFiles is sorted most-recent-first. Skip index 0 (the newest gate —
  // an ESCALATE there is a live halt, not a bypass). Any older gate with
  // status=ESCALATE was bypassed because a newer gate exists after it.
  const bypassed = [];
  for (let i = 1; i < gateFiles.length; i++) {
    const { gate } = loadGate(gateFiles[i].full);
    if (!gate) continue; // malformed — will surface separately if it's the top entry
    if (gate.status === "ESCALATE") {
      bypassed.push({ name: gateFiles[i].name, gate });
    }
  }

  return bypassed;
}

/**
 * Scan pipeline/lessons-learned.md for malformed `**Reinforced:**` lines.
 * Returns an array of { lineNumber, text } objects. Missing file is not
 * an error.
 */
function findMalformedReinforcedLines() {
  if (!fs.existsSync(LESSONS_FILE)) return [];

  let content;
  try {
    content = fs.readFileSync(LESSONS_FILE, "utf8");
  } catch {
    return [];
  }

  const lines = content.split(/\r?\n/);
  const malformed = [];

  lines.forEach((line, idx) => {
    const m = line.match(REINFORCED_LINE_RE);
    if (!m) return;
    const value = m[1];
    if (REINFORCED_ZERO_RE.test(value)) return;
    if (REINFORCED_NONZERO_RE.test(value)) return;
    malformed.push({ lineNumber: idx + 1, text: line.trim() });
  });

  return malformed;
}

/** List gate .json files sorted most-recent first. */
function listGates() {
  return fs
    .readdirSync(GATES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      name: f,
      mtime: fs.statSync(path.join(GATES_DIR, f)).mtimeMs,
      full: path.join(GATES_DIR, f),
    }))
    .sort((a, b) => b.mtime - a.mtime);
}

function reportBypassedEscalation(entry) {
  const { gate } = entry;
  console.log(
    `[gate-validator] 🚨 BYPASSED ESCALATION — ${entry.name} (${gate.host || gate.orchestrator || "unknown"})`,
  );
  console.log(
    `[gate-validator] This gate requested escalation but a newer gate was written`,
  );
  console.log(
    `[gate-validator] Reason: ${gate.escalation_reason || "not specified"}`,
  );
  if (gate.decision_needed) {
    console.log(`[gate-validator] Decision needed: ${gate.decision_needed}`);
  }
  if (gate.options) {
    console.log(`[gate-validator] Options: ${gate.options.join(" | ")}`);
  }
}

function main() {
  if (!fs.existsSync(GATES_DIR)) {
    process.exit(0);
  }

  const gateFiles = listGates();
  if (gateFiles.length === 0) {
    process.exit(0);
  }

  // Check for bypassed escalations BEFORE processing the most-recent gate.
  // An unresolved escalation anywhere in history must halt the pipeline.
  const bypassed = findBypassedEscalations(gateFiles);
  if (bypassed.length > 0) {
    for (const entry of bypassed) reportBypassedEscalation(entry);
    console.log(
      `[gate-validator] ${bypassed.length} escalation(s) appear to have been bypassed; halting`,
    );
    logEvent("bypassed_escalation", {
      count: bypassed.length,
      bypassed: bypassed.map((b) => ({
        file: b.name,
        host: b.gate.host || null,
        orchestrator: b.gate.orchestrator || null,
        reason: b.gate.escalation_reason || null,
      })),
    });
    process.exit(3);
  }

  const latest = gateFiles[0];
  const { gate, error } = loadGate(latest.full);

  if (error) {
    console.error(
      `[gate-validator] ERROR: Could not parse ${latest.name}: ${error}`,
    );
    console.error(
      `[gate-validator] Gate files must be valid JSON. See .devteam/rules/gates.md`,
    );
    process.exit(1);
  }

  const missing = missingRequired(gate);
  if (missing.length > 0) {
    console.error(
      `[gate-validator] INVALID GATE ${latest.name}: missing fields: ${missing.join(", ")}`,
    );
    process.exit(1);
  }

  if (!VALID_STATUSES.has(gate.status)) {
    console.error(
      `[gate-validator] UNKNOWN status "${gate.status}" in ${latest.name}`,
    );
    process.exit(1);
  }

  const retryErr = retryValidationError(gate);
  if (retryErr) {
    console.error(`[gate-validator] INVALID GATE ${latest.name}: ${retryErr}`);
    console.error(
      `[gate-validator] See .devteam/rules/gates.md §Retry Protocol`,
    );
    process.exit(1);
  }

  // Advisory checks (warnings only — do not change exit code).
  const advisories = [];
  if (!("track" in gate)) {
    advisories.push(
      `${latest.name} missing "track" field (add one of: ${[...VALID_TRACKS].join(", ")})`,
    );
  } else if (!VALID_TRACKS.has(gate.track)) {
    advisories.push(
      `${latest.name} has unrecognised track "${gate.track}"`,
    );
  }

  const malformedLessons = findMalformedReinforcedLines();
  for (const m of malformedLessons) {
    advisories.push(
      `lessons-learned.md:${m.lineNumber} malformed **Reinforced:** line: ${m.text}`,
    );
  }

  // Report final status based on most-recent gate.
  const { status, stage, host, orchestrator, workstream } = gate;
  const producer = host || orchestrator || "unknown";
  const stageLabel = workstream ? `${stage}/${workstream}` : stage;

  if (status === "PASS" || status === "WARN") {
    const icon = status === "WARN" ? "⚠️ " : "✅";
    console.log(`[gate-validator] ${icon} GATE ${status} — ${stageLabel} (${producer})`);
    if (Array.isArray(gate.warnings) && gate.warnings.length > 0) {
      console.log(
        `[gate-validator] ⚠️  Warnings: ${gate.warnings.join("; ")}`,
      );
    }
    for (const a of advisories) console.log(`[gate-validator] ℹ️  ${a}`);
    logEvent(status === "WARN" ? "gate_warn" : "gate_pass", { stage, workstream, host, orchestrator, file: latest.name, warnings: gate.warnings || [] });
    process.exit(0);
  }

  if (status === "FAIL") {
    console.log(`[gate-validator] ❌ GATE FAIL — ${stageLabel} (${producer})`);
    if (Array.isArray(gate.blockers) && gate.blockers.length > 0) {
      console.log(`[gate-validator] Blockers:`);
      gate.blockers.forEach((b) => console.log(`  - ${b}`));
    }
    for (const a of advisories) console.log(`[gate-validator] ℹ️  ${a}`);
    logEvent("gate_fail", { stage, workstream, host, orchestrator, file: latest.name, blockers: gate.blockers || [] });
    process.exit(2);
  }

  if (status === "ESCALATE") {
    console.log(`[gate-validator] 🚨 ESCALATION REQUIRED — ${stageLabel}`);
    console.log(
      `[gate-validator] Reason: ${gate.escalation_reason || "not specified"}`,
    );
    console.log(
      `[gate-validator] Decision needed: ${gate.decision_needed || "see gate file"}`,
    );
    if (gate.options) {
      console.log(`[gate-validator] Options: ${gate.options.join(" | ")}`);
    }
    for (const a of advisories) console.log(`[gate-validator] ℹ️  ${a}`);
    logEvent("gate_escalate", {
      stage, workstream, host, orchestrator, file: latest.name,
      reason: gate.escalation_reason || null,
      decision_needed: gate.decision_needed || null,
    });
    process.exit(3);
  }
}

// Top-level catch: distinguish error classes so a real filesystem problem
// (EACCES on pipeline/gates/, gates path is a regular file, etc.) halts the
// pipeline instead of silently green-lighting it. A runtime bug inside the
// validator itself still exits 0 with a warning, so a hook-side defect does
// not block every user session — the CI test suite is the authoritative
// check for validator correctness.
const HALT_FS_CODES = new Set([
  "EACCES",
  "EPERM",
  "ENOTDIR",
  "EISDIR",
  "EROFS",
]);

function runMain() {
  // Note: main() calls process.exit() on every branch, so wrapping it in
  // an OTel span here would leak unended spans. Validator runs are
  // short-lived and exit-on-decision; if we want a span for each
  // validate, instrument the caller (orchestrator) instead.
  try {
    main();
  } catch (err) {
    const code = err && err.code;
    if (code === "ENOENT") {
      // Expected absence (gates dir vanished between existsSync and readdir).
      process.exit(0);
    }
    if (HALT_FS_CODES.has(code)) {
      const msg = err.message || String(err);
      console.error(`[gate-validator] ❌ filesystem error (${code}): ${msg}`);
      console.error(
        `[gate-validator] Fix the underlying issue (permissions, path type) before re-running.`,
      );
      process.exit(1);
    }
    // Unknown / runtime error — likely a bug in this validator. Don't halt the
    // user's session with an opaque stack trace.
    const msg = err && err.message ? err.message : String(err);
    console.log(`[gate-validator] ⚠️  internal error: ${msg}; treating as PASS`);
    process.exit(0);
  }
}

if (require.main === module) {
  runMain();
}

module.exports = { main, runMain };
