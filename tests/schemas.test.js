// Schema integrity + cross-reference with stages.js gate skeletons.
// Avoids adding ajv as a dep — pure structural/string assertions.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { REPO_ROOT } = require("./_helpers");
const { STAGES } = require(path.join(REPO_ROOT, "core", "pipeline", "stages"));

const SCHEMAS_DIR = path.join(REPO_ROOT, "core", "gates", "schemas");

function schemaFor(stageId) {
  return JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, `${stageId}.schema.json`), "utf8"));
}

describe("schemas: structural integrity", () => {
  for (const f of fs.readdirSync(SCHEMAS_DIR).filter((x) => x.endsWith(".schema.json"))) {
    it(`${f} has draft 2020-12 + $id under ai-dev-team`, () => {
      const s = JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, f), "utf8"));
      assert.equal(s.$schema, "https://json-schema.org/draft/2020-12/schema");
      assert.match(s.$id, /ai-dev-team/);
    });

    it(`${f} declares additionalProperties as true (extensible)`, () => {
      const s = JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, f), "utf8"));
      assert.equal(s.additionalProperties, true, `${f} should allow additionalProperties`);
    });
  }
});

describe("schemas: base gate contract F", () => {
  const base = schemaFor("gate");

  it("requires exactly the contract F identity fields", () => {
    const expected = ["stage", "status", "orchestrator", "track", "timestamp", "blockers", "warnings"];
    for (const f of expected) {
      assert.ok(base.required.includes(f), `gate.schema missing required ${f}`);
    }
  });

  it("does not require legacy agent field", () => {
    assert.ok(!base.required.includes("agent"));
  });

  it("status enum includes PASS/WARN/FAIL/ESCALATE", () => {
    const e = base.properties.status.enum;
    for (const v of ["PASS", "WARN", "FAIL", "ESCALATE"]) {
      assert.ok(e.includes(v), `gate.schema status enum missing ${v}`);
    }
  });

  it("declares workstream and host as optional properties", () => {
    assert.ok(base.properties.workstream);
    assert.ok(base.properties.host);
  });

  it("declares workstreams[] for merged stage gates", () => {
    assert.ok(base.properties.workstreams);
    assert.equal(base.properties.workstreams.type, "array");
  });
});

describe("schemas: stage skeletons satisfy schema required fields", () => {
  // For each stage in STAGES, its gate skeleton (the stage-specific bit)
  // should provide every required field declared in its per-stage schema.
  for (const [name, def] of Object.entries(STAGES)) {
    if (!def) continue;
    it(`${name} (${def.stage}) skeleton covers schema.required`, () => {
      const schema = schemaFor(def.stage);
      const skeletonKeys = new Set(Object.keys(def.gate || {}));
      for (const req of schema.required) {
        // The stage's own gate skeleton plus the orchestrator-filled
        // identity fields must cover required[]. Identity fields are
        // filled automatically; check that anything else is in the
        // skeleton.
        const orchestratorFilled = ["stage", "status", "orchestrator", "track", "timestamp", "blockers", "warnings", "workstream", "host"];
        if (orchestratorFilled.includes(req)) continue;
        assert.ok(
          skeletonKeys.has(req),
          `stage "${name}" gate skeleton missing required field "${req}" from ${def.stage}.schema.json`,
        );
      }
    });
  }
});

describe("schemas: stage IDs match files on disk", () => {
  const onDisk = new Set(
    fs.readdirSync(SCHEMAS_DIR)
      .filter((f) => f.startsWith("stage-") && f.endsWith(".schema.json"))
      .map((f) => f.replace(".schema.json", "")),
  );

  it("every stage in STAGES has a matching schema file", () => {
    for (const def of Object.values(STAGES)) {
      if (!def) continue;
      assert.ok(onDisk.has(def.stage), `schema missing for stage ${def.stage}`);
    }
  });

  it("every schema file matches some stage in STAGES", () => {
    const stageIds = new Set(Object.values(STAGES).filter(Boolean).map((d) => d.stage));
    for (const id of onDisk) {
      assert.ok(stageIds.has(id), `orphan schema ${id}.schema.json — no matching stage`);
    }
  });
});
