const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { REPO_ROOT, makeTargetProject, seedGate, cleanup } = require("./_helpers");
const {
  loadGatesFrom, aggregate, overall, passRate, filterSince, renderJSON,
  // D6 cost view
  aggregateCost, overallCost, renderCostMarkdown, renderCostJSON, formatDuration,
} = require(path.join(REPO_ROOT, "scripts", "dashboard"));

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

// ---------------------------------------------------------------------------
// D6 — cost view
// ---------------------------------------------------------------------------

describe("dashboard: cost aggregation", () => {
  it("sums tokens / dollars / duration per group", () => {
    const gates = [
      {
        stage: "stage-01", workstream: "pm", host: "claude-code", status: "PASS",
        tokens_in: 1000, tokens_out: 500, cost_usd: 0.05, duration_ms: 12000, model: "claude-opus-4-7",
      },
      {
        stage: "stage-02", workstream: "principal", host: "claude-code", status: "PASS",
        tokens_in: 2000, tokens_out: 1000, cost_usd: 0.10, duration_ms: 25000, model: "claude-opus-4-7",
      },
      {
        stage: "stage-02", workstream: "principal", host: "codex", status: "PASS",
        tokens_in: 500, tokens_out: 250, cost_usd: 0.01, duration_ms: 8000, model: "gpt-5",
      },
    ];
    const groups = aggregateCost(gates, "host");
    assert.equal(groups.size, 2);
    const claude = groups.get("claude-code");
    assert.equal(claude.count, 2);
    assert.equal(claude.tokens_in, 3000);
    assert.equal(claude.tokens_out, 1500);
    // Float sum; assert with cent precision.
    assert.ok(Math.abs(claude.cost_usd - 0.15) < 0.001, `cost_usd ${claude.cost_usd}`);
    assert.equal(claude.duration_ms, 37000);
    assert.equal(claude.has_cost, 2);
    const codex = groups.get("codex");
    assert.equal(codex.count, 1);
    assert.equal(codex.cost_usd, 0.01);
  });

  it("expands merged stage gates into workstreams for attribution", () => {
    const gates = [
      {
        stage: "stage-04", status: "PASS",
        workstreams: [
          { workstream: "backend", host: "codex", status: "PASS", tokens_in: 5000, tokens_out: 2500, cost_usd: 0.03 },
          { workstream: "frontend", host: "claude-code", status: "PASS", tokens_in: 3000, tokens_out: 1500, cost_usd: 0.05 },
        ],
      },
    ];
    const groups = aggregateCost(gates, "host");
    assert.equal(groups.size, 2);
    assert.equal(groups.get("codex").cost_usd, 0.03);
    assert.equal(groups.get("claude-code").cost_usd, 0.05);
  });

  it("gates without cost data are counted but contribute 0 to cost_usd", () => {
    const gates = [
      { stage: "stage-01", workstream: "pm", host: "claude-code", status: "PASS",
        tokens_in: 1000, tokens_out: 500, cost_usd: 0.05 },
      { stage: "stage-02", workstream: "principal", host: "claude-code", status: "PASS" }, // no cost
    ];
    const groups = aggregateCost(gates, "host");
    const r = groups.get("claude-code");
    assert.equal(r.count, 2);
    assert.equal(r.has_cost, 1);
    assert.equal(r.cost_usd, 0.05);
  });
});

describe("dashboard: overallCost", () => {
  it("sums across all gates", () => {
    const gates = [
      { stage: "stage-01", workstream: "pm", host: "claude-code", status: "PASS",
        tokens_in: 100, tokens_out: 50, cost_usd: 0.01, duration_ms: 1000 },
      { stage: "stage-01", workstream: "pm", host: "codex", status: "PASS",
        tokens_in: 200, tokens_out: 100, cost_usd: 0.02, duration_ms: 2000 },
    ];
    const r = overallCost(gates);
    assert.equal(r.count, 2);
    assert.equal(r.tokens_in, 300);
    assert.equal(r.tokens_out, 150);
    assert.equal(r.cost_usd, 0.03);
    assert.equal(r.duration_ms, 3000);
  });
});

describe("dashboard: cost rendering", () => {
  it("renderCostJSON produces parseable output with the expected shape", () => {
    const gates = [
      { stage: "stage-01", workstream: "pm", host: "claude-code", status: "PASS",
        tokens_in: 1000, tokens_out: 500, cost_usd: 0.05 },
    ];
    const overallRec = overallCost(gates);
    const grouped = aggregateCost(gates, "host");
    const json = renderCostJSON({ from: ["x"], since: null, by: "host", view: "cost" }, gates, overallRec, grouped);
    const parsed = JSON.parse(json);
    assert.equal(parsed.view, "cost");
    assert.equal(parsed.overall.count, 1);
    assert.equal(parsed.overall.cost_usd, 0.05);
    assert.equal(parsed.groups[0].key, "claude-code");
    assert.equal(parsed.groups[0].cost_usd, 0.05);
  });

  it("renderCostMarkdown contains the headline cost figure", () => {
    const gates = [
      { stage: "stage-01", workstream: "pm", host: "claude-code", status: "PASS",
        tokens_in: 1000, tokens_out: 500, cost_usd: 0.05 },
    ];
    const md = renderCostMarkdown(
      { from: ["x"], since: null, by: "host" },
      gates,
      overallCost(gates),
      aggregateCost(gates, "host"),
    );
    assert.match(md, /Total cost: \*\*\$0\.050\*\*/);
    assert.match(md, /Workstreams counted: 1/);
  });
});

describe("dashboard: formatDuration", () => {
  it("formats milliseconds into the most informative unit", () => {
    assert.equal(formatDuration(0), "—");
    assert.equal(formatDuration(500), "500ms");
    assert.equal(formatDuration(1500), "1.5s");
    assert.equal(formatDuration(90_000), "1.5m");
  });
});
