const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { REPO_ROOT, makeTargetProject, seedGate, cleanup } = require("./_helpers");
const { loadGatesFrom, aggregate, overall, passRate, filterSince, renderJSON } =
  require(path.join(REPO_ROOT, "scripts", "dashboard"));

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
afterEach(() => { _dirs.forEach(cleanup); _dirs = []; });

describe("dashboard: gate loading", () => {
  it("loads gates from a project root (pipeline/gates/ auto-detected)", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { status: "PASS" });
    seedGate(cwd, "stage-02", { status: "FAIL" });
    const { gates } = loadGatesFrom(cwd);
    assert.equal(gates.length, 2);
  });

  it("returns warning when no pipeline/gates/ exists", () => {
    const cwd = track(makeTargetProject({ gates: false }));
    const r = loadGatesFrom(cwd);
    assert.equal(r.gates.length, 0);
    assert.match(r.warning, /no pipeline\/gates/);
  });

  it("skips malformed JSON files silently", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { status: "PASS" });
    fs.writeFileSync(path.join(cwd, "pipeline", "gates", "broken.json"), "{not json");
    const { gates } = loadGatesFrom(cwd);
    assert.equal(gates.length, 1);
  });
});

describe("dashboard: aggregation", () => {
  it("counts statuses per stage", () => {
    const gates = [
      { stage: "stage-01", status: "PASS" },
      { stage: "stage-01", status: "FAIL" },
      { stage: "stage-02", status: "PASS" },
    ];
    const r = aggregate(gates, "stage");
    assert.equal(r.get("stage-01").total, 2);
    assert.equal(r.get("stage-01").PASS, 1);
    assert.equal(r.get("stage-01").FAIL, 1);
    assert.equal(r.get("stage-02").total, 1);
  });

  it("expands merged stage gates into workstream rows for host/role grouping", () => {
    const gates = [
      {
        stage: "stage-04",
        status: "PASS",
        workstreams: [
          { workstream: "backend",  host: "codex",       status: "PASS" },
          { workstream: "frontend", host: "claude-code", status: "WARN" },
          { workstream: "platform", host: "claude-code", status: "PASS" },
          { workstream: "qa",       host: "claude-code", status: "PASS" },
        ],
      },
    ];
    const byHost = aggregate(gates, "host");
    assert.equal(byHost.get("codex").total, 1);
    assert.equal(byHost.get("codex").PASS, 1);
    assert.equal(byHost.get("claude-code").total, 3);
    assert.equal(byHost.get("claude-code").PASS, 2);
    assert.equal(byHost.get("claude-code").WARN, 1);

    const byRole = aggregate(gates, "role");
    assert.equal(byRole.get("backend").PASS, 1);
    assert.equal(byRole.get("frontend").WARN, 1);
  });

  it("non-merged workstream gates count once", () => {
    const gates = [
      { stage: "stage-04", workstream: "backend", host: "codex", status: "PASS" },
    ];
    const byStage = aggregate(gates, "stage");
    assert.equal(byStage.get("stage-04").total, 1);
  });
});

describe("dashboard: overall", () => {
  it("totals across all gates (expanding merged ones)", () => {
    const gates = [
      { stage: "stage-01", status: "PASS" },
      {
        stage: "stage-04",
        status: "WARN",
        workstreams: [
          { workstream: "backend",  host: "codex",       status: "PASS" },
          { workstream: "frontend", host: "claude-code", status: "WARN" },
        ],
      },
    ];
    const r = overall(gates);
    assert.equal(r.total, 3);
    assert.equal(r.PASS, 2);
    assert.equal(r.WARN, 1);
  });
});

describe("dashboard: passRate", () => {
  it("counts PASS + WARN as passing", () => {
    assert.equal(passRate({ PASS: 8, WARN: 1, FAIL: 1, ESCALATE: 0, total: 10 }), 90);
  });

  it("returns 0 for empty", () => {
    assert.equal(passRate({ PASS: 0, WARN: 0, FAIL: 0, ESCALATE: 0, total: 0 }), 0);
  });

  it("counts FAIL and ESCALATE as failing", () => {
    assert.equal(passRate({ PASS: 0, WARN: 0, FAIL: 1, ESCALATE: 1, total: 2 }), 0);
  });
});

describe("dashboard: filterSince", () => {
  it("keeps gates at or after the cutoff", () => {
    const gates = [
      { stage: "stage-01", timestamp: "2026-01-01T00:00:00Z", status: "PASS" },
      { stage: "stage-02", timestamp: "2026-06-01T00:00:00Z", status: "PASS" },
      { stage: "stage-03", timestamp: "2026-06-15T00:00:00Z", status: "FAIL" },
    ];
    const filtered = filterSince(gates, "2026-06-01");
    assert.equal(filtered.length, 2);
    assert.equal(filtered[0].stage, "stage-02");
  });

  it("returns all gates when since is null", () => {
    const gates = [{ stage: "stage-01", status: "PASS" }];
    assert.deepEqual(filterSince(gates, null), gates);
  });

  it("keeps gates with no timestamp (don't lose data)", () => {
    const gates = [
      { stage: "stage-01", status: "PASS" }, // no timestamp
      { stage: "stage-02", timestamp: "2026-01-01T00:00:00Z", status: "PASS" },
    ];
    const filtered = filterSince(gates, "2026-06-01");
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].stage, "stage-01");
  });
});

describe("dashboard: JSON rendering", () => {
  it("produces parseable JSON with the expected shape", () => {
    const gates = [
      { stage: "stage-01", status: "PASS" },
      { stage: "stage-01", status: "FAIL" },
    ];
    const grouped = aggregate(gates, "stage");
    const overallRec = overall(gates);
    const json = renderJSON({ from: ["x"], since: null, by: "stage" }, gates, overallRec, grouped);
    const parsed = JSON.parse(json);
    assert.equal(parsed.by, "stage");
    assert.equal(parsed.overall.total, 2);
    assert.equal(parsed.overall.pass_rate, 50);
    assert.equal(parsed.groups.length, 1);
    assert.equal(parsed.groups[0].key, "stage-01");
    assert.equal(parsed.groups[0].PASS, 1);
    assert.equal(parsed.groups[0].FAIL, 1);
  });
});
