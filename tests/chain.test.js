// Tests for the tamper-evident gate chain (C6).

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { REPO_ROOT, makeTargetProject, seedGate, cleanup } = require("./_helpers");
const { stampChain, verifyChain, stampAll, canonicalGateHash } = require(path.join(REPO_ROOT, "core", "gates", "chain"));

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
afterEach(() => { _dirs.forEach(cleanup); _dirs = []; });

function gatesDirOf(cwd) { return path.join(cwd, "pipeline", "gates"); }

// Seed the first three single-role full-track stages as PASS and stamp them.
function seedAndStamp(cwd) {
  seedGate(cwd, "stage-01", { status: "PASS" });
  seedGate(cwd, "stage-02", { status: "PASS" });
  seedGate(cwd, "stage-03", { status: "PASS" });
  stampAll(gatesDirOf(cwd), "full");
}

describe("gate chain: stamp", () => {
  it("genesis stage gets a null prev_hash; later stages commit to their predecessor", () => {
    const cwd = track(makeTargetProject());
    seedAndStamp(cwd);
    const g1 = JSON.parse(fs.readFileSync(path.join(gatesDirOf(cwd), "stage-01.json"), "utf8"));
    const g2 = JSON.parse(fs.readFileSync(path.join(gatesDirOf(cwd), "stage-02.json"), "utf8"));
    assert.equal(g1.chain.prev_hash, null);
    assert.equal(g1.chain.prev_stage, null);
    assert.equal(g2.chain.prev_stage, "stage-01");
    assert.equal(g2.chain.prev_hash, canonicalGateHash(g1));
  });

  it("hashing is canonical — key order does not matter", () => {
    const a = { status: "PASS", stage: "stage-01", blockers: [] };
    const b = { blockers: [], stage: "stage-01", status: "PASS" };
    assert.equal(canonicalGateHash(a), canonicalGateHash(b));
  });
});

describe("gate chain: verify", () => {
  it("an intact chain verifies", () => {
    const cwd = track(makeTargetProject());
    seedAndStamp(cwd);
    const r = verifyChain(gatesDirOf(cwd), "full");
    assert.equal(r.ok, true);
    assert.equal(r.checked, 3);
    assert.deepEqual(r.breaks, []);
  });

  it("tampering with an earlier gate is detected and located", () => {
    const cwd = track(makeTargetProject());
    seedAndStamp(cwd);
    // Mutate stage-01 AFTER the chain was stamped (simulate tampering).
    const p1 = path.join(gatesDirOf(cwd), "stage-01.json");
    const g1 = JSON.parse(fs.readFileSync(p1, "utf8"));
    g1.status = "FAIL"; // someone rewrites history
    fs.writeFileSync(p1, JSON.stringify(g1, null, 2) + "\n");
    const r = verifyChain(gatesDirOf(cwd), "full");
    assert.equal(r.ok, false);
    // stage-02 committed to the OLD stage-01 hash → its check breaks.
    assert.ok(r.breaks.some((b) => b.stage === "stage-02" && b.prev_stage === "stage-01"));
  });

  it("flags stamped-but-unstamped gates rather than silently passing", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { status: "PASS" });
    seedGate(cwd, "stage-02", { status: "PASS" }); // never stamped
    stampChain(gatesDirOf(cwd), "requirements", "full"); // stamp only stage-01
    const r = verifyChain(gatesDirOf(cwd), "full");
    assert.deepEqual(r.unstamped, ["stage-02"]);
  });

  it("re-stamping after an edit restores the chain (deliberate re-run path)", () => {
    const cwd = track(makeTargetProject());
    seedAndStamp(cwd);
    const p1 = path.join(gatesDirOf(cwd), "stage-01.json");
    const g1 = JSON.parse(fs.readFileSync(p1, "utf8"));
    g1.status = "WARN";
    fs.writeFileSync(p1, JSON.stringify(g1, null, 2) + "\n");
    assert.equal(verifyChain(gatesDirOf(cwd), "full").ok, false);
    stampAll(gatesDirOf(cwd), "full"); // deliberate re-stamp
    assert.equal(verifyChain(gatesDirOf(cwd), "full").ok, true);
  });
});
