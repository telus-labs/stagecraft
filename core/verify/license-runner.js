// Orchestrator-side offline license compliance check for Node projects.
// Walks node_modules/*/package.json (including scoped packages under @scope/name)
// without network access. Evaluates each package's declared SPDX license against
// the default policy table (matches C3 spec) plus any project-level overrides
// from .devteam/config.yml `license.extra_allowed[]`.
//
// Returns:
//   { nodeProject: false, unverified: true, reason }          — no package.json
//   { nodeProject: true, unverified: true, reason }           — node_modules absent
//   { nodeProject: true, unverified: false, passed, findings, totalScanned }
//
// `findings` contains only non-allowed packages (warned + denied),
// matching the model's expected `license_findings[]` shape.
// C3 policy table: BACKLOG C3, roles/platform.md §"License compatibility check".

const fs = require("node:fs");
const path = require("node:path");

// Default allowed SPDX identifiers. BSD-* is handled via prefix match below.
const ALLOWED_EXACT = new Set([
  "MIT", "MIT-0",
  "Apache-2.0",
  "BSD-2-Clause", "BSD-3-Clause", "BSD-4-Clause",
  "ISC",
  "CC0-1.0",
  "0BSD",
  "Unlicense",
  "CC-BY-4.0",
  "Python-2.0",
  "PSF-2.0",
  "BlueOak-1.0.0",
  "Artistic-2.0",
  "Zlib",
  "libpng",
]);

// Strong-copyleft identifiers: exact and common suffix variants.
const DENIED_EXACT = new Set([
  "GPL-2.0", "GPL-2.0-only", "GPL-2.0-or-later", "GPL-2.0+",
  "GPL-3.0", "GPL-3.0-only", "GPL-3.0-or-later", "GPL-3.0+",
  "LGPL-2.0", "LGPL-2.0-only", "LGPL-2.0-or-later",
  "LGPL-2.1", "LGPL-2.1-only", "LGPL-2.1-or-later", "LGPL-2.1+",
  "LGPL-3.0", "LGPL-3.0-only", "LGPL-3.0-or-later",
  "AGPL-1.0", "AGPL-3.0", "AGPL-3.0-only", "AGPL-3.0-or-later",
]);

// Prefixes that always indicate strong copyleft regardless of version.
const DENIED_PREFIXES = ["GPL-", "LGPL-", "AGPL-"];

// Identifiers requiring human review (unknown, proprietary, network-copyleft, source-available).
const WARNED_EXACT = new Set([
  "UNLICENSED",
  "SSPL-1.0",
  "BUSL-1.1",
  "CC-BY-SA-4.0",
  "CC-BY-NC-4.0",
]);

// Classify a single, already-resolved SPDX identifier.
function classifyOne(id, extraAllowed) {
  const normalized = id.trim().replace(/\s+/g, " ");
  if (!normalized || normalized === "UNKNOWN") return "warned";
  if (extraAllowed.includes(normalized)) return "allowed";
  if (ALLOWED_EXACT.has(normalized)) return "allowed";
  if (normalized.startsWith("BSD-")) return "allowed";
  if (DENIED_EXACT.has(normalized)) return "denied";
  if (DENIED_PREFIXES.some((p) => normalized.startsWith(p))) return "denied";
  if (WARNED_EXACT.has(normalized)) return "warned";
  return "warned"; // conservative: unknown identifiers require human review
}

// Classify a license string (may be SPDX expression with OR/AND/WITH).
// For OR expressions the most permissive component wins (user can choose).
// For AND/WITH expressions the most restrictive component wins.
// Precedence: allowed < warned < denied (higher index = more restrictive).
const RANK = { allowed: 0, warned: 1, denied: 2 };

function classifyLicense(licenseStr, extraAllowed = []) {
  if (!licenseStr || typeof licenseStr !== "string") return "warned";
  // Strip outer parentheses.
  const expr = licenseStr.trim().replace(/^\(+|\)+$/g, "");

  if (expr.includes(" OR ")) {
    // Most permissive wins — user can pick the friendly leg.
    const parts = expr.split(" OR ").map((s) => s.trim().replace(/^\(+|\)+$/g, ""));
    let best = "denied";
    for (const p of parts) {
      const c = classifyOne(p, extraAllowed);
      if (RANK[c] < RANK[best]) best = c;
    }
    return best;
  }

  if (expr.includes(" AND ") || expr.includes(" WITH ")) {
    // Most restrictive wins.
    const parts = expr.split(/ AND | WITH /).map((s) => s.trim().replace(/^\(+|\)+$/g, ""));
    let worst = "allowed";
    for (const p of parts) {
      const c = classifyOne(p, extraAllowed);
      if (RANK[c] > RANK[worst]) worst = c;
    }
    return worst;
  }

  return classifyOne(expr, extraAllowed);
}

// Extract the license identifier string from a package.json object.
// Handles: string (modern), { type, url } (npm2), [{ type }] (very old), plural `licenses`.
function extractLicense(pkg) {
  if (!pkg) return null;

  // Modern: "license": "MIT"
  if (typeof pkg.license === "string") return pkg.license;

  // npm2 object: "license": { "type": "MIT" }
  if (pkg.license && typeof pkg.license === "object" && !Array.isArray(pkg.license)) {
    return typeof pkg.license.type === "string" ? pkg.license.type : null;
  }

  // Very old array: "license": [{ "type": "MIT" }] or "licenses": [...]
  const licArr = Array.isArray(pkg.license) ? pkg.license : (Array.isArray(pkg.licenses) ? pkg.licenses : null);
  if (licArr && licArr.length > 0) {
    // Join multiple licenses as OR expression (user can choose any)
    const ids = licArr.map((l) => (typeof l === "string" ? l : l.type)).filter(Boolean);
    return ids.length === 1 ? ids[0] : `(${ids.join(" OR ")})`;
  }

  return null;
}

// Walk a node_modules directory (top-level, including scoped @scope/pkg).
// Returns an array of { pkgName, pkgJsonPath } for each package found.
function collectPackageJsonPaths(nodeModulesPath) {
  const results = [];
  let entries;
  try {
    entries = fs.readdirSync(nodeModulesPath);
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.startsWith(".")) continue; // skip .bin, .cache, .package-lock.json
    const entryPath = path.join(nodeModulesPath, entry);
    if (entry.startsWith("@")) {
      // Scoped — one level deeper
      let scopeEntries;
      try { scopeEntries = fs.readdirSync(entryPath); } catch { continue; }
      for (const scoped of scopeEntries) {
        if (scoped.startsWith(".")) continue;
        results.push({
          pkgName: `${entry}/${scoped}`,
          pkgJsonPath: path.join(entryPath, scoped, "package.json"),
        });
      }
    } else {
      results.push({
        pkgName: entry,
        pkgJsonPath: path.join(entryPath, "package.json"),
      });
    }
  }
  return results;
}

// Main export. cwd is the target project root (not stagecraft).
// config is the result of loadConfig(cwd) — used for license.extra_allowed[].
function runLicenseCheck(cwd, config) {
  const pkgJsonPath = path.join(cwd, "package.json");
  const nodeModulesPath = path.join(cwd, "node_modules");

  if (!fs.existsSync(pkgJsonPath)) {
    return { nodeProject: false, unverified: true, reason: "no package.json detected — not a Node project" };
  }

  if (!fs.existsSync(nodeModulesPath)) {
    return { nodeProject: true, unverified: true, reason: "node_modules not installed — cannot verify licenses offline" };
  }

  const extraAllowed = Array.isArray(config?._raw?.license?.extra_allowed)
    ? config._raw.license.extra_allowed
    : [];

  const pkgs = collectPackageJsonPaths(nodeModulesPath);
  const findings = [];
  let totalScanned = 0;

  for (const { pkgName, pkgJsonPath: pjPath } of pkgs) {
    if (!fs.existsSync(pjPath)) continue;
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(pjPath, "utf8"));
    } catch {
      // Unreadable package.json — treat as warned (unknown license)
      findings.push({ package: pkgName, license: "UNKNOWN", policy: "warned", note: "package.json unreadable" });
      totalScanned++;
      continue;
    }
    totalScanned++;
    const licStr = extractLicense(pkg);
    const policy = classifyLicense(licStr, extraAllowed);
    if (policy !== "allowed") {
      findings.push({ package: pkgName, license: licStr || "UNKNOWN", policy });
    }
  }

  const hasDenied = findings.some((f) => f.policy === "denied");
  return {
    nodeProject: true,
    unverified: false,
    passed: !hasDenied,
    findings,
    totalScanned,
  };
}

module.exports = { runLicenseCheck, classifyLicense, extractLicense, ALLOWED_EXACT, DENIED_EXACT, WARNED_EXACT };
