const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { REPO_ROOT, makeTargetProject, seedGate, cleanup } = require("./_helpers");

const VALIDATOR = path.join(REPO_ROOT, "core", "gates", "validator.js");

function runValidator(cwd) {
  const r = spawnSync("node", [VALIDATOR], { cwd, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
afterEach(() => { _dirs.forEach(cleanup); _dirs = []; });

describe("gate-validator: exit codes", () => {
  it("exits 0 when no gates directory", () => {
    const cwd = track(makeTargetProject({ gates: false }));
    assert.equal(runValidator(cwd).status, 0);
  });

  it("exits 0 when gates dir is empty", () => {
    const cwd = track(makeTargetProject());
    assert.equal(runValidator(cwd).status, 0);
  });

  it("PASS gate → exit 0", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { workstream: "pm", host: "claude-code", status: "PASS" });
    const r = runValidator(cwd);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /✅ GATE PASS/);
  });

  it("WARN gate → exit 0 with warnings printed", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-04", { status: "WARN", warnings: ["coverage at 82%"] });
    const r = runValidator(cwd);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /GATE WARN/);
    assert.match(r.stdout, /coverage at 82%/);
  });

  it("FAIL gate → exit 2 with blockers", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { workstream: "pm", host: "claude-code", status: "FAIL", blockers: ["criterion 3 missing"] });
    const r = runValidator(cwd);
    assert.equal(r.status, 2);
    assert.match(r.stdout, /GATE FAIL/);
    assert.match(r.stdout, /criterion 3 missing/);
  });

  it("ESCALATE gate → exit 3", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { workstream: "pm", host: "claude-code", status: "ESCALATE", escalation_reason: "test escalation" });
    const r = runValidator(cwd);
    assert.equal(r.status, 3);
    assert.match(r.stdout, /ESCALATION REQUIRED/);
    assert.match(r.stdout, /test escalation/);
  });
});

describe("gate-validator: contract F required fields", () => {
  it("auto-injects orchestrator when missing and passes", () => {
    const cwd = track(makeTargetProject());
    const file = path.join(cwd, "pipeline", "gates", "stage-01.json");
    fs.writeFileSync(file, JSON.stringify({
      stage: "stage-01", status: "PASS",
      // missing: orchestrator — validator should inject it
      track: "full", timestamp: "2026-05-26T00:00:00Z",
      blockers: [], warnings: [],
    }));
    const r = runValidator(cwd);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /auto-injected metadata/);
    const patched = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.match(patched.orchestrator, /^devteam@/);
  });

  it("accepts a workstream gate with workstream + host", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-04.backend", { workstream: "backend", host: "codex", status: "PASS" });
    assert.equal(runValidator(cwd).status, 0);
  });
});

describe("gate-validator: QA build blocker injection", () => {
  function makeProjectWithContext(cwd, contextContent = "# Context\n\nProject notes.\n") {
    fs.mkdirSync(path.join(cwd, "pipeline"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "pipeline", "context.md"), contextContent);
  }

  it("injects QA blockers into context.md when stage-04.qa FAILs", () => {
    const cwd = track(makeTargetProject());
    makeProjectWithContext(cwd);
    seedGate(cwd, "stage-04.qa", {
      stage: "stage-04", workstream: "qa", status: "FAIL",
      blockers: ["express.static points to public/ which doesn't exist", "Dockerfile CMD references wrong path"],
    });
    runValidator(cwd);
    const ctx = fs.readFileSync(path.join(cwd, "pipeline", "context.md"), "utf8");
    assert.match(ctx, /qa-build-blockers:begin/);
    assert.match(ctx, /QA Build Failures/);
    assert.match(ctx, /express\.static points to public\//);
    assert.match(ctx, /Dockerfile CMD references wrong path/);
    assert.match(ctx, /--skip-completed/);
  });

  it("replaces existing qa-build-blockers block on subsequent FAIL (idempotent)", () => {
    const cwd = track(makeTargetProject());
    makeProjectWithContext(cwd,
      "<!-- devteam:qa-build-blockers:begin -->\n## IMMEDIATE: QA Build Failures\n\n- old bug\n\n<!-- devteam:qa-build-blockers:end -->\n\n# Context\n");
    seedGate(cwd, "stage-04.qa", {
      stage: "stage-04", workstream: "qa", status: "FAIL",
      blockers: ["new bug"],
    });
    runValidator(cwd);
    const ctx = fs.readFileSync(path.join(cwd, "pipeline", "context.md"), "utf8");
    assert.match(ctx, /new bug/);
    assert.doesNotMatch(ctx, /old bug/);
    assert.equal((ctx.match(/qa-build-blockers:begin/g) || []).length, 1, "only one begin marker");
  });

  it("does not inject when status is PASS", () => {
    const cwd = track(makeTargetProject());
    makeProjectWithContext(cwd);
    seedGate(cwd, "stage-04.qa", {
      stage: "stage-04", workstream: "qa", status: "PASS", blockers: [],
    });
    runValidator(cwd);
    const ctx = fs.readFileSync(path.join(cwd, "pipeline", "context.md"), "utf8");
    assert.doesNotMatch(ctx, /qa-build-blockers/);
  });

  it("does not inject for a non-QA build gate that FAILs", () => {
    const cwd = track(makeTargetProject());
    makeProjectWithContext(cwd);
    seedGate(cwd, "stage-04.backend", {
      stage: "stage-04", workstream: "backend", status: "FAIL",
      blockers: ["some backend failure"],
    });
    runValidator(cwd);
    const ctx = fs.readFileSync(path.join(cwd, "pipeline", "context.md"), "utf8");
    assert.doesNotMatch(ctx, /qa-build-blockers/);
  });

  it("does not inject when context.md does not exist", () => {
    const cwd = track(makeTargetProject());
    // No context.md created — injection must silently no-op
    seedGate(cwd, "stage-04.qa", {
      stage: "stage-04", workstream: "qa", status: "FAIL",
      blockers: ["some bug"],
    });
    assert.doesNotThrow(() => runValidator(cwd));
    assert.ok(!fs.existsSync(path.join(cwd, "pipeline", "context.md")));
  });

  it("logs the injection to stdout", () => {
    const cwd = track(makeTargetProject());
    makeProjectWithContext(cwd);
    seedGate(cwd, "stage-04.qa", {
      stage: "stage-04", workstream: "qa", status: "FAIL",
      blockers: ["bug one", "bug two"],
    });
    const r = runValidator(cwd);
    assert.match(r.stdout, /QA build blockers \(2\) written to pipeline\/context\.md/);
  });
});

describe("gate-validator: bypassed escalation halts", () => {
  it("an old ESCALATE with a newer gate after it exits 3", () => {
    const cwd = track(makeTargetProject());
    // Write old ESCALATE
    const oldFile = seedGate(cwd, "stage-02", {
      stage: "stage-02", status: "ESCALATE", escalation_reason: "old halt",
    });
    // Backdate it so it's older than the newer gate
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(oldFile, past, past);
    // Write a newer PASS
    seedGate(cwd, "stage-03", { status: "PASS" });
    const r = runValidator(cwd);
    assert.equal(r.status, 3);
    assert.match(r.stdout, /BYPASSED ESCALATION/);
  });
});
