// core/preflight.js
//
// Mechanical pre-peer-review checks (stage-04e).  No LLM invocation.
// Three checks are run in sequence; each returns findings which are
// aggregated into a gate file written at pipeline/gates/stage-04e.json.
//
// Public API:
//   runPreflight(cwd, opts?) → { status, blockers, warnings, gate }
//
// opts:
//   gatesDir  — override the default pipeline/gates path
//   changeId  — for bounded-workspace pipelines
//   skipWrite — skip writing the gate file (useful for tests)

"use strict";

const fs   = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { gatesDir: getGatesDir } = require("./paths");

// ---------------------------------------------------------------------------
// Check A — git hygiene
// ---------------------------------------------------------------------------
// Finds tracked (committed) files that are now ignored by .gitignore.
// A common failure mode: developer adds *.pyc to .gitignore after the fact
// but never removes the already-committed files.
//
// Uses: git ls-files --ignored --exclude-standard
// An exit code != 0 from git is treated as a warning, not a blocker.
// ---------------------------------------------------------------------------
function runGitHygieneCheck(cwd) {
  const blockers = [];
  const warnings = [];

  // git ls-files --ignored --exclude-standard lists tracked files that
  // are now covered by .gitignore rules.  An empty result is clean.
  const result = spawnSync(
    "git",
    ["ls-files", "--ignored", "--exclude-standard"],
    { cwd, encoding: "utf8", timeout: 15_000 }
  );

  if (result.status !== 0 || result.error) {
    warnings.push(
      "git-hygiene check could not run (git not available or not a git repo) — skipped"
    );
    return { pass: true, blockers, warnings };
  }

  const committedIgnored = (result.stdout || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (committedIgnored.length > 0) {
    const examples = committedIgnored.slice(0, 5).map((f) => `  ${f}`).join("\n");
    const tail = committedIgnored.length > 5 ? `\n  … and ${committedIgnored.length - 5} more` : "";
    blockers.push(
      `${committedIgnored.length} committed file(s) are now ignored by .gitignore — ` +
      `remove with 'git rm --cached' before peer-review:\n${examples}${tail}\n` +
      `  Fix: git rm --cached ${committedIgnored.slice(0, 3).join(" ")} && git commit -m "chore: remove committed ignored files"`
    );
  }

  return { pass: blockers.length === 0, blockers, warnings };
}

// ---------------------------------------------------------------------------
// Check B — import path verification (Python projects)
// ---------------------------------------------------------------------------
// Detects conftest.py files with sys.path.insert(0, ".") which causes
// try/except ImportError fallback patterns to silently swallow the real
// import failure and test the inline reference implementation instead of
// the production code path.
//
// Only runs when at least one conftest.py is found in the project.
// ---------------------------------------------------------------------------
function runImportPathCheck(cwd) {
  const blockers = [];
  const warnings = [];

  // Find conftest.py files under src/tests/ or tests/ (common layouts)
  const candidates = [];
  for (const dir of ["src/tests", "tests", "src"]) {
    const abs = path.join(cwd, dir, "conftest.py");
    if (fs.existsSync(abs)) candidates.push(abs);
  }
  // Also check project root
  const rootConf = path.join(cwd, "conftest.py");
  if (fs.existsSync(rootConf)) candidates.push(rootConf);

  if (candidates.length === 0) {
    // Not a Python project (no conftest.py) — skip silently
    return { pass: true, blockers, warnings };
  }

  for (const conftest of candidates) {
    const rel = path.relative(cwd, conftest);
    let src;
    try {
      src = fs.readFileSync(conftest, "utf8");
    } catch {
      warnings.push(`Could not read ${rel} — import-path check skipped for this file`);
      continue;
    }

    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Detect sys.path.insert(0, ".") — inserts project root, not src/
      // which means `from backend.main import app` will resolve to nothing
      // and the except clause will silently fall back to a reference impl.
      if (/sys\.path\.insert\s*\(\s*0\s*,\s*['"]\.['"]\s*\)/.test(line)) {
        blockers.push(
          `${rel}:${i + 1}: sys.path.insert(0, ".") inserts the project root, not src/ — ` +
          `'from backend.main import app' will raise ImportError and silently fall back to a reference implementation.\n` +
          `  Fix: change to sys.path.insert(0, "src") so imports resolve to production code.`
        );
      }

      // Detect broad except (ImportError, ModuleNotFoundError) without re-raise
      // that would hide the path misconfiguration from tests.
      if (
        /except\s*\(\s*ImportError/.test(line) ||
        /except\s+ImportError/.test(line)
      ) {
        const surroundingCtx = lines.slice(Math.max(0, i - 3), i + 5).join("\n");
        if (/sys\.path\.insert/.test(surroundingCtx)) {
          warnings.push(
            `${rel}:${i + 1}: try/except ImportError near sys.path.insert — ` +
            `if the import fails, tests will silently run against the fallback implementation, not the real backend. ` +
            `Verify the sys.path value is correct.`
          );
        }
      }
    }
  }

  return { pass: blockers.length === 0, blockers, warnings };
}

// ---------------------------------------------------------------------------
// Check C — deferred items risk scan (informational, no blocker)
// ---------------------------------------------------------------------------
// Reads stage-04c.json noted_for_followup[] and emits a warning so the
// operator knows to expect these items to come up in peer-review.
// ---------------------------------------------------------------------------
function runDeferredItemsRisk(gatesDirPath) {
  const blockers = [];
  const warnings = [];

  const redTeamPath = path.join(gatesDirPath, "stage-04c.json");
  if (!fs.existsSync(redTeamPath)) {
    return { pass: true, blockers, warnings, deferredCount: 0 };
  }

  let gate;
  try {
    gate = JSON.parse(fs.readFileSync(redTeamPath, "utf8"));
  } catch {
    warnings.push("Could not read stage-04c.json — deferred-items risk check skipped");
    return { pass: true, blockers, warnings, deferredCount: 0 };
  }

  const ntu = Array.isArray(gate.noted_for_followup) ? gate.noted_for_followup : [];
  if (ntu.length > 0) {
    const ids = ntu.map((i) => i.id || "?").join(", ");
    warnings.push(
      `${ntu.length} red-team item(s) were noted_for_followup at stage-04c (${ids}). ` +
      `Peer reviewers often flag these as blockers. Inspect stage-04c.json and address ` +
      `them before dispatching reviewers, or accept that they will appear in CHANGES REQUESTED.`
    );
  }

  return { pass: true, blockers, warnings, deferredCount: ntu.length };
}

// ---------------------------------------------------------------------------
// runPreflight — orchestrator
// ---------------------------------------------------------------------------
function runPreflight(cwd, opts = {}) {
  const gatesDirPath = opts.gatesDir || getGatesDir(cwd, opts.changeId || null);

  const hygiene     = runGitHygieneCheck(cwd);
  const importPath  = runImportPathCheck(cwd);
  const deferred    = runDeferredItemsRisk(gatesDirPath);

  const allBlockers = [...hygiene.blockers, ...importPath.blockers];
  const allWarnings = [...hygiene.warnings, ...importPath.warnings, ...deferred.warnings];
  const status      = allBlockers.length > 0 ? "FAIL" : "PASS";

  const gate = {
    stage:              "stage-04e",
    status,
    orchestrator:       "devteam@preflight",
    track:              opts.track || "unknown",
    timestamp:          new Date().toISOString(),
    blockers:           allBlockers,
    warnings:           allWarnings,
    git_hygiene_pass:   hygiene.pass,
    import_path_pass:   importPath.pass,
    deferred_items_count: deferred.deferredCount,
  };

  if (!opts.skipWrite) {
    fs.mkdirSync(gatesDirPath, { recursive: true });
    const outFile = path.join(gatesDirPath, "stage-04e.json");
    fs.writeFileSync(outFile, JSON.stringify(gate, null, 2) + "\n", "utf8");
  }

  return { status, blockers: allBlockers, warnings: allWarnings, gate };
}

module.exports = { runPreflight, runGitHygieneCheck, runImportPathCheck, runDeferredItemsRisk };
