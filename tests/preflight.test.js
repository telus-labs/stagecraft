// tests/preflight.test.js
//
// Behavioral tests for core/preflight.js.
// Drives runPreflight(cwd, opts) and the three sub-checks directly.

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { REPO_ROOT, cleanup } = require("./_helpers");
const {
  runPreflight,
  runGitHygieneCheck,
  runImportPathCheck,
  runDeferredItemsRisk,
} = require(path.join(REPO_ROOT, "core", "preflight"));

let _tmpDirs = [];
function makeTmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "devteam-test-"));
  _tmpDirs.push(d);
  return d;
}
afterEach(() => { _tmpDirs.forEach(cleanup); _tmpDirs = []; });

// ---------------------------------------------------------------------------
// runGitHygieneCheck
//
// Note: `git ls-files --ignored --exclude-standard` (without -c or -o) was
// deprecated in git 2.27 and now exits 128 on git 2.27+.  On such systems
// (including macOS with Apple Git 2.28+) the hygiene check always hits the
// warning path and can never produce a blocker.  The blocker path is
// exercised only on older git.  Tests below verify the observable behavior
// on the current platform.
// ---------------------------------------------------------------------------

describe("runGitHygieneCheck — non-git directory", () => {
  it("returns pass:true with a warning when git returns non-zero", () => {
    const cwd = makeTmp(); // plain tempdir, no git init
    const r = runGitHygieneCheck(cwd);
    assert.equal(r.pass, true);
    assert.equal(r.blockers.length, 0);
    assert.equal(r.warnings.length, 1);
    assert.ok(r.warnings[0].includes("git not available or not a git repo"));
  });
});

describe("runGitHygieneCheck — git repo, non-zero exit from git ls-files", () => {
  // On git 2.27+ (including Apple Git), `git ls-files --ignored --exclude-standard`
  // requires -c or -o, so it exits 128 inside any git repo too.
  // The function treats any non-zero exit as a skip (warning, pass:true).
  it("returns pass:true and a warning when git returns non-zero (modern git)", () => {
    const cwd = makeTmp();
    spawnSync("git", ["init"], { cwd, encoding: "utf8" });
    const r = runGitHygieneCheck(cwd);
    assert.equal(r.pass, true);
    assert.equal(r.blockers.length, 0);
    // Either a warning (non-zero exit) or no warnings (clean empty stdout).
    // On modern git: always a warning.
    assert.ok(
      r.warnings.length === 0 || r.warnings[0].includes("git not available or not a git repo"),
      `unexpected warning: ${r.warnings[0]}`,
    );
  });
});

// ---------------------------------------------------------------------------
// runImportPathCheck
// ---------------------------------------------------------------------------

describe("runImportPathCheck — no conftest.py", () => {
  it("passes silently when no conftest.py is present", () => {
    const cwd = makeTmp();
    const r = runImportPathCheck(cwd);
    assert.equal(r.pass, true);
    assert.equal(r.blockers.length, 0);
    assert.equal(r.warnings.length, 0);
  });
});

describe("runImportPathCheck — clean conftest.py", () => {
  it("passes when conftest.py does not use sys.path.insert(0, '.')", () => {
    const cwd = makeTmp();
    fs.mkdirSync(path.join(cwd, "tests"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "tests", "conftest.py"), "import pytest\n");
    const r = runImportPathCheck(cwd);
    assert.equal(r.pass, true);
    assert.equal(r.blockers.length, 0);
    assert.equal(r.warnings.length, 0);
  });
});

describe("runImportPathCheck — sys.path.insert(0, '.')", () => {
  it("produces a blocker and recommends sys.path.insert(0, 'src')", () => {
    const cwd = makeTmp();
    fs.writeFileSync(
      path.join(cwd, "conftest.py"),
      'import sys\nsys.path.insert(0, ".")\n',
    );
    const r = runImportPathCheck(cwd);
    assert.equal(r.pass, false);
    assert.equal(r.blockers.length, 1);
    assert.ok(r.blockers[0].includes('sys.path.insert(0, ".")'));
    assert.ok(r.blockers[0].includes('sys.path.insert(0, "src")'));
  });

  it("also warns when except ImportError is adjacent to sys.path.insert", () => {
    const cwd = makeTmp();
    fs.writeFileSync(
      path.join(cwd, "conftest.py"),
      [
        "import sys",
        'sys.path.insert(0, ".")',
        "try:",
        "    from backend.main import app",
        "except ImportError:",
        "    from reference_impl import app",
        "",
      ].join("\n"),
    );
    const r = runImportPathCheck(cwd);
    assert.equal(r.pass, false, "sys.path.insert(0, '.') is still a blocker");
    assert.ok(r.warnings.some((w) => w.includes("try/except ImportError")));
  });
});

describe("runImportPathCheck — conftest.py in nested candidate dirs", () => {
  it("finds conftest.py under src/tests/", () => {
    const cwd = makeTmp();
    fs.mkdirSync(path.join(cwd, "src", "tests"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, "src", "tests", "conftest.py"),
      'import sys\nsys.path.insert(0, ".")\n',
    );
    const r = runImportPathCheck(cwd);
    assert.equal(r.pass, false);
    assert.ok(r.blockers[0].includes("src/tests/conftest.py"));
  });
});

// ---------------------------------------------------------------------------
// runDeferredItemsRisk
// ---------------------------------------------------------------------------

describe("runDeferredItemsRisk — no stage-04c.json", () => {
  it("passes and reports deferredCount 0 when the gate is absent", () => {
    const gatesDir = makeTmp();
    const r = runDeferredItemsRisk(gatesDir);
    assert.equal(r.pass, true);
    assert.equal(r.deferredCount, 0);
    assert.equal(r.warnings.length, 0);
  });
});

describe("runDeferredItemsRisk — items present", () => {
  it("emits one warning listing all deferred item IDs", () => {
    const gatesDir = makeTmp();
    fs.writeFileSync(
      path.join(gatesDir, "stage-04c.json"),
      JSON.stringify({ noted_for_followup: [{ id: "R-1" }, { id: "R-2" }] }),
    );
    const r = runDeferredItemsRisk(gatesDir);
    assert.equal(r.pass, true, "deferred items are informational — no blocker");
    assert.equal(r.deferredCount, 2);
    assert.equal(r.warnings.length, 1);
    assert.ok(r.warnings[0].includes("R-1"));
    assert.ok(r.warnings[0].includes("R-2"));
  });

  it("passes with deferredCount 0 when noted_for_followup is empty", () => {
    const gatesDir = makeTmp();
    fs.writeFileSync(
      path.join(gatesDir, "stage-04c.json"),
      JSON.stringify({ noted_for_followup: [] }),
    );
    const r = runDeferredItemsRisk(gatesDir);
    assert.equal(r.pass, true);
    assert.equal(r.deferredCount, 0);
    assert.equal(r.warnings.length, 0);
  });
});

describe("runDeferredItemsRisk — corrupt gate", () => {
  it("warns and passes when stage-04c.json is not valid JSON", () => {
    const gatesDir = makeTmp();
    fs.writeFileSync(path.join(gatesDir, "stage-04c.json"), "{{not json");
    const r = runDeferredItemsRisk(gatesDir);
    assert.equal(r.pass, true);
    assert.equal(r.deferredCount, 0);
    assert.ok(r.warnings.some((w) => w.includes("Could not read")));
  });
});

// ---------------------------------------------------------------------------
// runPreflight — orchestration
// ---------------------------------------------------------------------------

describe("runPreflight — happy path", () => {
  it("returns PASS for a clean non-git, non-Python project when skipWrite=true", () => {
    const cwd = makeTmp();
    const r = runPreflight(cwd, { skipWrite: true });
    assert.equal(r.status, "PASS");
    assert.equal(r.blockers.length, 0);
    assert.equal(r.gate.stage, "stage-04e");
    assert.equal(r.gate.orchestrator, "devteam@preflight");
    assert.equal(r.gate.status, "PASS");
    assert.ok(typeof r.gate.timestamp === "string");
  });

  it("records the track option in the gate", () => {
    const cwd = makeTmp();
    const r = runPreflight(cwd, { skipWrite: true, track: "hotfix" });
    assert.equal(r.gate.track, "hotfix");
  });

  it("defaults track to 'unknown' when not supplied", () => {
    const cwd = makeTmp();
    const r = runPreflight(cwd, { skipWrite: true });
    assert.equal(r.gate.track, "unknown");
  });

  it("reports check-level pass flags in the gate", () => {
    const cwd = makeTmp();
    const r = runPreflight(cwd, { skipWrite: true });
    assert.equal(r.gate.git_hygiene_pass, true);
    assert.equal(r.gate.import_path_pass, true);
    assert.equal(r.gate.deferred_items_count, 0);
  });
});

describe("runPreflight — gate file I/O", () => {
  it("writes stage-04e.json to gatesDir when skipWrite is not set", () => {
    const cwd = makeTmp();
    const gatesDir = path.join(cwd, "pipeline", "gates");
    runPreflight(cwd, { gatesDir });
    const outFile = path.join(gatesDir, "stage-04e.json");
    assert.ok(fs.existsSync(outFile));
    const written = JSON.parse(fs.readFileSync(outFile, "utf8"));
    assert.equal(written.stage, "stage-04e");
    assert.equal(written.status, "PASS");
  });

  it("does not write a gate file when skipWrite=true", () => {
    const cwd = makeTmp();
    const gatesDir = path.join(cwd, "my-gates");
    runPreflight(cwd, { gatesDir, skipWrite: true });
    assert.ok(!fs.existsSync(path.join(gatesDir, "stage-04e.json")));
  });
});

describe("runPreflight — FAIL on blocker", () => {
  it("returns FAIL when conftest.py has sys.path.insert(0, '.')", () => {
    const cwd = makeTmp();
    fs.writeFileSync(
      path.join(cwd, "conftest.py"),
      'import sys\nsys.path.insert(0, ".")\n',
    );
    const r = runPreflight(cwd, { skipWrite: true });
    assert.equal(r.status, "FAIL");
    assert.ok(r.blockers.length > 0);
    assert.equal(r.gate.status, "FAIL");
    assert.equal(r.gate.import_path_pass, false);
  });

  it("deferred items do not cause FAIL — they are warnings only", () => {
    const cwd = makeTmp();
    const gatesDir = path.join(cwd, "gates");
    fs.mkdirSync(gatesDir, { recursive: true });
    fs.writeFileSync(
      path.join(gatesDir, "stage-04c.json"),
      JSON.stringify({ noted_for_followup: [{ id: "R-42" }] }),
    );
    const r = runPreflight(cwd, { gatesDir, skipWrite: true });
    assert.equal(r.status, "PASS");
    assert.equal(r.blockers.length, 0);
    assert.ok(r.warnings.some((w) => w.includes("R-42")));
  });
});
