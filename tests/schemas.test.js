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
    it(`${f} has draft 2020-12 + urn:stagecraft:schema $id`, () => {
      const s = JSON.parse(fs.readFileSync(path.join(SCHEMAS_DIR, f), "utf8"));
      assert.equal(s.$schema, "https://json-schema.org/draft/2020-12/schema");
      assert.match(s.$id, /^urn:stagecraft:schema:/);
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

// G10: gate.schema.json must declare dispatched_tool_budget so workstream
// gates that carry it are recognised as valid (not flagged as unknown fields
// by strict consumers). The field is optional and accepts array|null per ADR-004.
describe("schemas: dispatched_tool_budget field contract (G10)", () => {
  const base = JSON.parse(
    fs.readFileSync(path.join(SCHEMAS_DIR, "gate.schema.json"), "utf8"),
  );

  it("gate.schema.json declares dispatched_tool_budget as an optional property", () => {
    assert.ok(base.properties.dispatched_tool_budget,
      "gate.schema.json must declare dispatched_tool_budget in properties");
    assert.ok(!base.required || !base.required.includes("dispatched_tool_budget"),
      "dispatched_tool_budget must be optional (not in required[])");
  });

  it("dispatched_tool_budget accepts array or null", () => {
    const prop = base.properties.dispatched_tool_budget;
    const types = Array.isArray(prop.type) ? prop.type : [prop.type];
    assert.ok(types.includes("array"),
      "dispatched_tool_budget must include type 'array'");
    assert.ok(types.includes("null"),
      "dispatched_tool_budget must include type 'null' (absent budget = full host surface)");
  });

  it("dispatched_tool_budget items are strings (tool names)", () => {
    const prop = base.properties.dispatched_tool_budget;
    assert.ok(prop.items && prop.items.type === "string",
      "dispatched_tool_budget items must be strings (Claude Code tool names)");
  });
});

// G3: production_feedback_reviewed field in stage-09 schema.
describe("schemas: stage-09 production_feedback_reviewed field (G3)", () => {
  const s09 = schemaFor("stage-09");

  it("stage-09 schema declares production_feedback_reviewed as an optional property", () => {
    assert.ok(
      s09.properties && s09.properties.production_feedback_reviewed,
      "stage-09.schema.json must declare production_feedback_reviewed in properties",
    );
    assert.ok(
      !s09.required || !s09.required.includes("production_feedback_reviewed"),
      "production_feedback_reviewed must be optional (not in required[])",
    );
  });

  it("production_feedback_reviewed accepts boolean values (oneOf includes boolean)", () => {
    const prop = s09.properties.production_feedback_reviewed;
    const oneOf = prop.oneOf || [];
    const hasBool = oneOf.some((entry) => entry.type === "boolean");
    assert.ok(hasBool, "production_feedback_reviewed oneOf must include { type: 'boolean' }");
  });

  it("production_feedback_reviewed accepts the string value 'absent'", () => {
    const prop = s09.properties.production_feedback_reviewed;
    const oneOf = prop.oneOf || [];
    const hasAbsent = oneOf.some((entry) => entry.type === "string" && entry.const === "absent");
    assert.ok(hasAbsent, "production_feedback_reviewed oneOf must include { type: 'string', const: 'absent' }");
  });

  it("production_feedback_reviewed accepts null (for not-applicable / omit)", () => {
    const prop = s09.properties.production_feedback_reviewed;
    const oneOf = prop.oneOf || [];
    const hasNull = oneOf.some((entry) => entry.type === "null");
    assert.ok(hasNull, "production_feedback_reviewed oneOf must include { type: 'null' }");
  });
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
