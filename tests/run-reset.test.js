// `devteam run --reset` — clears gate files and pipeline/brief.md before
// dispatching so users can start a new feature run on a completed pipeline
// without manually clearing the old state.

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeTargetProject, seedGate, cleanup, runCLI } = require("./_helpers");

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
afterEach(() => { _dirs.forEach(cleanup); _dirs = []; });

// Run devteam run with a headless echo command so dispatch exits immediately
// (structural halt) without needing a real agent.
function runReset(args, cwd) {
  return runCLI(["run", ...args], {
    cwd,
    env: { DEVTEAM_HEADLESS_COMMAND: "echo" },
  });
}

function gatePath(cwd, name) {
  return path.join(cwd, "pipeline", "gates", `${name}.json`);
}

function briefPath(cwd) {
  return path.join(cwd, "pipeline", "brief.md");
}

function seedBrief(cwd, content = "# Brief\n\nOld feature.\n") {
  fs.mkdirSync(path.join(cwd, "pipeline"), { recursive: true });
  fs.writeFileSync(briefPath(cwd), content);
}

function seedRunState(cwd, state) {
  fs.mkdirSync(path.join(cwd, "pipeline"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "pipeline", "run-state.json"), JSON.stringify(state, null, 2));
}

describe("run --reset: argument validation", () => {
  it("exits 1 with a clear error when --reset is used without --feature", () => {
    const cwd = track(makeTargetProject());
    const r = runCLI(["run", "--reset"], { cwd });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--reset requires --feature/);
  });

  it("accepts --reset together with --feature without a usage error message", () => {
    const cwd = track(makeTargetProject());
    // With echo as headless the run halts as structural — that's fine.
    // We just verify no argument-validation error was printed.
    const r = runReset(["--feature", "add logging", "--reset"], cwd);
    assert.doesNotMatch(r.stderr, /--reset requires --feature/);
  });
});

describe("run --reset: gate file clearing", () => {
  it("deletes all gate files before dispatching", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { status: "PASS" });
    seedGate(cwd, "stage-02", { status: "PASS" });
    seedGate(cwd, "stage-04", { status: "PASS" });
    seedGate(cwd, "stage-04.backend", { workstream: "backend", host: "claude-code", status: "PASS" });

    runReset(["--feature", "add logging", "--reset"], cwd);

    assert.ok(!fs.existsSync(gatePath(cwd, "stage-01")), "stage-01 gate must be cleared");
    assert.ok(!fs.existsSync(gatePath(cwd, "stage-02")), "stage-02 gate must be cleared");
    assert.ok(!fs.existsSync(gatePath(cwd, "stage-04")), "stage-04 gate must be cleared");
    assert.ok(!fs.existsSync(gatePath(cwd, "stage-04.backend")), "stage-04.backend gate must be cleared");
  });

  it("deletes pipeline/brief.md before dispatching", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { status: "PASS" });
    seedBrief(cwd);

    runReset(["--feature", "add logging", "--reset"], cwd);

    assert.ok(!fs.existsSync(briefPath(cwd)), "brief.md must be cleared by --reset");
  });

  it("succeeds without error when there are no gates and no brief (idempotent)", () => {
    const cwd = track(makeTargetProject());
    const r = runReset(["--feature", "add logging", "--reset"], cwd);
    assert.match(r.stderr, /nothing to clear/i, "should report nothing to clear");
  });

  it("prints a cleared-N message on stderr when files were deleted", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { status: "PASS" });
    seedBrief(cwd);

    const r = runReset(["--feature", "add logging", "--reset"], cwd);
    assert.match(r.stderr, /--reset: cleared/, "should print cleared summary");
    assert.match(r.stderr, /brief\.md/, "summary should mention brief.md");
  });
});

describe("run --reset: fixRetries clearing", () => {
  it("clears all fixRetries entries in run-state.json before dispatching", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { status: "PASS" });
    seedRunState(cwd, { fixRetries: { "build": 2, "red-team": 1 }, last_action: "pipeline-complete" });

    runReset(["--feature", "add logging", "--reset"], cwd);

    const rs = JSON.parse(fs.readFileSync(path.join(cwd, "pipeline", "run-state.json"), "utf8"));
    assert.deepEqual(rs.fixRetries, {}, "fixRetries must be empty after --reset");
  });

  it("does not crash when run-state.json has no fixRetries field", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { status: "PASS" });
    seedRunState(cwd, { last_action: "pipeline-complete" });

    const r = runReset(["--feature", "add logging", "--reset"], cwd);
    assert.doesNotMatch(r.stderr, /error/i);
  });
});
