const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { REPO_ROOT } = require("./_helpers");
const { checkStoplist, explainMatches } = require(path.join(REPO_ROOT, "core", "guards", "stoplist"));

describe("stoplist: matches", () => {
  it("matches auth keyword", () => {
    const m = checkStoplist({ description: "add auth middleware", cwd: REPO_ROOT });
    assert.ok(m.length > 0);
    assert.ok(m.some((x) => x.name.toLowerCase().includes("auth")));
  });

  it("matches PII keyword", () => {
    const m = checkStoplist({ description: "store user PII in the cache", cwd: REPO_ROOT });
    assert.ok(m.length > 0);
  });

  it("matches payments", () => {
    const m = checkStoplist({ description: "integrate Stripe payments", cwd: REPO_ROOT });
    assert.ok(m.length > 0);
  });

  it("matches migration", () => {
    const m = checkStoplist({ description: "add schema migration for orders table", cwd: REPO_ROOT });
    assert.ok(m.length > 0);
  });
});

describe("stoplist: passes harmless changes", () => {
  it("doesn't match copy edits", () => {
    const m = checkStoplist({ description: "fix typo in README", cwd: REPO_ROOT });
    assert.equal(m.length, 0);
  });

  it("doesn't match dependency-version bumps without matching keywords", () => {
    const m = checkStoplist({ description: "bump react from 18.3.0 to 18.3.1", cwd: REPO_ROOT });
    assert.equal(m.length, 0);
  });

  it("doesn't match empty description", () => {
    const m = checkStoplist({ description: "", cwd: REPO_ROOT });
    assert.equal(m.length, 0);
  });
});

describe("stoplist: explanation", () => {
  it("explains matches in human-readable form", () => {
    const m = checkStoplist({ description: "rotate session secrets", cwd: REPO_ROOT });
    const text = explainMatches(m);
    assert.match(text, /safety stoplist/i);
    assert.match(text, /--force/);
  });
});
