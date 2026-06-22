"use strict";

// Deterministic input manifest builder and result validator for the
// cloud-runner adapter (BACKLOG A3 / ADR-013).
//
// Three public functions:
//   buildManifest(projectRoot, opts) → { entries, totalBytes, warnings }
//   validateResult(entries, opts)    → { ok, errors }
//   applyResult(entries, projectRoot, opts) → { applied }
//
// Entry shape (both input manifest and result):
//   { path: string, sizeBytes: number, sha256: string, content: Buffer }
//
// buildManifest discovers files via git (tracked + non-ignored untracked),
// applies the fixed BUNDLE_DENYLIST, scans for secrets, and enforces a byte
// ceiling before returning. Content is included so callers can transport the
// bundle without re-reading from disk.
//
// validateResult is pure (no filesystem access). It checks path safety,
// authorization against allowedWrites, digest correctness, case collisions,
// duplicate paths, size/count limits, and local-edit conflicts.
//
// applyResult stages all files in a temp directory, re-verifies digests,
// then applies serially. On failure the temp dir is preserved for inspection.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

const { scanContent, isAllowlistedPath: secretScanAllowlisted } = require("../hooks/secret-scan");
const { isAllowed } = require("../guards/write-audit");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_BUNDLE_BYTES = 50 * 1024 * 1024;  // 50 MB
const DEFAULT_MAX_OUTPUT_BYTES = 50 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_FILES = 500;

// Project-root-relative POSIX prefixes always excluded from input bundles.
// Exact paths match as-is; entries ending in "/" match any path under them.
const BUNDLE_DENYLIST_PREFIXES = [
  ".git/",
  "node_modules/",
  ".npm/",
  ".yarn/",
  ".pnp.js",
  "pipeline/run.lock",
  "pipeline/run-state.json",
  "pipeline/run-log.jsonl",
  "pipeline/logs/",
  "pipeline/gates/archive/",
  "pipeline/gates/replay/",
  "pipeline/dispatches/",
  "pipeline/memory/",
  ".devteam/memory/",
  ".devteam/evidence-project-id",
  ".claude/",
];

// Regex patterns matched against the full relative POSIX path.
const BUNDLE_DENYLIST_PATTERNS = [
  /^\.env(\.|$)/i,                                              // .env, .env.local, .env.production
  /\.(pem|key|p12|pfx|p8)$/i,                                 // private key extensions
  /(^|\/)(package-lock|pnpm-lock)\.(yaml|yml|json)$/i,         // lock files / caches
  /(^|\/)yarn\.lock$/i,                                         // yarn classic lock file
];

// Paths that pass through even if they would otherwise match BUNDLE_DENYLIST_PATTERNS.
const BUNDLE_DENYLIST_ALLOWTHROUGH = [
  /\.env\.(example|sample|template|dist)$/i,
];

// ---------------------------------------------------------------------------
// Internal utilities
// ---------------------------------------------------------------------------

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function normalizePosix(p) {
  return p.replace(/\\/g, "/");
}

function isDenied(relPosixPath) {
  for (const re of BUNDLE_DENYLIST_ALLOWTHROUGH) {
    if (re.test(relPosixPath)) return false;
  }
  for (const prefix of BUNDLE_DENYLIST_PREFIXES) {
    if (prefix.endsWith("/")) {
      if (relPosixPath === prefix.slice(0, -1) || relPosixPath.startsWith(prefix)) return true;
    } else {
      if (relPosixPath === prefix) return true;
    }
  }
  for (const re of BUNDLE_DENYLIST_PATTERNS) {
    if (re.test(relPosixPath)) return true;
  }
  return false;
}

// Returns true if the relative path is safe to write inside a project root.
function safePath(relPath) {
  if (!relPath || typeof relPath !== "string") return false;
  if (relPath.includes("\0")) return false;
  if (path.isAbsolute(relPath)) return false;
  if (/^[A-Za-z]:/.test(relPath)) return false;                  // Windows drive letter
  const norm = path.normalize(relPath);
  if (norm.startsWith("..")) return false;
  return true;
}

// Resolve a symlink and verify it stays inside projectRoot.
// Returns the real absolute path on success, null if it escapes or is broken.
function resolveSymlinkSafe(absPath, projectRoot) {
  try {
    const real = fs.realpathSync(absPath);
    const rootReal = fs.realpathSync(projectRoot);
    if (real === rootReal || real.startsWith(rootReal + path.sep)) return real;
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// buildManifest
// ---------------------------------------------------------------------------

/**
 * Build a deterministic input manifest from a git project root.
 *
 * opts:
 *   maxBundleBytes (number)   — byte ceiling; throws if exceeded (default 50 MB)
 *   extraPaths     (string[]) — additional relative paths to include even if
 *                               normally denied (e.g. explicit pipeline artifacts)
 *   skipSecretScan (boolean)  — bypass secret scanning; for tests only
 *
 * Returns: { entries, totalBytes, warnings }
 *   entries  — Array<{ path, sizeBytes, sha256, content }> sorted by path
 *   warnings — non-fatal issues (symlinks skipped, unreadable files, etc.)
 *
 * Throws if git is unavailable, a secret is found, or the byte ceiling is hit.
 */
function buildManifest(projectRoot, opts = {}) {
  const maxBytes = opts.maxBundleBytes ?? DEFAULT_MAX_BUNDLE_BYTES;
  const extraPaths = new Set((opts.extraPaths || []).map(normalizePosix));
  const skipSecretScan = opts.skipSecretScan === true;
  const warnings = [];

  let candidates;
  try {
    const tracked = execFileSync("git", ["ls-files", "-z"], {
      cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).split("\0").filter(Boolean);

    const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
      cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).split("\0").filter(Boolean);

    candidates = new Set([...tracked, ...untracked].map(normalizePosix));
  } catch (err) {
    throw new Error(`buildManifest: git unavailable or not a repository — ${err.message}`);
  }

  for (const p of extraPaths) candidates.add(p);

  const entries = [];
  let totalBytes = 0;

  for (const relPath of [...candidates].sort()) {
    if (!extraPaths.has(relPath) && isDenied(relPath)) continue;

    const absPath = path.join(projectRoot, ...relPath.split("/"));

    let stat;
    try {
      stat = fs.lstatSync(absPath);
    } catch {
      warnings.push(`skipped (unreadable): ${relPath}`);
      continue;
    }

    if (stat.isSymbolicLink()) {
      const real = resolveSymlinkSafe(absPath, projectRoot);
      if (!real) {
        warnings.push(`skipped (symlink escapes project root): ${relPath}`);
        continue;
      }
      try { stat = fs.statSync(real); } catch {
        warnings.push(`skipped (broken symlink): ${relPath}`);
        continue;
      }
    }

    if (!stat.isFile()) continue;

    let content;
    try {
      content = fs.readFileSync(absPath);
    } catch {
      warnings.push(`skipped (read error): ${relPath}`);
      continue;
    }

    if (!skipSecretScan && !secretScanAllowlisted(relPath)) {
      const findings = scanContent(content.toString("utf8"));
      if (findings.length > 0) {
        const names = findings.map((f) => f.name).join(", ");
        throw new Error(
          `buildManifest: secret detected in "${relPath}" (${names}). ` +
          "Remove the secret or add a devteam-allow-secret comment before bundling.",
        );
      }
    }

    totalBytes += content.length;
    if (totalBytes > maxBytes) {
      throw new Error(
        `buildManifest: bundle exceeds ${maxBytes}-byte ceiling after adding "${relPath}". ` +
        "Reduce the workspace or raise maxBundleBytes.",
      );
    }

    entries.push({ path: relPath, sizeBytes: content.length, sha256: sha256(content), content });
  }

  return { entries, totalBytes, warnings };
}

// ---------------------------------------------------------------------------
// validateResult
// ---------------------------------------------------------------------------

/**
 * Validate a downloaded result bundle before applying it to the working tree.
 * Pure function — no filesystem access.
 *
 * entries: Array<{ path, sizeBytes, sha256, content: Buffer }>
 *
 * opts:
 *   allowedWrites    (string[])         — allowedWrites for this workstream
 *   gatePath         (string)           — expected gate path (always permitted)
 *   submittedDigests (Map<string,string>) — path → sha256 at dispatch time;
 *                                          only paths that changed locally since
 *                                          dispatch need to be present
 *   maxOutputBytes   (number)           — default 50 MB
 *   maxOutputFiles   (number)           — default 500
 *
 * Returns: { ok, errors }
 *   errors: Array<{ type, path, detail }>
 *   error types: "unsafe-path" | "unauthorized-write" | "corrupt-digest" |
 *                "case-collision" | "duplicate-path" | "size-exceeded" |
 *                "file-count-exceeded" | "local-edit-conflict"
 */
function validateResult(entries, opts = {}) {
  const {
    allowedWrites = [],
    gatePath = null,
    submittedDigests = new Map(),
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
    maxOutputFiles = DEFAULT_MAX_OUTPUT_FILES,
  } = opts;

  const errors = [];

  if (entries.length > maxOutputFiles) {
    errors.push({
      type: "file-count-exceeded",
      path: null,
      detail: `result contains ${entries.length} files; limit is ${maxOutputFiles}`,
    });
  }

  const seenPaths = new Set();
  const seenLower = new Map();
  let totalBytes = 0;

  for (const entry of entries) {
    const { path: relPath, sha256: declaredDigest, content } = entry;

    if (!safePath(relPath)) {
      errors.push({ type: "unsafe-path", path: relPath, detail: "traversal, absolute, or special-character path" });
      continue;
    }
    const posixPath = normalizePosix(relPath);

    if (seenPaths.has(posixPath)) {
      errors.push({ type: "duplicate-path", path: posixPath, detail: "path appears more than once in result" });
      continue;
    }
    seenPaths.add(posixPath);

    const lower = posixPath.toLowerCase();
    if (seenLower.has(lower)) {
      errors.push({ type: "case-collision", path: posixPath, detail: `collides with "${seenLower.get(lower)}"` });
    } else {
      seenLower.set(lower, posixPath);
    }

    const normalizedGate = gatePath ? normalizePosix(gatePath) : null;
    if (posixPath !== normalizedGate && !isAllowed(posixPath, allowedWrites)) {
      errors.push({ type: "unauthorized-write", path: posixPath, detail: "not in allowedWrites and not the expected gate path" });
    }

    if (content) {
      const actual = sha256(content);
      if (actual !== declaredDigest) {
        errors.push({ type: "corrupt-digest", path: posixPath, detail: `declared ${declaredDigest.slice(0, 12)}… actual ${actual.slice(0, 12)}…` });
      }

      // Local-edit conflict: file changed both locally and remotely since dispatch.
      // The adapter populates submittedDigests only for paths that changed locally.
      if (submittedDigests.has(posixPath) && actual !== submittedDigests.get(posixPath)) {
        errors.push({ type: "local-edit-conflict", path: posixPath, detail: "file modified locally after dispatch and remote returned different bytes" });
      }
    }

    const entryBytes = typeof entry.sizeBytes === "number" ? entry.sizeBytes : (content ? content.length : 0);
    totalBytes += entryBytes;
    if (totalBytes > maxOutputBytes) {
      errors.push({ type: "size-exceeded", path: posixPath, detail: `cumulative size exceeds ${maxOutputBytes}-byte ceiling` });
      break;
    }
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// applyResult
// ---------------------------------------------------------------------------

/**
 * Apply a validated result bundle to the project root.
 *
 * Stages all files in a temporary directory first, re-verifies digests, then
 * copies each file to its final location serially. On failure the temp directory
 * is preserved at err.tempDir for inspection; its path is also in the error message.
 *
 * opts:
 *   tempDir (string) — base directory for staging (default: os.tmpdir())
 *
 * Returns: { applied: string[] } — POSIX-relative paths of applied files
 */
function applyResult(entries, projectRoot, opts = {}) {
  const tempBase = opts.tempDir || os.tmpdir();
  const tempDir = fs.mkdtempSync(path.join(tempBase, "devteam-result-"));

  try {
    for (const entry of entries) {
      const posixPath = normalizePosix(entry.path);
      if (!safePath(posixPath)) throw new Error(`unsafe path in result: "${posixPath}"`);

      const actual = sha256(entry.content);
      if (actual !== entry.sha256) {
        throw new Error(`digest mismatch for "${posixPath}" during staging (declared ${entry.sha256.slice(0, 12)}…)`);
      }

      const tempPath = path.join(tempDir, ...posixPath.split("/"));
      fs.mkdirSync(path.dirname(tempPath), { recursive: true });
      fs.writeFileSync(tempPath, entry.content);
    }

    const applied = [];
    for (const entry of entries) {
      const posixPath = normalizePosix(entry.path);
      const tempPath = path.join(tempDir, ...posixPath.split("/"));
      const finalPath = path.join(projectRoot, ...posixPath.split("/"));
      fs.mkdirSync(path.dirname(finalPath), { recursive: true });
      fs.copyFileSync(tempPath, finalPath);
      applied.push(posixPath);
    }

    fs.rmSync(tempDir, { recursive: true, force: true });
    return { applied };
  } catch (err) {
    throw Object.assign(
      new Error(`applyResult failed: ${err.message}. Staged files preserved at: ${tempDir}`),
      { tempDir, cause: err },
    );
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  buildManifest,
  validateResult,
  applyResult,
  sha256,
  safePath,
  isDenied,
  BUNDLE_DENYLIST_PREFIXES,
  BUNDLE_DENYLIST_PATTERNS,
  DEFAULT_MAX_BUNDLE_BYTES,
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_MAX_OUTPUT_FILES,
};
