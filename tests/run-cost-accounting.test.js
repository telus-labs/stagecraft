// Run cost is rebuilt from corpus rows the way tokens are, so a review
// round-trip that archives and re-dispatches build/QA/review no longer drops the
// first attempt's spend from the total. Run E (2026-09-05): seven dispatches,
// $13.31 on the gates, "$5.17 spent" reported; tokens_used was right because it
// came from the corpus. The corpus rows themselves were $0.00 for every omp
// dispatch because the writer ignored cost_usd_derived — fixed here too.

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { REPO_ROOT } = require("./_helpers");
const corpus = require(path.join(REPO_ROOT, "core", "corpus"));
const { costEntryForRow, combineCostUsage, costUsageForRunIds, initRunState } = require(path.join(REPO_ROOT, "core", "driver-run-state"));

const dirs = [];
function mkProject() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "devteam-cost-"));
  dirs.push(cwd);
  fs.mkdirSync(path.join(cwd, "pipeline", "gates"), { recursive: true });
  return cwd;
}
process.on("exit", () => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function writeGate(cwd, name, gate) {
  const p = path.join(cwd, "pipeline", "gates", `${name}.json`);
  fs.writeFileSync(p, JSON.stringify(gate));
  return p;
}

describe("corpus rows carry derived cost", () => {
  test("a gate with only cost_usd_derived yields cost_usd + cost_basis derived", () => {
    const cwd = mkProject();
    const gatePath = writeGate(cwd, "stage-04", {
      stage: "stage-04", status: "PASS",
      _orchestrator_observed: { tokens_in: 1000, tokens_out: 50, cost_usd: null, cost_usd_derived: 2.25, model_observed: "claude-sonnet-5", source: "omp:json" },
    });
    const { record } = corpus.recordDispatch(cwd, { gatePath, runId: "r1", stage: "stage-04", role: "backend", host: "omp" });
    assert.equal(record.cost_usd, 2.25);
    assert.equal(record.cost_basis, "derived");
  });

  test("precedence is observed > derived > model-asserted", () => {
    const cwd = mkProject();
    const both = writeGate(cwd, "stage-01", { stage: "stage-01", status: "PASS", cost_usd: 9, _orchestrator_observed: { cost_usd: 1, cost_usd_derived: 2 } });
    assert.deepEqual((() => { const r = corpus.recordDispatch(cwd, { gatePath: both, runId: "r1", stage: "stage-01" }).record; return [r.cost_usd, r.cost_basis]; })(), [1, "observed"]);
    const asserted = writeGate(cwd, "stage-02", { stage: "stage-02", status: "PASS", cost_usd: 9 });
    assert.deepEqual((() => { const r = corpus.recordDispatch(cwd, { gatePath: asserted, runId: "r1", stage: "stage-02" }).record; return [r.cost_usd, r.cost_basis]; })(), [9, "model-asserted"]);
  });
});

describe("run cost from corpus rows", () => {
  test("costEntryForRow maps basis names onto costUsdDetail's vocabulary", () => {
    assert.deepEqual(costEntryForRow({ cost_usd: 1.5, cost_basis: "observed" }), { cost: 1.5, basis: "observed" });
    assert.deepEqual(costEntryForRow({ cost_usd: 1.5, cost_basis: "derived" }), { cost: 1.5, basis: "derived" });
    assert.deepEqual(costEntryForRow({ cost_usd: 1.5, cost_basis: "model-asserted" }), { cost: 1.5, basis: "model-asserted" });
    assert.equal(costEntryForRow({ cost_usd: null, cost_basis: null }), null);
    assert.equal(costEntryForRow({}), null);
  });

  test("costUsageForRunIds sums only the selected run ids, including archived-then-pruned attempts", () => {
    const cwd = mkProject();
    const rows = [
      { run_id: "run-A", stage: "stage-04", cost_usd: 3.16, cost_basis: "derived" },   // first attempt, gate later archived
      { run_id: "run-A", stage: "stage-06", cost_usd: 1.76, cost_basis: "derived" },
      { run_id: "run-A", stage: "stage-05", cost_usd: 3.23, cost_basis: "derived" },   // CHANGES REQUESTED
      { run_id: "run-A", stage: "stage-04", cost_usd: 2.25, cost_basis: "derived" },   // retry
      { run_id: "run-A", stage: "stage-06", cost_usd: 1.19, cost_basis: "derived" },
      { run_id: "run-A", stage: "stage-05", cost_usd: 1.29, cost_basis: "derived" },
      { run_id: "run-OTHER", stage: "stage-01", cost_usd: 99, cost_basis: "observed" },
      { run_id: "run-A", stage: "stage-01", cost_usd: null, cost_basis: null },        // codex-style: tokens, no dollars
    ];
    for (const r of rows) corpus.appendDispatchRecord(cwd, { ts: "2026-09-05T06:00:00Z", ...r });
    const usage = costUsageForRunIds(cwd, ["run-A"]);
    assert.ok(Math.abs(usage.total - 12.88) < 1e-9, `got ${usage.total}`);
    assert.equal(usage.basis, "derived");
    assert.deepEqual(costUsageForRunIds(cwd, []), { total: 0, basis: null });
  });

  test("combineCostUsage adds totals and reports mixed when sources differ", () => {
    assert.deepEqual(combineCostUsage({ total: 1, basis: "observed" }, { total: 2, basis: "observed" }), { total: 3, basis: "observed" });
    assert.deepEqual(combineCostUsage({ total: 1, basis: "observed" }, { total: 2, basis: "derived" }), { total: 3, basis: "mixed" });
    assert.deepEqual(combineCostUsage({ total: 0, basis: null }, { total: 2, basis: "derived" }), { total: 2, basis: "derived" });
    assert.deepEqual(combineCostUsage(null, { total: 0, basis: null }), { total: 0, basis: null });
  });

  test("a fresh run's baseline is the gates at start; corpus rows for the run are added on top", () => {
    const cwd = mkProject();
    writeGate(cwd, "stage-01", { stage: "stage-01", status: "PASS", _orchestrator_observed: { cost_usd: 0.5 } });
    const costDetail = () => ({ total: 0.5, basis: "observed" });
    const { state, currentCostUsage } = initRunState({
      nowTs: "2026-09-05T06:41:25.765Z", cwd, changeId: null, effectiveTrack: "loop", trackSource: "config",
      trackConfidence: null, intent: "feature", safetyPolicy: {}, opts: {}, costDetail,
    });
    assert.deepEqual(state.cost_usage_baseline, { total: 0.5, basis: "observed" });
    assert.deepEqual(currentCostUsage(), { total: 0.5, basis: "observed" });
    corpus.appendDispatchRecord(cwd, { ts: "t", run_id: state.started_at, stage: "stage-04", cost_usd: 3.16, cost_basis: "derived" });
    corpus.appendDispatchRecord(cwd, { ts: "t", run_id: state.started_at, stage: "stage-04", cost_usd: 2.25, cost_basis: "derived" });
    const now = currentCostUsage();
    assert.ok(Math.abs(now.total - 5.91) < 1e-9, `got ${now.total}`);
    assert.equal(now.basis, "mixed");
  });

  test("a resumed state that predates the field gets a zero baseline, not a double count", () => {
    const cwd = mkProject();
    const costDetail = () => ({ total: 7, basis: "derived" });
    const resumedState = { started_at: "2026-09-05T06:00:00Z", iterations: 3, retries: {}, stages_advanced: [], token_run_ids: ["2026-09-05T06:00:00Z"] };
    const { state } = initRunState({
      resumedState, nowTs: "2026-09-05T07:00:00Z", cwd, changeId: null, effectiveTrack: "loop", trackSource: "config",
      trackConfidence: null, intent: "feature", safetyPolicy: {}, opts: { resume: true }, costDetail,
    });
    assert.deepEqual(state.cost_usage_baseline, { total: 0, basis: null });
  });
});
