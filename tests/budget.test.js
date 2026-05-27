// Budget tracking script — pure-logic tests + subprocess smoke.
//
// scripts/budget.js is an out-of-band tool (`npm run budget -- init|update|check`),
// not yet auto-wired into the orchestrator. These tests cover:
//   - parseBudgetMd round-trip (a regex parser; easy to break)
//   - readConfig handling of missing/disabled/enabled .devteam/config.yml
//   - end-to-end init → update → check via spawnSync, asserting on the
//     pipeline/budget.md it writes and the exit codes it returns

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { makeTargetProject } = require("./_helpers");

const REPO_ROOT = path.resolve(__dirname, "..");
const BUDGET_SCRIPT = path.join(REPO_ROOT, "scripts", "budget.js");
const { parseBudgetMd, readConfig } = require("../scripts/budget");

function runBudget(cwd, ...args) {
  return spawnSync("node", [BUDGET_SCRIPT, ...args], {
    cwd,
    encoding: "utf8",
  });
}

const ENABLED_CONFIG = `routing:
  default_host: generic
pipeline:
  default_track: full
budget:
  enabled: true
  tokens_max: 1000
  wall_clock_max_minutes: 30
  on_exceed: escalate
`;

const DISABLED_CONFIG = `routing:
  default_host: generic
budget:
  enabled: false
`;

test("parseBudgetMd extracts started timestamp and table rows", () => {
  const md = `# Budget

Started: 2026-05-27T10:00:00Z
Tokens max: 5000

## Running totals

| Stage | Tokens | Elapsed (min) |
|-------|--------|---------------|
| stage-01     |    120 |           2.5 |
| stage-04     |    800 |          18.0 |

---

Total tokens used: 920
`;
  const parsed = parseBudgetMd(md);
  assert.equal(parsed.started, "2026-05-27T10:00:00Z");
  assert.deepEqual(parsed.rows, [
    { stage: "stage-01", tokens: 120, elapsed: 2.5 },
    { stage: "stage-04", tokens: 800, elapsed: 18.0 },
  ]);
});

test("parseBudgetMd handles empty / heading-only input", () => {
  const parsed = parseBudgetMd("# Budget\n\n");
  assert.equal(parsed.started, null);
  assert.deepEqual(parsed.rows, []);
});

test("readConfig returns empty object (falsy enabled) when .devteam/config.yml is missing", () => {
  const cwd = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "budget-test-"));
  const prev = process.cwd();
  try {
    process.chdir(cwd);
    const cfg = readConfig();
    // Missing config → {} → cfg.enabled is undefined → treated as disabled by callers.
    assert.ok(!cfg.enabled);
  } finally {
    process.chdir(prev);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("readConfig parses an enabled config block", () => {
  const cwd = makeTargetProject({ config: ENABLED_CONFIG });
  const prev = process.cwd();
  try {
    process.chdir(cwd);
    const cfg = readConfig();
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.tokensMax, 1000);
    assert.equal(cfg.wallMax, 30);
    assert.equal(cfg.onExceed, "escalate");
  } finally {
    process.chdir(prev);
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("init is a no-op when budget tracking is disabled", () => {
  const cwd = makeTargetProject({ config: DISABLED_CONFIG });
  const r = runBudget(cwd, "init");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /disabled/i);
  assert.equal(fs.existsSync(path.join(cwd, "pipeline", "budget.md")), false);
});

test("init → update → check round-trip writes a valid budget.md and reports OK", () => {
  const cwd = makeTargetProject({ config: ENABLED_CONFIG });

  const init = runBudget(cwd, "init");
  assert.equal(init.status, 0);
  const budgetPath = path.join(cwd, "pipeline", "budget.md");
  assert.ok(fs.existsSync(budgetPath), "init should create pipeline/budget.md");

  const update1 = runBudget(cwd, "update", "stage-01", "100", "5");
  assert.equal(update1.status, 0);
  const update2 = runBudget(cwd, "update", "stage-04", "300", "20");
  assert.equal(update2.status, 0);

  const check = runBudget(cwd, "check");
  assert.equal(check.status, 0);
  assert.match(check.stdout, /Budget OK/);
  assert.match(check.stdout, /tokens=400\/1000/);

  // re-running update for the same stage should replace, not append
  const replace = runBudget(cwd, "update", "stage-01", "150", "6");
  assert.equal(replace.status, 0);
  const md = fs.readFileSync(budgetPath, "utf8");
  const parsed = parseBudgetMd(md);
  const stage01Rows = parsed.rows.filter((r) => r.stage === "stage-01");
  assert.equal(stage01Rows.length, 1, "stage-01 should appear exactly once after replacement");
  assert.equal(stage01Rows[0].tokens, 150);
});

test("check escalates and writes a contract-F-compliant gate when tokens exceed max", () => {
  const cwd = makeTargetProject({ config: ENABLED_CONFIG });
  runBudget(cwd, "init");
  runBudget(cwd, "update", "stage-04", "1500", "10"); // tokens_max=1000, so this breaches

  const check = runBudget(cwd, "check");
  assert.equal(check.status, 3, "exit 3 = ESCALATE");
  assert.match(check.stderr, /BUDGET ESCALATE/);

  const gatePath = path.join(cwd, "pipeline", "gates", "stage-budget.json");
  assert.ok(fs.existsSync(gatePath), "escalation should write a gate file");
  const gate = JSON.parse(fs.readFileSync(gatePath, "utf8"));
  assert.equal(gate.status, "ESCALATE");
  // Contract F: orchestrator field, NOT agent
  assert.match(gate.orchestrator, /^devteam@/);
  assert.equal(gate.agent, undefined, "gate must not carry the legacy `agent` field");
  assert.equal(gate.tokens_used, 1500);
  assert.equal(gate.tokens_max, 1000);
});
