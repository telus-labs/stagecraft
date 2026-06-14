#!/usr/bin/env node
/**
 * approval-derivation.js
 *
 * PostToolUse hook (Claude Code Write|Edit). When the written file is
 * inside pipeline/code-review/, parses it for per-area section headers
 * and REVIEW: markers, then upserts the corresponding stage-05.<area>.json
 * workstream gates.
 *
 * Review file format:
 *
 *   ## Review of backend
 *   <comments>
 *   REVIEW: APPROVED
 *
 *   ## Review of platform
 *   <comments>
 *   REVIEW: CHANGES REQUESTED
 *   BLOCKER: <text>
 *
 * Contract F applied vs the prior fork:
 *   - drops the legacy "agent" field
 *   - gates carry orchestrator (auto-filled), host="claude-code"
 *     (this hook is currently only wired for claude-code), and
 *     workstream=<area>
 *
 * Concurrency: per-gate file lock (.stage-05-<area>.lock) plus atomic
 * rename writes — safe for concurrent reviewer writes.
 *
 * Conservative on errors: any parse/IO failure exits 0 with a WARN log;
 * never halts the host session on a hook bug.
 */

const fs = require("node:fs");
const path = require("node:path");
const { loadConfig } = require("../config");
const { requiredApprovalsFor, STAGES } = require("../pipeline/stages");

const ORCHESTRATOR_ID = `devteam@${require("../../package.json").version}`;
const HOST = "claude-code"; // this hook is wired only into the claude-code adapter

const CWD = (() => {
  try { return fs.realpathSync(process.cwd()); } catch { return process.cwd(); }
})();
// B9 (item 5.4): allow bounded-mode `devteam derive-approvals` to pass the
// per-change paths via env vars; in-place mode uses the historical defaults.
const REVIEW_DIR = process.env.DEVTEAM_REVIEW_DIR || path.join(CWD, "pipeline", "code-review");
const GATES_DIR = process.env.DEVTEAM_GATES_DIR || path.join(CWD, "pipeline", "gates");

const LOCK_RETRIES = 20;
const LOCK_DELAY_MS = 30;
const LOCK_STALE_MS = 5000;
const MAX_FILE_BYTES = 1_000_000;

const LOG_JSON = process.env.LOG_FORMAT === "json";
function logEvent(event, data) {
  if (!LOG_JSON) return;
  console.log(JSON.stringify({ ts: new Date().toISOString(), hook: "approval-derivation", event, ...data }));
}

// Map review file suffix → reviewer agent name.
const REVIEWER_MAP = {
  backend:  "dev-backend",
  frontend: "dev-frontend",
  platform: "dev-platform",
  qa:       "dev-qa",
  security: "security-engineer",
  principal: "principal",
};

const KNOWN_AREAS = new Set(["backend", "frontend", "platform", "qa", "deps"]);

// Host-based filenames trigger fanout-mode gate naming. When the
// reviewer identifier matches a known host, gates are written to
// stage-05.<area>.<host>.json instead of stage-05.<area>.json.
//
// "Known" = an entry here. Adding a new host adapter (under hosts/<name>/)
// REQUIRES adding the host's name to this set, otherwise the fanout-mode
// review files written by that host will fall back to the area-only gate
// path and collide across hosts. Keep this list in sync with the dirs
// under hosts/.
const KNOWN_HOSTS = new Set(["claude-code", "codex", "gemini-cli", "generic"]);

const SECTION_HEADER_RE = /^##\s+Review\s+of\s+(\w[\w-]*)\s*$/i;
const REVIEW_MARKER_RE = /^\s*REVIEW:\s*(APPROVED|CHANGES\s+REQUESTED)\s*$/i;
const BLOCKER_RE = /^\s*BLOCKER:\s*(.+)$/i;

// ---------------------------------------------------------------------------
// Stdin context — Claude Code PostToolUse provides tool_input.file_path
// ---------------------------------------------------------------------------

function getToolFilePath() {
  try {
    if (process.stdin.isTTY) return null;
    const chunks = [];
    const buf = Buffer.alloc(65536);
    let n;
    while ((n = fs.readSync(0, buf, 0, buf.length)) > 0) {
      chunks.push(Buffer.from(buf.slice(0, n)));
      if (chunks.reduce((s, c) => s + c.length, 0) > 4 * 1024 * 1024) break;
    }
    if (chunks.length === 0) return null;
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return data && data.tool_input && typeof data.tool_input.file_path === "string"
      ? data.tool_input.file_path
      : null;
  } catch { return null; }
}

function isReviewFile(filePath) {
  if (!filePath) return false;
  let normalized;
  try {
    normalized = fs.realpathSync(path.isAbsolute(filePath) ? filePath : path.resolve(filePath));
  } catch {
    normalized = path.isAbsolute(filePath) ? filePath : path.resolve(filePath);
  }
  return normalized.startsWith(REVIEW_DIR + path.sep);
}

// ---------------------------------------------------------------------------
// Locking
// ---------------------------------------------------------------------------

function acquireLock(lockPath) {
  if (fs.existsSync(lockPath)) {
    try {
      const age = Date.now() - fs.statSync(lockPath).mtimeMs;
      if (age > LOCK_STALE_MS) fs.unlinkSync(lockPath);
    } catch { /* concurrent unlink */ }
  }
  for (let i = 0; i < LOCK_RETRIES; i++) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
      return true;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_DELAY_MS);
    }
  }
  return false;
}

function releaseLock(lockPath) {
  try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Parse review file → verdicts
// ---------------------------------------------------------------------------

function parseReviewFile(filePath) {
  let content;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_FILE_BYTES) {
      console.log(`[approval-derivation] ⚠️  ${filePath} exceeds ${MAX_FILE_BYTES} bytes; skipping`);
      return [];
    }
    content = fs.readFileSync(filePath, "utf8");
  } catch { return []; }

  const verdicts = [];
  let currentArea = null;
  let currentBlockers = [];
  for (const line of content.split(/\r?\n/)) {
    const h = line.match(SECTION_HEADER_RE);
    if (h) { currentArea = h[1].toLowerCase(); currentBlockers = []; continue; }
    const b = line.match(BLOCKER_RE);
    if (b && currentArea && KNOWN_AREAS.has(currentArea)) {
      currentBlockers.push(b[1].trim());
      continue;
    }
    const m = line.match(REVIEW_MARKER_RE);
    if (m && currentArea && KNOWN_AREAS.has(currentArea)) {
      const verdict = m[1].toUpperCase().replace(/\s+/g, "_");
      verdicts.push({ area: currentArea, verdict, blockers: currentBlockers });
      currentArea = null;
      currentBlockers = [];
    }
  }
  return verdicts;
}

function reviewerNameFromPath(filePath) {
  const base = path.basename(filePath);
  const m = base.match(/^by-([\w-]+)\.md$/);
  if (!m) return null;
  return REVIEWER_MAP[m[1]] || m[1];
}

// Returns the raw role key (e.g. "backend") without mapping — used for
// self-review detection. For fanout files (by-codex.md) this returns the
// host name, which won't match any KNOWN_AREAS entry, so the check is safe.
function reviewerRoleFromPath(filePath) {
  const base = path.basename(filePath);
  const m = base.match(/^by-([\w-]+)\.md$/);
  return m ? m[1] : null;
}

// Return the host segment when the filename is host-based ("by-codex.md",
// "by-claude-code.md", etc.); null otherwise. Drives fanout gate naming.
function hostFromPath(filePath) {
  const base = path.basename(filePath);
  const m = base.match(/^by-([\w-]+)\.md$/);
  if (!m) return null;
  return KNOWN_HOSTS.has(m[1]) ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Gate upsert (locked, atomic write)
// ---------------------------------------------------------------------------

function applyVerdict({ area, verdict, blockers, reviewer, host }) {
  if (!fs.existsSync(GATES_DIR)) fs.mkdirSync(GATES_DIR, { recursive: true });

  // Fanout mode: host-suffixed gate name (stage-05.<area>.<host>.json).
  // Non-fanout: canonical per-area gate (stage-05.<area>.json).
  const baseName = host ? `stage-05.${area}.${host}` : `stage-05.${area}`;
  const gatePath = path.join(GATES_DIR, `${baseName}.json`);
  const lockPath = path.join(GATES_DIR, `.${baseName}.lock`);

  if (!acquireLock(lockPath)) {
    console.log(`[approval-derivation] ⚠️  could not acquire lock for ${baseName} after ${LOCK_RETRIES} retries; skipping`);
    return;
  }

  try {
    let gate;
    if (fs.existsSync(gatePath)) {
      try {
        const stat = fs.statSync(gatePath);
        if (stat.size > MAX_FILE_BYTES) {
          console.log(`[approval-derivation] ⚠️  ${gatePath} exceeds ${MAX_FILE_BYTES} bytes; refusing to clobber`);
          return;
        }
        gate = JSON.parse(fs.readFileSync(gatePath, "utf8"));
      } catch {
        console.log(`[approval-derivation] ⚠️  ${gatePath} is malformed; skipping update`);
        return;
      }
    } else {
      // Read the project's track so required_approvals matches the
      // PEER_REVIEW_SIZING table. Nano-track changes need 1 approval
      // (single-reviewer scoped review); full/quick/hotfix/etc need 2.
      let track = "full";
      try { track = loadConfig(CWD).pipeline.default_track || "full"; } catch { /* defaults */ }
      const required = requiredApprovalsFor(STAGES["peer-review"], track) ?? 2;
      gate = {
        stage: "stage-05",
        workstream: area,
        // For fanout gates the host IS the fanout target (the reviewer
        // is acting AS that host's reviewer). Otherwise it's the host
        // that ran the actual review session (claude-code by default
        // since this hook is wired only into claude-code today).
        host: host || HOST,
        orchestrator: ORCHESTRATOR_ID,
        track,
        status: "FAIL",
        timestamp: new Date().toISOString(),
        blockers: [],
        warnings: [],
        area,
        approvals: [],
        changes_requested: [],
        escalated_to_principal: false,
        required_approvals: required,
        review_shape: required === 1 ? "single" : "matrix",
      };
    }

    gate.approvals = Array.isArray(gate.approvals) ? gate.approvals : [];
    gate.changes_requested = Array.isArray(gate.changes_requested) ? gate.changes_requested : [];
    gate.blockers = Array.isArray(gate.blockers) ? gate.blockers : [];

    // Remove any prior blocker entries from this reviewer before rewriting.
    gate.blockers = gate.blockers.filter((b) => b.reviewer !== reviewer);

    if (verdict === "APPROVED") {
      if (!gate.approvals.includes(reviewer)) gate.approvals.push(reviewer);
      gate.changes_requested = gate.changes_requested.filter((e) => e.reviewer !== reviewer);
    } else if (verdict === "CHANGES_REQUESTED") {
      gate.approvals = gate.approvals.filter((n) => n !== reviewer);
      if (!gate.changes_requested.some((e) => e.reviewer === reviewer)) {
        gate.changes_requested.push({ reviewer, timestamp: new Date().toISOString() });
      }
      if (Array.isArray(blockers) && blockers.length > 0) {
        for (const text of blockers) {
          gate.blockers.push({ reviewer, text });
        }
      }
    }

    const required = typeof gate.required_approvals === "number" ? gate.required_approvals : 2;
    const hasEnough = gate.approvals.length >= required;
    const hasBlockers = gate.changes_requested.length > 0;
    gate.status = hasEnough && !hasBlockers ? "PASS" : "FAIL";
    gate.timestamp = new Date().toISOString();

    // Diagnostic fields — cleared on every update so stale values don't persist.
    delete gate.failure_reason;
    delete gate.action_required;
    if (gate.status === "FAIL") {
      if (hasBlockers) {
        gate.failure_reason = "CHANGES_REQUESTED";
      } else {
        gate.failure_reason = "INSUFFICIENT_APPROVALS";
        const needed = required - gate.approvals.length;
        const eligible = Object.values(REVIEWER_MAP).filter(r => !gate.approvals.includes(r));
        gate.action_required =
          `Need ${needed} more approval(s). ` +
          `Run 'devteam derive-approvals' to pick up any existing review-file verdicts. ` +
          `If still failing, have an eligible reviewer add ` +
          `'## Review of ${area}' + 'REVIEW: APPROVED' to their ` +
          `pipeline/code-review/by-<role>.md. ` +
          `Eligible reviewers: [${eligible.join(", ")}].`;
      }
    }
    // Backfill identity for legacy gates that predate the field, but do NOT
    // overwrite. For fanout gates, gate.host was set at creation to the
    // fanout target host (e.g. "codex") — clobbering it to HOST here would
    // misattribute every subsequent review update from this hook to
    // claude-code. The host field is set once when the gate is created and
    // is never mutated afterwards.
    gate.orchestrator = gate.orchestrator || ORCHESTRATOR_ID;
    gate.host = gate.host || host || HOST;

    const tmpPath = `${gatePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmpPath, JSON.stringify(gate, null, 2) + "\n");
    fs.renameSync(tmpPath, gatePath);

    console.log(`[approval-derivation] ${reviewer} → ${verdict} on ${area} (approvals: ${gate.approvals.length}/${required}, status: ${gate.status})`);
    logEvent("gate_updated", {
      area, reviewer, verdict, status: gate.status,
      approvals: gate.approvals.slice(),
      approvals_count: gate.approvals.length,
      required_approvals: required,
      changes_requested_count: gate.changes_requested.length,
    });
  } finally {
    releaseLock(lockPath);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const writtenPath = getToolFilePath();
  if (writtenPath !== null && !isReviewFile(writtenPath)) process.exit(0);
  if (!fs.existsSync(REVIEW_DIR)) process.exit(0);

  const reviewFiles = fs.readdirSync(REVIEW_DIR).filter((f) => /^by-[\w-]+\.md$/.test(f));
  if (reviewFiles.length === 0) process.exit(0);

  // Nano track uses a single reviewer (backend) who reviews the backend
  // workstream — self-review is structural, not a violation.
  let track = "full";
  try { track = loadConfig(CWD).pipeline.default_track || "full"; } catch { /* defaults */ }
  const isSingleReviewer = track === "nano";

  for (const file of reviewFiles) {
    const fullPath = path.join(REVIEW_DIR, file);
    const reviewer = reviewerNameFromPath(fullPath);
    if (!reviewer) continue;
    const host = hostFromPath(fullPath);  // null unless it's a fanout file
    const role = reviewerRoleFromPath(fullPath); // raw key, e.g. "backend"
    const verdicts = parseReviewFile(fullPath);
    for (const v of verdicts) {
      // Self-review guard: skip sections where the reviewer's own workstream
      // matches the area being reviewed. Only applies to non-fanout files
      // (fanout hosts like "codex" don't own a workstream). Not applied on
      // nano track where the single reviewer IS the workstream owner.
      if (!host && role && v.area === role && !isSingleReviewer) {
        console.error(`[approval-derivation] WARN: self-review skipped — ${file} contains "## Review of ${v.area}" but that is the reviewer's own workstream`);
        continue;
      }
      applyVerdict({ area: v.area, verdict: v.verdict, blockers: v.blockers, reviewer, host });
    }
  }
  process.exit(0);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.log(`[approval-derivation] ⚠️  internal error: ${msg}; no gates updated`);
    process.exit(0);
  }
}

module.exports = { main, parseReviewFile, applyVerdict, reviewerNameFromPath, hostFromPath, KNOWN_HOSTS };
