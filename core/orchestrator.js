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
const { STAGES, getStage, orderedStageNamesForTrack, isStageInTrack, rolesForStage, trackLabel } = require("./pipeline/stages");
const { loadConfig, changeIdFromFeature } = require("./config");
const { gatesDir: getGatesDir, pipelineRoot, prefixPipelineRelative } = require("./paths");
const { resolveAdapter } = require("./router");
const { withSpan, setSpanAttributes } = require("./observability");
const { loadGateSafe } = require("./gates/load-gate");
const { classifyGate, MAX_RETRIES_DEFAULT } = require("./gates/classify");
const { pricingFor } = require("./pricing");
const { getRecipe } = require("./pipeline/fix-recipes");

// C1: patch a gate file to record write-audit violations and flip status to FAIL.
// Called after headless invoke when the adapter reported unauthorized writes.
// Idempotent — safe to call multiple times (violations are deduplicated by string match).
function patchGateForWriteViolations(gatePath, violations) {
  if (!fs.existsSync(gatePath)) return;
  try {
    const gate = JSON.parse(fs.readFileSync(gatePath, "utf8"));
    const msgs = violations.map((v) => `[write-audit] unauthorized write: ${v}`);
    const existing = new Set(Array.isArray(gate.blockers) ? gate.blockers : []);
    for (const m of msgs) existing.add(m);
    gate.blockers = [...existing];
    if (gate.status === "PASS" || gate.status === "WARN") gate.status = "FAIL";
    fs.writeFileSync(gatePath, JSON.stringify(gate, null, 2) + "\n", "utf8");
    process.stderr.write(
      `[devteam] write-audit: ${violations.length} violation(s) added to gate — status flipped to FAIL\n`,
    );
  } catch {
    // Gate unreadable; violations already logged by headless.js
  }
}

const PROJECT_ROOT = path.resolve(__dirname, "..");
const ORCHESTRATOR_ID = `devteam@${require("../package.json").version}`;

// Produce the workstream identifier for a (stage, role) dispatch.
// Single-role stages get the bare stage id ("stage-01"); multi-role stages
// get a dotted form ("stage-04.backend"). The role count is what the caller
// observed at decomposition time — pass stageDef.roles.length.
function workstreamId(stage, role, roleCount) {
  return roleCount > 1 ? `${stage}.${role}` : stage;
}

// C5: throw early if the resolved host lacks a capability the stage requires.
// stageDef.requiredCapabilities is a { capName: true } map; adapter.capabilities.enforces
// must have capName: true for each entry. Checked on every dispatch — headless or not —
// so misconfigured routing fails at plan time, not silently at runtime.
function assertCapabilities(stageDef, role, hostName, adapter) {
  const required = stageDef.requiredCapabilities;
  if (!required) return;
  const enforces = adapter.capabilities?.enforces || {};
  for (const [cap, needed] of Object.entries(required)) {
    if (needed && enforces[cap] !== true) {
      throw new Error(
        `stage "${stageDef.stage}" (role "${role}") requires the "${cap}" capability ` +
        `but host "${hostName}" does not provide it (enforces.${cap} !== true). ` +
        `Update routing in .devteam/config.yml to use a host with ${cap} support ` +
        `(claude-code, codex, or gemini-cli).`,
      );
    }
  }
}

// Compute the full dispatch plan for a stage: which (role, host) pairs
// the orchestrator should invoke, with their workstream ids and gate
// filenames. Normally there's one entry per role; for peer-review with
// routing.review_fanout set, each role expands to N entries (one per
// fanout host), giving N×M total entries.
//
// Returns: [ { role, hostName, workstreamId, gateFile } ]
//
// hostName is null when fanout is active and the caller should resolve
// it from the entry's hostName field directly (no routing precedence).
// For non-fanout, the caller resolves via routing as usual.
function computeDispatchPlan(stageDef, config, track) {
  const fanout = (config && config.routing && Array.isArray(config.routing.review_fanout))
    ? config.routing.review_fanout
    : [];
  const isPeerReview = stageDef.stage === "stage-05" && fanout.length > 0;
  // Track-aware roles. Today only stage-05 (peer-review) varies — nano
  // dispatches a single reviewer; every other track uses the standard
  // four-area matrix. rolesForStage falls back to stageDef.roles for
  // every other stage.
  const effectiveTrack = track || (config && config.pipeline && config.pipeline.default_track) || "full";
  const roles = rolesForStage(stageDef, effectiveTrack);

  const plan = [];
  for (const role of roles) {
    if (isPeerReview) {
      for (const hostName of fanout) {
        const ws = `${stageDef.stage}.${role}.${hostName}`;
        plan.push({ role, hostName, workstreamId: ws, gateFile: `${ws}.json`, fanout: true });
      }
    } else {
      const ws = workstreamId(stageDef.stage, role, roles.length);
      plan.push({ role, hostName: null, workstreamId: ws, gateFile: `${ws}.json`, fanout: false });
    }
  }
  return plan;
}

function buildDescriptor(stageDef, role, opts = {}) {
  const allowedWrites = stageDef.roleWrites?.[role] ?? stageDef.allowedWrites;
  const wsId = opts.workstreamId || workstreamId(stageDef.stage, role, stageDef.roles.length);
  const changeId = opts.changeId || null;
  const prefix = (p) => prefixPipelineRelative(p, changeId);
  return {
    stage: stageDef.stage,
    name: nameForStage(stageDef.stage),
    role,
    rolesInStage: stageDef.roles,
    workstreamId: wsId,
    objective: stageDef.objective,
    readFirst: Array.isArray(stageDef.readFirst) ? stageDef.readFirst.map(prefix) : stageDef.readFirst,
    allowedWrites: Array.isArray(allowedWrites) ? allowedWrites.map(prefix) : allowedWrites,
    artifact: prefix(stageDef.artifact),
    template: stageDef.template,
    goalCondition: stageDef.goalCondition
      ? stageDef.goalCondition.replace("{workstreamId}", wsId)
      : null,
    expectedGate: stageDef.gate,
    changeId,
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
  const isolation = opts.isolation || config.pipeline.isolation;
  const feature = opts.feature || "";
  // G6: custom_stages in config overrides default_track when no explicit track is passed.
  const track = opts.track
    || (Array.isArray(config.pipeline.custom_stages) ? config.pipeline.custom_stages : null)
    || config.pipeline.default_track;
  const ctx = {
    track,
    feature,
    cwd,
    isolation,
    changeId: isolation === "bounded" ? changeIdFromFeature(feature) : null,
    orchestrator: ORCHESTRATOR_ID,
    timeoutMs: typeof opts.timeoutMs === "number" ? opts.timeoutMs : undefined,
    patchItems: Array.isArray(opts.patchItems) && opts.patchItems.length > 0 ? opts.patchItems : null,
  };

  if (!isStageInTrack(stageName, ctx.track)) {
    process.stderr.write(
      `[devteam] note: stage "${stageName}" is skipped by track "${ctx.track}". Running anyway; if this is unintended, change pipeline.default_track in .devteam/config.yml.\n`,
    );
  }

  const plan = computeDispatchPlan(stageDef, config, ctx.track);

  // Apply --workstream filter BEFORE rendering prompts so only the requested
  // workstreams are built. This is the single shared filter for both headless
  // and non-headless modes — keeping them identical.
  //
  // Role-prefix match rule: filter values are bare role names. For fanout stages,
  // each fanout entry keeps the bare role name (e.g. ws.role = "backend" even when
  // workstreamId = "stage-05.backend.claude-code"), so all fanout instances of a
  // role are selected together by a single --workstream value.
  let effectivePlan = plan;
  if (opts.workstream && opts.workstream.length > 0) {
    const wsFilter = new Set(opts.workstream);
    effectivePlan = plan.filter((entry) => wsFilter.has(entry.role));
    if (effectivePlan.length === 0) {
      throw new Error(
        `--workstream filter matched no roles in stage "${stageName}". ` +
        `Available: ${[...new Set(plan.map((e) => e.role))].join(", ")}`,
      );
    }
    process.stderr.write(`[devteam] --workstream: dispatching ${[...new Set(effectivePlan.map((e) => e.role))].join(", ")} only\n`);
  }

  return withSpan("pipeline.stage", {
    "devteam.stage": stageDef.stage,
    "devteam.stage.name": stageName,
    "devteam.track": trackLabel(ctx.track),
    "devteam.roles": stageDef.roles.join(","),
    "devteam.workstream_count": effectivePlan.length,
    "devteam.fanout": effectivePlan.some((p) => p.fanout) || undefined,
    "devteam.feature": ctx.feature || undefined,
  }, () => {
    const dispatches = effectivePlan.map((entry) => withSpan("pipeline.workstream", {
      "devteam.stage": stageDef.stage,
      "devteam.workstream.role": entry.role,
      "devteam.workstream.id": entry.workstreamId,
    }, () => {
      // For fanout entries the host is fixed by the fanout list; for
      // normal entries the router resolves via precedence.
      let hostName, adapter;
      if (entry.hostName) {
        hostName = entry.hostName;
        const { loadAdapter } = require("./router");
        adapter = loadAdapter(hostName);
      } else {
        const resolved = resolveAdapter(config, stageDef.stage, entry.role);
        hostName = resolved.hostName;
        adapter = resolved.adapter;
      }
      assertCapabilities(stageDef, entry.role, hostName, adapter);
      const descriptor = buildDescriptor(stageDef, entry.role, { workstreamId: entry.workstreamId, changeId: ctx.changeId });
      const prompt = withSpan("adapter.renderStagePrompt", {
        "devteam.host": hostName,
        "devteam.stage": stageDef.stage,
        "devteam.workstream.role": entry.role,
      }, () => adapter.renderStagePrompt(descriptor, ctx));
      setSpanAttributes({ "devteam.host": hostName });
      return { role: entry.role, host: hostName, descriptor, prompt, adapter, fanout: entry.fanout };
    }));

    // roles[] reflects the filtered set when --workstream is active, so callers
    // (e.g. printStagePreamble) show the correct workstream count.
    const filteredRoles = effectivePlan.length < plan.length
      ? [...new Set(effectivePlan.map((e) => e.role))]
      : stageDef.roles;

    return {
      stage: stageDef.stage,
      name: stageName,
      roles: filteredRoles,
      workstreams: dispatches,
      ctx,
    };
  });
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
  const gatesDir = getGatesDir(plan.ctx.cwd, plan.ctx.changeId);
  return withSpan("pipeline.stage.headless", {
    "devteam.stage": plan.stage,
    "devteam.stage.name": stageName,
    "devteam.workstream_count": plan.workstreams.length,
  }, async () => {
    // C6: remember the single-role stage gate's pre-dispatch mtime so we only
    // stamp the chain when THIS dispatch actually (re)wrote it — not on a
    // no-write run (e.g. `devteam replay` against an empty host command, which
    // must stay distinguishable by mtime).
    const singleRoleGate = plan.workstreams.length === 1
      ? path.join(gatesDir, `${plan.stage}.json`) : null;
    let preGateMtime = null;
    if (singleRoleGate) { try { preGateMtime = fs.statSync(singleRoleGate).mtimeMs; } catch { preGateMtime = null; } }

    // --workstream filtering is applied in runStage (before rendering), so
    // plan.workstreams already contains only the requested workstreams here.
    const results = await Promise.all(plan.workstreams.map(async (ws) => {
      if (opts.skipCompleted) {
        const gateFile = path.join(gatesDir, `${ws.descriptor.workstreamId}.json`);
        if (fs.existsSync(gateFile)) {
          process.stderr.write(`[devteam] --skip-completed: ${ws.role} already has a gate, skipping\n`);
          return { role: ws.role, host: ws.host, descriptor: ws.descriptor, skipped: true, exitCode: 0, gatePath: gateFile, durationMs: 0 };
        }
      }
      process.stderr.write(`[devteam] dispatching ${ws.role} → ${ws.host} (headless)\n`);
      const r = await withSpan("adapter.invoke", {
        "devteam.host": ws.host,
        "devteam.workstream.role": ws.role,
        "devteam.workstream.id": ws.descriptor.workstreamId,
      }, async (span) => {
        // E7: prepend /goal directive for hosts that support a goal loop
        // and stages that declare a convergence condition.
        const prompt = ws.adapter.capabilities.goalLoop && ws.descriptor.goalCondition
          ? `/goal "${ws.descriptor.goalCondition}"\n\n${ws.prompt}`
          : ws.prompt;
        const out = await ws.adapter.invoke(ws.descriptor, plan.ctx, prompt);
        if (span) span.setAttributes({
          "devteam.invoke.exit_code": out.exitCode,
          "devteam.invoke.duration_ms": out.durationMs,
          "devteam.invoke.gate_written": Boolean(out.gatePath),
        });
        return out;
      });
      // C1: if write violations were detected, patch the gate to FAIL.
      if (r.writeViolations && r.writeViolations.length > 0) {
        const wsGatePath = r.gatePath || path.join(gatesDir, `${ws.descriptor.workstreamId}.json`);
        patchGateForWriteViolations(wsGatePath, r.writeViolations);
      }
      return { role: ws.role, host: ws.host, descriptor: ws.descriptor, ...r };
    }));

    // Orchestrator-stamped verification. For stages where the gate
    // claims something the orchestrator can verify (stage-04a:
    // lint+tests; stage-06: tests + AC mapping), run the actual
    // commands and stamp what was observed. Skipped when the gate
    // doesn't exist yet (model wrote nothing) or when the stage isn't
    // stampable. Failures here log but don't block — the validator
    // will catch a malformed gate on its own. opts.stamp === false
    // disables this entirely (used by tests that don't want to run
    // real lint/test commands).
    if (opts.stamp !== false) {
      const { STAMPABLE_STAGES, stamp } = require("./verify/stamp");
      // Single-role stages produce one gate at stage-XX.json (no role
      // suffix). For now, stamping only applies to single-role stages
      // (stage-04a, stage-06). Multi-role stages would need per-role
      // stamping, which isn't in scope here.
      if (STAMPABLE_STAGES.has(plan.stage) && plan.workstreams.length === 1) {
        try {
          const stampResult = await stamp(plan.ctx.cwd, plan.stage);
          if (!stampResult.ok) {
            process.stderr.write(`[devteam] orchestrator stamping: ${stampResult.error}\n`);
          } else if (stampResult.stamp.status_overridden) {
            process.stderr.write(
              `[devteam] orchestrator verification flipped status: ${stampResult.stamp.status_overridden.from} → ${stampResult.stamp.status_overridden.to}\n`,
            );
          }
        } catch (err) {
          process.stderr.write(`[devteam] orchestrator stamping failed: ${err.message}\n`);
        }
      }
    }

    // C6: single-role stages write their stage gate directly (no merge step),
    // so stamp the tamper-evident chain here — but only if THIS dispatch
    // actually wrote the gate (created it, or advanced its mtime). Multi-role
    // stages are stamped by mergeWorkstreamGates. Best-effort.
    if (singleRoleGate) {
      let postGateMtime = null;
      try { postGateMtime = fs.statSync(singleRoleGate).mtimeMs; } catch { postGateMtime = null; }
      const wroteThisRun = postGateMtime !== null && (preGateMtime === null || postGateMtime > preGateMtime);
      if (wroteThisRun) {
        try { require("./gates/chain").stampChain(gatesDir, stageName, plan.ctx.track); } catch { /* */ }
      }
    }

    return { stage: plan.stage, name: stageName, roles: plan.roles, results, ctx: plan.ctx };
  });
}

function mergeWorkstreamGates(stageName, opts = {}) {
  const stageDef = getStage(stageName);
  if (!stageDef) throw new Error(`Unknown stage "${stageName}"`);
  const config = opts.config || loadConfig(opts.cwd || process.cwd());
  // G6: custom_stages in config overrides default_track when no explicit track is passed.
  const track = opts.track
    || (Array.isArray(config.pipeline.custom_stages) ? config.pipeline.custom_stages : null)
    || config.pipeline.default_track;
  const plan = computeDispatchPlan(stageDef, config, track);
  if (plan.length <= 1) {
    return { merged: false, reason: "single-workstream stage; no merge needed" };
  }

  return withSpan("pipeline.merge", {
    "devteam.stage": stageDef.stage,
    "devteam.stage.name": stageName,
    "devteam.workstream_count": plan.length,
    "devteam.fanout": plan.some((p) => p.fanout) || undefined,
  }, () => {
    const gatesDir = opts.gatesDir || getGatesDir(opts.cwd || process.cwd(), opts.changeId || null);
    const wsGates = [];
    for (const entry of plan) {
      const wsFile = path.join(gatesDir, entry.gateFile);
      if (!fs.existsSync(wsFile)) {
        setSpanAttributes({ "devteam.merge.result": "missing", "devteam.merge.missing": entry.workstreamId });
        return { merged: false, reason: `missing workstream gate: ${wsFile}` };
      }
      const { gate, error } = loadGateSafe(wsFile);
      if (error) {
        setSpanAttributes({ "devteam.merge.result": "malformed", "devteam.merge.malformed": entry.workstreamId });
        return { merged: false, reason: `unreadable workstream gate (${entry.workstreamId}): ${error}` };
      }
      wsGates.push({ role: entry.role, host: entry.hostName, gate });
    }

    const statuses = wsGates.map((w) => w.gate.status);
    const aggregate = statuses.includes("ESCALATE") ? "ESCALATE"
      : statuses.includes("FAIL") ? "FAIL"
      : statuses.includes("WARN") ? "WARN"
      : "PASS";

    // Roll up per-workstream cost telemetry (D6) when present.
    // Fields are optional; sum only what's reported. The merged gate
    // captures totals at stage level + preserves per-workstream detail
    // inside the workstreams[] array.
    let totalTokensIn = 0, totalTokensOut = 0, totalCost = 0, totalDuration = 0;
    let anyCost = false, anyTokens = false, anyDuration = false;
    for (const w of wsGates) {
      if (typeof w.gate.tokens_in === "number") { totalTokensIn += w.gate.tokens_in; anyTokens = true; }
      if (typeof w.gate.tokens_out === "number") { totalTokensOut += w.gate.tokens_out; }
      if (typeof w.gate.cost_usd === "number") { totalCost += w.gate.cost_usd; anyCost = true; }
      if (typeof w.gate.duration_ms === "number") { totalDuration += w.gate.duration_ms; anyDuration = true; }
    }

    const mergedWarnings = wsGates.flatMap((w) => w.gate.warnings || []);
    // D7: when a workstream gate reports token usage for an unpriced model,
    // budget totals silently under-count. Surface a visible warning so the
    // operator knows enforcement is incomplete for this stage.
    for (const w of wsGates) {
      if (
        typeof w.gate.tokens_in === "number" &&
        typeof w.gate.model === "string" &&
        !pricingFor(w.gate.model)
      ) {
        mergedWarnings.push(`unpriced model ${w.gate.model} — budget enforcement incomplete`);
      }
    }
    const mergedChangesRequested = wsGates.flatMap((w) => {
      const cr = w.gate.changes_requested || [];
      return cr.map((entry) => ({ ...entry, workstream: w.role }));
    });

    // Cross-stage hint: if this is stage-05 peer-review and reviewers requested changes,
    // check whether red-team (stage-04c) already flagged related items as noted_for_followup.
    // Surface a warning so the operator knows to consult stage-04c.json for fix hints.
    if (stageDef.stage === "stage-05" && mergedChangesRequested.length > 0) {
      const redTeamGatePath = path.join(gatesDir, "stage-04c.json");
      if (fs.existsSync(redTeamGatePath)) {
        const { gate: rtGate } = loadGateSafe(redTeamGatePath);
        const ntu = Array.isArray(rtGate && rtGate.noted_for_followup) ? rtGate.noted_for_followup : [];
        if (ntu.length > 0) {
          mergedWarnings.push(
            `[cross-stage] ${ntu.length} red-team item(s) were noted_for_followup at stage-04c ` +
            `and may be driving peer-review objections — consult stage-04c.json for fix hints.`
          );
        }
      }
    }

    const merged = {
      stage: stageDef.stage,
      status: aggregate,
      orchestrator: ORCHESTRATOR_ID,
      // Fall back to the locally-resolved track when a workstream gate omits
      // it (model forgot the field). Without the fallback, merged.track is
      // undefined and the validator flags a gate the orchestrator itself wrote.
      track: wsGates[0].gate.track ?? track,
      timestamp: new Date().toISOString(),
      blockers: wsGates.flatMap((w) => w.gate.blockers || []),
      warnings: mergedWarnings,
      changes_requested: mergedChangesRequested,
      workstreams: wsGates.map((w) => {
        const ws = {
          workstream: w.role,
          host: w.host || w.gate.host || null,
          status: w.gate.status,
        };
        // Preserve per-workstream cost data so dashboard.js can attribute
        // tokens/dollars/duration to (host, role) without re-reading the
        // workstream gate files.
        if (typeof w.gate.tokens_in === "number") ws.tokens_in = w.gate.tokens_in;
        if (typeof w.gate.tokens_out === "number") ws.tokens_out = w.gate.tokens_out;
        if (typeof w.gate.cost_usd === "number") ws.cost_usd = w.gate.cost_usd;
        if (typeof w.gate.duration_ms === "number") ws.duration_ms = w.gate.duration_ms;
        if (typeof w.gate.model === "string") ws.model = w.gate.model;
        return ws;
      }),
    };

    // Stage-level totals — only emit when at least one workstream had data.
    if (anyTokens) { merged.tokens_in = totalTokensIn; merged.tokens_out = totalTokensOut; }
    if (anyCost) merged.cost_usd = totalCost;
    if (anyDuration) merged.duration_ms = totalDuration;

    const outFile = path.join(gatesDir, `${stageDef.stage}.json`);
    fs.writeFileSync(outFile, JSON.stringify(merged, null, 2) + "\n", "utf8");
    // C6: stamp the tamper-evident chain hash of the predecessor stage gate.
    // Best-effort — a chain-stamp failure must never fail a merge.
    try { require("./gates/chain").stampChain(gatesDir, stageName, track); } catch { /* */ }
    setSpanAttributes({
      "devteam.merge.result": "merged",
      "devteam.merge.status": aggregate,
      "devteam.merge.blockers_count": merged.blockers.length,
      "devteam.merge.warnings_count": merged.warnings.length,
    });
    return { merged: true, file: outFile, gate: merged };
  });
}

// Walk stages in order, inspect gate files in pipeline/gates/, decide
// what the caller should do next. Pure read; never mutates state.
//
// When Stage 7's auto-fold preconditions are met, next() returns the
// "fold-sign-off" action instead of writing the gate itself — it is the
// CALLER's responsibility to persist the gate payload and then call
// next() again. This keeps next() a pure function of disk state.
// (See item 1.2 in plans/phase-1-trust-consolidation.md.)
//
// Returns one of:
//   { action: "run-stage",          stage, name, roles, reason }
//   { action: "continue-stage",     stage, name, completed[], remaining[], reason }
//   { action: "merge",              stage, name, reason }
//   { action: "fix-and-retry",      stage, name, gate, blockers[], reason }
//   { action: "resolve-escalation", stage, name, gate, reason }
//   { action: "fold-sign-off",      stage, name, gate_path, gate_content, acCount, reason }
//   { action: "pipeline-complete",  reason }
function next(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const config = opts.config || loadConfig(cwd);
  // B9: resolve changeId for bounded isolation so the read side looks in the
  // same tree that dispatch wrote into (pipeline/changes/<id>/gates/).
  // Accept an explicit changeId (from the driver, which already derived it),
  // or derive it fresh from feature + isolation config (interactive path).
  const isolation = config.pipeline.isolation;
  const changeId = opts.changeId !== undefined
    ? opts.changeId
    : (isolation === "bounded" ? changeIdFromFeature(opts.feature || "") : null);
  const gatesDir = getGatesDir(cwd, changeId);
  // G6: custom_stages in config overrides default_track when no explicit track is passed.
  const track = opts.track
    || (Array.isArray(config.pipeline.custom_stages) ? config.pipeline.custom_stages : null)
    || config.pipeline.default_track
    || "full";
  const skipStages = config.pipeline.skip_stages || [];
  const stageList = orderedStageNamesForTrack(track);
  const maxRetries = (config.autonomy && Number.isInteger(config.autonomy.max_retries))
    ? config.autonomy.max_retries
    : MAX_RETRIES_DEFAULT;

  return withSpan("pipeline.next", {
    "devteam.track": trackLabel(track),
  }, () => {
    const result = _nextImpl(stageList, gatesDir, track, skipStages, maxRetries, cwd, changeId);
    setSpanAttributes({
      "devteam.next.action": result.action,
      "devteam.next.stage": result.stage || undefined,
      "devteam.next.name": result.name || undefined,
    });
    return result;
  });
}

// Are any of a multi-role stage's per-workstream gates present? Used by
// the auto-fold path to avoid clobbering work the PM/Platform agents
// have already started.
function workstreamGatesExistFor(stageDef, gatesDir) {
  if (stageDef.roles.length <= 1) return false;
  return stageDef.roles.some((role) =>
    fs.existsSync(path.join(gatesDir, `${stageDef.stage}.${role}.json`)),
  );
}

// Stage 7 auto-fold. Pure function — returns { ok: false, reason } on
// any precondition failure, or { ok: true, gate, acCount } on success.
// Does NOT write any file; the caller is responsible for persisting the
// returned gate object (see _nextImpl → "fold-sign-off" action).
//
// Preconditions verified by the orchestrator itself (no model trust):
//   1. stage-06.json exists and PASSed
//   2. brief.md has at least one AC-N entry
//   3. test-report.md exists
//   4. every AC-N in brief.md is mentioned in test-report.md
//
// changeId (B9): when non-null, brief.md / test-report.md / runbook.md are
// resolved under pipeline/changes/<changeId>/ via pipelineRoot().
function tryAutoFoldSignOff(cwd, gatesDir, track, changeId) {
  const stage06Path = path.join(gatesDir, "stage-06.json");
  if (!fs.existsSync(stage06Path)) {
    return { ok: false, reason: "stage-06 gate missing" };
  }
  const { gate: stage06, error: stage06Err } = loadGateSafe(stage06Path);
  if (stage06Err) return { ok: false, reason: `stage-06 unreadable: ${stage06Err}` };
  if (stage06.status !== "PASS") {
    return { ok: false, reason: `stage-06 status is ${stage06.status}, not PASS` };
  }

  // Re-verify the AC→test mapping ourselves. The QA agent may have
  // claimed all_acceptance_criteria_met: true; we check.
  // B9: use pipelineRoot() so bounded-mode runs look under
  // pipeline/changes/<changeId>/ instead of the global pipeline/.
  const { extractAcsFromBrief, extractAcsFromReport } = require("./verify/stamp");
  const root = pipelineRoot(cwd, changeId);
  const briefPath = path.join(root, "brief.md");
  const reportPath = path.join(root, "test-report.md");
  if (!fs.existsSync(briefPath)) {
    return { ok: false, reason: "pipeline/brief.md missing (auto-fold needs a brief with AC-N entries)" };
  }
  if (!fs.existsSync(reportPath)) {
    return { ok: false, reason: "pipeline/test-report.md missing" };
  }
  const briefAcs = extractAcsFromBrief(fs.readFileSync(briefPath, "utf8"));
  if (briefAcs.length === 0) {
    return { ok: false, reason: "brief.md has no AC-N entries — auto-fold requires explicit criteria" };
  }
  const reportAcs = new Set(extractAcsFromReport(fs.readFileSync(reportPath, "utf8")));
  const unmapped = briefAcs.filter((ac) => !reportAcs.has(ac));
  if (unmapped.length > 0) {
    return { ok: false, reason: `unmapped AC(s): ${unmapped.join(", ")}` };
  }

  // 1:1 mapping claim. We've already confirmed every AC is mentioned in
  // the report; the QA agent's `criterion_to_test_mapping_is_one_to_one`
  // is an additional uniqueness claim we can't fully verify without
  // parsing the AC|Test table structurally. Trust the gate field here —
  // mis-claiming 1:1 when it isn't is a Stage 5 reviewer concern.
  if (stage06.criterion_to_test_mapping_is_one_to_one !== true) {
    return { ok: false, reason: "stage-06 criterion_to_test_mapping_is_one_to_one is not true" };
  }

  const runbookPath = path.join(root, "runbook.md");
  const runbookExists = fs.existsSync(runbookPath);

  const gate = {
    stage: "stage-07",
    status: "PASS",
    orchestrator: ORCHESTRATOR_ID,
    track,
    timestamp: new Date().toISOString(),
    blockers: [],
    warnings: runbookExists ? [] : ["pipeline/runbook.md not yet authored — Stage 8 will require it"],
    pm_signoff: true,
    deploy_requested: true,
    runbook_referenced: runbookExists,
    auto_from_stage_06: true,
    auto_fold: {
      ac_count: briefAcs.length,
      criteria: briefAcs,
      stamped_at: new Date().toISOString(),
      stamper: `devteam@${require("../package.json").version}`,
    },
  };
  // No fs.writeFileSync here — caller writes via the "fold-sign-off" action.
  return { ok: true, gate, acCount: briefAcs.length };
}

// ── Fix-step computation ──────────────────────────────────────────────────────

function _wsFromWorkstreams(gate) {
  if (!Array.isArray(gate.workstreams)) return [];
  return gate.workstreams
    .filter(w => w.status === "FAIL" || w.status === "ESCALATE")
    .map(w => w.role);
}

function _wsFromBlockers(gate) {
  if (!Array.isArray(gate.blockers)) return [];
  const set = new Set();
  for (const b of gate.blockers) {
    if (typeof b === "object" && b.assigned_to) set.add(b.assigned_to);
  }
  return [...set];
}

// Heuristic: map free-text blocker strings to build workstream roles by
// file-path patterns. Used as a fallback when structured assigned_to is absent.
function _wsFromText(text) {
  const ws = new Set();
  if (/\.test\.[jt]sx?|\.spec\.[jt]sx?|spec\.feature|__tests__|\/tests?\//i.test(text)) ws.add("qa");
  if (/src[/\\]backend[/\\]|\/api\/|\/routes\/|\/controller/i.test(text)) ws.add("backend");
  if (/src[/\\]frontend[/\\]|\/components?\//i.test(text)) ws.add("frontend");
  if (/src[/\\]infra[/\\]|Dockerfile|docker-compose/i.test(text)) ws.add("platform");
  return [...ws];
}

function _rmBuildGates(workstreams) {
  const cmds = workstreams.map(w => `rm pipeline/gates/stage-04.${w}.json`);
  cmds.push("rm pipeline/gates/stage-04.json");
  return cmds;
}

// The canonical home for "which gate files does this recipe want cleared".
// computeFixSteps embeds gate-clears as `rm pipeline/gates/*.json` command
// strings; this extracts them as structured, repo-relative paths so the
// autonomous driver consumes data (action.clear_gates) instead of re-parsing
// shell strings itself. Placeholder targets (e.g. `<affected-ws>`) are kept —
// the driver's unlink is best-effort and skips non-existent paths.
function clearGatesFromFixSteps(fixSteps) {
  const out = [];
  for (const step of (fixSteps || [])) {
    for (const cmd of (step.commands || [])) {
      const m = typeof cmd === "string" && cmd.match(/^rm\s+(?:-\S+\s+)*(pipeline\/gates\/\S+\.json)\s*$/);
      if (m && !out.includes(m[1])) out.push(m[1]);
    }
  }
  return out;
}

/**
 * Returns an ordered array of { description, commands[] } fix steps for a
 * failed gate, or null when no stage-specific recipe can be derived.
 */
function computeFixSteps(gate, stageDef, gatesDir) {
  const stage = stageDef.stage;

  // Check the recipe registry first. Migrated stages return early here;
  // the remaining if-ladder handles stages not yet ported to fix-recipes.js.
  const _recipe = getRecipe(stage);
  if (_recipe && _recipe.diagnose !== undefined) {
    const _diagnosed = _recipe.diagnose(gate, { gatesDir, stageDef });
    if (_diagnosed && _diagnosed.steps !== null) return _diagnosed.steps;
    // null steps means no special recipe — fall through for non-migrated stages.
    // Once all stages are ported, the if-ladder below will be empty and removed.
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────

// B9: cwd and changeId are threaded through so tryAutoFoldSignOff can
// resolve brief.md / test-report.md / runbook.md under the correct
// pipeline root (bounded: pipeline/changes/<changeId>/; in-place: pipeline/).
// Previously cwd was derived from gatesDir via path.resolve("..", ".."), which
// was wrong in bounded mode (gatesDir is .../pipeline/changes/<id>/gates/).
function _nextImpl(stageList, gatesDir, track, skipStages = [], maxRetries = MAX_RETRIES_DEFAULT, cwd, changeId) {
  for (const stageName of stageList) {
    const stageDef = getStage(stageName);
    const stageGatePath = path.join(gatesDir, `${stageDef.stage}.json`);

    // Explicitly skipped via pipeline.skip_stages in config.
    if (skipStages.includes(stageName)) continue;

    // Stage 7 auto-fold. When Stage 6 cleanly satisfies the AC→test
    // contract, return a "fold-sign-off" action carrying the gate content.
    // The CALLER writes the gate and calls next() again — keeping _nextImpl
    // a pure function of disk state. (item 1.2, phase-1-trust-consolidation)
    // Verified — not trusted: we re-derive the AC list from brief.md and
    // the AC→test mapping from test-report.md ourselves, rather than
    // rubber-stamping the QA agent's claim.
    // See docs/concepts.md → "Auto-fold (Stage 7)" for the rationale.
    if (stageName === "sign-off"
        && !fs.existsSync(stageGatePath)
        && !workstreamGatesExistFor(stageDef, gatesDir)) {
      const folded = tryAutoFoldSignOff(cwd, gatesDir, track, changeId);
      if (folded.ok) {
        // Return fold-sign-off so the caller writes the gate and re-runs
        // next(). Do NOT fall through here — stageGatePath doesn't exist
        // yet; the caller must persist the gate before calling next().
        return {
          action: "fold-sign-off",
          stage: stageDef.stage,
          name: stageName,
          gate_path: stageGatePath,
          gate_content: folded.gate,
          acCount: folded.acCount,
          reason: `stage 6 satisfied the AC→test contract (${folded.acCount} criteria mapped)`,
        };
      }
    }

    // Conditional stages: skip when the prerequisite gate's named field
    // is not equal to the required value. The prerequisite gate must
    // already exist — if it doesn't, the pipeline would be advancing
    // out of order, so we surface that as needing the prerequisite first.
    if (stageDef.conditionalOn) {
      const c = stageDef.conditionalOn;
      const prereqGatePath = path.join(gatesDir, `${c.stage}.json`);
      if (!fs.existsSync(prereqGatePath)) {
        // Prereq not done yet; the earlier iteration of this loop should
        // have returned for it. If we got here, fall through to normal
        // run-stage handling — but flag the issue.
      } else {
        const { gate: prereq, error } = loadGateSafe(prereqGatePath);
        if (error) {
          return {
            action: "fix-and-retry", stage: stageDef.stage, name: stageName,
            gate: prereqGatePath,
            failure_class: "state-corruption",
            blockers: [`prereq gate is unreadable: ${error}`],
            reason: "cannot evaluate conditional stage — fix the prereq gate file",
            command: `cat ${prereqGatePath}  # then repair or rewrite`,
          };
        }
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

    const { gate, error: gateError } = loadGateSafe(stageGatePath);
    if (gateError) {
      return {
        action: "fix-and-retry", stage: stageDef.stage, name: stageName,
        gate: stageGatePath,
        failure_class: "state-corruption",
        blockers: [`gate file is unreadable: ${gateError}`],
        reason: "cannot determine stage status — fix or rewrite the gate file",
        command: `cat ${stageGatePath}  # then repair or rewrite`,
      };
    }
    if (gate.status === "ESCALATE") {
      return {
        action: "resolve-escalation", stage: stageDef.stage, name: stageName,
        gate: stageGatePath,
        failure_class: "judgment-gate",
        reason: gate.escalation_reason || "escalation required; pipeline halted",
        command: `devteam ruling --topic "..." --target-gate ${stageGatePath} [--headless]`,
      };
    }
    if (gate.status === "FAIL") {
      const fix_steps = computeFixSteps(gate, stageDef, gatesDir);

      // Convergence ceiling (ADR-003 / H1). When the gate has already been
      // retried up to the budget and is still FAIL, stop returning
      // fix-and-retry and escalate for a ruling instead — re-running the same
      // stage that hasn't converged just burns work. This is a count-based
      // ceiling on retry_number; progress-based detection is a follow-up
      // (needs gate archiving to compare blocker counts across attempts).
      const retryNumber = typeof gate.retry_number === "number" ? gate.retry_number : 0;
      if (retryNumber >= maxRetries) {
        return {
          action: "resolve-escalation", stage: stageDef.stage, name: stageName,
          gate: stageGatePath,
          failure_class: "convergence-exhausted",
          blockers: gate.blockers || [],
          reason: `retry budget exhausted (${retryNumber}/${maxRetries} attempts); escalating for a ruling`,
          command: `devteam ruling --topic "..." --target-gate ${stageGatePath} [--headless]`,
        };
      }

      const clear_gates = clearGatesFromFixSteps(fix_steps);
      return {
        action: "fix-and-retry", stage: stageDef.stage, name: stageName,
        gate: stageGatePath,
        failure_class: classifyGate(gate, fix_steps),
        blockers: gate.blockers || [],
        reason: "stage failed; address blockers and rewrite the gate",
        command: `devteam stage ${stageName}`,
        ...(fix_steps ? { fix_steps } : {}),
        ...(clear_gates.length ? { clear_gates } : {}),
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
  const config = opts.config || loadConfig(cwd);
  // B9: resolve changeId for bounded isolation — same logic as next().
  const isolation = config.pipeline.isolation;
  const changeId = opts.changeId !== undefined
    ? opts.changeId
    : (isolation === "bounded" ? changeIdFromFeature(opts.feature || "") : null);
  const gatesDir = getGatesDir(cwd, changeId);
  // G6: custom_stages in config overrides default_track when no explicit track is passed.
  const track = opts.track
    || (Array.isArray(config.pipeline.custom_stages) ? config.pipeline.custom_stages : null)
    || config.pipeline.default_track
    || "full";
  const skipStages = config.pipeline.skip_stages || [];
  const stageList = orderedStageNamesForTrack(track);

  const rows = [];

  function readJSONSafe(file) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
  }

  for (const stageName of stageList) {
    const stageDef = getStage(stageName);
    const stageGatePath = path.join(gatesDir, `${stageDef.stage}.json`);

    // Explicitly skipped via pipeline.skip_stages.
    if (skipStages.includes(stageName)) {
      rows.push({ stage: stageDef.stage, name: stageName, state: "skipped", reason: "pipeline.skip_stages" });
      continue;
    }

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
      // Fix 1.7.1: guard against a valid-JSON gate missing the `status` field.
      // gate.status.toLowerCase() would throw TypeError — use the
      // (gate.status || "unknown").toLowerCase() pattern so summary() survives
      // incomplete or partially-written gates.
      // (plans/phase-1-trust-consolidation.md item 1.7 fix 1)
      const state = gate ? (gate.status || "unknown").toLowerCase() : "pending";
      const row = { stage: stageDef.stage, name: stageName, state, timestamp: gate && gate.timestamp };
      if (gate && Array.isArray(gate.workstreams) && gate.workstreams.length > 0) {
        row.workstreams = gate.workstreams.map((w) => ({ role: w.workstream, host: w.host, state: (w.status || "unknown").toLowerCase() }));
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
  computeDispatchPlan,
  clearGatesFromFixSteps,
  ORCHESTRATOR_ID,
  rolesPath,
  templatesPath,
  PROJECT_ROOT,
};
