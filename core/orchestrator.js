// Orchestrator core.
//
// Public entry points:
//   - runStage(stageName, opts): decompose stage into per-role workstreams,
//     resolve adapter per role, render prompt for each, return result.
//   - mergeWorkstreamGates(stageName, opts): read per-workstream gate files
//     and write the merged stage gate.
//
// No model is ever invoked here. Hosts (adapters) do that; the orchestrator
// only shells the work and validates outputs against schemas.

const fs = require("node:fs");
const path = require("node:path");
const { STAGES, getStage } = require("./pipeline/stages");
const { loadConfig } = require("./config");
const { resolveAdapter } = require("./router");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const ORCHESTRATOR_ID = `devteam@${require("../package.json").version}`;

function workstreamId(stage, role, roleCount) {
  return roleCount > 1 ? `${stage}.${role}` : stage;
}

function buildDescriptor(stageDef, role) {
  return {
    stage: stageDef.stage,
    name: nameForStage(stageDef.stage),
    role,
    rolesInStage: stageDef.roles,
    workstreamId: workstreamId(stageDef.stage, role, stageDef.roles.length),
    objective: stageDef.objective,
    readFirst: stageDef.readFirst,
    allowedWrites: stageDef.allowedWrites,
    artifact: stageDef.artifact,
    template: stageDef.template,
    expectedGate: stageDef.gate,
  };
}

function nameForStage(stage) {
  for (const [name, def] of Object.entries(STAGES)) {
    if (def && def.stage === stage) return name;
  }
  return stage;
}

function runStage(stageName, opts = {}) {
  const stageDef = getStage(stageName);
  if (!stageDef) {
    throw new Error(
      `Unknown stage "${stageName}". Known: ${Object.keys(STAGES).join(", ")}.`,
    );
  }

  const cwd = opts.cwd || process.cwd();
  const config = opts.config || loadConfig(cwd);
  const ctx = {
    track: opts.track || config.pipeline.default_track,
    feature: opts.feature || "",
    cwd,
    isolation: opts.isolation || config.pipeline.isolation,
    orchestrator: ORCHESTRATOR_ID,
  };

  const dispatches = stageDef.roles.map((role) => {
    const { hostName, adapter } = resolveAdapter(config, stageDef.stage, role);
    const descriptor = buildDescriptor(stageDef, role);
    const prompt = adapter.renderStagePrompt(descriptor, ctx);
    return { role, host: hostName, descriptor, prompt };
  });

  return {
    stage: stageDef.stage,
    name: stageName,
    roles: stageDef.roles,
    workstreams: dispatches,
    ctx,
  };
}

function gateFileFor(stage, workstream, gatesDir) {
  const dir = gatesDir || path.join(process.cwd(), "pipeline", "gates");
  return workstream && workstream !== stage
    ? path.join(dir, `${stage}.${workstream.split(".").pop()}.json`)
    : path.join(dir, `${stage}.json`);
}

function mergeWorkstreamGates(stageName, opts = {}) {
  const stageDef = getStage(stageName);
  if (!stageDef) throw new Error(`Unknown stage "${stageName}"`);
  if (stageDef.roles.length === 1) {
    return { merged: false, reason: "single-role stage; no merge needed" };
  }

  const gatesDir = opts.gatesDir || path.join(opts.cwd || process.cwd(), "pipeline", "gates");
  const wsGates = [];
  for (const role of stageDef.roles) {
    const wsFile = path.join(gatesDir, `${stageDef.stage}.${role}.json`);
    if (!fs.existsSync(wsFile)) {
      return { merged: false, reason: `missing workstream gate: ${wsFile}` };
    }
    wsGates.push({ role, gate: JSON.parse(fs.readFileSync(wsFile, "utf8")) });
  }

  const statuses = wsGates.map((w) => w.gate.status);
  const aggregate = statuses.includes("ESCALATE") ? "ESCALATE"
    : statuses.includes("FAIL") ? "FAIL"
    : statuses.includes("WARN") ? "WARN"
    : "PASS";

  const merged = {
    stage: stageDef.stage,
    status: aggregate,
    orchestrator: ORCHESTRATOR_ID,
    track: wsGates[0].gate.track,
    timestamp: new Date().toISOString(),
    blockers: wsGates.flatMap((w) => w.gate.blockers || []),
    warnings: wsGates.flatMap((w) => w.gate.warnings || []),
    workstreams: wsGates.map((w) => ({
      workstream: w.role,
      host: w.gate.host || null,
      status: w.gate.status,
    })),
  };

  const outFile = path.join(gatesDir, `${stageDef.stage}.json`);
  fs.writeFileSync(outFile, JSON.stringify(merged, null, 2) + "\n", "utf8");
  return { merged: true, file: outFile, gate: merged };
}

function rolesPath() {
  return path.join(PROJECT_ROOT, "roles");
}

function templatesPath() {
  return path.join(PROJECT_ROOT, "templates");
}

module.exports = {
  runStage,
  mergeWorkstreamGates,
  buildDescriptor,
  ORCHESTRATOR_ID,
  rolesPath,
  templatesPath,
  PROJECT_ROOT,
};
