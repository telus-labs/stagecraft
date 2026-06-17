// B3 — Deploy cost gate structural tests.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { REPO_ROOT } = require("./_helpers");
const { STAGES } = require(path.join(REPO_ROOT, "core", "pipeline", "stages"));

const DEPLOY_DIR = path.join(REPO_ROOT, "core", "deploy");
const SCHEMA = path.join(REPO_ROOT, "core", "gates", "schemas", "stage-08.schema.json");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function stage08Schema() {
  return JSON.parse(read(SCHEMA));
}

describe("stage-08 deploy cost gate", () => {
  it("stage skeleton includes the cost gate fields", () => {
    const gate = STAGES.deploy.gate;
    assert.equal(gate.cost_delta_estimated, false);
    assert.equal(gate.cost_delta_multiplier, 1);
    assert.equal(gate.cost_gate_override, false);
  });

  it("schema requires the cost gate fields", () => {
    const schema = stage08Schema();
    for (const field of ["cost_delta_estimated", "cost_delta_multiplier", "cost_gate_override"]) {
      assert.ok(schema.required.includes(field), `stage-08 schema must require ${field}`);
    }
  });

  it("schema types the cost gate fields", () => {
    const schema = stage08Schema();
    assert.equal(schema.properties.cost_delta_estimated.type, "boolean");
    assert.equal(schema.properties.cost_delta_multiplier.type, "number");
    assert.equal(schema.properties.cost_gate_override.type, "boolean");
    assert.equal(schema.properties.cost_gate_override_reason.type, "string");
  });

  it("stage rules document the 10x blocking threshold and override", () => {
    const rules = read(path.join(REPO_ROOT, "rules", "stage-08.md"));
    assert.match(rules, /10x/i);
    assert.match(rules, /cost_gate_override/);
    assert.match(rules, /cost_delta_multiplier/);
  });

  it("deploy adapter docs include the cost gate fields", () => {
    const adapterFiles = fs.readdirSync(DEPLOY_DIR)
      .filter((name) => name.endsWith(".md"))
      .filter((name) => name !== "README.md" && !name.endsWith(".conventions.md"));

    for (const name of adapterFiles) {
      const content = read(path.join(DEPLOY_DIR, name));
      assert.match(content, /cost_delta_estimated/, `${name} must include cost_delta_estimated`);
      assert.match(content, /cost_delta_multiplier/, `${name} must include cost_delta_multiplier`);
      assert.match(content, /cost_gate_override/, `${name} must include cost_gate_override`);
    }
  });
});
