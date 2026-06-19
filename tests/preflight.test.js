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
  runCallerlessFileCheck,
  runADRComplianceCheck,
  checkStagedPipelineArtifacts,
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

describe("runGitHygieneCheck — clean git repo (no committed+ignored files)", () => {
  it("returns pass:true with no blockers and no warnings for a clean repo", () => {
    const cwd = makeTmp();
    spawnSync("git", ["init"], { cwd, encoding: "utf8" });
    spawnSync("git", ["config", "user.email", "test@example.com"], { cwd });
    spawnSync("git", ["config", "user.name", "Test"], { cwd });
    // Commit a clean file
    fs.writeFileSync(path.join(cwd, "readme.txt"), "hello\n");
    spawnSync("git", ["add", "."], { cwd, encoding: "utf8" });
    spawnSync("git", ["commit", "--no-gpg-sign", "-m", "init"], { cwd, encoding: "utf8" });
    const r = runGitHygieneCheck(cwd);
    assert.equal(r.pass, true);
    assert.equal(r.blockers.length, 0);
    assert.equal(r.warnings.length, 0);
  });
});

describe("runGitHygieneCheck — committed file later ignored → blocker fires", () => {
  it("produces a blocker listing the committed+ignored file", () => {
    const cwd = makeTmp();
    spawnSync("git", ["init"], { cwd, encoding: "utf8" });
    spawnSync("git", ["config", "user.email", "test@example.com"], { cwd });
    spawnSync("git", ["config", "user.name", "Test"], { cwd });

    // Commit a file that we will later add to .gitignore
    fs.writeFileSync(path.join(cwd, "build.out"), "compiled output\n");
    spawnSync("git", ["add", "build.out"], { cwd, encoding: "utf8" });
    spawnSync("git", ["commit", "--no-gpg-sign", "-m", "add build output"], { cwd, encoding: "utf8" });

    // Now add .gitignore that covers build.out
    fs.writeFileSync(path.join(cwd, ".gitignore"), "*.out\n");
    spawnSync("git", ["add", ".gitignore"], { cwd, encoding: "utf8" });
    spawnSync("git", ["commit", "--no-gpg-sign", "-m", "add gitignore"], { cwd, encoding: "utf8" });

    // build.out is now committed but ignored — the hygiene check must catch it.
    const r = runGitHygieneCheck(cwd);
    assert.equal(r.pass, false, "committed+ignored file should produce a blocker");
    assert.equal(r.blockers.length, 1);
    assert.ok(r.blockers[0].includes("build.out"), `expected 'build.out' in blocker: ${r.blockers[0]}`);
    assert.ok(r.blockers[0].includes("git rm --cached"), "blocker should suggest git rm --cached");
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

// ---------------------------------------------------------------------------
// checkStagedPipelineArtifacts
// ---------------------------------------------------------------------------

describe("checkStagedPipelineArtifacts — non-git directory", () => {
  it("returns [] when the directory is not a git repo", () => {
    const cwd = makeTmp();
    const result = checkStagedPipelineArtifacts(cwd);
    assert.deepEqual(result, []);
  });
});

describe("checkStagedPipelineArtifacts — pipeline/brief.md staged", () => {
  it("returns the staged artifact path as a match", () => {
    const cwd = makeTmp();
    spawnSync("git", ["init"], { cwd, encoding: "utf8" });
    spawnSync("git", ["config", "user.email", "test@example.com"], { cwd });
    spawnSync("git", ["config", "user.name", "Test"], { cwd });
    fs.mkdirSync(path.join(cwd, "pipeline"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "pipeline", "brief.md"), "brief content\n");
    spawnSync("git", ["add", "pipeline/brief.md"], { cwd, encoding: "utf8" });

    const result = checkStagedPipelineArtifacts(cwd);
    assert.ok(result.includes("pipeline/brief.md"), `expected pipeline/brief.md in result: ${JSON.stringify(result)}`);
  });
});

describe("checkStagedPipelineArtifacts — only non-pipeline files staged", () => {
  it("returns [] when only non-pipeline files are in the index", () => {
    const cwd = makeTmp();
    spawnSync("git", ["init"], { cwd, encoding: "utf8" });
    spawnSync("git", ["config", "user.email", "test@example.com"], { cwd });
    spawnSync("git", ["config", "user.name", "Test"], { cwd });
    fs.writeFileSync(path.join(cwd, "README.md"), "hello\n");
    spawnSync("git", ["add", "README.md"], { cwd, encoding: "utf8" });

    const result = checkStagedPipelineArtifacts(cwd);
    assert.deepEqual(result, []);
  });
});

describe("checkStagedPipelineArtifacts — pipeline/gates/ file staged", () => {
  it("matches files under pipeline/gates/ prefix", () => {
    const cwd = makeTmp();
    spawnSync("git", ["init"], { cwd, encoding: "utf8" });
    spawnSync("git", ["config", "user.email", "test@example.com"], { cwd });
    spawnSync("git", ["config", "user.name", "Test"], { cwd });
    fs.mkdirSync(path.join(cwd, "pipeline", "gates"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "pipeline", "gates", "stage-01.json"), "{}\n");
    spawnSync("git", ["add", "pipeline/gates/stage-01.json"], { cwd, encoding: "utf8" });

    const result = checkStagedPipelineArtifacts(cwd);
    assert.ok(result.includes("pipeline/gates/stage-01.json"), `expected gate file in result: ${JSON.stringify(result)}`);
  });
});

describe("runPreflight — FAIL on staged pipeline artifacts", () => {
  it("returns FAIL with a blocker when pipeline/brief.md is staged", () => {
    const cwd = makeTmp();
    spawnSync("git", ["init"], { cwd, encoding: "utf8" });
    spawnSync("git", ["config", "user.email", "test@example.com"], { cwd });
    spawnSync("git", ["config", "user.name", "Test"], { cwd });
    fs.mkdirSync(path.join(cwd, "pipeline"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "pipeline", "brief.md"), "brief content\n");
    spawnSync("git", ["add", "pipeline/brief.md"], { cwd, encoding: "utf8" });

    const r = runPreflight(cwd, { skipWrite: true });
    assert.equal(r.status, "FAIL");
    assert.ok(r.blockers.length > 0);
    assert.ok(
      r.blockers.some((b) => b.includes("Pipeline artifacts are staged")),
      `expected staged-artifact blocker: ${JSON.stringify(r.blockers)}`
    );
    assert.ok(
      r.blockers.some((b) => b.includes("pipeline/brief.md")),
      `expected file name in blocker: ${JSON.stringify(r.blockers)}`
    );
    assert.ok(
      r.blockers.some((b) => b.includes("git restore --staged")),
      `expected remediation hint in blocker: ${JSON.stringify(r.blockers)}`
    );
  });

  it("returns PASS when only non-pipeline files are staged", () => {
    const cwd = makeTmp();
    spawnSync("git", ["init"], { cwd, encoding: "utf8" });
    spawnSync("git", ["config", "user.email", "test@example.com"], { cwd });
    spawnSync("git", ["config", "user.name", "Test"], { cwd });
    fs.writeFileSync(path.join(cwd, "src.js"), "// code\n");
    spawnSync("git", ["add", "src.js"], { cwd, encoding: "utf8" });

    const r = runPreflight(cwd, { skipWrite: true });
    assert.equal(r.status, "PASS");
    assert.ok(
      r.blockers.every((b) => !b.includes("Pipeline artifacts are staged")),
      `unexpected staged-artifact blocker: ${JSON.stringify(r.blockers)}`
    );
  });
});

// ---------------------------------------------------------------------------
// runImportPathCheck — pytest.ini pythonpath shadow imports (B2)
// ---------------------------------------------------------------------------

describe("runImportPathCheck — pytest.ini pythonpath shadow import", () => {
  it("produces a blocker when a root-level stub shadows a package module", () => {
    const cwd = makeTmp();
    // pytest.ini with pythonpath = src
    fs.writeFileSync(path.join(cwd, "pytest.ini"), "[pytest]\npythonpath = src\n");
    // src/worker.py (stub) shadows src/backend/worker.py (canonical)
    fs.mkdirSync(path.join(cwd, "src", "backend"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "src", "worker.py"), "# stub\n");
    fs.writeFileSync(path.join(cwd, "src", "backend", "worker.py"), "# canonical\n");
    const r = runImportPathCheck(cwd);
    assert.equal(r.pass, false, "shadow import should produce a blocker");
    assert.ok(r.blockers.some(b => b.includes("worker")), `expected 'worker' in blocker: ${JSON.stringify(r.blockers)}`);
    assert.ok(r.blockers.some(b => b.includes("stub")), `expected 'stub' in blocker: ${JSON.stringify(r.blockers)}`);
  });

  it("passes when no root-level module shadows a package module", () => {
    const cwd = makeTmp();
    fs.writeFileSync(path.join(cwd, "pytest.ini"), "[pytest]\npythonpath = src\n");
    fs.mkdirSync(path.join(cwd, "src", "backend"), { recursive: true });
    // Only src/backend/worker.py — no root-level shadow
    fs.writeFileSync(path.join(cwd, "src", "backend", "worker.py"), "# canonical\n");
    const r = runImportPathCheck(cwd);
    assert.equal(r.pass, true);
    assert.equal(r.blockers.length, 0);
  });

  it("skips silently when no Python project files are present", () => {
    const cwd = makeTmp();
    const r = runImportPathCheck(cwd);
    assert.equal(r.pass, true);
    assert.equal(r.blockers.length, 0);
    assert.equal(r.warnings.length, 0);
  });
});

// ---------------------------------------------------------------------------
// runCallerlessFileCheck
// ---------------------------------------------------------------------------

function makeGitRepo(cwd) {
  spawnSync("git", ["init"], { cwd, encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd });
  spawnSync("git", ["config", "user.name", "Test"], { cwd });
}

describe("runCallerlessFileCheck — non-git directory", () => {
  it("returns pass:true with no warnings when git returns non-zero", () => {
    const cwd = makeTmp();
    const r = runCallerlessFileCheck(cwd);
    assert.equal(r.pass, true);
    assert.equal(r.warnings.length, 0);
  });
});

describe("runCallerlessFileCheck — new file with no callers", () => {
  it("emits a warning for a .py file with no callers", () => {
    const cwd = makeTmp();
    makeGitRepo(cwd);
    // Initial commit with a placeholder so HEAD exists
    fs.writeFileSync(path.join(cwd, "README.md"), "hello\n");
    spawnSync("git", ["add", "README.md"], { cwd, encoding: "utf8" });
    spawnSync("git", ["commit", "--no-gpg-sign", "-m", "init"], { cwd, encoding: "utf8" });
    // Add a new .py file with no callers (nothing imports 'orphan')
    fs.writeFileSync(path.join(cwd, "orphan.py"), "def unused(): pass\n");
    spawnSync("git", ["add", "orphan.py"], { cwd, encoding: "utf8" });
    spawnSync("git", ["commit", "--no-gpg-sign", "-m", "add orphan"], { cwd, encoding: "utf8" });
    const r = runCallerlessFileCheck(cwd);
    assert.equal(r.pass, true, "callerless check is WARNING only — pass must always be true");
    assert.ok(r.warnings.some(w => w.includes("orphan.py")), `expected orphan.py in warnings: ${JSON.stringify(r.warnings)}`);
    assert.ok(r.warnings.some(w => w.includes("dead code")), `expected 'dead code' hint: ${JSON.stringify(r.warnings)}`);
  });
});

describe("runCallerlessFileCheck — new file with a caller", () => {
  it("emits no warning when the new module is imported by another file", () => {
    const cwd = makeTmp();
    makeGitRepo(cwd);
    fs.writeFileSync(path.join(cwd, "README.md"), "hello\n");
    spawnSync("git", ["add", "README.md"], { cwd, encoding: "utf8" });
    spawnSync("git", ["commit", "--no-gpg-sign", "-m", "init"], { cwd, encoding: "utf8" });
    // Add helper.py and a caller that imports it
    fs.writeFileSync(path.join(cwd, "helper.py"), "def greet(): return 'hi'\n");
    fs.writeFileSync(path.join(cwd, "main.py"), "from helper import greet\nprint(greet())\n");
    spawnSync("git", ["add", "helper.py", "main.py"], { cwd, encoding: "utf8" });
    spawnSync("git", ["commit", "--no-gpg-sign", "-m", "add helper"], { cwd, encoding: "utf8" });
    const r = runCallerlessFileCheck(cwd);
    assert.equal(r.pass, true);
    assert.ok(!r.warnings.some(w => w.includes("helper.py")), `unexpected warning for helper.py: ${JSON.stringify(r.warnings)}`);
  });
});

// ---------------------------------------------------------------------------
// runADRComplianceCheck
// ---------------------------------------------------------------------------

describe("runADRComplianceCheck — no adr directory", () => {
  it("passes silently when pipeline/adr does not exist", () => {
    const cwd = makeTmp();
    const r = runADRComplianceCheck(cwd);
    assert.equal(r.pass, true);
    assert.equal(r.blockers.length, 0);
  });
});

describe("runADRComplianceCheck — no @prohibit annotations", () => {
  it("passes when ADR files exist but contain no @prohibit annotations", () => {
    const cwd = makeTmp();
    fs.mkdirSync(path.join(cwd, "pipeline", "adr"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, "pipeline", "adr", "0001-no-prohibit.md"),
      "# ADR 0001\n\n## Decision\nUse httpx.\n"
    );
    const r = runADRComplianceCheck(cwd);
    assert.equal(r.pass, true);
    assert.equal(r.blockers.length, 0);
  });
});

describe("runADRComplianceCheck — prohibited pattern found in diff", () => {
  it("produces a blocker when a diff addition matches a @prohibit annotation", () => {
    const cwd = makeTmp();
    makeGitRepo(cwd);
    // Initial commit
    fs.writeFileSync(path.join(cwd, "README.md"), "hello\n");
    spawnSync("git", ["add", "README.md"], { cwd, encoding: "utf8" });
    spawnSync("git", ["commit", "--no-gpg-sign", "-m", "init"], { cwd, encoding: "utf8" });

    // Write ADR with @prohibit annotation
    fs.mkdirSync(path.join(cwd, "pipeline", "adr"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, "pipeline", "adr", "0001-no-urllib.md"),
      "# ADR 0001\n## Decision\nDo not use urllib.request.\n<!-- @prohibit: urllib\\.request -->\n"
    );

    // Add a file that uses the prohibited pattern (committed so it shows in diff)
    fs.writeFileSync(path.join(cwd, "fetcher.py"), "import urllib.request\nresp = urllib.request.urlopen('http://example.com')\n");
    spawnSync("git", ["add", "fetcher.py"], { cwd, encoding: "utf8" });
    spawnSync("git", ["commit", "--no-gpg-sign", "-m", "add fetcher"], { cwd, encoding: "utf8" });

    const r = runADRComplianceCheck(cwd);
    assert.equal(r.pass, false, "prohibited pattern in diff should block");
    assert.ok(r.blockers.some(b => b.includes("urllib")), `expected urllib in blocker: ${JSON.stringify(r.blockers)}`);
    assert.ok(r.blockers.some(b => b.includes("0001-no-urllib.md")), `expected ADR source in blocker: ${JSON.stringify(r.blockers)}`);
  });
});

describe("runADRComplianceCheck — prohibited pattern not in diff", () => {
  it("passes when the prohibited pattern does not appear in any added line", () => {
    const cwd = makeTmp();
    makeGitRepo(cwd);
    fs.writeFileSync(path.join(cwd, "README.md"), "hello\n");
    spawnSync("git", ["add", "README.md"], { cwd, encoding: "utf8" });
    spawnSync("git", ["commit", "--no-gpg-sign", "-m", "init"], { cwd, encoding: "utf8" });

    fs.mkdirSync(path.join(cwd, "pipeline", "adr"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, "pipeline", "adr", "0001-no-urllib.md"),
      "# ADR 0001\n## Decision\nDo not use urllib.request.\n<!-- @prohibit: urllib\\.request -->\n"
    );

    // Add a file that does NOT use urllib.request
    fs.writeFileSync(path.join(cwd, "fetcher.py"), "import httpx\nresp = httpx.get('http://example.com')\n");
    spawnSync("git", ["add", "fetcher.py"], { cwd, encoding: "utf8" });
    spawnSync("git", ["commit", "--no-gpg-sign", "-m", "add fetcher"], { cwd, encoding: "utf8" });

    const r = runADRComplianceCheck(cwd);
    assert.equal(r.pass, true);
    assert.equal(r.blockers.length, 0);
  });
});

describe("runPreflight — new gate fields", () => {
  it("includes callerless_file_check_pass and adr_compliance_pass in the gate", () => {
    const cwd = makeTmp();
    const r = runPreflight(cwd, { skipWrite: true });
    assert.equal(r.gate.callerless_file_check_pass, true);
    assert.equal(r.gate.adr_compliance_pass, true);
  });

  it("adr_compliance_pass is false and status FAIL when a prohibited pattern is in diff", () => {
    const cwd = makeTmp();
    makeGitRepo(cwd);
    fs.writeFileSync(path.join(cwd, "README.md"), "hello\n");
    spawnSync("git", ["add", "README.md"], { cwd, encoding: "utf8" });
    spawnSync("git", ["commit", "--no-gpg-sign", "-m", "init"], { cwd, encoding: "utf8" });

    fs.mkdirSync(path.join(cwd, "pipeline", "adr"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, "pipeline", "adr", "0001.md"),
      "## Decision\nNo sys.exit.\n<!-- @prohibit: sys\\.exit -->\n"
    );
    fs.writeFileSync(path.join(cwd, "bad.py"), "import sys\nsys.exit(1)\n");
    spawnSync("git", ["add", "bad.py"], { cwd, encoding: "utf8" });
    spawnSync("git", ["commit", "--no-gpg-sign", "-m", "add bad"], { cwd, encoding: "utf8" });

    const r = runPreflight(cwd, { skipWrite: true });
    assert.equal(r.status, "FAIL");
    assert.equal(r.gate.adr_compliance_pass, false);
  });
});
