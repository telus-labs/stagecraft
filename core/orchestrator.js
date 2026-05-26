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
const { STAGES, getStage, orderedStageNames, orderedStageNamesForTrack, isStageInTrack } = require("./pipeline/stages");
const { loadConfig } = require("./config");
const { resolveAdapter } = require("./router");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const ORCHESTRATOR_ID = `devteam@${require("../package.json").version}`;

function workstreamId(stage, role, roleCount) {
  return roleCount > 1 ? `${stage}.${role}` : stage;
}

function buildDescriptor(stageDef, role) {
  const allowedWrites = stageDef.roleWrites?.[role] ?? stageDef.allowedWrites;
  return {
    stage: stageDef.stage,
    name: nameForStage(stageDef.stage),
    role,
    rolesInStage: stageDef.roles,
    workstreamId: workstreamId(stageDef.stage, role, stageDef.roles.length),
    objective: stageDef.objective,
    readFirst: stageDef.readFirst,
    allowedWrites,
    artifact: stageDef.artifact,
    template: stageDef.template,
    expectedGate: stageDef.gate,
    // When set, all workstreams of this stage dispatch to the same
    // subagent regardless of role (used by peer-review where the
    // workstreams are areas being reviewed but the dispatched agent
    // is always the reviewer). Adapters honor this in renderStagePrompt.
    subagent: stageDef.subagent,
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

  if (!isStageInTrack(stageName, ctx.track)) {
    process.stderr.write(
      `[devteam] note: stage "${stageName}" is skipped by track "${ctx.track}". Running anyway; if this is unintended, change pipeline.default_track in .devteam/config.yml.\n`,
    );
  }

  const dispatches = stageDef.roles.map((role) => {
    const { hostName, adapter } = resolveAdapter(config, stageDef.stage, role);
    const descriptor = buildDescriptor(stageDef, role);
    const prompt = adapter.renderStagePrompt(descriptor, ctx);
    return { role, host: hostName, descriptor, prompt, adapter };
  });

  return {
    stage: stageDef.stage,
    name: stageName,
    roles: stageDef.roles,
    workstreams: dispatches,
    ctx,
  };
}

// Headless variant of runStage — actually drives each adapter's invoke()
// to spawn the host CLI per workstream. Resolves with an array of
// {role, host, invokeResult, descriptor}. Honors per-workstream
// capability check; rejects if any routed host has headless: false.
async function runStageHeadless(stageName, opts = {}) {
  const plan = runStage(stageName, opts);
  for (const ws of plan.workstreams) {
    if (!ws.adapter.capabilities || !ws.adapter.capabilities.headless) {
      throw new Error(
        `host "${ws.host}" cannot drive workstream "${ws.role}" headlessly ` +
        `(capabilities.headless is false). Either install a different host ` +
        `for this role or run interactively (omit --headless).`,
      );
    }
    if (typeof ws.adapter.invoke !== "function") {
      throw new Error(`host "${ws.host}" declares headless: true but exports no invoke()`);
    }
  }
  const results = [];
  for (const ws of plan.workstreams) {
    process.stderr.write(`[devteam] dispatching ${ws.role} → ${ws.host} (headless)\n`);
    const r = await ws.adapter.invoke(ws.descriptor, plan.ctx);
    results.push({ role: ws.role, host: ws.host, descriptor: ws.descriptor, ...r });
  }
  return { stage: plan.stage, name: stageName, roles: plan.roles, results, ctx: plan.ctx };
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

// Walk stages in order, inspect gate files in pipeline/gates/, decide
// what the user should do next. Pure read; never mutates state.
//
// Returns one of:
//   { action: "run-stage",          stage, name, roles, reason }
//   { action: "continue-stage",     stage, name, completed[], remaining[], reason }
//   { action: "merge",              stage, name, reason }
//   { action: "fix-and-retry",      stage, name, gate, blockers[], reason }
//   { action: "resolve-escalation", stage, name, gate, reason }
//   { action: "pipeline-complete",  reason }
function next(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const gatesDir = path.join(cwd, "pipeline", "gates");
  const track = opts.track || (opts.config && opts.config.pipeline && opts.config.pipeline.default_track) || (loadConfig(cwd).pipeline.default_track) || "full";
  const stageList = orderedStageNamesForTrack(track);

  for (const stageName of stageList) {
    const stageDef = getStage(stageName);
    const stageGatePath = path.join(gatesDir, `${stageDef.stage}.json`);

    // Conditional stages: skip when the prerequisite gate's named field
    // is not equal to the required value. The prerequisite gate must
    // already exist — if it doesn't, the pipeline would be advancing
    // out of order, so we surface that as needing the prerequisite first.
    if (stageDef.conditionalOn) {
      const c = stageDef.conditionalOn;
      const prereqDef = Object.values(STAGES).find((s) => s && s.stage === c.stage);
      const prereqGatePath = path.join(gatesDir, `${c.stage}.json`);
      if (!fs.existsSync(prereqGatePath)) {
        // Prereq not done yet; the earlier iteration of this loop should
        // have returned for it. If we got here, fall through to normal
        // run-stage handling — but flag the issue.
      } else {
        const prereq = JSON.parse(fs.readFileSync(prereqGatePath, "utf8"));
        if (prereq[c.field] !== c.equals) {
          continue; // condition not met — skip this stage silently
        }
      }
    }

    if (!fs.existsSync(stageGatePath)) {
      if (stageDef.roles.length > 1) {
        const completed = [];
        const remaining = [];
        for (const role of stageDef.roles) {
          const p = path.join(gatesDir, `${stageDef.stage}.${role}.json`);
          (fs.existsSync(p) ? completed : remaining).push(role);
        }
        if (remaining.length === 0) {
          return {
            action: "merge", stage: stageDef.stage, name: stageName,
            reason: "all workstreams complete; merge to produce stage gate",
            command: `devteam merge ${stageName}`,
          };
        }
        if (completed.length === 0) {
          return {
            action: "run-stage", stage: stageDef.stage, name: stageName,
            roles: stageDef.roles,
            reason: "multi-role stage not started",
            command: `devteam stage ${stageName}`,
          };
        }
        return {
          action: "continue-stage", stage: stageDef.stage, name: stageName,
          completed, remaining,
          reason: `${completed.length}/${stageDef.roles.length} workstreams complete`,
          command: `devteam stage ${stageName}  # roles still pending: ${remaining.join(", ")}`,
        };
      }
      return {
        action: "run-stage", stage: stageDef.stage, name: stageName,
        roles: stageDef.roles,
        reason: "stage not started",
        command: `devteam stage ${stageName}`,
      };
    }

    const gate = JSON.parse(fs.readFileSync(stageGatePath, "utf8"));
    if (gate.status === "ESCALATE") {
      return {
        action: "resolve-escalation", stage: stageDef.stage, name: stageName,
        gate: stageGatePath,
        reason: gate.escalation_reason || "escalation required; pipeline halted",
      };
    }
    if (gate.status === "FAIL") {
      return {
        action: "fix-and-retry", stage: stageDef.stage, name: stageName,
        gate: stageGatePath,
        blockers: gate.blockers || [],
        reason: "stage failed; address blockers and rewrite the gate",
        command: `devteam stage ${stageName}`,
      };
    }
    // PASS or WARN — proceed to next stage.
  }

  return { action: "pipeline-complete", reason: `all stages PASS or WARN (track: ${track})`, track };
}

// One-screen pipeline state for `devteam summary`. Walks the active
// track's stage list, classifies each stage as one of:
//   - pass    : merged stage gate exists with status PASS or WARN
//   - warn    : merged stage gate exists with status WARN
//   - fail    : merged stage gate exists with status FAIL
//   - escalate: merged stage gate exists with status ESCALATE
//   - partial : multi-role stage with some workstream gates but no merge
//   - skipped : conditional stage whose condition is not met
//   - pending : nothing on disk yet
// For multi-role stages, includes per-workstream rows.
function summary(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const gatesDir = path.join(cwd, "pipeline", "gates");
  const track = opts.track || (opts.config && opts.config.pipeline && opts.config.pipeline.default_track) || (loadConfig(cwd).pipeline.default_track) || "full";
  const stageList = orderedStageNamesForTrack(track);

  const rows = [];

  function readJSONSafe(file) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
  }

  for (const stageName of stageList) {
    const stageDef = getStage(stageName);
    const stageGatePath = path.join(gatesDir, `${stageDef.stage}.json`);

    // Check conditional first
    if (stageDef.conditionalOn) {
      const c = stageDef.conditionalOn;
      const prereqGatePath = path.join(gatesDir, `${c.stage}.json`);
      if (fs.existsSync(prereqGatePath)) {
        const prereq = readJSONSafe(prereqGatePath);
        if (prereq && prereq[c.field] !== c.equals) {
          rows.push({
            stage: stageDef.stage,
            name: stageName,
            state: "skipped",
            reason: `condition not met: ${c.stage}.${c.field} !== ${c.equals}`,
          });
          continue;
        }
      }
    }

    if (fs.existsSync(stageGatePath)) {
      const gate = readJSONSafe(stageGatePath);
      const state = gate ? gate.status.toLowerCase() : "pending";
      const row = { stage: stageDef.stage, name: stageName, state, timestamp: gate && gate.timestamp };
      if (gate && Array.isArray(gate.workstreams) && gate.workstreams.length > 0) {
        row.workstreams = gate.workstreams.map((w) => ({ role: w.workstream, host: w.host, state: w.status.toLowerCase() }));
      }
      if (gate && Array.isArray(gate.warnings) && gate.warnings.length > 0) row.warnings = gate.warnings;
      if (gate && Array.isArray(gate.blockers) && gate.blockers.length > 0) row.blockers = gate.blockers;
      rows.push(row);
      continue;
    }

    // No stage gate. Multi-role: check per-workstream gates.
    if (stageDef.roles.length > 1) {
      const completed = [];
      const remaining = [];
      for (const role of stageDef.roles) {
        const p = path.join(gatesDir, `${stageDef.stage}.${role}.json`);
        if (fs.existsSync(p)) {
          const g = readJSONSafe(p);
          completed.push({ role, host: g && g.host, state: g && g.status ? g.status.toLowerCase() : "pending" });
        } else {
          remaining.push(role);
        }
      }
      if (completed.length === 0) {
        rows.push({ stage: stageDef.stage, name: stageName, state: "pending" });
      } else {
        rows.push({
          stage: stageDef.stage, name: stageName, state: "partial",
          workstreams: completed,
          remaining,
        });
      }
      continue;
    }

    rows.push({ stage: stageDef.stage, name: stageName, state: "pending" });
  }

  return { track, rows };
}

function rolesPath() {
  return path.join(PROJECT_ROOT, "roles");
}

function templatesPath() {
  return path.join(PROJECT_ROOT, "templates");
}

module.exports = {
  runStage,
  runStageHeadless,
  mergeWorkstreamGates,
  next,
  summary,
  buildDescriptor,
  ORCHESTRATOR_ID,
  rolesPath,
  templatesPath,
  PROJECT_ROOT,
};
