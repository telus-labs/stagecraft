const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { REPO_ROOT, makeTargetProject, cleanup } = require("./_helpers");
const { parseReviewFile, reviewerNameFromPath } =
  require(path.join(REPO_ROOT, "core", "hooks", "approval-derivation"));

const HOOK = path.join(REPO_ROOT, "core", "hooks", "approval-derivation.js");

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
afterEach(() => { _dirs.forEach(cleanup); _dirs = []; });

function writeReview(cwd, filename, body) {
  const dir = path.join(cwd, "pipeline", "code-review");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), body);
  return path.join(dir, filename);
}

function runHook(cwd) {
  const r = spawnSync("node", [HOOK], { cwd, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout || "" };
}

function readGate(cwd, name) {
  const file = path.join(cwd, "pipeline", "gates", `${name}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

describe("approval-derivation: parser", () => {
  it("extracts per-area APPROVED verdicts", () => {
    const cwd = track(makeTargetProject());
    const file = writeReview(cwd, "by-backend.md",
      "## Review of frontend\nLGTM\nREVIEW: APPROVED\n\n## Review of platform\nLGTM\nREVIEW: APPROVED\n");
    const v = parseReviewFile(file);
    assert.equal(v.length, 2);
    assert.deepEqual(v.map((x) => x.area).sort(), ["frontend", "platform"]);
    assert.ok(v.every((x) => x.verdict === "APPROVED"));
  });

  it("extracts CHANGES_REQUESTED", () => {
    const cwd = track(makeTargetProject());
    const file = writeReview(cwd, "by-frontend.md",
      "## Review of backend\nbug\nREVIEW: CHANGES REQUESTED\n");
    const v = parseReviewFile(file);
    assert.equal(v.length, 1);
    assert.equal(v[0].verdict, "CHANGES_REQUESTED");
  });

  it("ignores sections without REVIEW marker", () => {
    const cwd = track(makeTargetProject());
    const file = writeReview(cwd, "by-platform.md",
      "## Review of backend\nLooking at this...\n\n## Review of qa\nfine\nREVIEW: APPROVED\n");
    const v = parseReviewFile(file);
    assert.equal(v.length, 1);
    assert.equal(v[0].area, "qa");
  });

  it("ignores unknown areas", () => {
    const cwd = track(makeTargetProject());
    const file = writeReview(cwd, "by-backend.md",
      "## Review of marketing\nlol\nREVIEW: APPROVED\n");
    const v = parseReviewFile(file);
    assert.equal(v.length, 0);
  });

  it("maps reviewer filename to agent name", () => {
    assert.equal(reviewerNameFromPath("/p/by-backend.md"), "dev-backend");
    assert.equal(reviewerNameFromPath("/p/by-frontend.md"), "dev-frontend");
    assert.equal(reviewerNameFromPath("/p/by-platform.md"), "dev-platform");
    assert.equal(reviewerNameFromPath("/p/by-qa.md"), "dev-qa");
    assert.equal(reviewerNameFromPath("/p/by-security.md"), "security-engineer");
    assert.equal(reviewerNameFromPath("/p/by-principal.md"), "principal");
    assert.equal(reviewerNameFromPath("/p/notamatch.md"), null);
  });
});

describe("approval-derivation: gate upsert (end-to-end)", () => {
  it("creates a new gate with contract F identity fields", () => {
    const cwd = track(makeTargetProject());
    writeReview(cwd, "by-backend.md", "## Review of frontend\nLGTM\nREVIEW: APPROVED\n");
    runHook(cwd);
    const g = readGate(cwd, "stage-05.frontend");
    assert.ok(g, "gate not written");
    assert.equal(g.stage, "stage-05");
    assert.equal(g.workstream, "frontend");
    assert.equal(g.host, "claude-code");
    assert.match(g.orchestrator, /^devteam@/);
    assert.equal(g.approvals.length, 1);
    assert.equal(g.approvals[0], "dev-backend");
  });

  it("PASS only when approvals >= required AND no changes_requested", () => {
    const cwd = track(makeTargetProject());
    writeReview(cwd, "by-backend.md", "## Review of frontend\nA\nREVIEW: APPROVED\n");
    writeReview(cwd, "by-platform.md", "## Review of frontend\nB\nREVIEW: APPROVED\n");
    runHook(cwd);
    const g = readGate(cwd, "stage-05.frontend");
    assert.equal(g.status, "PASS");
    assert.equal(g.approvals.length, 2);
  });

  it("CHANGES_REQUESTED removes prior approval from same reviewer", () => {
    const cwd = track(makeTargetProject());
    writeReview(cwd, "by-backend.md", "## Review of frontend\nA\nREVIEW: APPROVED\n");
    runHook(cwd);
    const g1 = readGate(cwd, "stage-05.frontend");
    assert.deepEqual(g1.approvals, ["dev-backend"]);
    // Now change the same review to CHANGES_REQUESTED
    writeReview(cwd, "by-backend.md", "## Review of frontend\nWait\nREVIEW: CHANGES REQUESTED\n");
    runHook(cwd);
    const g2 = readGate(cwd, "stage-05.frontend");
    assert.equal(g2.approvals.length, 0, "prior approval should be removed");
    assert.equal(g2.changes_requested.length, 1);
    assert.equal(g2.status, "FAIL");
  });

  it("dedupes approval from the same reviewer on re-run", () => {
    const cwd = track(makeTargetProject());
    writeReview(cwd, "by-backend.md", "## Review of frontend\nA\nREVIEW: APPROVED\n");
    runHook(cwd);
    runHook(cwd); // same review file, run hook again
    const g = readGate(cwd, "stage-05.frontend");
    assert.equal(g.approvals.length, 1);
  });
});
