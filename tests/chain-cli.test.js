const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { makeTargetProject, seedGate, cleanup, runCLI } = require("./_helpers");

let dirs = [];
function track(cwd) { dirs.push(cwd); return cwd; }
afterEach(() => { dirs.forEach(cleanup); dirs = []; });

describe("gate chain CLI authentication", () => {
  it("stamps and verifies an authenticated chain", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { status: "PASS" });
    const env = { DEVTEAM_SIGNING_SECRET: "test-secret" };
    const stamped = runCLI(["stamp-chain", "--cwd", cwd], { env });
    assert.equal(stamped.status, 0);
    assert.match(stamped.stdout, /Authenticated 1 stage gate/);

    const verified = runCLI(["verify-chain", "--cwd", cwd, "--require-signed", "--json"], { env });
    assert.equal(verified.status, 0);
    const payload = JSON.parse(verified.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.require_signed, true);
    assert.deepEqual(payload.invalid_macs, []);
  });

  it("honors pipeline.require_signed_gates and fails without a secret", () => {
    const cwd = track(makeTargetProject({
      config: "pipeline:\n  default_track: full\n  require_signed_gates: true\n",
    }));
    seedGate(cwd, "stage-01", { status: "PASS" });
    const unsigned = runCLI(["stamp-chain", "--cwd", cwd], { env: { DEVTEAM_SIGNING_SECRET: "" } });
    assert.equal(unsigned.status, 0);

    const verified = runCLI(["verify-chain", "--cwd", cwd, "--json"], {
      env: { DEVTEAM_SIGNING_SECRET: "" },
    });
    assert.equal(verified.status, 1);
    const payload = JSON.parse(verified.stdout);
    assert.deepEqual(payload.unsigned, ["stage-01"]);
  });

  it("does not expose the signing secret in gate JSON", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { status: "PASS" });
    runCLI(["stamp-chain", "--cwd", cwd], { env: { DEVTEAM_SIGNING_SECRET: "never-write-this" } });
    const gate = require(path.join(cwd, "pipeline", "gates", "stage-01.json"));
    assert.doesNotMatch(JSON.stringify(gate), /never-write-this/);
  });
});
