// C4 — Reproducibility helpers + `devteam reproduce` CLI.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeTargetProject, cleanup, runCLI, seedGate } = require("./_helpers");
const {
  sha256,
  hashSystemPrompt,
  hashTools,
  reproducibilityFingerprint,
  compareFingerprints,
  replayReadiness,
  REPRODUCIBILITY_FIELDS,
} = require("../core/reproducibility");

const REPO_ROOT = path.resolve(__dirname, "..");

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
test.afterEach?.(() => { _dirs.forEach(cleanup); _dirs = []; });

// -- Hash helpers ------------------------------------------------------------

test("sha256 produces a `sha256:<hex>` formatted string", () => {
  const h = sha256("hello");
  assert.match(h, /^sha256:[0-9a-f]{64}$/);
});

test("sha256 is deterministic on the same input", () => {
  assert.equal(sha256("foo"), sha256("foo"));
});

test("sha256 changes when input changes by a single character", () => {
  assert.notEqual(sha256("foo"), sha256("fop"));
});

test("hashSystemPrompt normalizes trailing whitespace per line", () => {
  // The two prompts differ only in trailing whitespace; hash must match.
  const promptA = "Line one\nLine two\nLine three";
  const promptB = "Line one   \nLine two\t\nLine three  ";
  assert.equal(hashSystemPrompt(promptA), hashSystemPrompt(promptB));
});

test("hashSystemPrompt is sensitive to non-trailing content changes", () => {
  assert.notEqual(
    hashSystemPrompt("Line one\nLine two"),
    hashSystemPrompt("Line one\nLine three"),
  );
});

test("hashSystemPrompt returns null for non-string input", () => {
  assert.equal(hashSystemPrompt(null), null);
  assert.equal(hashSystemPrompt(undefined), null);
  assert.equal(hashSystemPrompt(42), null);
});

test("hashTools sorts tool names so order doesn't change the hash", () => {
  assert.equal(
    hashTools(["Read", "Write", "Edit"]),
    hashTools(["Write", "Edit", "Read"]),
  );
});

test("hashTools deduplicates", () => {
  assert.equal(
    hashTools(["Read", "Write"]),
    hashTools(["Read", "Write", "Read"]),
  );
});

test("hashTools returns null for empty / non-array input", () => {
  assert.equal(hashTools([]), null);
  assert.equal(hashTools(null), null);
  assert.equal(hashTools("Read"), null);
});

// -- Fingerprint + diff ------------------------------------------------------

test("reproducibilityFingerprint pulls only the reproducibility fields + identity", () => {
  const gate = {
    stage: "stage-04", workstream: "backend", host: "codex", status: "PASS",
    orchestrator: "devteam@0.3.0", timestamp: "2026-05-29T10:00:00Z",
    model: "gpt-5", model_version: "gpt-5-20251101", temperature: 0.0,
    seed: 42, max_tokens: 8000,
    system_prompt_hash: `sha256:${"a".repeat(64)}`,
    tools_hash: `sha256:${"b".repeat(64)}`,
    // Non-reproducibility fields the fingerprint must NOT include:
    blockers: [], warnings: [], cost_usd: 0.12, tokens_in: 1000,
  };
  const fp = reproducibilityFingerprint(gate);
  for (const f of REPRODUCIBILITY_FIELDS) assert.equal(fp[f], gate[f]);
  assert.equal(fp.stage, "stage-04");
  assert.equal(fp.workstream, "backend");
  assert.equal(fp.host, "codex");
  assert.equal(fp.orchestrator, "devteam@0.3.0");
  // Must not leak unrelated fields:
  assert.equal(fp.blockers, undefined);
  assert.equal(fp.cost_usd, undefined);
});

test("reproducibilityFingerprint fills missing fields with null (so audits can distinguish absent vs zero)", () => {
  const gate = { stage: "stage-04", model: "gpt-5" }; // sparse
  const fp = reproducibilityFingerprint(gate);
  assert.equal(fp.model, "gpt-5");
  assert.equal(fp.temperature, null);
  assert.equal(fp.seed, null);
  assert.equal(fp.system_prompt_hash, null);
});

test("compareFingerprints emits drift entries only for fields that differ", () => {
  const before = { model: "gpt-5", temperature: 0.0, seed: 42 };
  const after = { model: "gpt-5", temperature: 0.7, seed: 42 };
  const diffs = compareFingerprints(
    reproducibilityFingerprint(before),
    reproducibilityFingerprint(after),
  );
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].field, "temperature");
  assert.equal(diffs[0].kind, "drift");
  assert.equal(diffs[0].before, 0.0);
  assert.equal(diffs[0].after, 0.7);
});

test("compareFingerprints emits absent entries when one side has data the other doesn't", () => {
  const before = { model: "gpt-5", temperature: 0.0 };
  const after = { model: "gpt-5" };
  const diffs = compareFingerprints(
    reproducibilityFingerprint(before),
    reproducibilityFingerprint(after),
  );
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].field, "temperature");
  assert.equal(diffs[0].kind, "absent");
  assert.equal(diffs[0].before, 0.0);
  assert.equal(diffs[0].after, null);
});

test("compareFingerprints --verbose includes match entries", () => {
  const before = { model: "gpt-5" };
  const after = { model: "gpt-5" };
  const verbose = compareFingerprints(
    reproducibilityFingerprint(before),
    reproducibilityFingerprint(after),
    { verbose: true },
  );
  const matches = verbose.filter((d) => d.kind === "match");
  assert.ok(matches.length >= 1);
  assert.equal(matches[0].field, "model");
});

// -- Replay readiness --------------------------------------------------------

test("replayReadiness: full when every reproducibility field is recorded", () => {
  const gate = {
    model: "gpt-5", model_version: "gpt-5-20251101", temperature: 0.0,
    seed: 42, max_tokens: 8000,
    system_prompt_hash: `sha256:${"a".repeat(64)}`,
    tools_hash: `sha256:${"b".repeat(64)}`,
  };
  const r = replayReadiness(gate);
  assert.equal(r.level, "full");
});

test("replayReadiness: partial when required present but helpful missing", () => {
  const gate = {
    model: "gpt-5",
    system_prompt_hash: `sha256:${"a".repeat(64)}`,
  };
  const r = replayReadiness(gate);
  assert.equal(r.level, "partial");
  assert.ok(r.missing_helpful.includes("temperature"));
});

test("replayReadiness: incomplete when a required field is missing", () => {
  const gate = { temperature: 0.0, seed: 42 }; // no model, no system_prompt_hash
  const r = replayReadiness(gate);
  assert.equal(r.level, "incomplete");
  assert.ok(r.missing_required.includes("model"));
  assert.ok(r.missing_required.includes("system_prompt_hash"));
});

// -- CLI surface -------------------------------------------------------------

test("`devteam reproduce` without a stage prints usage", () => {
  const r = runCLI(["reproduce"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Usage: devteam reproduce/);
});

test("`devteam reproduce <stage>` fails when no gate exists", () => {
  const cwd = track(makeTargetProject());
  const r = runCLI(["reproduce", "stage-04"], { cwd });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /No gate at/);
});

test("`devteam reproduce <stage>` reports recorded fields for a gate with full reproducibility data", () => {
  const cwd = track(makeTargetProject());
  seedGate(cwd, "stage-01", {
    workstream: "pm",
    host: "claude-code",
    status: "PASS",
    model: "claude-opus-4-7",
    model_version: "claude-opus-4-7-20251104",
    temperature: 0.0,
    seed: 42,
    max_tokens: 8000,
    system_prompt_hash: `sha256:${"a".repeat(64)}`,
    tools_hash: `sha256:${"b".repeat(64)}`,
  });
  const r = runCLI(["reproduce", "stage-01"], { cwd });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Reproducibility report/);
  assert.match(r.stdout, /Replay readiness: FULL/);
  assert.match(r.stdout, /claude-opus-4-7-20251104/);
  assert.match(r.stdout, /temperature\s+0/);
});

test("`devteam reproduce <stage>` reports PARTIAL readiness when only required fields present", () => {
  const cwd = track(makeTargetProject());
  seedGate(cwd, "stage-01", {
    workstream: "pm",
    host: "claude-code",
    status: "PASS",
    model: "claude-opus-4-7",
    system_prompt_hash: `sha256:${"a".repeat(64)}`,
  });
  const r = runCLI(["reproduce", "stage-01"], { cwd });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Replay readiness: PARTIAL/);
});

test("`devteam reproduce --json` emits a parseable JSON object", () => {
  const cwd = track(makeTargetProject());
  seedGate(cwd, "stage-01", {
    workstream: "pm",
    host: "claude-code",
    status: "PASS",
    model: "claude-opus-4-7",
    system_prompt_hash: `sha256:${"a".repeat(64)}`,
  });
  const r = runCLI(["reproduce", "stage-01", "--json"], { cwd });
  assert.equal(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.fingerprint.model, "claude-opus-4-7");
  assert.equal(parsed.readiness.level, "partial");
});

// -- Schema --------------------------------------------------------------

test("gate.schema.json declares all reproducibility fields as optional", () => {
  const schemaPath = path.join(REPO_ROOT, "core", "gates", "schemas", "gate.schema.json");
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  for (const f of ["model_version", "temperature", "seed", "max_tokens", "system_prompt_hash", "tools_hash"]) {
    assert.ok(schema.properties[f], `gate.schema must declare property "${f}"`);
    assert.ok(!schema.required.includes(f), `"${f}" must be optional, not required`);
  }
  // The hash fields have a pattern constraint.
  assert.match(schema.properties.system_prompt_hash.pattern, /sha256/);
  assert.match(schema.properties.tools_hash.pattern, /sha256/);
});

// -- Adapter prompt rendering integration ----------------------------------

test("claude-code renderStagePrompt includes a system_prompt_hash in the gate skeleton hint", () => {
  const adapter = require(path.join(REPO_ROOT, "hosts", "claude-code", "adapter.js"));
  const descriptor = {
    stage: "stage-01",
    name: "requirements",
    role: "pm",
    workstreamId: "stage-01",
    objective: "test",
    readFirst: ["AGENTS.md"],
    allowedWrites: ["pipeline/brief.md"],
    artifact: "pipeline/brief.md",
    template: "brief-template.md",
    expectedGate: {},
  };
  const ctx = { track: "full", feature: "x", orchestrator: "devteam@test" };
  const prompt = adapter.renderStagePrompt(descriptor, ctx);
  assert.match(prompt, /Optional reproducibility \(C4\)/);
  assert.match(prompt, /system_prompt_hash/);
  assert.match(prompt, /sha256:[0-9a-f]{64}/);
});
