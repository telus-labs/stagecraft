// G4 — red-team stage-04c structural tests.
//
// Locks the contract that:
//   - roles/red-team.md exists and is read-only by design.
//   - skills/red-team/SKILL.md exists with YAML frontmatter.
//   - core/pipeline/stages.js has a stage-04c entry with the expected
//     shape (name "red-team", single role, always-on, correct artifact
//     + template + gate fields).
//   - core/gates/schemas/stage-04c.schema.json exists and lists the
//     red-team-specific required fields.
//   - templates/red-team-report-template.md exists.
//   - hosts/claude-code/adapter.js has a ROLE_FRONTMATTER entry for
//     "red-team".
//   - All hosts install the red-team role brief (via the shared
//     listRoles() source — same path the auditor role uses).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeTargetProject, cleanup, runCLI } = require("./_helpers");

const REPO_ROOT = path.resolve(__dirname, "..");

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
test.afterEach?.(() => { _dirs.forEach(cleanup); _dirs = []; });

test("roles/red-team.md exists and is read-only by design", () => {
  const p = path.join(REPO_ROOT, "roles", "red-team.md");
  assert.ok(fs.existsSync(p), "roles/red-team.md is missing");
  const text = fs.readFileSync(p, "utf8");
  assert.match(text, /Red Team Role Brief/i);
  assert.match(text, /read-only/i);
  // Sanity: explicit "you do not write to src/" assertion.
  assert.match(text, /do \*\*not\*\* write under `src\//);
});

test("skills/red-team/SKILL.md exists with YAML frontmatter", () => {
  const p = path.join(REPO_ROOT, "skills", "red-team", "SKILL.md");
  assert.ok(fs.existsSync(p), "skills/red-team/SKILL.md is missing");
  const text = fs.readFileSync(p, "utf8");
  assert.match(text.slice(0, 5), /^---/, "skill must start with YAML frontmatter");
  assert.match(text, /^name: red-team$/m);
  assert.match(text, /description:/m);
});

test("core/pipeline/stages.js has a red-team stage at stage-04c", () => {
  const { STAGES, getStage } = require(path.join(REPO_ROOT, "core", "pipeline", "stages"));
  assert.ok(STAGES["red-team"], "STAGES has no red-team entry");
  const s = getStage("red-team");
  assert.equal(s.stage, "stage-04c");
  assert.deepEqual(s.roles, ["red-team"]);
  assert.equal(s.artifact, "pipeline/red-team-report.md");
  assert.equal(s.template, "red-team-report-template.md");
  // Gate skeleton has the right shape.
  assert.ok(Array.isArray(s.gate.surfaces_walked));
  assert.equal(s.gate.findings_count, 0);
  assert.ok(s.gate.severity_breakdown);
  assert.deepEqual(s.gate.must_address_before_peer_review, []);
  assert.deepEqual(s.gate.noted_for_followup, []);
  // Red-team is NOT conditional — different from stage-04b.
  assert.equal(s.conditionalOn, undefined);
});

test("red-team is in ORDERED_STAGE_NAMES between security-review and peer-review", () => {
  const { ORDERED_STAGE_NAMES } = require(path.join(REPO_ROOT, "core", "pipeline", "stages"));
  const sr = ORDERED_STAGE_NAMES.indexOf("security-review");
  const rt = ORDERED_STAGE_NAMES.indexOf("red-team");
  const pr = ORDERED_STAGE_NAMES.indexOf("peer-review");
  assert.ok(sr >= 0 && rt >= 0 && pr >= 0);
  assert.ok(sr < rt && rt < pr);
});

test("core/gates/schemas/stage-04c.schema.json declares red-team required fields", () => {
  const p = path.join(REPO_ROOT, "core", "gates", "schemas", "stage-04c.schema.json");
  assert.ok(fs.existsSync(p), "stage-04c schema is missing");
  const s = JSON.parse(fs.readFileSync(p, "utf8"));
  assert.equal(s.$id, "urn:stagecraft:schema:stage-04c");
  // Required must include the red-team-specific fields.
  for (const f of ["surfaces_walked", "findings_count", "severity_breakdown", "must_address_before_peer_review", "noted_for_followup"]) {
    assert.ok(s.required.includes(f), `stage-04c schema must require "${f}"`);
  }
});

test("templates/red-team-report-template.md exists with the expected sections", () => {
  const p = path.join(REPO_ROOT, "templates", "red-team-report-template.md");
  assert.ok(fs.existsSync(p), "template missing");
  const text = fs.readFileSync(p, "utf8");
  // Section headings the skill expects.
  for (const heading of [
    "## Summary",
    "## Surfaces walked",
    "## Findings — must-fix",
    "## Findings — should-fix",
    "## Findings — noted for followup",
    "## Surfaces with no findings",
  ]) {
    assert.match(text, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `template missing "${heading}"`);
  }
});

test("hosts/claude-code/adapter.js has a ROLE_FRONTMATTER entry for red-team", () => {
  const text = fs.readFileSync(path.join(REPO_ROOT, "hosts", "claude-code", "adapter.js"), "utf8");
  // The map key can be unquoted "red-team:" (invalid JS, hyphen) — so it
  // must appear as a quoted key. Match either form.
  assert.match(
    text,
    /["']red-team["']\s*:\s*\{/,
    "ROLE_FRONTMATTER must declare 'red-team' so claude-code installs the subagent",
  );
});

test("`devteam init --host claude-code` installs the red-team role brief + subagent", () => {
  const cwd = track(makeTargetProject());
  const r = runCLI(["init", "--host", "claude-code"], { cwd });
  assert.equal(r.status, 0);
  // claude-code uses the subagent filename from ROLE_FRONTMATTER.name,
  // which is "red-team" → red-team.md under .claude/agents/.
  assert.ok(
    fs.existsSync(path.join(cwd, ".claude/agents/red-team.md")),
    "claude-code init did not lay down .claude/agents/red-team.md",
  );
  assert.ok(
    fs.existsSync(path.join(cwd, ".claude/skills/red-team/SKILL.md")),
    "claude-code init did not lay down the red-team skill",
  );
});

test("`devteam init --host codex` installs the red-team role brief + skill", () => {
  const cwd = track(makeTargetProject());
  const r = runCLI(["init", "--host", "codex"], { cwd });
  assert.equal(r.status, 0);
  assert.ok(fs.existsSync(path.join(cwd, ".codex/prompts/roles/red-team.md")));
  assert.ok(fs.existsSync(path.join(cwd, ".codex/skills/red-team/SKILL.md")));
});

test("`devteam stage red-team` renders a prompt mentioning the role + artifact", () => {
  const cwd = track(makeTargetProject());
  runCLI(["init", "--host", "claude-code"], { cwd });
  const r = runCLI(["stage", "red-team", "--feature", "test"], { cwd });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /workstream: red-team/);
  assert.match(r.stdout, /red-team-report\.md/);
  assert.match(r.stdout, /red-team-report-template\.md/);
});
