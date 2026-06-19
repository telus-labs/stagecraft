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

  // git ls-files -c --ignored --exclude-standard lists tracked (committed)
  // files that are now covered by .gitignore rules.  -c (--cached) is
  // required on git ≥ 2.27; without it the command exits 128 immediately.
  // An empty result is clean.
  const result = spawnSync(
    "git",
    ["ls-files", "-c", "--ignored", "--exclude-standard"],
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
// Detects two classes of Python import path misconfiguration:
//
//   B1. conftest.py with sys.path.insert(0, ".") — inserts project root,
//       not src/, causing try/except ImportError fallback patterns to silently
//       swallow the real import failure.
//
//   B2. pytest.ini (or pyproject.toml) pythonpath including a directory D
//       where D/<module>.py shadows D/<package>/<module>.py — `import module`
//       resolves to the stub instead of the canonical production module.
//
// Runs when a conftest.py, pytest.ini, or pyproject.toml is found.
// ---------------------------------------------------------------------------
function runImportPathCheck(cwd) {
  const blockers = [];
  const warnings = [];

  // Detect Python project
  const candidates = [];
  for (const dir of ["src/tests", "tests", "src"]) {
    const abs = path.join(cwd, dir, "conftest.py");
    if (fs.existsSync(abs)) candidates.push(abs);
  }
  const rootConf = path.join(cwd, "conftest.py");
  if (fs.existsSync(rootConf)) candidates.push(rootConf);

  const pytestIniPath = path.join(cwd, "pytest.ini");
  const pyprojectPath = path.join(cwd, "pyproject.toml");
  if (candidates.length === 0 && !fs.existsSync(pytestIniPath) && !fs.existsSync(pyprojectPath)) {
    return { pass: true, blockers, warnings };
  }

  // B1: sys.path.insert(0, ".") in conftest.py
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

      if (/sys\.path\.insert\s*\(\s*0\s*,\s*['"]\.['"]\s*\)/.test(line)) {
        blockers.push(
          `${rel}:${i + 1}: sys.path.insert(0, ".") inserts the project root, not src/ — ` +
          `'from backend.main import app' will raise ImportError and silently fall back to a reference implementation.\n` +
          `  Fix: change to sys.path.insert(0, "src") so imports resolve to production code.`
        );
      }

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

  // B2: pytest.ini pythonpath shadow imports
  let pythonpathDirs = [];
  if (fs.existsSync(pytestIniPath)) {
    try {
      const ini = fs.readFileSync(pytestIniPath, "utf8");
      const m = ini.match(/^\s*pythonpath\s*=\s*(.+)$/m);
      if (m) pythonpathDirs = m[1].trim().split(/\s+/).filter(Boolean);
    } catch { /* skip */ }
  }
  if (pythonpathDirs.length === 0 && fs.existsSync(pyprojectPath)) {
    try {
      const toml = fs.readFileSync(pyprojectPath, "utf8");
      const m = toml.match(/^\s*pythonpath\s*=\s*\[([^\]]+)\]/m);
      if (m) {
        pythonpathDirs = [...m[1].matchAll(/"([^"]+)"|'([^']+)'/g)]
          .map(e => e[1] || e[2]);
      }
    } catch { /* skip */ }
  }

  for (const dir of pythonpathDirs) {
    const absDir = path.join(cwd, dir);
    if (!fs.existsSync(absDir)) continue;
    let rootFiles, subdirs;
    try {
      const entries = fs.readdirSync(absDir, { withFileTypes: true });
      rootFiles = entries
        .filter(e => e.isFile() && e.name.endsWith(".py") &&
                     e.name !== "__init__.py" && e.name !== "conftest.py")
        .map(e => e.name.slice(0, -3));
      subdirs = entries
        .filter(e => e.isDirectory() && !["__pycache__", ".pytest_cache"].includes(e.name))
        .map(e => e.name);
    } catch { continue; }

    for (const mod of rootFiles) {
      for (const subdir of subdirs) {
        if (fs.existsSync(path.join(absDir, subdir, `${mod}.py`))) {
          blockers.push(
            `pytest.ini pythonpath = ${dir}: \`import ${mod}\` resolves to ` +
            `${dir}/${mod}.py (stub) instead of ${dir}/${subdir}/${mod}.py (canonical) — ` +
            `remove the stub or fix the pythonpath entry`
          );
          break;
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
// Check D — callerless file detection (warnings only, no blockers)
// ---------------------------------------------------------------------------
// Finds newly-added source files that have no callers in the project.
// A file with no callers is likely dead code (§2 Simplicity First principle).
// Emits WARNINGs only — false positives are common for infra entry-points
// that are invoked by shell scripts, Docker, or CI rather than imported.
// ---------------------------------------------------------------------------
function runCallerlessFileCheck(cwd) {
  const warnings = [];

  // Use `git show HEAD` to inspect the most recently committed changes.
  // Build agents commit their work before preflight runs, so `git diff HEAD`
  // (working-tree diff) would return nothing — the changes are already committed.
  const r = spawnSync(
    "git", ["show", "--name-only", "--diff-filter=A", "--format=", "HEAD"],
    { cwd, encoding: "utf8", timeout: 10_000 }
  );
  if (r.status !== 0 || r.error) {
    return { pass: true, warnings };
  }

  const newFiles = (r.stdout || "").split("\n").map(l => l.trim()).filter(Boolean);

  // Entry-point patterns — legitimately have no importers in-tree
  const ENTRY_POINTS = /(__main__|manage|wsgi|asgi|conftest|setup|entrypoint)\.(py|js|ts|jsx|tsx)$/;
  const SUPPORTED_EXTS = new Set(["py", "js", "ts", "jsx", "tsx"]);

  for (const file of newFiles) {
    if (ENTRY_POINTS.test(file)) continue;
    const ext = path.extname(file).slice(1);
    if (!SUPPORTED_EXTS.has(ext)) continue;

    const moduleBase = path.basename(file, `.${ext}`)
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // escape regex special chars

    const pattern = ext === "py"
      ? `(from [a-z_.]*${moduleBase} import|import [a-z_.]*${moduleBase})`
      : `(require|from).*['"].*${moduleBase}['"]`;

    const g = spawnSync(
      "grep", ["-r", `--include=*.${ext}`, "-l", "-E", pattern, "."],
      { cwd, encoding: "utf8", timeout: 10_000 }
    );
    const callers = (g.stdout || "").split("\n")
      .map(l => l.replace(/^\.\//, "").trim())
      .filter(f => f && f !== file);

    if (callers.length === 0) {
      warnings.push(
        `${file}: no callers found — may be dead code (§2 Simplicity First); ` +
        `verify it is imported or invoked somewhere, or delete it`
      );
    }
  }

  return { pass: true, warnings };
}

// ---------------------------------------------------------------------------
// Check E — ADR compliance (blockers)
// ---------------------------------------------------------------------------
// Reads pipeline/adr/*.md files for <!-- @prohibit: <regex> --> annotations
// and greps the git diff for each prohibited pattern.
// A match is a BLOCKER — the ADR author explicitly banned this construct.
//
// To suppress a false positive, add a documented exception to
// pipeline/context.md and remove or narrow the @prohibit annotation.
// ---------------------------------------------------------------------------
function runADRComplianceCheck(cwd) {
  const adrDir = path.join(cwd, "pipeline", "adr");
  if (!fs.existsSync(adrDir)) return { pass: true, blockers: [], warnings: [] };

  let adrFiles;
  try {
    adrFiles = fs.readdirSync(adrDir).filter(f => f.endsWith(".md"));
  } catch {
    return { pass: true, blockers: [], warnings: [] };
  }

  const prohibitions = [];
  for (const f of adrFiles) {
    let src;
    try { src = fs.readFileSync(path.join(adrDir, f), "utf8"); } catch { continue; }
    for (const m of src.matchAll(/<!--\s*@prohibit:\s*(.+?)\s*-->/g)) {
      prohibitions.push({ pattern: m[1].trim(), source: f });
    }
  }
  if (prohibitions.length === 0) return { pass: true, blockers: [], warnings: [] };

  // Use `git show HEAD` to inspect the most recently committed changes.
  // Build agents commit their work before preflight runs, so `git diff HEAD`
  // (working-tree diff) would return nothing.
  const diffResult = spawnSync(
    "git", ["show", "HEAD", "--unified=0"],
    { cwd, encoding: "utf8", timeout: 15_000 }
  );
  if (diffResult.status !== 0 || diffResult.error) {
    return {
      pass: true,
      blockers: [],
      warnings: ["ADR compliance check skipped — git show HEAD failed"],
    };
  }

  const addedLines = (diffResult.stdout || "")
    .split("\n")
    .filter(l => l.startsWith("+") && !l.startsWith("+++"));

  const blockers = [];
  for (const { pattern, source } of prohibitions) {
    let re;
    try { re = new RegExp(pattern); } catch {
      // Malformed regex in ADR — skip rather than crash
      continue;
    }
    const hit = addedLines.find(l => re.test(l));
    if (hit) {
      blockers.push(
        `ADR ${source} prohibits "${pattern}" — found in diff: ` +
        `"${hit.trim().slice(0, 80)}". ` +
        `Add a documented exception to pipeline/context.md if intentional.`
      );
    }
  }

  return { pass: blockers.length === 0, blockers, warnings: [] };
}

// ---------------------------------------------------------------------------
// Check F — staged pipeline artifacts
// ---------------------------------------------------------------------------
// Blocks a PR if any pipeline artifact files appear in the git index.
// Applies to all projects (not just dogfood mode) — staging these files into
// a peer-review PR is always a mistake.
// ---------------------------------------------------------------------------
function checkStagedPipelineArtifacts(cwd) {
  const result = spawnSync("git", ["diff", "--cached", "--name-only"], { cwd, encoding: "utf8" });
  if (result.status !== 0) return []; // not a git repo or no index — skip silently
  const staged = (result.stdout || "").split("\n").filter(Boolean);
  const ARTIFACT_PREFIXES = [
    "pipeline/brief.md",
    "pipeline/context.md",
    "pipeline/spec.feature",
    "pipeline/runbook.md",
    "pipeline/test-report.md",
    "pipeline/deploy-log.md",
    "pipeline/code-review/",
    "pipeline/gates/",
    "pipeline/changes/",
    "pipeline/run-state.json",
    "pipeline/run-log.jsonl",
    "pipeline/run.lock",
    "pipeline/logs/",
    "pipeline/dispatches/",
    "pipeline/memory/",
  ];
  return staged.filter((f) =>
    ARTIFACT_PREFIXES.some((p) => p.endsWith("/") ? f.startsWith(p) : f === p)
  );
}

// ---------------------------------------------------------------------------
// runPreflight — orchestrator
// ---------------------------------------------------------------------------
function runPreflight(cwd, opts = {}) {
  const gatesDirPath = opts.gatesDir || getGatesDir(cwd, opts.changeId || null);

  const hygiene      = runGitHygieneCheck(cwd);
  const importPath   = runImportPathCheck(cwd);
  const deferred     = runDeferredItemsRisk(gatesDirPath);
  const callerless   = runCallerlessFileCheck(cwd);
  const adrCompliance = runADRComplianceCheck(cwd);

  const stagedArtifacts = checkStagedPipelineArtifacts(cwd);
  const stagedBlockers  = stagedArtifacts.length > 0
    ? [
        `Pipeline artifacts are staged for commit — these must not appear in a PR: ` +
        stagedArtifacts.slice(0, 5).join(", ") +
        (stagedArtifacts.length > 5 ? ` (+${stagedArtifacts.length - 5} more)` : "") +
        `. Run 'git restore --staged <files>' to unstage.`,
      ]
    : [];

  const allBlockers = [
    ...hygiene.blockers,
    ...importPath.blockers,
    ...stagedBlockers,
    ...adrCompliance.blockers,
  ];
  const allWarnings = [
    ...hygiene.warnings,
    ...importPath.warnings,
    ...deferred.warnings,
    ...callerless.warnings,
    ...adrCompliance.warnings,
  ];
  const status = allBlockers.length > 0 ? "FAIL" : "PASS";

  const gate = {
    stage:                   "stage-04e",
    status,
    orchestrator:            "devteam@preflight",
    track:                   opts.track || "unknown",
    timestamp:               new Date().toISOString(),
    blockers:                allBlockers,
    warnings:                allWarnings,
    git_hygiene_pass:        hygiene.pass,
    import_path_pass:        importPath.pass,
    deferred_items_count:    deferred.deferredCount,
    callerless_file_check_pass: callerless.pass,
    adr_compliance_pass:     adrCompliance.pass,
  };

  if (!opts.skipWrite) {
    fs.mkdirSync(gatesDirPath, { recursive: true });
    const outFile = path.join(gatesDirPath, "stage-04e.json");
    fs.writeFileSync(outFile, JSON.stringify(gate, null, 2) + "\n", "utf8");
  }

  return { status, blockers: allBlockers, warnings: allWarnings, gate };
}

module.exports = {
  runPreflight,
  runGitHygieneCheck,
  runImportPathCheck,
  runDeferredItemsRisk,
  runCallerlessFileCheck,
  runADRComplianceCheck,
  checkStagedPipelineArtifacts,
};
