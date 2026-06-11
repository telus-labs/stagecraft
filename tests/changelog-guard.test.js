// changelog-guard decision logic — unit tests for scripts/changelog-guard.js.
// Tests the exported `evaluate()` function directly; no subprocesses needed.
// Closes BACKLOG C8.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { evaluate, GUARDED_PREFIXES } = require(
  path.join(__dirname, "..", "scripts", "changelog-guard.js"),
);

test("evaluate: touched core/ without fragment → fail", () => {
  const r = evaluate(["core/orchestrator.js", "core/pipeline/stages.js"], [], "");
  assert.equal(r.pass, false);
  assert.match(r.reason, /guarded paths/);
});

test("evaluate: touched core/ with fragment → pass", () => {
  const r = evaluate(
    ["core/orchestrator.js"],
    ["changelog.d/feat-my-thing.md"],
    "",
  );
  assert.equal(r.pass, true);
  assert.match(r.reason, /fragment present/);
});

test("evaluate: [skip-changelog] in skip text → pass even without fragment", () => {
  const r = evaluate(
    ["core/driver.js", "bin/devteam"],
    [],
    "refactor: internal cleanup [skip-changelog]",
  );
  assert.equal(r.pass, true);
  assert.match(r.reason, /opt-out/);
});

test("evaluate: touched only docs/ → pass (not a guarded path)", () => {
  const r = evaluate(["docs/faq.md", "docs/concepts.md"], [], "");
  assert.equal(r.pass, true);
  assert.match(r.reason, /no guarded paths/);
});

test("evaluate: touched bin/ without fragment → fail", () => {
  const r = evaluate(["bin/devteam"], [], "update help text");
  assert.equal(r.pass, false);
});

test("evaluate: touched hosts/ with fragment → pass", () => {
  const r = evaluate(
    ["hosts/claude-code/adapter.js"],
    ["changelog.d/fix-adapter.md"],
    "",
  );
  assert.equal(r.pass, true);
});

test("evaluate: README.md in changelog.d/ does NOT count as a fragment", () => {
  const r = evaluate(
    ["core/orchestrator.js"],
    ["changelog.d/README.md"],
    "",
  );
  assert.equal(r.pass, false, "README.md must not satisfy the fragment requirement");
});

test("evaluate: [skip-changelog] anywhere in multi-line skip text → pass", () => {
  const skipText = "normal first commit\n[skip-changelog] docs only\nanother commit";
  const r = evaluate(["rules/gates.md"], [], skipText);
  assert.equal(r.pass, true);
});

test("evaluate: GUARDED_PREFIXES covers the six expected directories", () => {
  const expected = ["core/", "bin/", "hosts/", "rules/", "roles/", "skills/"];
  for (const prefix of expected) {
    assert.ok(GUARDED_PREFIXES.includes(prefix), `${prefix} must be guarded`);
  }
});
