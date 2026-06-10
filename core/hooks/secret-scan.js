#!/usr/bin/env node
/**
 * secret-scan.js
 *
 * PreToolUse hook (Claude Code Write|Edit). Reads the proposed file
 * content from stdin and scans for common secret patterns. Exits:
 *
 *   0 — no secrets found; allow the tool call to proceed
 *   2 — secrets detected; block the tool call
 *
 * The hook is conservative on input:
 *   - Empty stdin / non-JSON stdin → exit 0 (allow). Hook bugs must
 *     not block legitimate sessions; the gate validator is the
 *     authoritative downstream safety net.
 *   - Unknown tool name → exit 0.
 *
 * Magic-comment override (per-line scoping, fix 1.7.2):
 *   A line containing `devteam-allow-secret: <reason>` (case-insensitive)
 *   suppresses findings on that line AND the immediately following line only
 *   — NOT the entire file. This prevents LLM-written content from embedding
 *   a single bypass comment to disable the whole scan. Every suppressed
 *   finding is appended as a JSON record to pipeline/secret-allowlist.log
 *   so suppressions are auditable.
 *   (plans/phase-1-trust-consolidation.md item 1.7 fix 2)
 *
 * Path allowlist: certain filenames are skipped by default
 * (.env.example, .env.sample, *.template, *.dist). Edit ALLOWLIST_PATH_PATTERNS
 * below if your project needs more.
 *
 * Module exports `scanContent(text)` for use in tests and other
 * callers; main() is the hook entrypoint.
 */

const fs = require("node:fs");

// ---------------------------------------------------------------------------
// Detection patterns
// ---------------------------------------------------------------------------

// Each entry: { name, re, severity }. We keep the regex tight to avoid
// false positives on docs/code that *mention* secrets. Severity is
// informational only — any match blocks.
const SECRET_PATTERNS = [
  // AWS
  { name: "AWS Access Key ID",      re: /\bAKIA[0-9A-Z]{16}\b/g,        severity: "critical" },
  { name: "AWS Secret Access Key",  re: /\baws_secret_access_key\s*=\s*['"]?([A-Za-z0-9/+=]{40})['"]?/gi, severity: "critical" },
  { name: "AWS Session Token",      re: /\bASIA[0-9A-Z]{16}\b/g,        severity: "critical" },

  // GitHub
  { name: "GitHub Personal Token",  re: /\bghp_[A-Za-z0-9]{36}\b/g,     severity: "critical" },
  { name: "GitHub OAuth Token",     re: /\bgho_[A-Za-z0-9]{36}\b/g,     severity: "critical" },
  { name: "GitHub User Token",      re: /\bghu_[A-Za-z0-9]{36}\b/g,     severity: "critical" },
  { name: "GitHub Server Token",    re: /\bghs_[A-Za-z0-9]{36}\b/g,     severity: "critical" },
  { name: "GitHub Refresh Token",   re: /\bghr_[A-Za-z0-9]{36}\b/g,     severity: "critical" },

  // Anthropic / OpenAI
  { name: "Anthropic API Key",      re: /\bsk-ant-[A-Za-z0-9_-]{32,}\b/g, severity: "critical" },
  { name: "OpenAI API Key",         re: /\bsk-(?!ant-)[A-Za-z0-9]{20,}\b/g, severity: "critical" },

  // Google
  { name: "Google API Key",         re: /\bAIza[0-9A-Za-z\-_]{35}\b/g,  severity: "critical" },
  { name: "Google OAuth Client",    re: /\b\d{12}-[a-z0-9]{32}\.apps\.googleusercontent\.com\b/g, severity: "warning" },

  // Slack
  { name: "Slack Bot Token",        re: /\bxoxb-[A-Za-z0-9-]{10,}\b/g,  severity: "critical" },
  { name: "Slack User Token",       re: /\bxoxp-[A-Za-z0-9-]{10,}\b/g,  severity: "critical" },
  { name: "Slack App Token",        re: /\bxapp-[0-9]-[A-Za-z0-9-]{10,}\b/g, severity: "critical" },
  { name: "Slack Webhook URL",      re: /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{8,}\/B[A-Z0-9]{8,}\/[A-Za-z0-9]{20,}/g, severity: "critical" },

  // Stripe
  { name: "Stripe Live Secret",     re: /\bsk_live_[A-Za-z0-9]{24,}\b/g, severity: "critical" },
  { name: "Stripe Live Publishable",re: /\bpk_live_[A-Za-z0-9]{24,}\b/g, severity: "warning" },

  // Generic high-confidence
  { name: "Private Key Block",      re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY( BLOCK)?-----/g, severity: "critical" },
  { name: "JWT-shaped token",       re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, severity: "warning" },

  // PostgreSQL connection string with embedded password
  { name: "Postgres URL w/ password", re: /\bpostgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]{6,}@[^\s/]+/g, severity: "critical" },

  // Generic API key assignment (lower-confidence catch-all; tight enough
  // to skip "API_KEY=YOUR_KEY_HERE" type placeholder content)
  { name: "Generic API Key",        re: /\b(?:api[_-]?key|access[_-]?token|secret[_-]?key)['"]?\s*[:=]\s*['"]([A-Za-z0-9_/+=-]{32,})['"]/gi, severity: "warning" },
];

// File-path patterns where secret scanning is intentionally skipped.
// These are LEGIT places to have secret-shaped strings (templates,
// examples, doc snippets) and blocking them produces friction.
const ALLOWLIST_PATH_PATTERNS = [
  /\.env\.example$/,
  /\.env\.sample$/,
  /\.template$/,
  /\.dist$/,
  /(^|\/)docs?\/.*\.md$/,                  // docs/ markdown — patterns shown as examples
  /(^|\/)examples?\/.*$/,                   // examples/ — same
  /(^|\/)tests?\/.*\.test\.js$/,            // test files have fake secrets in fixtures
  /\.snap$/,                                // snapshot tests
];

// Honor user/project allowlist additions via env var
function additionalAllowlistPatterns() {
  const raw = process.env.DEVTEAM_SECRET_SCAN_ALLOW || "";
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean).map((s) => new RegExp(s));
}

// Skip scanning content larger than this. The hook runs as a Claude Code
// PreToolUse blocker — Claude Code times out hooks that take too long, and
// a timed-out hook fails OPEN (tool call proceeds without the safety net).
// Matches the 1 MB cap used by core/guards/security-heuristic.js and
// core/hooks/approval-derivation.js for the same reason.
const MAX_SCAN_BYTES = 1_000_000;

// ---------------------------------------------------------------------------
// Scan logic
// ---------------------------------------------------------------------------

// Magic-comment regex — matches `devteam-allow-secret: <reason>` anywhere
// on a line, case-insensitive. Requires the colon to prevent accidental matches.
const ALLOW_COMMENT_RE = /devteam-allow-secret\s*:/i;

/**
 * Return a Set of 1-based line numbers that are suppressed by a
 * `devteam-allow-secret:` comment.  The comment on line N suppresses
 * findings on line N and line N+1 (comment-above-code style).
 * This is per-line scoping — NOT a whole-file bypass.
 * (plans/phase-1-trust-consolidation.md item 1.7 fix 2)
 */
function suppressedLines(text) {
  const suppressed = new Set();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (ALLOW_COMMENT_RE.test(lines[i])) {
      const lineNo = i + 1; // 1-based
      suppressed.add(lineNo);       // own line
      suppressed.add(lineNo + 1);   // immediately following line
    }
  }
  return suppressed;
}

/**
 * Scan a text blob. Returns an array of findings:
 *   { name, severity, line, snippet }
 *
 * Findings on lines covered by a `devteam-allow-secret:` comment are
 * omitted (per-line scoping — see suppressedLines above).
 */
function scanContent(text) {
  if (typeof text !== "string" || text.length === 0) return [];

  const suppressed = suppressedLines(text);

  const findings = [];
  // Per-match line numbers are computed inline below by re-splitting the
  // prefix up to the match index. We don't keep a separate lines array.
  for (const pattern of SECRET_PATTERNS) {
    // Reset regex state for global flag reuse.
    pattern.re.lastIndex = 0;
    let m;
    while ((m = pattern.re.exec(text)) !== null) {
      const upTo = text.slice(0, m.index);
      const line = upTo.split(/\r?\n/).length;
      if (suppressed.has(line)) continue; // per-line suppression window
      const matched = m[0];
      const snippet = matched.length > 60 ? matched.slice(0, 40) + "…" + matched.slice(-15) : matched;
      findings.push({
        name: pattern.name,
        severity: pattern.severity,
        line,
        snippet: redact(snippet),
      });
    }
  }
  return findings;
}

/** Redact the middle of a matched secret so we don't echo it back to logs. */
function redact(s) {
  if (s.length <= 12) return s.slice(0, 2) + "***" + s.slice(-2);
  return s.slice(0, 6) + "***" + s.slice(-4);
}

function isAllowlistedPath(filePath) {
  if (!filePath) return false;
  const norm = String(filePath).replace(/\\/g, "/");
  for (const re of ALLOWLIST_PATH_PATTERNS) if (re.test(norm)) return true;
  for (const re of additionalAllowlistPatterns()) if (re.test(norm)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Stdin parsing — Claude Code PreToolUse context
// ---------------------------------------------------------------------------

function readStdin() {
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
    return Buffer.concat(chunks).toString("utf8");
  } catch { return null; }
}

/**
 * Extract { tool_name, file_path, content } from PreToolUse stdin.
 * Returns null if any field is missing or stdin can't be parsed.
 */
function extractContext(raw) {
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || !parsed.tool_input) return null;
  const tool_name = parsed.tool_name || null;
  const tool_input = parsed.tool_input;
  const file_path = tool_input.file_path || null;
  // Write: full content in tool_input.content
  // Edit:  new content in tool_input.new_string (we scan the new content only)
  const content =
    typeof tool_input.content === "string" ? tool_input.content :
    typeof tool_input.new_string === "string" ? tool_input.new_string :
    null;
  return { tool_name, file_path, content };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function reportFindings(findings, filePath) {
  console.error(`[secret-scan] 🚫 Blocked: ${findings.length} secret-like pattern${findings.length === 1 ? "" : "s"} detected in ${filePath || "<file>"}`);
  for (const f of findings) {
    console.error(`  - line ${f.line}: ${f.name} (${f.severity})  ${f.snippet}`);
  }
  console.error("");
  console.error("If this is a verified false positive:");
  console.error("  - Add `devteam-allow-secret: <reason>` on the line containing the pattern (or the");
  console.error("    immediately preceding line). The comment suppresses that line and the next one only.");
  console.error("    Every suppression is appended to pipeline/secret-allowlist.log for audit.");
  console.error("  - Add the file's path pattern to DEVTEAM_SECRET_SCAN_ALLOW env var (comma-separated regex list).");
  console.error("Patterns: core/hooks/secret-scan.js  -  reasons here are recorded in PR / retro for audit.");
}

/**
 * Append one JSON record per suppressed finding to pipeline/secret-allowlist.log.
 * Best-effort: if the directory doesn't exist or write fails, log a warning and
 * continue — suppression audit must never block a legitimate session.
 * (plans/phase-1-trust-consolidation.md item 1.7 fix 2)
 */
function appendAllowlistLog(filePath, content) {
  const suppressed = suppressedLines(content);
  if (suppressed.size === 0) return;

  // Re-scan but emit only the suppressed findings so we can log them.
  const suppressedFindings = [];
  for (const pattern of SECRET_PATTERNS) {
    pattern.re.lastIndex = 0;
    let m;
    while ((m = pattern.re.exec(content)) !== null) {
      const upTo = content.slice(0, m.index);
      const line = upTo.split(/\r?\n/).length;
      if (!suppressed.has(line)) continue;
      // Only log the line's allow reason (extract from the covering comment line).
      const lines = content.split(/\r?\n/);
      // Find which allow-comment line covers this finding.
      let reason = "";
      for (let i = 0; i < lines.length; i++) {
        const commentLine = i + 1;
        if ((commentLine === line || commentLine === line - 1) && ALLOW_COMMENT_RE.test(lines[i])) {
          const match = lines[i].match(/devteam-allow-secret\s*:\s*(.+)/i);
          reason = match ? match[1].trim() : "";
          break;
        }
      }
      suppressedFindings.push({ file: filePath || "", line, reason, ts: new Date().toISOString() });
    }
  }
  if (suppressedFindings.length === 0) return;

  try {
    const logDir = "pipeline";
    const logPath = require("node:path").join(logDir, "secret-allowlist.log");
    require("node:fs").mkdirSync(logDir, { recursive: true });
    for (const entry of suppressedFindings) {
      require("node:fs").appendFileSync(logPath, JSON.stringify(entry) + "\n");
    }
  } catch (err) {
    console.error(`[secret-scan] ⚠️  could not write allowlist log: ${err && err.message}`);
  }
}

function main() {
  const raw = readStdin();
  if (!raw) process.exit(0);
  const ctx = extractContext(raw);
  if (!ctx) process.exit(0);
  // We only scan Write and Edit. Others (Read, Bash, Glob, …) are irrelevant.
  if (ctx.tool_name && !["Write", "Edit"].includes(ctx.tool_name)) process.exit(0);
  if (!ctx.content) process.exit(0);
  if (isAllowlistedPath(ctx.file_path)) process.exit(0);

  // Fail-soft on oversized content: log a warning and allow the tool call.
  // Better to skip an unusually large file than to time out the hook and
  // fail OPEN under load. Real source files are well under 1 MB.
  if (ctx.content.length > MAX_SCAN_BYTES) {
    console.error(
      `[secret-scan] ⚠️  content for ${ctx.file_path || "<file>"} ` +
      `is ${ctx.content.length} bytes (cap ${MAX_SCAN_BYTES}); skipping scan and allowing.`,
    );
    process.exit(0);
  }

  const findings = scanContent(ctx.content);
  // Append audit log for any findings that were suppressed by a per-line
  // magic comment — this is best-effort and must not block the tool call.
  appendAllowlistLog(ctx.file_path, ctx.content);
  if (findings.length === 0) process.exit(0);

  reportFindings(findings, ctx.file_path);
  process.exit(2);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    // Hook bugs must not block sessions. Log and exit 0 (allow).
    console.error(`[secret-scan] ⚠️  internal error: ${err && err.message}; allowing`);
    process.exit(0);
  }
}

module.exports = {
  scanContent,
  suppressedLines,
  appendAllowlistLog,
  extractContext,
  isAllowlistedPath,
  SECRET_PATTERNS,
  ALLOWLIST_PATH_PATTERNS,
  MAX_SCAN_BYTES,
};
