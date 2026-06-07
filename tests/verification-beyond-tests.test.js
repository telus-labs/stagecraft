// G7 — Verification beyond tests (stage-06d) structural tests.
//
// Stagecraft itself doesn't EXECUTE property-based / mutation / formal
// verifiers — those are external tools the verifier role invokes inside
// the model's Bash session. This test file covers:
//   - Stage definition shape + ordering + track inclusion
//   - Schema required fields + enum constraints
//   - Role brief shape (read-only, distinct from qa / red-team)
//   - Skill structure (five phases + selection guide)
//   - Template sections
//   - Adapter integration (claude-code ROLE_FRONTMATTER + install roundtrip)
//   - Stage prompt rendering wires up the verifier workstream

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeTargetProject, cleanup, runCLI } = require("./_helpers");

const REPO_ROOT = path.resolve(__dirname, "..");

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
test.afterEach?.(() => { _dirs.forEach(cleanup); _dirs = []; });

// -- Stage definition --------------------------------------------------------

test("core/pipeline/stages.js has verification-beyond-tests at stage-06d", () => {
  const { STAGES, getStage } = require(path.join(REPO_ROOT, "core", "pipeline", "stages"));
  assert.ok(STAGES["verification-beyond-tests"], "STAGES has no verification-beyond-tests entry");
  const s = getStage("verification-beyond-tests");
  assert.equal(s.stage, "stage-06d");
  assert.deepEqual(s.roles, ["verifier"]);
  assert.equal(s.artifact, "pipeline/verification-report.md");
  assert.equal(s.template, "verification-report-template.md");
  // Gate skeleton fields:
  for (const f of [
    "methods_attempted", "methods_skipped", "candidates_inventoried",
    "property_based", "mutation", "formal",
    "findings_count", "blocking_findings", "non_blocking_findings",
  ]) {
    assert.ok(f in s.gate, `gate skeleton missing "${f}"`);
  }
});

test("verification-beyond-tests is ordered after observability-gate and before sign-off", () => {
  const { ORDERED_STAGE_NAMES } = require(path.join(REPO_ROOT, "core", "pipeline", "stages"));
  const ob = ORDERED_STAGE_NAMES.indexOf("observability-gate");
  const vb = ORDERED_STAGE_NAMES.indexOf("verification-beyond-tests");
  const so = ORDERED_STAGE_NAMES.indexOf("sign-off");
  assert.ok(ob >= 0 && vb >= 0 && so >= 0);
  assert.ok(ob < vb && vb < so, `expected observability-gate(${ob}) < verification-beyond-tests(${vb}) < sign-off(${so})`);
});

test("verification-beyond-tests is full-only; absent from quick/nano/hotfix/config-only/dep-update", () => {
  const { orderedStageNamesForTrack } = require(path.join(REPO_ROOT, "core", "pipeline", "stages"));
  assert.ok(orderedStageNamesForTrack("full").includes("verification-beyond-tests"));
  for (const t of ["quick", "nano", "hotfix", "config-only", "dep-update"]) {
    assert.ok(!orderedStageNamesForTrack(t).includes("verification-beyond-tests"), `${t} should NOT include verification-beyond-tests`);
  }
});

// -- Schema ------------------------------------------------------------------

test("stage-06d schema declares the G7 required fields", () => {
  const p = path.join(REPO_ROOT, "core", "gates", "schemas", "stage-06d.schema.json");
  assert.ok(fs.existsSync(p));
  const s = JSON.parse(fs.readFileSync(p, "utf8"));
  assert.equal(s.$id, "urn:stagecraft:schema:stage-06d");
  for (const f of [
    "methods_attempted", "methods_skipped", "candidates_inventoried",
    "findings_count", "blocking_findings",
  ]) {
    assert.ok(s.required.includes(f), `stage-06d schema must require "${f}"`);
  }
});

test("stage-06d schema constrains methods_attempted to known method names", () => {
  const s = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "core", "gates", "schemas", "stage-06d.schema.json"), "utf8"));
  const enumVals = s.properties.methods_attempted.items.enum;
  for (const m of ["property", "mutation", "formal"]) {
    assert.ok(enumVals.includes(m), `methods_attempted enum must include "${m}"`);
  }
  // attempted_but_blocked:* variants for honest reporting:
  assert.ok(enumVals.some((v) => v.startsWith("attempted_but_blocked:")));
});

test("stage-06d schema requires methods_skipped entries to carry a reason", () => {
  const s = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "core", "gates", "schemas", "stage-06d.schema.json"), "utf8"));
  const itemSchema = s.properties.methods_skipped.items;
  assert.ok(itemSchema.required.includes("reason"));
  assert.ok(itemSchema.required.includes("method"));
  // reason has minLength: 1 — no empty-string skips.
  assert.equal(itemSchema.properties.reason.minLength, 1);
});

test("stage-06d schema blocking_findings entries require method + summary", () => {
  const s = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "core", "gates", "schemas", "stage-06d.schema.json"), "utf8"));
  const item = s.properties.blocking_findings.items;
  for (const r of ["method", "summary"]) {
    assert.ok(item.required.includes(r), `blocking_findings item must require "${r}"`);
  }
});

// -- Role + skill + template -------------------------------------------------

test("roles/verifier.md exists and describes the five-phase method", () => {
  const p = path.join(REPO_ROOT, "roles", "verifier.md");
  assert.ok(fs.existsSync(p));
  const text = fs.readFileSync(p, "utf8");
  assert.match(text, /Verifier Role Brief/i);
  // The five phases explicitly:
  for (const phase of ["Phase 1", "Phase 2", "Phase 3", "Phase 4", "Phase 5"]) {
    assert.match(text, new RegExp(phase), `verifier brief missing "${phase}"`);
  }
  // Read-only contract:
  assert.match(text, /do \*\*not\*\* modify production code/i);
  // Distinct-from boundary:
  assert.match(text, /Distinct from/i);
});

test("skills/verification-beyond-tests/SKILL.md has YAML frontmatter + selection table", () => {
  const p = path.join(REPO_ROOT, "skills", "verification-beyond-tests", "SKILL.md");
  assert.ok(fs.existsSync(p));
  const text = fs.readFileSync(p, "utf8");
  assert.match(text.slice(0, 5), /^---/);
  assert.match(text, /^name: verification-beyond-tests$/m);
  // Method selection guide:
  assert.match(text, /Property-based/);
  assert.match(text, /Mutation/);
  assert.match(text, /Formal/);
  // Property shape vocabulary:
  for (const shape of ["Round-trip", "Idempotence", "Commutativity"]) {
    assert.match(text, new RegExp(shape), `skill missing property shape "${shape}"`);
  }
});

test("templates/verification-report-template.md has the expected sections", () => {
  const p = path.join(REPO_ROOT, "templates", "verification-report-template.md");
  assert.ok(fs.existsSync(p));
  const text = fs.readFileSync(p, "utf8");
  for (const heading of [
    "## Summary",
    "## Candidate Inventory",
    "## Property-Based Testing",
    "## Mutation Testing",
    "## Formal Verification",
    "## Skipped Methods",
    "## Triage",
    "## Recommendations",
    "## Approval line",
  ]) {
    assert.match(text, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `template missing "${heading}"`);
  }
});

// -- Adapter integration -----------------------------------------------------

test("claude-code adapter has a ROLE_FRONTMATTER entry for 'verifier'", () => {
  const text = fs.readFileSync(path.join(REPO_ROOT, "hosts", "claude-code", "adapter.js"), "utf8");
  assert.match(text, /\bverifier:\s*\{/);
  assert.match(text, /Verification-beyond-tests/i);
});

test("`devteam init --host claude-code` installs verifier brief + skill", () => {
  const cwd = track(makeTargetProject());
  const r = runCLI(["init", "--host", "claude-code"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(cwd, ".claude/agents/verifier.md")));
  assert.ok(fs.existsSync(path.join(cwd, ".claude/skills/verification-beyond-tests/SKILL.md")));
});

test("`devteam init --host codex` installs verifier brief + skill", () => {
  const cwd = track(makeTargetProject());
  const r = runCLI(["init", "--host", "codex"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(cwd, ".codex/prompts/roles/verifier.md")));
  assert.ok(fs.existsSync(path.join(cwd, ".codex/skills/verification-beyond-tests/SKILL.md")));
});

test("`devteam stage verification-beyond-tests` renders a prompt referencing the role + artifact", () => {
  const cwd = track(makeTargetProject({ config: "routing:\n  default_host: claude-code\npipeline:\n  default_track: full\n" }));
  runCLI(["init", "--host", "claude-code"], { cwd });
  const r = runCLI(["stage", "verification-beyond-tests", "--feature", "test"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /workstream: verifier/);
  assert.match(r.stdout, /verification-report\.md/);
  assert.match(r.stdout, /verification-report-template\.md/);
});
