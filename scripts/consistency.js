#!/usr/bin/env node
// consistency.js — standalone cross-artifact lint.
//
// Runs checks that catch drift between stages.js, schemas, role briefs,
// rules docs, and adapters. Exits 0 if clean, 1 if any failures.
//
// Most of these checks also live in tests/contract.test.js — having
// them here too means a developer can spot-check without running
// the full test suite, and CI can fail fast on cross-artifact drift.
//
// Usage:
//   node scripts/consistency.js          # run all checks
//   node scripts/consistency.js --json   # machine-readable output

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const { STAGES, TRACKS, STAGES_BY_TRACK, ORDERED_STAGE_NAMES, stageNames } =
  require(path.join(REPO_ROOT, "core", "pipeline", "stages"));
const { listHosts, loadAdapter } = require(path.join(REPO_ROOT, "core", "router"));

const failures = [];
const passes = [];

function pass(name) { passes.push(name); }
function fail(name, detail) { failures.push({ name, detail }); }

function exists(rel) { return fs.existsSync(path.join(REPO_ROOT, rel)); }
function readJSON(rel) { return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")); }
function listDir(rel) { return fs.readdirSync(path.join(REPO_ROOT, rel)); }

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function checkStagesToSchemas() {
  for (const [name, def] of Object.entries(STAGES)) {
    if (!def) continue;
    const rel = `core/gates/schemas/${def.stage}.schema.json`;
    if (exists(rel)) pass(`stage "${name}" has schema ${rel}`);
    else fail(`stage "${name}"`, `missing schema at ${rel}`);
  }
}

function checkSchemasToStages() {
  const stageIds = new Set(Object.values(STAGES).filter(Boolean).map((d) => d.stage));
  for (const f of listDir("core/gates/schemas")) {
    if (!f.startsWith("stage-") || !f.endsWith(".schema.json")) continue;
    const id = f.replace(".schema.json", "");
    if (stageIds.has(id)) pass(`schema ${f} has matching stage`);
    else fail(`schema ${f}`, "no matching entry in STAGES");
  }
}

function checkStagesToRoles() {
  const seen = new Set();
  for (const def of Object.values(STAGES)) {
    if (!def) continue;
    for (const role of def.roles) seen.add(role);
  }
  for (const role of seen) {
    if (exists(`roles/${role}.md`)) pass(`role "${role}" has brief`);
    else fail(`role "${role}"`, `missing brief at roles/${role}.md`);
  }
}

function checkRoleWritesValid() {
  for (const [name, def] of Object.entries(STAGES)) {
    if (!def || !def.roleWrites) continue;
    for (const role of Object.keys(def.roleWrites)) {
      if (def.roles.includes(role)) {
        pass(`stage "${name}" roleWrites["${role}"] valid`);
      } else {
        fail(`stage "${name}" roleWrites`, `role "${role}" not in roles[${def.roles.join(", ")}]`);
      }
    }
  }
}

function checkSubagentOverrides() {
  for (const [name, def] of Object.entries(STAGES)) {
    if (!def || !def.subagent) continue;
    if (exists(`roles/${def.subagent}.md`)) {
      pass(`stage "${name}" subagent override "${def.subagent}" has brief`);
    } else {
      fail(`stage "${name}" subagent`, `override "${def.subagent}" has no brief at roles/${def.subagent}.md`);
    }
  }
}

function checkTracksReferenceKnownStages() {
  for (const [track, names] of Object.entries(STAGES_BY_TRACK)) {
    for (const n of names) {
      if (STAGES[n]) pass(`track "${track}" stage "${n}"`);
      else fail(`track "${track}"`, `lists unknown stage "${n}"`);
    }
  }
}

function checkOrderedStageNamesCoversAll() {
  const stageSet = new Set(stageNames());
  const orderedSet = new Set(ORDERED_STAGE_NAMES);
  for (const n of stageSet) {
    if (orderedSet.has(n)) pass(`ORDERED_STAGE_NAMES contains "${n}"`);
    else fail(`ORDERED_STAGE_NAMES`, `missing stage "${n}"`);
  }
  for (const n of orderedSet) {
    if (stageSet.has(n)) pass(`STAGES has "${n}" (referenced in ORDERED_STAGE_NAMES)`);
    else fail(`ORDERED_STAGE_NAMES`, `references unknown stage "${n}"`);
  }
}

function checkAdaptersExportContract() {
  const required = ["install", "renderStagePrompt", "status", "uninstall"];
  for (const h of listHosts()) {
    const adapter = loadAdapter(h);
    if (!adapter.capabilities) {
      fail(`adapter "${h}"`, "missing capabilities");
      continue;
    }
    if (adapter.capabilities.name !== h) {
      fail(`adapter "${h}"`, `capabilities.name mismatch (got "${adapter.capabilities.name}")`);
    }
    for (const m of required) {
      if (typeof adapter[m] === "function") pass(`adapter "${h}" exports ${m}()`);
      else fail(`adapter "${h}"`, `missing ${m}() function`);
    }
    if (adapter.capabilities.headless && typeof adapter.invoke !== "function") {
      fail(`adapter "${h}"`, "declares headless: true but no invoke()");
    } else if (adapter.capabilities.headless) {
      pass(`adapter "${h}" exports invoke() (headless: true)`);
    }
  }
}

function checkRequiredRulesPresent() {
  const required = ["gates.md", "pipeline.md", "escalation.md", "retrospective.md", "orchestrator.md"];
  for (const r of required) {
    if (exists(`rules/${r}`)) pass(`rules/${r} present`);
    else fail(`rules/${r}`, "missing");
  }
}

function checkSchemaIdsAndDraft() {
  for (const f of listDir("core/gates/schemas")) {
    if (!f.endsWith(".schema.json")) continue;
    const s = readJSON(`core/gates/schemas/${f}`);
    if (s.$schema === "https://json-schema.org/draft/2020-12/schema") pass(`${f} draft 2020-12`);
    else fail(f, `wrong $schema: ${s.$schema}`);
    if (s.$id && s.$id.includes("ai-dev-team")) pass(`${f} $id under ai-dev-team`);
    else fail(f, `wrong $id: ${s.$id}`);
  }
}

function checkGateBaseSchemaIdentity() {
  const base = readJSON("core/gates/schemas/gate.schema.json");
  const expected = ["stage", "status", "orchestrator", "track", "timestamp", "blockers", "warnings"];
  for (const f of expected) {
    if (base.required.includes(f)) pass(`gate.schema requires "${f}"`);
    else fail("gate.schema", `missing required field "${f}"`);
  }
  if (base.required.includes("agent")) fail("gate.schema", "still requires legacy 'agent' field — should be removed");
  else pass("gate.schema does not require legacy 'agent'");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const json = process.argv.includes("--json");

  checkStagesToSchemas();
  checkSchemasToStages();
  checkStagesToRoles();
  checkRoleWritesValid();
  checkSubagentOverrides();
  checkTracksReferenceKnownStages();
  checkOrderedStageNamesCoversAll();
  checkAdaptersExportContract();
  checkRequiredRulesPresent();
  checkSchemaIdsAndDraft();
  checkGateBaseSchemaIdentity();

  if (json) {
    console.log(JSON.stringify({ passes: passes.length, failures }, null, 2));
  } else {
    if (failures.length === 0) {
      console.log(`✅ consistency: ${passes.length} checks passed`);
    } else {
      console.log(`❌ consistency: ${failures.length} failure(s), ${passes.length} pass(es)`);
      for (const f of failures) {
        console.log(`  ✗ ${f.name}: ${f.detail}`);
      }
    }
  }

  process.exit(failures.length === 0 ? 0 : 1);
}

if (require.main === module) main();

module.exports = { main };
