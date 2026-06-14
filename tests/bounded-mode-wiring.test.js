// Tests for B9 item 5.4 commit 2 — bounded-mode CLI wiring.
//
// Verifies two things:
//
//   1. Driver auto-fix e2e: when isolation is bounded, the driver applies
//      prefixPipelineRelative to recipe clear_gates paths so it clears the
//      right file (pipeline/changes/<id>/gates/...) instead of the nonexistent
//      in-place file. This test FAILS on main before the Phase 5.4 fix with:
//        "fix steps for '...' contain no gate clears — cannot make automated
//         progress"
//
//   2. Per-command bounded-path coverage: each of the seven wired CLI commands
//      (next, restart, log, advise, replay, derive-approvals, spec) correctly
//      routes reads and writes through the bounded subtree when --feature is
//      supplied with isolation: bounded config.

"use strict";

const { describe, test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { REPO_ROOT, runCLI, cleanup } = require("./_helpers");
const { run } = require(path.join(REPO_ROOT, "core", "driver"));
const { clearConfigCache } = require(path.join(REPO_ROOT, "core", "config"));

const FEATURE = "my-feature";
const CHANGE_ID = "my-feature"; // changeIdFromFeature("my-feature") = "my-feature"
const BOUNDED_CONFIG = [
  "routing:",
  "  default_host: generic",
  "pipeline:",
  "  default_track: full",
  "  isolation: bounded",
].join("\n") + "\n";

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
afterEach(() => {
  clearConfigCache();
  _dirs.forEach(cleanup);
  _dirs = [];
});

function makeBoundedProject(extraConfig = "") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "b9-wiring-test-"));
  fs.mkdirSync(path.join(dir, ".devteam"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".devteam", "config.yml"), BOUNDED_CONFIG + extraConfig);
  return dir;
}

// Bounded gates dir for the test feature.
function boundedGatesDir(cwd) {
  return path.join(cwd, "pipeline", "changes", CHANGE_ID, "gates");
}

function boundedPipelineRoot(cwd) {
  return path.join(cwd, "pipeline", "changes", CHANGE_ID);
}

function seedBoundedGate(cwd, name, gate = {}) {
  const dir = boundedGatesDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  const content = {
    stage: name.replace(/\.json$/, ""),
    status: "PASS",
    orchestrator: "devteam@test",
    track: "full",
    timestamp: "2026-06-13T00:00:00Z",
    blockers: [],
    warnings: [],
    ...gate,
  };
  const file = path.join(dir, name.endsWith(".json") ? name : `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(content, null, 2));
  return file;
}

// ── 1. Driver: bounded auto-fix clears prefixed gate path ────────────────────
//
// The regression: before item 5.4 commit 2, driver.js applied clear_gates
// paths without prefixPipelineRelative — so it looked for the in-place file
// (pipeline/gates/stage-04.backend.json) instead of the bounded file
// (pipeline/changes/<id>/gates/stage-04.backend.json). clearGates returned []
// and the driver halted with "fix steps contain no gate clears".

describe("driver: bounded auto-fix — prefixPipelineRelative applied to clear_gates", () => {
  test("recipe clears the PREFIXED gate and driver completes (regression for item 5.4)", async () => {
    const cwd = track(makeBoundedProject());
    const gatesDir = boundedGatesDir(cwd);
    fs.mkdirSync(gatesDir, { recursive: true });

    // Seed the gate at the BOUNDED path (pipeline/changes/my-feature/gates/...)
    // which is where the driver writes in bounded mode.
    const victim = path.join(gatesDir, "stage-04.backend.json");
    fs.writeFileSync(victim, JSON.stringify({ stage: "stage-04", status: "FAIL" }, null, 2));

    // next() returns fix-and-retry with the IN-PLACE clear_gates path — this
    // is the format the pipeline always uses; the driver must prefix it.
    const nextSeq = [
      {
        action: "fix-and-retry",
        stage: "stage-04",
        name: "build",
        failure_class: "code-defect",
        blockers: ["backend test failing"],
        clear_gates: ["pipeline/gates/stage-04.backend.json"], // in-place path
      },
      { action: "pipeline-complete", reason: "done" },
    ];
    let n = 0;
    const s = await run({
      cwd,
      changeId: CHANGE_ID,
      next: () => nextSeq[n++],
      runStageHeadless: async () => [{ role: "backend", gatePath: "x", exitCode: 0, durationMs: 1 }],
    });

    assert.equal(s.completed, true,
      `driver must complete — if it halted with halt_reason="${s.halt_reason}" the ` +
      `prefixPipelineRelative fix is missing from driver.js`);
    assert.ok(!fs.existsSync(victim),
      "bounded gate file must be cleared by the driver's auto-fix path");
  });

  test("without changeId (in-place mode), missing gate → structural-input halt", async () => {
    // Confirms the halt path fires when the gate genuinely doesn't exist —
    // distinguishing a correct halt from the regression where the gate EXISTS
    // but at the wrong path.
    const cwd = track(makeBoundedProject());
    // Gate is NOT seeded — no in-place gate at pipeline/gates/stage-04.backend.json.
    const s = await run({
      cwd,
      changeId: null, // in-place mode: no prefix applied
      next: () => ({
        action: "fix-and-retry",
        stage: "stage-04",
        name: "build",
        failure_class: "code-defect",
        blockers: [],
        clear_gates: ["pipeline/gates/stage-04.backend.json"],
      }),
    });
    assert.equal(s.halt_action, "fix-and-retry");
    assert.equal(s.halt_failure_class, "structural-input");
    assert.match(s.halt_reason, /no gate clears/,
      "halted because the in-place gate did not exist — this is the CORRECT structural-input halt");
  });
});

// ── 2. next — bounded gate is visible ────────────────────────────────────────

describe("devteam next --feature: reads bounded gates", () => {
  test("next advances past stage-01 when bounded gate is PASS", () => {
    const cwd = track(makeBoundedProject());
    seedBoundedGate(cwd, "stage-01", { stage: "stage-01", status: "PASS" });
    const r = runCLI(["next", "--feature", FEATURE, "--json", "--skip-advise"], { cwd });
    assert.equal(r.status, 0, `next exited ${r.status}: ${r.stderr}`);
    const result = JSON.parse(r.stdout.trim());
    assert.notEqual(result.stage, "stage-01",
      "next() must have read the bounded stage-01 gate and advanced past it");
    assert.ok(
      ["run-stage", "continue-stage", "merge"].includes(result.action),
      `expected forward action; got: ${result.action}`,
    );
  });

  test("next without --feature in bounded config: no gate seeded → run-stage for stage-01", () => {
    const cwd = track(makeBoundedProject());
    // No gate anywhere — pipeline starts from the top.
    // Without --feature, changeId is null (empty feature string → null).
    const r = runCLI(["next", "--json", "--skip-advise"], { cwd });
    assert.equal(r.status, 0, `next exited ${r.status}: ${r.stderr}`);
    const result = JSON.parse(r.stdout.trim());
    // stage-01 PASS gate only exists in bounded dir, not consulted without changeId.
    assert.equal(result.stage, "stage-01", "without --feature, in-place path is used (empty)");
  });
});

// ── 3. restart — deletes from bounded gates dir ───────────────────────────────

describe("devteam restart --feature: deletes bounded gate", () => {
  test("restart requirements deletes the bounded stage-01 gate", () => {
    const cwd = track(makeBoundedProject());
    const victim = seedBoundedGate(cwd, "stage-01", { stage: "stage-01", status: "PASS" });
    assert.ok(fs.existsSync(victim), "bounded gate must exist before restart");
    const r = runCLI(["restart", "requirements", "--feature", FEATURE], { cwd });
    assert.equal(r.status, 0, `restart exited ${r.status}: ${r.stderr}`);
    assert.ok(!fs.existsSync(victim), "bounded gate must be deleted after restart");
  });

  test("restart without --feature: in-place gates dir is used (bounded gate untouched)", () => {
    const cwd = track(makeBoundedProject());
    const victim = seedBoundedGate(cwd, "stage-01", { stage: "stage-01", status: "PASS" });
    // Also create the in-place gates dir so restart doesn't immediately exit 1.
    fs.mkdirSync(path.join(cwd, "pipeline", "gates"), { recursive: true });
    runCLI(["restart", "requirements"], { cwd });
    // Exit 0 — nothing to clear in the (empty) in-place dir; bounded gate untouched.
    assert.ok(fs.existsSync(victim),
      "bounded gate must NOT be deleted when --feature is absent (in-place mode)");
  });
});

// ── 4. log — emits bounded gate events ────────────────────────────────────────

describe("devteam log --feature: reads bounded pipeline", () => {
  test("log emits a gate event for a gate seeded in the bounded dir", () => {
    const cwd = track(makeBoundedProject());
    seedBoundedGate(cwd, "stage-01", { stage: "stage-01", status: "PASS" });
    const r = runCLI(["log", "--feature", FEATURE, "--json"], { cwd });
    assert.equal(r.status, 0, `log exited ${r.status}: ${r.stderr}`);
    const events = r.stdout.trim().split("\n").map((l) => JSON.parse(l));
    const gateEvent = events.find((e) => e.kind === "gate" && e.stage === "stage-01");
    assert.ok(gateEvent, "log must emit a gate event for the bounded stage-01 gate");
  });

  test("log without --feature: in-place pipeline only — bounded gate not emitted", () => {
    const cwd = track(makeBoundedProject());
    seedBoundedGate(cwd, "stage-01", { stage: "stage-01", status: "PASS" });
    const r = runCLI(["log", "--json"], { cwd });
    assert.equal(r.status, 0, `log exited ${r.status}: ${r.stderr}`);
    const events = r.stdout.trim() ? r.stdout.trim().split("\n").map((l) => JSON.parse(l)) : [];
    const gateEvent = events.find((e) => e.kind === "gate" && e.stage === "stage-01");
    assert.ok(!gateEvent,
      "without --feature, log must NOT emit the bounded gate (in-place pipeline is empty)");
  });
});

// ── 5. spec — reads brief and spec from bounded pipelineDir ──────────────────

describe("devteam spec --feature: reads bounded pipeline artifacts", () => {
  test("spec verify reads brief.md from bounded pipelineDir", () => {
    const cwd = track(makeBoundedProject());
    const pipelineDir = boundedPipelineRoot(cwd);
    fs.mkdirSync(pipelineDir, { recursive: true });
    fs.writeFileSync(path.join(pipelineDir, "brief.md"),
      "# Brief\n\n- AC-1: User can log in.\n- AC-2: Session expires after 30 minutes.\n");
    const r = runCLI(["spec", "verify", "--feature", FEATURE, "--json"], { cwd });
    // Brief exists but spec does not → drift=true, but brief.exists must be true.
    const report = JSON.parse(r.stdout);
    assert.equal(report.artifacts.brief.exists, true,
      "spec verify must read brief.md from the bounded pipelineDir");
    assert.equal(report.criteria.length, 2, "both ACs extracted from bounded brief.md");
  });

  test("spec verify without --feature: in-place pipelineDir — bounded brief ignored", () => {
    const cwd = track(makeBoundedProject());
    const pipelineDir = boundedPipelineRoot(cwd);
    fs.mkdirSync(pipelineDir, { recursive: true });
    fs.writeFileSync(path.join(pipelineDir, "brief.md"),
      "# Brief\n\n- AC-1: User can log in.\n");
    // Only the bounded brief exists; the in-place pipeline dir is empty.
    const r = runCLI(["spec", "verify", "--json"], { cwd });
    // Without --feature, brief not found → drift=true, brief.exists=false.
    const report = JSON.parse(r.stdout);
    assert.equal(report.artifacts.brief.exists, false,
      "without --feature, in-place pipelineDir is used — bounded brief must not be read");
  });
});

// ── 6. derive-approvals — uses bounded code-review dir ───────────────────────

describe("devteam derive-approvals --feature: uses bounded reviewDir", () => {
  test("derive-approvals reads by-*.md from bounded code-review dir", () => {
    const cwd = track(makeBoundedProject());
    const reviewDir = path.join(boundedPipelineRoot(cwd), "code-review");
    fs.mkdirSync(reviewDir, { recursive: true });
    // Write a minimal review file (the hook will process it).
    fs.writeFileSync(
      path.join(reviewDir, "by-alice.md"),
      "## Review of backend\n\n**Approval: APPROVED**\n",
    );
    const r = runCLI(["derive-approvals", "--feature", FEATURE, "--json"], { cwd });
    // Exit code 0 or 1 depending on hook result; what matters is it found the review file.
    const result = JSON.parse(r.stdout);
    assert.ok(Array.isArray(result.files), "derive-approvals returned files array");
    assert.ok(
      result.files.some((f) => f.file.includes("by-alice.md")),
      "derive-approvals must have processed the bounded code-review/by-alice.md",
    );
  });

  test("derive-approvals without --feature: looks in in-place code-review dir", () => {
    const cwd = track(makeBoundedProject());
    // Bounded code-review exists but in-place does not.
    const reviewDir = path.join(boundedPipelineRoot(cwd), "code-review");
    fs.mkdirSync(reviewDir, { recursive: true });
    fs.writeFileSync(path.join(reviewDir, "by-alice.md"), "## Review of backend\n");
    const r = runCLI(["derive-approvals", "--json"], { cwd });
    // Without --feature, in-place reviewDir doesn't exist → exits 2 with error.
    assert.equal(r.status, 2,
      "derive-approvals without --feature must fail (in-place code-review doesn't exist)");
    assert.match(r.stderr, /pipeline\/code-review/,
      "error must reference the in-place path — confirms bounded dir was not used");
  });
});

// ── 7. advise — passes bounded gatesDir to runAdvise ─────────────────────────

describe("devteam advise --feature: reads bounded gatesDir", () => {
  test("advise exits 0 with no items when bounded gatesDir has only PASS gates", () => {
    const cwd = track(makeBoundedProject());
    // Seed a gate with no noted_for_followup items.
    seedBoundedGate(cwd, "stage-01", {
      stage: "stage-01", status: "PASS",
      noted_for_followup: [],
    });
    const r = runCLI(["advise", "--feature", FEATURE, "--json"], { cwd });
    assert.equal(r.status, 0, `advise exited ${r.status}: ${r.stderr}`);
    const result = JSON.parse(r.stdout);
    assert.ok(Array.isArray(result.items), "advise returned items array");
  });

  test("advise without --feature: uses in-place gatesDir (bounded gate not visible)", () => {
    const cwd = track(makeBoundedProject());
    seedBoundedGate(cwd, "stage-01", {
      stage: "stage-01", status: "PASS",
      noted_for_followup: [{ id: "AC-99", description: "something" }],
    });
    // Without --feature, in-place gatesDir is used — no items there.
    const r = runCLI(["advise", "--json"], { cwd });
    assert.equal(r.status, 0, `advise exited ${r.status}: ${r.stderr}`);
    const result = JSON.parse(r.stdout);
    // In-place gatesDir is empty → no items found.
    assert.equal(result.items.length, 0,
      "advise without --feature must return 0 items (in-place gatesDir is empty)");
  });
});

// ── 8. replay — reads gate from bounded gatesDir ─────────────────────────────

describe("devteam replay --feature: reads bounded gatesDir", () => {
  test("replay reads gate from bounded path (not in-place) when --feature is set", () => {
    const cwd = track(makeBoundedProject());
    // Only seed the gate in the bounded dir, not in-place.
    seedBoundedGate(cwd, "stage-01", { stage: "stage-01", status: "PASS" });
    // No gate at in-place path → if replay uses in-place, it would exit 1 with "No gate at..."
    const inPlaceGate = path.join(cwd, "pipeline", "gates", "stage-01.json");
    assert.ok(!fs.existsSync(inPlaceGate), "in-place gate must not exist for this test");

    // Run replay with --dry-run so it doesn't dispatch. It reads the gate, finds
    // the stage definition, and (potentially) tries to render prompts. The key
    // assertion is that it does NOT exit with "No gate at" (it found the bounded gate).
    const r = runCLI(["replay", "stage-01", "--feature", FEATURE, "--dry-run", "--json"], { cwd });
    // replay may fail later (e.g. prompt rendering needs a richer project), but
    // it must NOT fail with "No gate at <in-place-path>" — that would mean it
    // didn't use the bounded gatesDir.
    assert.ok(
      !r.stderr.includes(`No gate at ${inPlaceGate}`),
      `replay must not look for gate at in-place path; stderr: ${r.stderr}`,
    );
  });

  test("replay without --feature exits 1 when bounded gate exists but in-place does not", () => {
    const cwd = track(makeBoundedProject());
    seedBoundedGate(cwd, "stage-01", { stage: "stage-01", status: "PASS" });
    // Without --feature, replay uses in-place gatesDir (no gate there) → exit 1.
    const r = runCLI(["replay", "stage-01", "--dry-run", "--json"], { cwd });
    assert.equal(r.status, 1, "without --feature, replay must fail (in-place gate absent)");
    assert.match(r.stderr, /No gate at/,
      "must report missing in-place gate — confirms in-place dir was used");
  });
});
