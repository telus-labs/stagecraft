// Bounded autonomous driver (ADR-003 / BACKLOG H2, Phase 1 PR-A).
//
// `devteam run` advances the pipeline unattended on the happy path and HALTS
// cleanly at the first thing that needs a human — it does not auto-fix or
// auto-rule yet (that is PR-B / Phase 2). The driver is deterministic CODE; the
// only LLMs in the loop are the dispatched workstream agents inside
// runStageHeadless.
//
// The loop is a thin switch over next()'s action + failure_class:
//   run-stage / continue-stage → dispatch (in-process via runStageHeadless)
//   merge                       → mergeWorkstreamGates
//   fold-sign-off               → write stage-07.json, log the event, loop
//   fix-and-retry               → HALT and surface failure_class (PR-B acts)
//   resolve-escalation          → HALT for a human ruling/grant
//   pipeline-complete           → done
//
// next() never writes files; fold-sign-off is the mechanism by which the
// driver persists the auto-fold gate and makes it visible in the audit log.
// (item 1.2, plans/phase-1-trust-consolidation.md)
//
// Run-scoped state this layer introduces (the pipeline is otherwise stateless
// within a run): an exclusive lock (pipeline/run.lock), resumable run-state
// (pipeline/run-state.json), and an append-only audit/debug log
// (pipeline/run-log.jsonl).

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { next, runStageHeadless, mergeWorkstreamGates } = require("./orchestrator");
const { loadConfig, changeIdFromFeature, changeIdFromSymptom } = require("./config");
const { pipelineRoot, gatesDir: getGatesDir, logsDir: getLogsDir, prefixPipelineRelative } = require("./paths");
const { orderedStageNamesForTrack } = require("./pipeline/stages");
const { classifyDispatch, MAX_RETRIES_DEFAULT, MAX_TRANSIENT_RETRIES_DEFAULT } = require("./gates/classify");
const { loadPrincipalOutputs, runRuling, runFixEscalation } = require("./escalation");
const { archiveGate, pruneArchives } = require("./gates/archive");
const { detectNoProgress, noProgressEvidence, detectNoSourceChange, noSourceChangeEvidence } = require("./gates/convergence");
const { checkStoplist, explainMatches, STOPLIST_TRACKS } = require("./guards/stoplist");
const { upsertSection } = require("./markers");

// Default escalation runners: render + dispatch the Principal / applicator
// IN-PROCESS via core/escalation.js (no subprocess hop). Both are injectable
// via run() opts for deterministic tests.
function defaultRunRuling(cwd, { targetGate } = {}) {
  return runRuling(cwd, { targetGate });
}
function defaultRunFixEscalation(cwd, { escalatingGate } = {}) {
  return runFixEscalation(cwd, { escalatingGate });
}

// Irreversible / outward-facing stages. The driver never advances INTO these
// without an explicit human grant (--allow-stage), regardless of confidence.
// They are also the non-idempotent stages, so the ceiling doubles as the
// idempotency guard. (ADR-003 §4.2)
const CONSEQUENCE_CEILING = new Set(["sign-off", "deploy"]);

const DEFAULT_MAX_ITERATIONS = 100;

function nowIso() { return new Date().toISOString(); }
// B9 (item 1.6): path helpers accept changeId so bounded runs keep all
// run-scoped artifacts under pipeline/changes/<id>/ alongside the gates
// they read. changeId===null gives the historical in-place paths.
function lockPath(cwd, changeId) { return path.join(pipelineRoot(cwd, changeId), "run.lock"); }
function runStatePath(cwd, changeId) { return path.join(pipelineRoot(cwd, changeId), "run-state.json"); }
function runLogPath(cwd, changeId) { return path.join(pipelineRoot(cwd, changeId), "run-log.jsonl"); }
function gatesDir(cwd, changeId) { return getGatesDir(cwd, changeId); }

// A pid is "alive" if signal 0 succeeds, or fails with EPERM (exists, not ours).
function isPidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === "EPERM"; }
}

function acquireLock(cwd, { force = false } = {}, changeId) {
  const p = lockPath(cwd, changeId);
  if (fs.existsSync(p) && !force) {
    let info = {};
    try { info = JSON.parse(fs.readFileSync(p, "utf8")); } catch { /* unreadable lock */ }
    if (info.pid && isPidAlive(info.pid)) {
      const err = new Error(
        `pipeline is locked by an active run (pid ${info.pid}, started ${info.started_at}). ` +
        `Use --force to override a stale lock.`,
      );
      err.code = "ELOCKED";
      throw err;
    }
    // recorded pid is gone → stale lock; fall through and overwrite
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ pid: process.pid, host: os.hostname(), started_at: nowIso() }, null, 2));
}

function releaseLock(cwd, changeId) { try { fs.unlinkSync(lockPath(cwd, changeId)); } catch { /* already gone */ } }

function loadRunState(cwd, changeId) {
  try { return JSON.parse(fs.readFileSync(runStatePath(cwd, changeId), "utf8")); } catch { return null; }
}
function saveRunState(cwd, changeId, state) {
  try {
    fs.mkdirSync(path.dirname(runStatePath(cwd, changeId)), { recursive: true });
    fs.writeFileSync(runStatePath(cwd, changeId), JSON.stringify(state, null, 2));
  } catch { /* best-effort */ }
}

function logEvent(cwd, changeId, entry) {
  try {
    fs.mkdirSync(path.dirname(runLogPath(cwd, changeId)), { recursive: true });
    fs.appendFileSync(runLogPath(cwd, changeId), JSON.stringify({ ts: nowIso(), ...entry }) + "\n");
  } catch { /* logging must never break the run */ }
}

// Sum cost_usd across all stage gates, avoiding double-counting for multi-role
// stages. Strategy per gate file:
//
//   stage-NN.json / stage-NNa.json  — merged gate; use it and skip any
//     workstream gates for the same stage prefix (the merged gate already
//     rolls up per-workstream costs, see mergeWorkstreamGates in orchestrator).
//
//   stage-NN.<role>.json            — per-workstream gate; include it ONLY
//     when no merged gate exists yet for that stage prefix. This closes the
//     budget-cap blind spot where a multi-role stage's costs are invisible
//     until merge.  (Fix 1.7.3, plans/phase-1-trust-consolidation.md item 1.7)
//
// Best-effort: unreadable or cost-less gates contribute 0.
function totalCostUsd(cwd, changeId) {
  // stage-NN[a].json   — merged gate (letters a-z suffix for overflow stages)
  const mergedGateRe = /^(stage-\d{2}[a-z]?)\.json$/;
  // stage-NN.<role>.json — workstream gate (at least one dot-separated word)
  const wsGateRe = /^(stage-\d{2}[a-z]?)\.[^.]+\.json$/;

  let allFiles = [];
  try { allFiles = fs.readdirSync(gatesDir(cwd, changeId)); } catch { return 0; }

  // Collect merged-gate prefixes (e.g. "stage-04") so we can skip workstream
  // gates for stages that are already merged.
  const mergedPrefixes = new Set();
  for (const f of allFiles) {
    const m = f.match(mergedGateRe);
    if (m) mergedPrefixes.add(m[1]);
  }

  let total = 0;
  for (const f of allFiles) {
    let prefix = null;
    let isWorkstream = false;

    const mm = f.match(mergedGateRe);
    if (mm) {
      prefix = mm[1];
    } else {
      const wm = f.match(wsGateRe);
      if (wm) { prefix = wm[1]; isWorkstream = true; }
    }

    if (!prefix) continue; // not a gate file
    // Skip workstream gates when the merged gate for this stage already exists
    // — the merged gate's cost_usd already includes those workstream costs.
    if (isWorkstream && mergedPrefixes.has(prefix)) continue;

    try {
      const g = JSON.parse(fs.readFileSync(path.join(gatesDir(cwd, changeId), f), "utf8"));
      if (typeof g.cost_usd === "number") total += g.cost_usd;
    } catch { /* skip */ }
  }
  return total;
}

function resolveTrack(opts, config) {
  // ADR-009 §Decision.1: --repair defaults to hotfix depth; --repair --track X overrides.
  return opts.track
    || (opts.repair ? "hotfix" : null)
    || (Array.isArray(config.pipeline.custom_stages) ? config.pipeline.custom_stages : null)
    || config.pipeline.default_track
    || "full";
}

const RUN_BLOCKERS_BEGIN = "<!-- devteam:run-blockers:begin -->";
const RUN_BLOCKERS_END = "<!-- devteam:run-blockers:end -->";

function clearGates(targets) {
  const cleared = [];
  for (const t of targets) {
    try { fs.unlinkSync(t); cleared.push(t); }
    catch { /* not present, or a placeholder like stage-04.<affected-ws>.json */ }
  }
  return cleared;
}

// Cross-stage context propagation (ADR-003 §4.3): record WHY a stage is being
// re-dispatched so the agent's fresh session sees it. Upserted (one section,
// rewritten each retry) so it doesn't accumulate across attempts.
//
// B9 (item 1.6): context.md lives under pipelineRoot() so bounded runs
// write it alongside the other change-scoped artifacts.
function writeRunBlockers(cwd, stageName, blockers, changeId) {
  const p = path.join(pipelineRoot(cwd, changeId), "context.md");
  const items = (blockers || []).map((b) =>
    `- ${typeof b === "string" ? b : (b.text || b.summary || b.message || JSON.stringify(b))}`);
  const section = [
    RUN_BLOCKERS_BEGIN,
    `<!-- written by \`devteam run\` before re-dispatching "${stageName}" -->`,
    `## Address before re-running ${stageName} (autonomous retry)`,
    ...(items.length ? items : ["- (no structured blockers reported)"]),
    RUN_BLOCKERS_END,
  ].join("\n");
  let existing = "";
  try { existing = fs.readFileSync(p, "utf8"); } catch { /* none yet */ }
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, upsertSection(existing, RUN_BLOCKERS_BEGIN, RUN_BLOCKERS_END, section));
  } catch { /* best-effort */ }
}

function defaultSleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ADR-007 Tier 1: observe-only stall probe. Runs fire-and-forget alongside
// each run-stage/continue-stage dispatch. Wakes every stallPollIntervalMs
// and checks whether the workstream log grew or a gate appeared. If neither
// happened within stallThresholdMs, emits a stall-detected event and exits.
// Any log growth resets the clock, so this detects silent hangs only —
// loop-spew (a model emitting repeating output indefinitely) resets the clock
// and is not detected. Content-distinct growth rides with Tier 2.
//
// Returns a cancel() function the caller must invoke when the dispatch settles
// so no stale event fires after the stage has moved on.
function defaultStallProbe(stageName, stageId, cwd, changeId, dispatchStart, opts = {}) {
  const {
    stallThresholdMs = 5 * 60 * 1000,   // 5 minutes
    stallPollIntervalMs = 60 * 1000,     // 60 seconds
    stallMinGrowthBytes = 512,
    logEvent: _logEvent,
    onEvent: _onEvent,
    iteration,
    action,
    sleep: _sleep = defaultSleep,
  } = opts;

  const logsPath = getLogsDir(cwd, changeId);
  const gatesPath = getGatesDir(cwd, changeId);

  // Snapshot log sizes and gate mtimes at probe start.
  function totalLogBytes() {
    try {
      let total = 0;
      const files = fs.readdirSync(logsPath).filter((f) => f.endsWith(".log"));
      for (const f of files) {
        try { total += fs.statSync(path.join(logsPath, f)).size; } catch { /* gone */ }
      }
      return total;
    } catch { return 0; }
  }

  function latestGateMtime() {
    try {
      let latest = 0;
      const prefix = stageId ? stageId.replace(/\.[^.]+$/, "") : "";
      for (const f of fs.readdirSync(gatesPath)) {
        if (prefix && !f.startsWith(prefix)) continue;
        try {
          const mt = fs.statSync(path.join(gatesPath, f)).mtimeMs;
          if (mt > latest) latest = mt;
        } catch { /* gone */ }
      }
      return latest;
    } catch { return 0; }
  }

  let cancelled = false;
  let lastLogBytes = totalLogBytes();
  let lastGateMtime = latestGateMtime();
  let lastProgressMs = Date.now();

  (async () => {
    while (true) {
      await _sleep(stallPollIntervalMs);
      if (cancelled) return;

      const nowBytes = totalLogBytes();
      const nowMtime = latestGateMtime();
      const growth = nowBytes - lastLogBytes;
      const gateUpdated = nowMtime > lastGateMtime;

      if (growth >= stallMinGrowthBytes || gateUpdated) {
        lastLogBytes = nowBytes;
        lastGateMtime = nowMtime;
        lastProgressMs = Date.now();
        continue;
      }

      // No qualifying progress signal since lastProgressMs.
      if (Date.now() - lastProgressMs >= stallThresholdMs) {
        if (cancelled) return;
        const elapsedMs = Date.now() - dispatchStart;
        if (_logEvent) {
          _logEvent({
            outcome: "stall-detected",
            iteration,
            stage: stageName,
            action,
            stall_threshold_ms: stallThresholdMs,
            log_growth_bytes_last_interval: growth,
            gate_updated: gateUpdated,
            dispatch_elapsed_ms: elapsedMs,
            stall_class: "observed",
          });
        }
        if (_onEvent) {
          _onEvent({
            type: "stall-detected",
            stage: stageName,
            action,
            iteration,
            stall_threshold_ms: stallThresholdMs,
            log_growth_bytes_last_interval: growth,
            gate_updated: gateUpdated,
            dispatch_elapsed_ms: elapsedMs,
            stall_class: "observed",
          });
        }
        return; // one observed stall per dispatch (Tier 1 — no retry/kill)
      }
    }
  })();

  return () => { cancelled = true; };
}

// ADR-009 §Decision.3: structural scope gate — check whether a build touched files
// outside the diagnosed affected-files set. Returns an array of out-of-scope file
// paths. Empty array = within scope. Uses git diff --name-only HEAD; returns []
// on any error (be lenient when git is unavailable — the gate is advisory until
// 10.2 supplies a real diagnosis).
const { spawnSync } = require("node:child_process");
function defaultCheckScopeGate(cwd, affectedFiles) {
  if (!affectedFiles || affectedFiles.length === 0) return [];
  const r = spawnSync("git", ["diff", "--name-only", "HEAD"], { cwd, encoding: "utf8" });
  if (!r || r.status !== 0) return [];
  const modified = r.stdout.split(/\r?\n/).filter(Boolean);
  const allowed = new Set(affectedFiles);
  return modified.filter((f) => !allowed.has(f));
}

/**
 * Drive the pipeline autonomously until completion or a halt condition.
 *
 * @param {object} opts
 * @param {string} [opts.cwd]
 * @param {string} [opts.track]
 * @param {string} [opts.until]          stop after this stage (inclusive)
 * @param {number} [opts.maxIterations]  loop guard (default 100)
 * @param {number} [opts.budgetUsd]      halt before a dispatch once spend ≥ cap
 * @param {number} [opts.timeoutMs]      per-stage dispatch wall-clock
 * @param {string[]} [opts.allowStages]  consequence-ceiling grants (sign-off/deploy)
 * @param {boolean} [opts.resume]        continue from existing run-state
 * @param {boolean} [opts.force]         override a stale lock
 * @param {number} [opts.retryDelayMs]   backoff before a transient re-dispatch (default 30000)
 * @param {number} [opts.maxTransientRetries] no-gate retries before structural halt (default 1)
 * @param {string[]} [opts.autoRule]     pre-authorized ruling classes the driver may auto-apply (default none → halt on every escalation)
 * @param {function} [opts.runRuling]    injectable Principal-ruling runner (for tests)
 * @param {function} [opts.runFixEscalation] injectable applicator runner (for tests)
 * @param {function} [opts.onEvent]      progress callback (type + fields)
 * @param {function} [opts.sleep]        injectable delay (for tests)
 * @param {function} [opts.stallProbe]   injectable stall-probe factory (for tests); receives (stageName, stageId, cwd, changeId, dispatchStart, probeOpts) and returns a cancel()
 * @returns {Promise<object>} run summary
 */
async function run(opts = {}) {
  // ADR-009: --repair and --feature are mutually exclusive intents. Reject early
  // so there is no ambiguity about which string drives the changeId or patchItems.
  if (opts.repair && opts.feature) {
    return {
      completed: false,
      halted: true,
      halt_action: "mutual-exclusion",
      halt_failure_class: "mutual-exclusion",
      halt_reason: "--repair and --feature are mutually exclusive — a run is either a bug fix or a feature, not both",
      stages_advanced: [],
      iterations: 0,
      cost_usd: 0,
    };
  }

  const cwd = opts.cwd || process.cwd();
  // Config is intentionally pinned for the lifetime of this run. The track,
  // isolation mode, and changeId are derived here and baked into run-state.json —
  // re-reading config mid-loop could change the stage order or isolation path and
  // silently corrupt an in-progress run. Users who edit .devteam/config.yml mid-run
  // must stop and restart (run.lock will alert them to the active run).
  const config = opts.config || loadConfig(cwd);
  const track = resolveTrack(opts, config);
  // ADR-009 §Decision.7: tag runs by intent from day one so feature vs repair
  // history is distinguishable in run-state.json and run-log.jsonl.
  const intent = opts.repair ? "repair" : "feature";
  // ADR-009 Phase 2: --repair-at escape hatch. Defined early so the stage-order
  // computation below can tell whether to prepend the diagnosis stage.
  const repairAtRaw = opts.repairAt || null;
  // B9 (item 1.6): derive changeId from feature + isolation config so the
  // driver reads/writes lock, run-state, run-log, gates, and context.md in
  // the same bounded subtree that runStageHeadless writes gates into.
  // Accept an explicit opts.changeId for tests; otherwise derive from feature
  // (or symptom for repair runs — ADR-009 §Consequences).
  const isolation = config.pipeline.isolation;
  const changeId = opts.changeId !== undefined
    ? opts.changeId
    : (isolation === "bounded"
        ? (opts.repair ? changeIdFromSymptom(opts.repair || "") : changeIdFromFeature(opts.feature || ""))
        : null);

  // Dependencies are injectable for deterministic testing of the loop without
  // spawning host CLIs; production passes none and gets the real orchestrator.
  const _next = opts.next || next;
  const _runStageHeadless = opts.runStageHeadless || runStageHeadless;
  const _merge = opts.mergeWorkstreamGates || mergeWorkstreamGates;
  const maxIterations = Number.isInteger(opts.maxIterations) ? opts.maxIterations : DEFAULT_MAX_ITERATIONS;
  const budgetUsd = typeof opts.budgetUsd === "number" ? opts.budgetUsd : null;
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : undefined;
  const allowStages = new Set(opts.allowStages || []);
  const onEvent = typeof opts.onEvent === "function" ? opts.onEvent : () => {};
  // PR-B: autonomous fix-and-retry knobs.
  const maxRetries = (config.autonomy && Number.isInteger(config.autonomy.max_retries))
    ? config.autonomy.max_retries
    : MAX_RETRIES_DEFAULT;
  const retryDelayMs = typeof opts.retryDelayMs === "number" ? opts.retryDelayMs : 30000;
  const maxTransientRetries = Number.isInteger(opts.maxTransientRetries)
    ? opts.maxTransientRetries
    : MAX_TRANSIENT_RETRIES_DEFAULT;
  const _sleep = typeof opts.sleep === "function" ? opts.sleep : defaultSleep;
  // ADR-007 Tier 1: stall probe config and injectable factory.
  const stallThresholdMs = (config.autonomy && typeof config.autonomy.stall_threshold_ms === "number")
    ? config.autonomy.stall_threshold_ms
    : 5 * 60 * 1000;
  const stallMinGrowthBytes = (config.autonomy && typeof config.autonomy.stall_min_growth_bytes === "number")
    ? config.autonomy.stall_min_growth_bytes
    : 512;
  const _stallProbe = typeof opts.stallProbe === "function" ? opts.stallProbe : defaultStallProbe;
  // PR-C2: bounded autonomous escalation resolution. Default grant is empty →
  // every escalation halts for a human (the safe default). Class-allowlist only.
  const grantSet = new Set(opts.autoRule || []);
  const _runRuling = typeof opts.runRuling === "function" ? opts.runRuling : defaultRunRuling;
  const _runFixEscalation = typeof opts.runFixEscalation === "function" ? opts.runFixEscalation : defaultRunFixEscalation;
  // ADR-009 §Decision.3: injectable scope gate for deterministic tests.
  const _checkScopeGate = typeof opts.checkScopeGate === "function" ? opts.checkScopeGate : defaultCheckScopeGate;

  // ADR-009 §Decision.1: repair stoplist upgrade — hotfix bypasses STOPLIST_TRACKS
  // by design, but auth/payments/migration symptoms must still force the track to
  // full. Check the symptom now (before acquiring the lock) so the upgrade is visible
  // in the initial run-state write. --force opts out, same as the regular stoplist.
  let effectiveTrack = track;
  let repairStoplistMatches = [];
  if (opts.repair && !opts.force && effectiveTrack !== "full") {
    const _checkStoplist = opts.checkStoplist || checkStoplist;
    repairStoplistMatches = _checkStoplist({ description: opts.repair, cwd });
    if (repairStoplistMatches.length > 0) effectiveTrack = "full";
  }

  // ADR-009 Phase 2: repair without escape hatch prepends "requirements" (diagnosis)
  // to the stage list so next() routes through it before build. The escape hatch
  // (--repair-at) seeds the affected-files list directly and writes a synthetic
  // stage-01 gate — no LLM diagnosis needed, so no prepend.
  // "requirements" is filtered out first to guard against double-prepend if the
  // user specifies a full track that already includes it.
  //
  // ADR-009 Phase 3: repair intent always includes "executable-spec" (stage-03b),
  // providing failing-first reproduction discipline even on hotfix depth (which
  // normally skips it — hotfix has no requirements stage and therefore no brief).
  // Inject executable-spec immediately before "build" in the filtered base list so
  // the PM authors the regression scenario before the build writes the failing test.
  const repairNeedsDiagnosis = intent === "repair" && !repairAtRaw;
  let order;
  if (intent === "repair") {
    const base = orderedStageNamesForTrack(effectiveTrack)
      .filter((n) => n !== "requirements" && n !== "executable-spec");
    const buildIdx = base.indexOf("build");
    const withSpec = buildIdx >= 0
      ? [...base.slice(0, buildIdx), "executable-spec", ...base.slice(buildIdx)]
      : ["executable-spec", ...base];
    order = repairNeedsDiagnosis ? ["requirements", ...withSpec] : withSpec;
  } else {
    order = orderedStageNamesForTrack(effectiveTrack);
  }
  const untilIndex = opts.until ? order.indexOf(opts.until) : -1;

  acquireLock(cwd, { force: opts.force }, changeId);

  const nowTs = nowIso();
  const state = (opts.resume && loadRunState(cwd, changeId)) || {
    track: Array.isArray(effectiveTrack) ? effectiveTrack.join(",") : effectiveTrack,
    intent,                                      // ADR-009 §Decision.7
    ...(opts.repair ? { repair: opts.repair } : {}), // symptom string persisted for correlation
    iterations: 0,
    retries: {},
    started_at: nowTs,
  };
  // Correlation id (ADR-009 §Decision.7): on resume, record the prior run's identity
  // so a re-classified re-run is linkable to its predecessor in the run log.
  if (opts.resume && state.started_at && state.started_at !== nowTs) {
    state.prior_run_id = state.started_at;
    state.started_at = nowTs;
  }
  // PR-B counters (resilient to a resumed state that predates them).
  state.fixRetries = state.fixRetries || {};      // code-defect re-dispatches per stage
  state.autoRule = state.autoRule || {};          // auto-rule attempts per stage
  state.transient = state.transient || {};        // no-gate transient retries per stage
  state.srcFingerprints = state.srcFingerprints || {}; // content hashes for no-source-change detection

  const summary = {
    completed: false,
    halted: false,
    halt_action: null,
    halt_failure_class: null,
    halt_reason: null,
    stages_advanced: [],
    iterations: 0,
    cost_usd: 0,
  };

  // runStart stoplist check (Phase 1 § 1.1 check-point 1 of 2): refuse before
  // any dispatch when the resolved track is in STOPLIST_TRACKS and the brief or
  // description already matches.  Full/hotfix bypass by design — they are not in
  // STOPLIST_TRACKS.  --force opts out.
  function runStoplistCheck(label) {
    if (!STOPLIST_TRACKS.has(effectiveTrack)) return false; // bypass for full/hotfix
    if (opts.force) return false;                            // --force explicit bypass
    const _checkStoplist = opts.checkStoplist || checkStoplist;
    const matches = _checkStoplist({ description: opts.description || "", cwd });
    if (matches.length === 0) return false;
    const reason = explainMatches(matches);
    summary.halted = true;
    summary.halt_action = "stoplist";
    summary.halt_reason = reason;
    logEvent(cwd, changeId, { outcome: "stoplist-halt", label, track: effectiveTrack, matches: matches.map((m) => m.name) });
    onEvent({ type: "halt", action: "stoplist", reason, label, track: effectiveTrack, matches: matches.map((m) => m.name) });
    return true; // halted
  }

  // ADR-009 §Decision.1: patchItems for repair mode. Populated from the symptom
  // until 10.2's diagnosis supplies an affected-files list + structured items.
  // 10.2: made mutable — updated from the diagnosis gate's affected_files once
  // stage-01 PASSes, so the build stage receives a structured list not just the symptom.
  let repairPatchItems = opts.repair ? [opts.repair] : null;

  try {
    // Log the repair stoplist upgrade event (computed before lock/state were set up).
    if (repairStoplistMatches.length > 0) {
      logEvent(cwd, changeId, {
        outcome: "repair-stoplist-upgrade",
        symptom: opts.repair,
        upgraded_to: effectiveTrack,
        matches: repairStoplistMatches.map((m) => m.name),
      });
      onEvent({
        type: "repair-stoplist-upgrade",
        track: effectiveTrack,
        matches: repairStoplistMatches,
      });
    }

    // ADR-009 Phase 2: --repair-at escape hatch. Parse locations, seed
    // affectedFiles + patchItems, write synthetic stage-01 PASS gate.
    if (repairAtRaw && opts.repair) {
      const locations = Array.isArray(repairAtRaw)
        ? repairAtRaw
        : String(repairAtRaw).split(",").map((s) => s.trim()).filter(Boolean);
      const seededFiles = [...new Set(locations.map((loc) => loc.replace(/:.*$/, "")))];
      if (seededFiles.length > 0) {
        state.affectedFiles = seededFiles;
        repairPatchItems = locations.map((loc) => `Fix ${loc}: ${opts.repair}`);
        // Synthetic gate makes next() see stage-01 as PASS (skips LLM diagnosis).
        const diagGatePath = path.join(gatesDir(cwd, changeId), "stage-01.json");
        try {
          fs.mkdirSync(path.dirname(diagGatePath), { recursive: true });
          fs.writeFileSync(diagGatePath, JSON.stringify({
            stage: "stage-01",
            workstream: "pm",
            status: "PASS",
            track: effectiveTrack,
            timestamp: nowIso(),
            blockers: [],
            warnings: [],
            root_cause: opts.repair,
            proposed_fix: `User-specified fix location(s): ${locations.join(", ")}`,
            affected_files: seededFiles,
            regression_criterion: "",
            diagnosis_confirmed: true,
            seeded_by: "--repair-at",
            seeded_locations: locations,
          }, null, 2) + "\n");
        } catch { /* best-effort — if write fails, next() dispatches stage-01 normally */ }
        saveRunState(cwd, changeId, state);
        logEvent(cwd, changeId, {
          outcome: "repair-at-seeded",
          symptom: opts.repair,
          locations,
          affected_files: seededFiles,
        });
        onEvent({ type: "repair-at-seeded", symptom: opts.repair, locations, affected_files: seededFiles });
      }
    }

    // Check-point 1: run start (before the first loop iteration).
    if (runStoplistCheck("run-start")) {
      // halt recorded above; skip the loop entirely.
    } else
    for (let i = 0; i < maxIterations; i++) {
      // ADR-007 §2: emit heartbeat before next() so run-log.jsonl always has a
      // bounded last-event age regardless of dispatch duration. Cheap: no fs scans.
      const heartbeatIteration = (state.iterations || 0) + 1;
      logEvent(cwd, changeId, {
        outcome: "heartbeat",
        iteration: heartbeatIteration,
        stage: state.current_stage || null,
        action: state.last_action || null,
        run_state_path: runStatePath(cwd, changeId),
        cost_usd_so_far: totalCostUsd(cwd, changeId),
      });
      onEvent({
        type: "heartbeat",
        iteration: heartbeatIteration,
        stage: state.current_stage || null,
        action: state.last_action || null,
        cost_usd: totalCostUsd(cwd, changeId),
      });

      // Pass the repair-aware order (array) for repair runs — includes the diagnosis
      // stage at the front. Passes the raw CLI track for feature runs, keeping
      // the original behaviour. G6's custom-array path handles array tracks.
      const nextTrack = intent === "repair" ? order : opts.track;
      const r = _next({ cwd, track: nextTrack, changeId });
      state.iterations = (state.iterations || 0) + 1;
      state.last_action = r.action;
      state.current_stage = r.name || null;
      saveRunState(cwd, changeId, state);

      const base = {
        iteration: state.iterations,
        stage: r.stage || null,
        name: r.name || null,
        action: r.action,
        failure_class: r.failure_class || null,
        reason: r.reason,
        intent, // ADR-009 §Decision.7
      };

      if (r.action === "pipeline-complete") {
        summary.completed = true;
        logEvent(cwd, changeId, { ...base, outcome: "complete" });
        onEvent({ type: "complete", ...base });
        break;
      }

      // fold-sign-off: orchestrator verified a clean AC→test mapping and
      // returned the gate content for us to persist. Write the gate here so
      // the act is visible in the audit log (today it was a silent side effect
      // of next()). No --allow-stage required — the fold is orchestrator-derived
      // from verified AC mapping, not model-asserted. (item 1.2, phase-1-trust)
      if (r.action === "fold-sign-off") {
        fs.mkdirSync(path.dirname(r.gate_path), { recursive: true });
        fs.writeFileSync(r.gate_path, JSON.stringify(r.gate_content, null, 2) + "\n", "utf8");
        logEvent(cwd, changeId, {
          ...base,
          outcome: "auto-fold-sign-off",
          event: "auto-fold-sign-off",
          derived_from: "brief AC mapping",
          gate_path: r.gate_path,
          ac_count: r.acCount,
        });
        onEvent({ type: "auto-fold-sign-off", ...base, ac_count: r.acCount });
        continue;
      }

      // PR-B: the driver auto-fixes code-defect FAILs — clear the failing
      // gate(s) the recipe names, propagate the blockers as context, and loop
      // (next() will re-dispatch). Bounded by a driver-side retry ceiling, the
      // authoritative backstop (next()'s convergence-exhausted relies on the
      // agent bumping retry_number, which the driver does not control).
      if (r.action === "fix-and-retry" && r.failure_class === "code-defect") {
        const attempts = state.fixRetries[r.name] || 0;
        if (attempts >= maxRetries) {
          summary.halted = true;
          summary.halt_action = "resolve-escalation";
          summary.halt_failure_class = "convergence-exhausted";
          summary.halt_reason = `driver retry budget exhausted for "${r.name}" (${attempts}/${maxRetries}); escalating`;
          summary.blockers = r.blockers || [];
          logEvent(cwd, changeId, { ...base, outcome: "convergence-halt" });
          onEvent({ type: "halt", ...base, action: "resolve-escalation", failure_class: "convergence-exhausted", reason: summary.halt_reason, blockers: r.blockers });
          break;
        }
        // Archive the failed attempt's stage gate before it's cleared/overwritten.
        // The archive is the data source for the progress-based convergence check
        // below — archiving must happen first. Best-effort.
        const archived = archiveGate(gatesDir(cwd, changeId), r.stage, attempts + 1);

        // Progress-based convergence check (4.2): trip the breaker when the last
        // two archived attempts carry identical non-empty blocker sets, even before
        // the count ceiling is reached. Prefers archived data (orchestrator-written)
        // over the current live gate (model-written). (ADR-003)
        const progress = detectNoProgress(gatesDir(cwd, changeId), r.stage);
        if (progress.noProgress) {
          const evidence = noProgressEvidence(progress.stuckBlockers, progress.attempts);
          summary.halted = true;
          summary.halt_action = "resolve-escalation";
          summary.halt_failure_class = "convergence-exhausted";
          summary.halt_reason = `no-progress convergence for "${r.name}": ${evidence}; escalating for a ruling`;
          summary.blockers = r.blockers || [];
          summary.no_progress_evidence = evidence;
          logEvent(cwd, changeId, { ...base, outcome: "convergence-halt", no_progress_evidence: evidence, archived: archived || null });
          onEvent({ type: "halt", ...base, action: "resolve-escalation", failure_class: "convergence-exhausted", reason: summary.halt_reason, blockers: r.blockers, no_progress_evidence: evidence });
          break;
        }

        // No-source-change check: if blockers name specific files and those files'
        // content is identical to the baseline captured on the previous iteration,
        // the build agent made no actionable edits. Halt before dispatching another
        // wasted build — the defect requires a config-level fix the agent cannot apply.
        const srcCheck = detectNoSourceChange(cwd, gatesDir(cwd, changeId), r.stage, state);
        if (srcCheck.noSourceChange) {
          const evidence = noSourceChangeEvidence(srcCheck.lastAttempt, srcCheck.files);
          summary.halted = true;
          summary.halt_action = "resolve-escalation";
          summary.halt_failure_class = "convergence-exhausted";
          summary.halt_reason = `no-source-change convergence for "${r.name}": ${evidence}; escalating for a ruling`;
          summary.blockers = r.blockers || [];
          summary.no_source_change_evidence = evidence;
          logEvent(cwd, changeId, { ...base, outcome: "convergence-halt", no_source_change_evidence: evidence, archived: archived || null });
          onEvent({ type: "halt", ...base, action: "resolve-escalation", failure_class: "convergence-exhausted", reason: summary.halt_reason, blockers: r.blockers, no_source_change_evidence: evidence });
          break;
        }

        // B9 (item 5.4): recipes emit in-place pipeline/ paths; rewrite them
        // through prefixPipelineRelative so bounded runs clear the right gates.
        const toClear = (r.clear_gates || []).map((rel) =>
          path.join(cwd, prefixPipelineRelative(rel, changeId)),
        );
        const cleared = clearGates(toClear);
        // 5.2: prune archives for every stage whose gates were cleared — re-entry
        // starts a fresh attempt sequence so stale archives must not survive.
        // Best-effort; derive stage IDs from the gate filenames (part before first dot).
        const clearedStageIds = new Set(
          toClear.map((p) => path.basename(p).replace(/\..*$/, "")),
        );
        for (const sid of clearedStageIds) {
          try { pruneArchives(gatesDir(cwd, changeId), sid); } catch { /* never block a retry */ }
        }
        // If a recipe exists but cleared nothing, next() will return the same
        // fix-and-retry unchanged. Halt immediately rather than burning retries.
        // Stages with no recipe (toClear empty) still reach convergence-exhausted —
        // they may recover if the agent self-corrects on retry.
        if (cleared.length === 0 && toClear.length > 0) {
          summary.halted = true;
          summary.halt_action = "fix-and-retry";
          summary.halt_failure_class = "structural-input";
          summary.halt_reason =
            `fix steps for "${r.name}" contain no gate clears — cannot make automated progress; `
            + `run \`devteam next\` for manual fix steps`;
          summary.blockers = r.blockers || [];
          summary.fix_steps = r.fix_steps || [];
          logEvent(cwd, changeId, { ...base, outcome: "no-progress-halt", archived: archived || null });
          onEvent({ type: "halt", ...base, failure_class: "structural-input", reason: summary.halt_reason, blockers: r.blockers, fix_steps: r.fix_steps });
          break;
        }
        writeRunBlockers(cwd, r.name, r.blockers, changeId);
        state.fixRetries[r.name] = attempts + 1;
        saveRunState(cwd, changeId, state);
        logEvent(cwd, changeId, { ...base, outcome: "fix-retry", attempt: attempts + 1, cleared_gates: cleared.length, archived: archived || null });
        onEvent({ type: "fix-retry", ...base, attempt: attempts + 1, cleared_gates: cleared.length });
        continue;
      }

      // PR-C2: bounded autonomous escalation resolution. With no --auto-rule
      // grant the driver halts (the safe default). With a grant, it dispatches
      // the Principal and auto-applies a ruling whose class is granted — but
      // NEVER crosses the hard stops (cannot-decide, the consequence ceiling,
      // convergence-exhausted), and at most once per stage.
      if (r.action === "resolve-escalation") {
        const hardStop = r.failure_class === "convergence-exhausted" || CONSEQUENCE_CEILING.has(r.name);
        const alreadyTried = (state.autoRule[r.name] || 0) >= 1;
        if (grantSet.size === 0 || hardStop || alreadyTried) {
          summary.halted = true;
          summary.halt_action = "resolve-escalation";
          summary.halt_failure_class = r.failure_class || "judgment-gate";
          summary.halt_reason = hardStop
            ? `escalation requires a human (auto-rule never crosses ${r.failure_class === "convergence-exhausted" ? "convergence-exhausted" : "the consequence ceiling"})`
            : alreadyTried
              ? `auto-rule already attempted once for "${r.name}" and it re-escalated; halting for a human`
              : r.reason;
          logEvent(cwd, changeId, { ...base, outcome: "halt" });
          onEvent({ type: "halt", ...base });
          break;
        }

        // Dispatch the Principal; inspect only the output it appends this turn.
        const before = loadPrincipalOutputs(cwd).length;
        onEvent({ type: "auto-rule-dispatch", ...base });
        const rr = await _runRuling(cwd, { targetGate: r.gate });
        state.autoRule[r.name] = (state.autoRule[r.name] || 0) + 1;
        saveRunState(cwd, changeId, state);
        const fresh = loadPrincipalOutputs(cwd).slice(before);
        const latest = fresh.length ? fresh[fresh.length - 1] : null;

        if (!latest || (rr && rr.exitCode !== 0)) {
          summary.halted = true;
          summary.halt_action = "resolve-escalation";
          summary.halt_failure_class = "judgment-gate";
          summary.halt_reason = "Principal produced no ruling; halting for a human";
          logEvent(cwd, changeId, { ...base, outcome: "auto-rule-no-output" });
          onEvent({ type: "halt", ...base });
          break;
        }
        if (latest.type === "cannot-decide") {
          summary.halted = true;
          summary.halt_action = "resolve-escalation";
          summary.halt_failure_class = "cannot-decide";
          summary.cannot_decide = { reason_class: latest.reason_class, question: latest.question };
          summary.halt_reason = `Principal cannot decide (${latest.reason_class}): ${latest.question}`;
          logEvent(cwd, changeId, { ...base, outcome: "cannot-decide", reason_class: latest.reason_class });
          onEvent({ type: "cannot-decide", ...base, reason_class: latest.reason_class, question: latest.question });
          break;
        }
        if (!grantSet.has(latest.class)) {
          summary.halted = true;
          summary.halt_action = "resolve-escalation";
          summary.halt_failure_class = "judgment-gate";
          summary.halt_reason = `ruling class "${latest.class}" is not in the --auto-rule grant; halting for a human`;
          logEvent(cwd, changeId, { ...base, outcome: "auto-rule-ungranted", ruling_class: latest.class });
          onEvent({ type: "halt", ...base, ruling_class: latest.class });
          break;
        }
        // Granted class → apply the ruling and resume.
        const fr = await _runFixEscalation(cwd, { escalatingGate: r.gate });
        if (fr && fr.exitCode !== 0) {
          summary.halted = true;
          summary.halt_action = "resolve-escalation";
          summary.halt_reason = `escalation applicator failed (exit ${fr.exitCode}); halting`;
          logEvent(cwd, changeId, { ...base, outcome: "auto-rule-apply-failed" });
          onEvent({ type: "halt", ...base });
          break;
        }
        const authority = `auto-rule:${latest.class}`;
        // PR-D2: bind the authority record ONTO the escalating gate, so the
        // autonomous-decision provenance inherits C6 tamper-evidence (vs. only
        // living in run-log.jsonl). Best-effort: if the applicator cleared the
        // gate to re-run, the run-log still carries the record. The gate is
        // hashed by the next downstream stamp, so resolved_by enters the chain.
        try {
          if (r.gate && fs.existsSync(r.gate)) {
            const g = JSON.parse(fs.readFileSync(r.gate, "utf8"));
            g.resolved_by = { authority, grant_class: latest.class, ruling: latest.decision, ts: nowIso() };
            fs.writeFileSync(r.gate, JSON.stringify(g, null, 2) + "\n");
          }
        } catch { /* run-log retains the record */ }
        logEvent(cwd, changeId, { ...base, outcome: "auto-ruled", grant_class: latest.class, ruling: latest.decision, authority });
        onEvent({ type: "auto-ruled", ...base, grant_class: latest.class, ruling: latest.decision, authority });
        continue;
      }

      // Non-auto-fixable fix-and-retry classes (state-corruption /
      // external-blocked) halt for a human.
      if (r.action === "fix-and-retry") {
        summary.halted = true;
        summary.halt_action = r.action;
        summary.halt_failure_class = r.failure_class || null;
        summary.halt_reason = r.reason;
        summary.blockers = r.blockers || [];
        summary.fix_steps = r.fix_steps || [];
        logEvent(cwd, changeId, { ...base, outcome: "halt" });
        onEvent({ type: "halt", ...base, blockers: r.blockers, fix_steps: r.fix_steps });
        break;
      }

      if (r.action === "run-stage" || r.action === "continue-stage") {
        // Consequence ceiling — irreversible/outward-facing stages need a grant.
        if (CONSEQUENCE_CEILING.has(r.name) && !allowStages.has(r.name)) {
          summary.halted = true;
          summary.halt_action = "ceiling";
          summary.halt_reason = `consequence ceiling: "${r.name}" requires an explicit human grant (--allow-stage ${r.name})`;
          logEvent(cwd, changeId, { ...base, outcome: "ceiling-halt" });
          onEvent({ type: "ceiling", ...base });
          break;
        }

        // --until boundary (inclusive): stop before dispatching a later stage.
        if (untilIndex >= 0) {
          const idx = order.indexOf(r.name);
          if (idx > untilIndex) {
            summary.halted = true;
            summary.halt_action = "until";
            summary.halt_reason = `reached --until boundary "${opts.until}"`;
            logEvent(cwd, changeId, { ...base, outcome: "until-halt" });
            onEvent({ type: "until", ...base });
            break;
          }
        }

        // Budget — pre-dispatch check. Cost is only known AFTER a dispatch, so
        // this prevents the NEXT stage, not an overrun of the current one.
        if (budgetUsd != null) {
          const spent = totalCostUsd(cwd, changeId);
          if (spent >= budgetUsd) {
            summary.halted = true;
            summary.halt_action = "budget";
            summary.halt_reason = `budget cap reached: $${spent.toFixed(2)} ≥ $${budgetUsd.toFixed(2)}`;
            logEvent(cwd, changeId, { ...base, outcome: "budget-halt", cost_usd: spent });
            onEvent({ type: "budget", ...base, cost_usd: spent });
            break;
          }
        }

        // Check-point 2 (Phase 1 § 1.1): re-run the stoplist immediately before
        // dispatching build (stage-04) because the requirements agent may have
        // written pipeline/brief.md after run-start; the start-of-run check would
        // have seen no brief yet.  Exactly two check-points: start + pre-build.
        if (r.stage === "stage-04" && runStoplistCheck("pre-build")) break;

        // ADR-009 Phase 2: before dispatching build (stage-04) in repair mode,
        // check whether the diagnosis gate has now landed (stage-01 just PASSed
        // after escalation approval) and propagate its affected_files.
        // This is also the point where repairPatchItems upgrades from the raw
        // symptom string to a structured per-file list from the diagnosis.
        if (intent === "repair" && !repairAtRaw && !state.affectedFiles) {
          const diagGatePath = path.join(gatesDir(cwd, changeId), "stage-01.json");
          try {
            if (fs.existsSync(diagGatePath)) {
              const diagGate = JSON.parse(fs.readFileSync(diagGatePath, "utf8"));
              if (
                diagGate.status === "PASS" &&
                Array.isArray(diagGate.affected_files) &&
                diagGate.affected_files.length > 0
              ) {
                state.affectedFiles = diagGate.affected_files;
                // Upgrade patchItems to structured per-file entries from the diagnosis.
                repairPatchItems = diagGate.affected_files.map(
                  (f) => `Fix ${f}: ${diagGate.proposed_fix || opts.repair}`,
                );
                saveRunState(cwd, changeId, state);
                logEvent(cwd, changeId, {
                  outcome: "diagnosis-activated",
                  affected_files: state.affectedFiles,
                });
              }
            }
          } catch { /* best-effort — diagnosis gate may not exist yet */ }
        }

        onEvent({ type: "dispatch", ...base });
        const t0 = Date.now();
        // ADR-007 Tier 1: start the observe-only stall probe fire-and-forget.
        // The probe emits stall-detected if the workstream log and gate are both
        // flat for stallThresholdMs. It NEVER kills or alters the dispatch — the
        // await below is always the sole resolution path (no Promise.race).
        const cancelStallProbe = _stallProbe(r.name, r.stage, cwd, changeId, t0, {
          stallThresholdMs,
          stallMinGrowthBytes,
          logEvent: (entry) => logEvent(cwd, changeId, entry),
          onEvent,
          iteration: state.iterations,
          action: r.action,
          sleep: _sleep,
        });
        let runResult;
        try {
          runResult = await _runStageHeadless(r.name, {
            cwd,
            track: opts.repair ? effectiveTrack : opts.track,
            feature: opts.feature || "",
            intent,   // ADR-009 §Decision.7: propagate so adapters render repair prompts
            timeoutMs,
            skipCompleted: r.action === "continue-stage",
            // ADR-009 §Decision.2: repair builds run in PATCH MODE (renderPatchBlock).
            // After 10.2 diagnosis, repairPatchItems holds structured per-file items.
            ...(repairPatchItems ? { patchItems: repairPatchItems } : {}),
          });
        } finally {
          // Dispatch settled — cancel the probe so it never fires a stale event.
          cancelStallProbe();
        }
        const results = Array.isArray(runResult) ? runResult : (runResult.results || []);
        const durationMs = Date.now() - t0;
        const nonSkipped = results.filter((x) => !x.skipped);
        const anyTimedOut = results.some((x) => x.timedOut);
        const wroteGate = nonSkipped.every((x) => x.gatePath);
        // exitCode is 0 only when every dispatched workstream cleanly exited 0;
        // any non-zero/null (timeout) collapses to 1 for classification.
        const exitCode = nonSkipped.length > 0 && nonSkipped.every((x) => x.exitCode === 0) ? 0 : 1;
        state.retries[r.name] = (state.retries[r.name] || 0) + 1;
        saveRunState(cwd, changeId, state);
        if (!summary.stages_advanced.includes(r.name)) summary.stages_advanced.push(r.name);
        logEvent(cwd, changeId, {
          ...base, outcome: "dispatched",
          duration_ms: durationMs, workstreams: results.length,
          timed_out: anyTimedOut, no_gate: !wroteGate,
        });
        onEvent({ type: "dispatched", ...base, duration_ms: durationMs, timed_out: anyTimedOut });

        // Dispatch-time classification (PR-B) — replaces PR-A's no-progress
        // guard. A dispatch that wrote no gate is transient (backoff + retry)
        // until the transient budget is spent, then structural (halt).
        const dispatchClass = classifyDispatch(
          { wroteGate, exitCode, timedOut: anyTimedOut },
          { transientRetries: state.transient[r.name] || 0, maxTransientRetries },
        );
        if (dispatchClass === "ok") {
          state.transient[r.name] = 0;
          saveRunState(cwd, changeId, state);

          // ADR-009 §Decision.3: structural scope gate. FAILs a build that
          // touches files outside the diagnosed affected-files set. In 10.1 the
          // gate is inert (opts.affectedFiles is absent — no diagnosis yet);
          // 10.2 activates it by supplying the diagnosed affected-files list.
          // Peer-review criteria gain "could this be smaller?" as a judgment on
          // top of this mechanical boundary.
          const affectedFiles = opts.affectedFiles || state.affectedFiles || null;
          if (r.stage === "stage-04" && affectedFiles) {
            const outOfScope = _checkScopeGate(cwd, affectedFiles);
            if (outOfScope.length > 0) {
              summary.halted = true;
              summary.halt_action = "scope-gate";
              summary.halt_failure_class = "scope-gate";
              summary.halt_reason = `repair scope gate: build touched files outside the diagnosed affected-files set: ${outOfScope.join(", ")}`;
              summary.out_of_scope = outOfScope;
              logEvent(cwd, changeId, { ...base, outcome: "scope-gate-fail", out_of_scope: outOfScope });
              onEvent({ type: "halt", ...base, action: "scope-gate", reason: summary.halt_reason, out_of_scope: outOfScope });
              break;
            }
          }

          continue;
        }
        if (dispatchClass === "transient") {
          state.transient[r.name] = (state.transient[r.name] || 0) + 1;
          saveRunState(cwd, changeId, state);
          logEvent(cwd, changeId, { ...base, outcome: "transient-retry", attempt: state.transient[r.name] });
          onEvent({ type: "transient-retry", ...base, attempt: state.transient[r.name], delay_ms: retryDelayMs });
          await _sleep(retryDelayMs);
          continue;
        }
        // structural-input — retrying the same dispatch cannot help.
        summary.halted = true;
        summary.halt_action = "structural-input";
        summary.halt_failure_class = "structural-input";
        summary.halt_reason =
          `dispatch of "${r.name}" produced no gate and is not transient ` +
          `(clean exit with no output, or repeated failure) — input is structurally unworkable`;
        logEvent(cwd, changeId, { ...base, outcome: "structural-halt" });
        onEvent({ type: "structural", ...base });
        break;
      }

      if (r.action === "merge") {
        onEvent({ type: "merge", ...base });
        const m = _merge(r.name, { cwd, track: opts.track, changeId });
        logEvent(cwd, changeId, { ...base, outcome: m.merged ? "merged" : "merge-failed", reason: m.reason || null });
        if (!m.merged) {
          summary.halted = true;
          summary.halt_action = "merge-failed";
          summary.halt_reason = m.reason || "merge failed";
          onEvent({ type: "merge-failed", ...base, reason: m.reason });
          break;
        }
        continue;
      }

      // Unknown action — halt defensively rather than spin.
      summary.halted = true;
      summary.halt_action = r.action;
      summary.halt_reason = `unhandled action "${r.action}"`;
      logEvent(cwd, changeId, { ...base, outcome: "unhandled" });
      onEvent({ type: "unhandled", ...base });
      break;
    }

    if (!summary.completed && !summary.halted) {
      summary.halted = true;
      summary.halt_action = "max-iterations";
      summary.halt_reason = `reached max iterations (${maxIterations})`;
      logEvent(cwd, changeId, { iteration: state.iterations, outcome: "max-iterations-halt" });
    }
  } finally {
    summary.iterations = state.iterations || 0;
    summary.cost_usd = totalCostUsd(cwd, changeId);
    saveRunState(cwd, changeId, state);
    releaseLock(cwd, changeId);
  }

  return summary;
}

module.exports = { run, CONSEQUENCE_CEILING, DEFAULT_MAX_ITERATIONS, totalCostUsd, runStatePath, runLogPath };
