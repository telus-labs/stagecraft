// Tests for the orchestrator-side license compliance runner (C3, Phase 6.3).
// Covers: classifyLicense unit tests, runLicenseCheck fixture scenarios, and
// schema validation for the license_check_passed tri-state.

const { describe, it, afterEach, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeTargetProject, cleanup, REPO_ROOT } = require("./_helpers");
const { runLicenseCheck, classifyLicense, extractLicense } = require("../core/verify/license-runner");
const { stampStage04a } = require("../core/verify/stamp");

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
afterEach(() => { _dirs.forEach(cleanup); _dirs = []; });

// --- Fixtures ---

function seedNodeModules(cwd, packages) {
  // packages: [{ name, license }] where name can be "@scope/pkg"
  const nmPath = path.join(cwd, "node_modules");
  fs.mkdirSync(nmPath, { recursive: true });
  for (const { name, license } of packages) {
    const pkgDir = path.join(nmPath, ...name.split("/"));
    fs.mkdirSync(pkgDir, { recursive: true });
    const pkg = { name, version: "1.0.0" };
    if (license !== undefined) pkg.license = license;
    fs.writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify(pkg));
  }
}

function seedGateRaw(cwd, content) {
  const dir = path.join(cwd, "pipeline", "gates");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "stage-04a.json");
  fs.writeFileSync(file, JSON.stringify(content, null, 2));
  return file;
}

function baseGate(overrides = {}) {
  return {
    stage: "stage-04a", status: "PASS", orchestrator: "devteam@test",
    host: "generic", track: "full", timestamp: "2026-06-14T00:00:00Z",
    blockers: [], warnings: [],
    lint_passed: true, tests_passed: true,
    dependency_review_passed: true, security_review_required: false,
    license_check_passed: true, license_findings: [],
    ...overrides,
  };
}

function configWith(extra) {
  const base = "routing:\n  default_host: generic\npipeline:\n  default_track: full\n";
  const extraStr = extra ? `\n${extra}` : "";
  return base + extraStr;
}

// --- classifyLicense unit tests ---

describe("license-runner: classifyLicense — allowed licenses", () => {
  const allowed = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC",
    "CC0-1.0", "0BSD", "Unlicense", "CC-BY-4.0", "Python-2.0", "PSF-2.0",
    "MIT-0", "BSD-4-Clause", "Artistic-2.0", "Zlib", "BlueOak-1.0.0"];
  for (const lic of allowed) {
    it(`classifies ${lic} as allowed`, () => {
      assert.equal(classifyLicense(lic), "allowed", `${lic} should be allowed`);
    });
  }

  it("classifies BSD-* wildcard pattern as allowed", () => {
    assert.equal(classifyLicense("BSD-3-Clause-Clear"), "allowed");
  });
});

describe("license-runner: classifyLicense — denied licenses", () => {
  const denied = ["GPL-2.0", "GPL-3.0", "GPL-2.0-only", "GPL-3.0-or-later",
    "LGPL-2.0", "LGPL-2.1", "LGPL-3.0", "LGPL-2.1-only",
    "AGPL-3.0", "AGPL-3.0-only", "AGPL-3.0-or-later"];
  for (const lic of denied) {
    it(`classifies ${lic} as denied`, () => {
      assert.equal(classifyLicense(lic), "denied", `${lic} should be denied`);
    });
  }
});

describe("license-runner: classifyLicense — warned licenses", () => {
  it("classifies UNLICENSED as warned", () => {
    assert.equal(classifyLicense("UNLICENSED"), "warned");
  });
  it("classifies SSPL-1.0 as warned", () => {
    assert.equal(classifyLicense("SSPL-1.0"), "warned");
  });
  it("classifies BUSL-1.1 as warned", () => {
    assert.equal(classifyLicense("BUSL-1.1"), "warned");
  });
  it("classifies unknown/missing identifiers as warned", () => {
    assert.equal(classifyLicense(""), "warned");
    assert.equal(classifyLicense(null), "warned");
    assert.equal(classifyLicense("Some-Proprietary-License"), "warned");
  });
});

describe("license-runner: classifyLicense — SPDX OR expressions", () => {
  it("dual-licensed MIT OR GPL-3.0 resolves to allowed (user can pick MIT)", () => {
    assert.equal(classifyLicense("(MIT OR GPL-3.0)"), "allowed");
  });
  it("LGPL-2.1 OR Apache-2.0 resolves to allowed", () => {
    assert.equal(classifyLicense("LGPL-2.1 OR Apache-2.0"), "allowed");
  });
  it("GPL-3.0 OR AGPL-3.0 stays denied (both legs denied)", () => {
    assert.equal(classifyLicense("GPL-3.0 OR AGPL-3.0"), "denied");
  });
  it("UNLICENSED OR MIT resolves to allowed", () => {
    assert.equal(classifyLicense("UNLICENSED OR MIT"), "allowed");
  });
});

describe("license-runner: classifyLicense — extra_allowed override", () => {
  it("LGPL-2.1 classified as denied without extra_allowed", () => {
    assert.equal(classifyLicense("LGPL-2.1", []), "denied");
  });
  it("LGPL-2.1 classified as allowed when in extra_allowed", () => {
    assert.equal(classifyLicense("LGPL-2.1", ["LGPL-2.1"]), "allowed");
  });
  it("extra_allowed is checked before deny list", () => {
    assert.equal(classifyLicense("GPL-3.0", ["GPL-3.0"]), "allowed");
  });
});

describe("license-runner: extractLicense", () => {
  it("returns string license as-is", () => {
    assert.equal(extractLicense({ license: "MIT" }), "MIT");
  });
  it("returns type from npm2 object format", () => {
    assert.equal(extractLicense({ license: { type: "ISC", url: "https://..." } }), "ISC");
  });
  it("returns joined OR for array of objects (old format)", () => {
    const result = extractLicense({ licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] });
    assert.equal(result, "(MIT OR Apache-2.0)");
  });
  it("returns single item without OR wrapping", () => {
    assert.equal(extractLicense({ licenses: [{ type: "MIT" }] }), "MIT");
  });
  it("returns null for missing license", () => {
    assert.equal(extractLicense({ name: "foo" }), null);
  });
  it("returns null for null/undefined input", () => {
    assert.equal(extractLicense(null), null);
    assert.equal(extractLicense(undefined), null);
  });
});

// --- runLicenseCheck fixture tests ---

describe("license-runner: runLicenseCheck — non-Node project", () => {
  it("returns nodeProject=false when no package.json exists", () => {
    const cwd = track(makeTargetProject({ config: false, gates: false }));
    const result = runLicenseCheck(cwd, {});
    assert.equal(result.nodeProject, false);
    assert.equal(result.unverified, true);
    assert.match(result.reason, /no package\.json/);
  });
});

describe("license-runner: runLicenseCheck — Node project, node_modules absent", () => {
  it("returns unverified=true when node_modules not installed", () => {
    const cwd = track(makeTargetProject({ config: false, gates: false }));
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    // No node_modules
    const result = runLicenseCheck(cwd, {});
    assert.equal(result.nodeProject, true);
    assert.equal(result.unverified, true);
    assert.match(result.reason, /node_modules not installed/);
  });
});

describe("license-runner: runLicenseCheck — clean Node project", () => {
  it("passes with only allowed licenses (MIT, Apache-2.0, ISC)", () => {
    const cwd = track(makeTargetProject({ config: false, gates: false }));
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    seedNodeModules(cwd, [
      { name: "lodash", license: "MIT" },
      { name: "express", license: "MIT" },
      { name: "@babel/core", license: "MIT" },
      { name: "chalk", license: "MIT" },
    ]);
    const result = runLicenseCheck(cwd, {});
    assert.equal(result.nodeProject, true);
    assert.equal(result.unverified, false);
    assert.equal(result.passed, true);
    assert.deepEqual(result.findings, []);
    assert.equal(result.totalScanned, 4);
  });

  it("records warned packages but still passes", () => {
    const cwd = track(makeTargetProject({ config: false, gates: false }));
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    seedNodeModules(cwd, [
      { name: "good-lib", license: "MIT" },
      { name: "mongo-db", license: "SSPL-1.0" },
    ]);
    const result = runLicenseCheck(cwd, {});
    assert.equal(result.passed, true);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].package, "mongo-db");
    assert.equal(result.findings[0].policy, "warned");
  });
});

describe("license-runner: runLicenseCheck — denied license fixture", () => {
  it("fails and records denied package when GPL-3.0 is present", () => {
    const cwd = track(makeTargetProject({ config: false, gates: false }));
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    seedNodeModules(cwd, [
      { name: "safe-lib", license: "MIT" },
      { name: "gpl-lib", license: "GPL-3.0" },
    ]);
    const result = runLicenseCheck(cwd, {});
    assert.equal(result.nodeProject, true);
    assert.equal(result.unverified, false);
    assert.equal(result.passed, false);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].package, "gpl-lib");
    assert.equal(result.findings[0].license, "GPL-3.0");
    assert.equal(result.findings[0].policy, "denied");
  });

  it("fails with LGPL-2.1 (without extra_allowed)", () => {
    const cwd = track(makeTargetProject({ config: false, gates: false }));
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    seedNodeModules(cwd, [{ name: "lgpl-lib", license: "LGPL-2.1" }]);
    const result = runLicenseCheck(cwd, {});
    assert.equal(result.passed, false);
    assert.equal(result.findings[0].policy, "denied");
  });

  it("passes LGPL-2.1 when included in extra_allowed config", () => {
    const cwd = track(makeTargetProject({ config: false, gates: false }));
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    seedNodeModules(cwd, [{ name: "lgpl-lib", license: "LGPL-2.1" }]);
    const config = { _raw: { license: { extra_allowed: ["LGPL-2.1"] } } };
    const result = runLicenseCheck(cwd, config);
    assert.equal(result.passed, true);
    assert.deepEqual(result.findings, []);
  });

  it("handles scoped packages (@scope/pkg)", () => {
    const cwd = track(makeTargetProject({ config: false, gates: false }));
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    seedNodeModules(cwd, [
      { name: "@company/safe", license: "MIT" },
      { name: "@company/bad", license: "AGPL-3.0" },
    ]);
    const result = runLicenseCheck(cwd, {});
    assert.equal(result.passed, false);
    const denied = result.findings.filter((f) => f.policy === "denied");
    assert.equal(denied.length, 1);
    assert.equal(denied[0].package, "@company/bad");
  });
});

// --- stampStage04a integration: denied license flips gate ---

describe("stamp/stampStage04a: license_check_passed — Node denied license", () => {
  it("stamps FAIL regardless of model claim when GPL package is installed", async () => {
    const cwd = track(makeTargetProject({
      config: configWith("  verify:\n    lint_command: \"true\"\n    test_command: \"true\""),
    }));
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    seedNodeModules(cwd, [
      { name: "safe-dep", license: "MIT" },
      { name: "copyleft-dep", license: "GPL-3.0" },
    ]);
    const gatePath = seedGateRaw(cwd, baseGate({
      license_check_passed: true, // model claimed true
      status: "PASS",
    }));
    const r = await stampStage04a(cwd, gatePath);
    assert.equal(r.ok, true);
    assert.equal(r.gate.license_check_passed, false, "orchestrator must override to false");
    assert.equal(r.gate.status, "FAIL", "gate status flips to FAIL");
    assert.ok(r.gate.blockers.some((b) => /license check failed/.test(b)), "license blocker added");
    assert.ok(r.gate.blockers.some((b) => /copyleft-dep/.test(b)), "denied package named in blocker");
    const licField = r.gate._orchestrator_stamped.fields.find((f) => f.field === "license_check_passed");
    assert.equal(licField.model_said, true, "model_said captured");
    assert.equal(licField.orchestrator, false, "orchestrator result captured");
    assert.ok(r.gate._orchestrator_stamped.status_overridden, "status_overridden audit present");
  });

  it("stamps PASS when all licenses are clean (model claim confirmed)", async () => {
    const cwd = track(makeTargetProject({
      config: configWith("  verify:\n    lint_command: \"true\"\n    test_command: \"true\""),
    }));
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    seedNodeModules(cwd, [
      { name: "lodash", license: "MIT" },
      { name: "express", license: "MIT" },
    ]);
    const gatePath = seedGateRaw(cwd, baseGate({ license_check_passed: true }));
    const r = await stampStage04a(cwd, gatePath);
    assert.equal(r.gate.license_check_passed, true);
    assert.equal(r.gate.status, "PASS");
    assert.deepEqual(r.gate.license_findings, []);
    assert.equal(r.gate._orchestrator_stamped.runs.license.denied_count, 0);
  });

  it("stamps model_said=false + orchestrator=true when model understated (model said false, actually clean)", async () => {
    const cwd = track(makeTargetProject({
      config: configWith("  verify:\n    lint_command: \"true\"\n    test_command: \"true\""),
    }));
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    seedNodeModules(cwd, [{ name: "lodash", license: "MIT" }]);
    const gatePath = seedGateRaw(cwd, baseGate({
      license_check_passed: false, // model was wrong (too conservative)
      status: "FAIL",
      blockers: ["license check failed (model-reported)"],
    }));
    const r = await stampStage04a(cwd, gatePath);
    assert.equal(r.gate.license_check_passed, true, "orchestrator corrects to true");
    const licField = r.gate._orchestrator_stamped.fields.find((f) => f.field === "license_check_passed");
    assert.equal(licField.model_said, false);
    assert.equal(licField.orchestrator, true);
  });
});

describe("stamp/stampStage04a: license_check_passed — non-Node project", () => {
  it("stamps 'unverified-by-orchestrator' and adds WARN when no package.json", async () => {
    const cwd = track(makeTargetProject({
      config: configWith("  verify:\n    lint_command: \"true\"\n    test_command: \"true\""),
    }));
    // No package.json → non-Node
    const gatePath = seedGateRaw(cwd, baseGate({ license_check_passed: true }));
    const r = await stampStage04a(cwd, gatePath);
    assert.equal(r.gate.license_check_passed, "unverified-by-orchestrator", "tri-state value set");
    assert.ok(Array.isArray(r.gate.warnings), "warnings array present");
    assert.ok(r.gate.warnings.some((w) => /unverified by orchestrator/.test(w)), "WARN added");
    assert.ok(r.gate._orchestrator_stamped.runs.license.skipped, "license run recorded as skipped");
    assert.equal(r.gate.status, "PASS", "status not changed for unverified (no new blockers)");
    const licField = r.gate._orchestrator_stamped.fields.find((f) => f.field === "license_check_passed");
    assert.equal(licField.model_said, true, "model_said captured");
    assert.equal(licField.orchestrator, "unverified-by-orchestrator");
  });

  it("stamps 'unverified-by-orchestrator' when node_modules is absent", async () => {
    const cwd = track(makeTargetProject({
      config: configWith("  verify:\n    lint_command: \"true\"\n    test_command: \"true\""),
    }));
    fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }));
    // No node_modules — deps not installed
    const gatePath = seedGateRaw(cwd, baseGate({ license_check_passed: true }));
    const r = await stampStage04a(cwd, gatePath);
    assert.equal(r.gate.license_check_passed, "unverified-by-orchestrator");
    assert.ok(r.gate.warnings.some((w) => /unverified by orchestrator/.test(w)));
  });
});

// --- Schema tests for tri-state ---

describe("stage-04a schema: license_check_passed tri-state", () => {
  let schema;
  before(() => {
    schema = JSON.parse(
      fs.readFileSync(
        path.join(REPO_ROOT, "core", "gates", "schemas", "stage-04a.schema.json"),
        "utf8",
      ),
    );
  });

  it("license_check_passed uses oneOf (not plain boolean)", () => {
    const prop = schema.properties.license_check_passed;
    assert.ok(Array.isArray(prop.oneOf), "license_check_passed must use oneOf for tri-state");
  });

  it("oneOf includes boolean", () => {
    const prop = schema.properties.license_check_passed;
    const hasBool = prop.oneOf.some((o) => o.type === "boolean");
    assert.ok(hasBool, "oneOf must include { type: 'boolean' }");
  });

  it("oneOf includes string with enum ['unverified-by-orchestrator']", () => {
    const prop = schema.properties.license_check_passed;
    const hasUnverified = prop.oneOf.some(
      (o) => o.type === "string" && Array.isArray(o.enum) && o.enum.includes("unverified-by-orchestrator"),
    );
    assert.ok(hasUnverified, "oneOf must include string enum with 'unverified-by-orchestrator'");
  });

  it("dependency_review_passed description mentions model-asserted by design", () => {
    const prop = schema.properties.dependency_review_passed;
    assert.ok(
      /model-asserted by design/i.test(prop.description),
      "dependency_review_passed must be labeled model-asserted by design in description",
    );
  });

  it("dependency_review_passed remains boolean type (no structural change)", () => {
    const prop = schema.properties.dependency_review_passed;
    assert.equal(prop.type, "boolean", "dependency_review_passed stays boolean");
  });
});
