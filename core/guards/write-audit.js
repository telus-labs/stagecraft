// Write-audit guard (C1 — filesystem-level allowedWrites enforcement).
//
// Provides post-hoc enforcement for adapters that have no hook mechanism
// (codex, gemini-cli). The orchestrator snapshots the working-tree dirty
// state before invoking the host process, then diffs after; any newly
// appearing path that isn't covered by the stage's allowedWrites list is
// a violation.
//
// "Covered" means:
//   - exact file match:     allowedWrites contains "pipeline/brief.md" and
//                           the written path is exactly "pipeline/brief.md"
//   - directory prefix:     allowedWrites contains "pipeline/adr/" and the
//                           written path starts with "pipeline/adr/"
//
// Pre-existing dirty files (present in the before snapshot) are never
// flagged — they weren't written by this invocation.
//
// If git is unavailable or the directory is not a repo, ok: false is
// returned and the audit is skipped rather than false-positiving.

const { execFileSync } = require("node:child_process");

/**
 * Capture the current set of modified/untracked paths visible to git.
 * Returns { paths: Set<string>, ok: boolean }.
 * ok=false when git is unavailable or the directory is not a repo.
 */
function snapshotWritables(cwd) {
  try {
    const out = execFileSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const paths = new Set();
    for (const line of out.split("\n")) {
      if (!line.trim()) continue;
      // Format: "XY path" where XY are two status chars followed by a space.
      // For renames the format is "XY old -> new"; we record the new name.
      const raw = line.slice(3).trim();
      const arrowIdx = raw.indexOf(" -> ");
      paths.add(arrowIdx >= 0 ? raw.slice(arrowIdx + 4) : raw);
    }
    return { paths, ok: true };
  } catch {
    return { paths: new Set(), ok: false };
  }
}

/**
 * Check whether a file path is covered by an allowedWrites entry.
 * Path separators are normalized to forward slashes for cross-platform safety.
 */
function isAllowed(filePath, allowedWrites) {
  if (!Array.isArray(allowedWrites) || allowedWrites.length === 0) return false;
  const normalized = filePath.replace(/\\/g, "/");
  return allowedWrites.some((entry) => {
    const e = (entry || "").replace(/\\/g, "/");
    if (e.endsWith("/")) {
      return normalized.startsWith(e) || normalized === e.slice(0, -1);
    }
    return normalized === e;
  });
}

/**
 * Diff two snapshots and return paths newly written during an invocation.
 * Returns { violations: string[], newPaths: string[], audited: boolean }.
 * audited=false when either snapshot reported ok=false (git unavailable).
 */
function auditWrites(before, after, allowedWrites) {
  if (!before.ok || !after.ok) {
    return { violations: [], newPaths: [], audited: false };
  }
  const newPaths = [...after.paths].filter((p) => !before.paths.has(p));
  const violations = newPaths.filter((p) => !isAllowed(p, allowedWrites));
  return { violations, newPaths, audited: true };
}

module.exports = { snapshotWritables, auditWrites, isAllowed };
