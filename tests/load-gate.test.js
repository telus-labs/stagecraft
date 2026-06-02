const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadGateSafe, MAX_GATE_BYTES } = require("../core/gates/load-gate");

function tmpFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devteam-test-load-gate-"));
  const f = path.join(dir, "stage-01.json");
  if (content !== null) fs.writeFileSync(f, content, "utf8");
  return { dir, file: f };
}

describe("loadGateSafe", () => {
  it("parses a valid gate file", () => {
    const { file } = tmpFile('{"stage":"stage-01","status":"PASS"}');
    const { gate, error } = loadGateSafe(file);
    assert.equal(error, null);
    assert.equal(gate.stage, "stage-01");
    assert.equal(gate.status, "PASS");
  });

  it("returns a clear error on malformed JSON, not a thrown SyntaxError", () => {
    const { file } = tmpFile('{"stage":"stage-01",,,}');
    const { gate, error } = loadGateSafe(file);
    assert.equal(gate, null);
    assert.match(error, /malformed JSON/);
    assert.match(error, /stage-01\.json/);
  });

  it("returns a clear error on missing file (ENOENT)", () => {
    const { gate, error } = loadGateSafe("/tmp/does-not-exist-stage-99.json");
    assert.equal(gate, null);
    assert.match(error, /not found/);
  });

  it("rejects oversized files", () => {
    // Build a JSON file just over the cap. Use a string field padded out
    // with a single character so the file is valid JSON but big.
    const padding = "x".repeat(MAX_GATE_BYTES);
    const { file } = tmpFile(`{"stage":"stage-01","pad":"${padding}"}`);
    const { gate, error } = loadGateSafe(file);
    assert.equal(gate, null);
    assert.match(error, /exceeds/);
  });

  it("handles partial-write truncation (real-world: model crash mid-emit)", () => {
    const { file } = tmpFile('{"stage":"stage-01","status":"PA');
    const { gate, error } = loadGateSafe(file);
    assert.equal(gate, null);
    assert.match(error, /malformed JSON/);
  });
});
