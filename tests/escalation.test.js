// Tests for the typed escalation contract parser (ADR-003 / Phase 2 PR-C1).

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { REPO_ROOT, makeTargetProject, cleanup } = require("./_helpers");
const {
  parseRulingLine, parseCannotDecideLine, loadRulings, loadCannotDecide,
} = require(path.join(REPO_ROOT, "core", "escalation"));

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
afterEach(() => { _dirs.forEach(cleanup); _dirs = []; });

describe("parseRulingLine", () => {
  it("parses a typed ruling with a class", () => {
    const r = parseRulingLine("PRINCIPAL-RULING: lint style → accept prettier defaults [class: formatting-only]");
    assert.deepEqual(r, { topic: "lint style", decision: "accept prettier defaults", class: "formatting-only" });
  });

  it("defaults to unclassified when no class tag is present (legacy)", () => {
    const r = parseRulingLine("PRINCIPAL-RULING: auth design → use JWT with 1h expiry");
    assert.equal(r.class, "unclassified");
    assert.equal(r.decision, "use JWT with 1h expiry");
  });

  it("accepts the ASCII -> arrow and lowercases the class", () => {
    const r = parseRulingLine("PRINCIPAL-RULING: dep bump -> approve lodash 4.17.21 [class: Known-Safe-Dependency-Bump]");
    assert.equal(r.topic, "dep bump");
    assert.equal(r.class, "known-safe-dependency-bump");
  });

  it("returns null for a non-ruling line", () => {
    assert.equal(parseRulingLine("some other note"), null);
    assert.equal(parseRulingLine("PRINCIPAL-CANNOT-DECIDE: value → x"), null);
  });
});

describe("parseCannotDecideLine", () => {
  it("parses each valid reason class", () => {
    for (const rc of ["authority", "information", "value"]) {
      const r = parseCannotDecideLine(`PRINCIPAL-CANNOT-DECIDE: ${rc} → who approves this?`);
      assert.equal(r.reason_class, rc);
      assert.equal(r.question, "who approves this?");
    }
  });

  it("falls back to unspecified for an unknown reason class", () => {
    const r = parseCannotDecideLine("PRINCIPAL-CANNOT-DECIDE: vibes → really?");
    assert.equal(r.reason_class, "unspecified");
  });

  it("returns null for a non-cannot-decide line", () => {
    assert.equal(parseCannotDecideLine("PRINCIPAL-RULING: x → y [class: z]"), null);
  });
});

describe("loadRulings / loadCannotDecide", () => {
  it("reads typed lines from a project's context.md in order", () => {
    const cwd = track(makeTargetProject());
    fs.mkdirSync(path.join(cwd, "pipeline"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "pipeline", "context.md"), [
      "## Principal Rulings",
      "",
      "PRINCIPAL-RULING: a → b [class: doc-only]",
      "some prose",
      "PRINCIPAL-CANNOT-DECIDE: authority → who signs off on prod?",
      "PRINCIPAL-RULING: c → d",
      "",
    ].join("\n"));
    const rulings = loadRulings(cwd);
    assert.equal(rulings.length, 2);
    assert.equal(rulings[0].class, "doc-only");
    assert.equal(rulings[1].class, "unclassified");
    const cd = loadCannotDecide(cwd);
    assert.equal(cd.length, 1);
    assert.equal(cd[0].reason_class, "authority");
  });

  it("returns empty arrays when context.md is absent", () => {
    const cwd = track(makeTargetProject({ gates: false }));
    assert.deepEqual(loadRulings(cwd), []);
    assert.deepEqual(loadCannotDecide(cwd), []);
  });
});
