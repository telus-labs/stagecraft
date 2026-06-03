// bin/devteam `derive-approvals` subcommand — invokes the
// approval-derivation hook from the shell with a synthetic PostToolUse
// payload, so operators who hand-edit pipeline/code-review/by-*.md
// outside an active Claude Code session can still get the per-area
// stage-05 gates re-derived. The hook itself is tested separately under
// approval-derivation.test.js; this suite covers the CLI wiring:
// arg resolution, the no-arg fanout, error paths, and end-to-end gate
// content.

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeTargetProject, cleanup, runCLI } = require("./_helpers");

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
afterEach(() => { _dirs.forEach(cleanup); _dirs = []; });

function writeReview(cwd, filename, body) {
  const dir = path.join(cwd, "pipeline", "code-review");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), body);
  return path.join(dir, filename);
}

function readGate(cwd, name) {
  const file = path.join(cwd, "pipeline", "gates", `${name}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

describe("derive-approvals: end-to-end", () => {
  it("rewrites stage-05.<area>.json with the approval when given a single review file", () => {
    const cwd = track(makeTargetProject());
    const file = writeReview(cwd, "by-platform.md",
      "## Review of qa\nLooks good, tests cover AC-11/AC-13.\nREVIEW: APPROVED\n");

    const r = runCLI(["derive-approvals", file], { cwd });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);

    const gate = readGate(cwd, "stage-05.qa");
    assert.ok(gate, "stage-05.qa.json should exist after derive");
    assert.deepEqual(gate.approvals, ["dev-platform"]);
    assert.equal(gate.changes_requested.length, 0);
    assert.equal(gate.area, "qa");
  });

  it("flips an existing per-area gate to PASS once required_approvals is met", () => {
    const cwd = track(makeTargetProject());
    // Seed: dev-backend already approved qa; only need one more for matrix quorum.
    writeReview(cwd, "by-backend.md",
      "## Review of qa\nLGTM\nREVIEW: APPROVED\n");
    const firstRun = runCLI(["derive-approvals", "pipeline/code-review/by-backend.md"], { cwd });
    assert.equal(firstRun.status, 0);
    const seeded = readGate(cwd, "stage-05.qa");
    assert.equal(seeded.status, "FAIL", "single approval should still be FAIL under matrix");
    assert.equal(seeded.required_approvals, 2);

    // Now add the second approval from a non-area reviewer.
    writeReview(cwd, "by-platform.md",
      "## Review of qa\nLGTM\nREVIEW: APPROVED\n");
    const r = runCLI(["derive-approvals", "pipeline/code-review/by-platform.md"], { cwd });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);

    const gate = readGate(cwd, "stage-05.qa");
    assert.equal(gate.status, "PASS");
    assert.deepEqual(gate.approvals.sort(), ["dev-backend", "dev-platform"]);
  });

  it("with no argument, derives every by-*.md under pipeline/code-review/", () => {
    const cwd = track(makeTargetProject());
    writeReview(cwd, "by-backend.md",
      "## Review of frontend\nLGTM\nREVIEW: APPROVED\n\n## Review of qa\nLGTM\nREVIEW: APPROVED\n");
    writeReview(cwd, "by-platform.md",
      "## Review of backend\nLGTM\nREVIEW: APPROVED\n");

    const r = runCLI(["derive-approvals"], { cwd });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);

    assert.deepEqual(readGate(cwd, "stage-05.frontend").approvals, ["dev-backend"]);
    assert.deepEqual(readGate(cwd, "stage-05.qa").approvals, ["dev-backend"]);
    assert.deepEqual(readGate(cwd, "stage-05.backend").approvals, ["dev-platform"]);
  });

  it("reports JSON with --json", () => {
    const cwd = track(makeTargetProject());
    writeReview(cwd, "by-backend.md",
      "## Review of qa\nLGTM\nREVIEW: APPROVED\n");

    const r = runCLI(["derive-approvals", "--json"], { cwd });
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.files.length, 1);
    assert.equal(out.files[0].ok, true);
    assert.match(out.files[0].file, /by-backend\.md$/);
  });
});

describe("derive-approvals: error paths", () => {
  it("rejects when pipeline/code-review/ does not exist", () => {
    const cwd = track(makeTargetProject());
    const r = runCLI(["derive-approvals"], { cwd });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /pipeline\/code-review\/ does not exist/);
  });

  it("rejects a missing file argument", () => {
    const cwd = track(makeTargetProject());
    // Create the dir so the second check (file existence) is what fires.
    fs.mkdirSync(path.join(cwd, "pipeline", "code-review"), { recursive: true });
    const r = runCLI(["derive-approvals", "pipeline/code-review/by-ghost.md"], { cwd });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /file not found/);
  });

  it("rejects a file outside pipeline/code-review/", () => {
    const cwd = track(makeTargetProject());
    fs.mkdirSync(path.join(cwd, "pipeline", "code-review"), { recursive: true });
    // Put a markdown file somewhere else and try to derive from it.
    fs.writeFileSync(path.join(cwd, "stray.md"), "## Review of qa\nREVIEW: APPROVED\n");
    const r = runCLI(["derive-approvals", "stray.md"], { cwd });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /not under pipeline\/code-review\//);
  });

  it("rejects a non-by-*.md filename even when inside the review dir", () => {
    const cwd = track(makeTargetProject());
    const dir = path.join(cwd, "pipeline", "code-review");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "notes.md"), "scratch\n");
    const r = runCLI(["derive-approvals", "pipeline/code-review/notes.md"], { cwd });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /not a by-<reviewer>\.md file/);
  });

  it("rejects empty pipeline/code-review/ when no arg is given", () => {
    const cwd = track(makeTargetProject());
    fs.mkdirSync(path.join(cwd, "pipeline", "code-review"), { recursive: true });
    const r = runCLI(["derive-approvals"], { cwd });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no by-\*\.md review files/);
  });
});
