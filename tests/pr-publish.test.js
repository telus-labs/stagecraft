// Tests for pr-publish.js. We deliberately don't exercise the
// network/auth/gh-CLI path — that requires a real GitHub PR.
// What we DO test:
//   - The gate → check-run translation (the pure logic)
//   - readGatesDir reads the right files
//   - STATUS_TO_CONCLUSION mapping is exhaustive

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { REPO_ROOT, makeTargetProject, seedGate, cleanup } = require("./_helpers");
const { buildCheckRuns, readGatesDir, STATUS_TO_CONCLUSION } =
  require(path.join(REPO_ROOT, "scripts", "pr-publish"));

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
afterEach(() => { _dirs.forEach(cleanup); _dirs = []; });

describe("pr-publish: STATUS_TO_CONCLUSION mapping", () => {
  it("covers every status the validator emits", () => {
    assert.equal(STATUS_TO_CONCLUSION.PASS, "success");
    assert.equal(STATUS_TO_CONCLUSION.WARN, "neutral");
    assert.equal(STATUS_TO_CONCLUSION.FAIL, "failure");
    assert.equal(STATUS_TO_CONCLUSION.ESCALATE, "failure");
  });
});

describe("pr-publish: readGatesDir", () => {
  it("returns gates with _file attached", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { status: "PASS" });
    seedGate(cwd, "stage-02", { status: "FAIL" });
    const gates = readGatesDir(cwd);
    assert.equal(gates.length, 2);
    assert.ok(gates.every((g) => g._file));
  });

  it("returns [] when no gates dir", () => {
    const cwd = track(makeTargetProject({ gates: false }));
    assert.deepEqual(readGatesDir(cwd), []);
  });

  it("skips malformed JSON without throwing", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { status: "PASS" });
    fs.writeFileSync(path.join(cwd, "pipeline", "gates", "broken.json"), "{nope");
    const gates = readGatesDir(cwd);
    assert.equal(gates.length, 1);
  });
});

describe("pr-publish: buildCheckRuns translation", () => {
  it("produces one check run per gate, attached to headSha", () => {
    const gates = [
      { stage: "stage-01", status: "PASS", host: "claude-code", workstream: "pm" },
      { stage: "stage-02", status: "PASS" },
    ];
    const runs = buildCheckRuns(gates, "abc123");
    assert.equal(runs.length, 2);
    assert.ok(runs.every((r) => r.head_sha === "abc123"));
    assert.ok(runs.every((r) => r.status === "completed"));
  });

  it("names workstream gates as 'devteam: stage-NN/role'", () => {
    const runs = buildCheckRuns([
      { stage: "stage-04", workstream: "backend", host: "codex", status: "PASS" },
    ], "sha");
    assert.equal(runs[0].name, "devteam: stage-04/backend");
  });

  it("names stage-level gates as 'devteam: stage-NN' (no workstream suffix)", () => {
    const runs = buildCheckRuns([
      { stage: "stage-04", status: "PASS" },
    ], "sha");
    assert.equal(runs[0].name, "devteam: stage-04");
  });

  it("maps PASS → success, WARN → neutral, FAIL/ESCALATE → failure", () => {
    const runs = buildCheckRuns([
      { stage: "stage-01", status: "PASS" },
      { stage: "stage-02", status: "WARN" },
      { stage: "stage-03", status: "FAIL" },
      { stage: "stage-04", status: "ESCALATE" },
    ], "sha");
    assert.deepEqual(runs.map((r) => r.conclusion), ["success", "neutral", "failure", "failure"]);
  });

  it("falls back to neutral for unknown status", () => {
    const runs = buildCheckRuns([{ stage: "stage-x", status: "MYSTERY" }], "sha");
    assert.equal(runs[0].conclusion, "neutral");
  });

  it("output.summary includes status + host + orchestrator", () => {
    const runs = buildCheckRuns([
      { stage: "stage-04", workstream: "backend", host: "codex", orchestrator: "devteam@1.2.3", status: "PASS" },
    ], "sha");
    assert.match(runs[0].output.summary, /Status: PASS/);
    assert.match(runs[0].output.summary, /Host: codex/);
    assert.match(runs[0].output.summary, /Orchestrator: devteam@1\.2\.3/);
  });

  it("output.text lists blockers when present", () => {
    const runs = buildCheckRuns([
      { stage: "stage-01", status: "FAIL", blockers: ["criterion 3 missing", "missing AC for rollback"] },
    ], "sha");
    assert.match(runs[0].output.text, /Blockers/);
    assert.match(runs[0].output.text, /criterion 3 missing/);
    assert.match(runs[0].output.text, /missing AC for rollback/);
  });

  it("output.text lists warnings when present", () => {
    const runs = buildCheckRuns([
      { stage: "stage-04", status: "WARN", warnings: ["coverage at 82%"] },
    ], "sha");
    assert.match(runs[0].output.text, /Warnings/);
    assert.match(runs[0].output.text, /coverage at 82%/);
  });

  it("output.text shows workstreams from a merged stage gate", () => {
    const runs = buildCheckRuns([
      {
        stage: "stage-04",
        status: "PASS",
        workstreams: [
          { workstream: "backend",  host: "codex",       status: "PASS" },
          { workstream: "frontend", host: "claude-code", status: "WARN" },
        ],
      },
    ], "sha");
    assert.match(runs[0].output.text, /Workstreams/);
    assert.match(runs[0].output.text, /backend \(codex\): PASS/);
    assert.match(runs[0].output.text, /frontend \(claude-code\): WARN/);
  });

  it("output.text falls back to a 'no findings' placeholder when nothing to report", () => {
    const runs = buildCheckRuns([{ stage: "stage-01", status: "PASS" }], "sha");
    assert.match(runs[0].output.text, /No additional findings/);
  });
});
