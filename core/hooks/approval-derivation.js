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

const ORCHESTRATOR_ID = `devteam@${require("../../package.json").version}`;
const HOST = "claude-code"; // this hook is wired only into the claude-code adapter

const CWD = (() => {
  try { return fs.realpathSync(process.cwd()); } catch { return process.cwd(); }
})();
const REVIEW_DIR = path.join(CWD, "pipeline", "code-review");
const GATES_DIR = path.join(CWD, "pipeline", "gates");

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

const SECTION_HEADER_RE = /^##\s+Review\s+of\s+(\w[\w-]*)\s*$/i;
const REVIEW_MARKER_RE = /^\s*REVIEW:\s*(APPROVED|CHANGES\s+REQUESTED)\s*$/i;

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
  for (const line of content.split(/\r?\n/)) {
    const h = line.match(SECTION_HEADER_RE);
    if (h) { currentArea = h[1].toLowerCase(); continue; }
    const m = line.match(REVIEW_MARKER_RE);
    if (m && currentArea && KNOWN_AREAS.has(currentArea)) {
      const verdict = m[1].toUpperCase().replace(/\s+/g, "_");
      verdicts.push({ area: currentArea, verdict });
      currentArea = null;
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

// ---------------------------------------------------------------------------
// Gate upsert (locked, atomic write)
// ---------------------------------------------------------------------------

function applyVerdict({ area, verdict, reviewer }) {
  if (!fs.existsSync(GATES_DIR)) fs.mkdirSync(GATES_DIR, { recursive: true });

  const gatePath = path.join(GATES_DIR, `stage-05.${area}.json`);
  const lockPath = path.join(GATES_DIR, `.stage-05.${area}.lock`);

  if (!acquireLock(lockPath)) {
    console.log(`[approval-derivation] ⚠️  could not acquire lock for ${area} after ${LOCK_RETRIES} retries; skipping`);
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
      gate = {
        stage: "stage-05",
        workstream: area,
        host: HOST,
        orchestrator: ORCHESTRATOR_ID,
        track: "full",
        status: "FAIL",
        timestamp: new Date().toISOString(),
        blockers: [],
        warnings: [],
        area,
        approvals: [],
        changes_requested: [],
        escalated_to_principal: false,
        required_approvals: 2,
        review_shape: "matrix",
      };
    }

    gate.approvals = Array.isArray(gate.approvals) ? gate.approvals : [];
    gate.changes_requested = Array.isArray(gate.changes_requested) ? gate.changes_requested : [];

    if (verdict === "APPROVED") {
      if (!gate.approvals.includes(reviewer)) gate.approvals.push(reviewer);
      gate.changes_requested = gate.changes_requested.filter((e) => e.reviewer !== reviewer);
    } else if (verdict === "CHANGES_REQUESTED") {
      gate.approvals = gate.approvals.filter((n) => n !== reviewer);
      if (!gate.changes_requested.some((e) => e.reviewer === reviewer)) {
        gate.changes_requested.push({ reviewer, timestamp: new Date().toISOString() });
      }
    }

    const required = typeof gate.required_approvals === "number" ? gate.required_approvals : 2;
    const hasEnough = gate.approvals.length >= required;
    const hasBlockers = gate.changes_requested.length > 0;
    gate.status = hasEnough && !hasBlockers ? "PASS" : "FAIL";
    gate.timestamp = new Date().toISOString();
    // Re-stamp identity in case we read a legacy gate.
    gate.orchestrator = ORCHESTRATOR_ID;
    gate.host = HOST;

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

  for (const file of reviewFiles) {
    const fullPath = path.join(REVIEW_DIR, file);
    const reviewer = reviewerNameFromPath(fullPath);
    if (!reviewer) continue;
    const verdicts = parseReviewFile(fullPath);
    for (const v of verdicts) {
      applyVerdict({ area: v.area, verdict: v.verdict, reviewer });
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

module.exports = { main, parseReviewFile, applyVerdict, reviewerNameFromPath };
