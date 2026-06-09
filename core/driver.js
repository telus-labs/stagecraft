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
//   fix-and-retry               → HALT and surface failure_class (PR-B acts)
//   resolve-escalation          → HALT for a human ruling/grant
//   pipeline-complete           → done
//
// next() is unchanged: the new actions the design sketched (halt/block) are
// driver OUTCOMES, not orchestrator actions — the driver derives them from the
// action + failure_class. That keeps next() a pure function of disk state.
//
// Run-scoped state this layer introduces (the pipeline is otherwise stateless
// within a run): an exclusive lock (pipeline/run.lock), resumable run-state
// (pipeline/run-state.json), and an append-only audit/debug log
// (pipeline/run-log.jsonl).

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { next, runStageHeadless, mergeWorkstreamGates } = require("./orchestrator");
const { loadConfig } = require("./config");
const { orderedStageNamesForTrack } = require("./pipeline/stages");

// Irreversible / outward-facing stages. The driver never advances INTO these
// without an explicit human grant (--allow-stage), regardless of confidence.
// They are also the non-idempotent stages, so the ceiling doubles as the
// idempotency guard. (ADR-003 §4.2)
const CONSEQUENCE_CEILING = new Set(["sign-off", "deploy"]);

const DEFAULT_MAX_ITERATIONS = 100;

function nowIso() { return new Date().toISOString(); }
function lockPath(cwd) { return path.join(cwd, "pipeline", "run.lock"); }
function runStatePath(cwd) { return path.join(cwd, "pipeline", "run-state.json"); }
function runLogPath(cwd) { return path.join(cwd, "pipeline", "run-log.jsonl"); }
function gatesDir(cwd) { return path.join(cwd, "pipeline", "gates"); }

// A pid is "alive" if signal 0 succeeds, or fails with EPERM (exists, not ours).
function isPidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === "EPERM"; }
}

function acquireLock(cwd, { force = false } = {}) {
  const p = lockPath(cwd);
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

function releaseLock(cwd) { try { fs.unlinkSync(lockPath(cwd)); } catch { /* already gone */ } }

function loadRunState(cwd) {
  try { return JSON.parse(fs.readFileSync(runStatePath(cwd), "utf8")); } catch { return null; }
}
function saveRunState(cwd, state) {
  try {
    fs.mkdirSync(path.dirname(runStatePath(cwd)), { recursive: true });
    fs.writeFileSync(runStatePath(cwd), JSON.stringify(state, null, 2));
  } catch { /* best-effort */ }
}

function logEvent(cwd, entry) {
  try {
    fs.mkdirSync(path.dirname(runLogPath(cwd)), { recursive: true });
    fs.appendFileSync(runLogPath(cwd), JSON.stringify({ ts: nowIso(), ...entry }) + "\n");
  } catch { /* logging must never break the run */ }
}

// Sum cost_usd across MERGED stage gates only (stage-NN[a].json) — not the
// per-workstream gates (stage-NN.<role>.json), whose cost is already rolled up
// into the merged gate. Summing every *.json would double-count multi-role
// stages. Best-effort: unreadable or cost-less gates contribute 0.
function totalCostUsd(cwd) {
  const stageGate = /^stage-\d{2}[a-z]?\.json$/;
  let total = 0;
  let files = [];
  try { files = fs.readdirSync(gatesDir(cwd)).filter((f) => stageGate.test(f)); } catch { return 0; }
  for (const f of files) {
    try {
      const g = JSON.parse(fs.readFileSync(path.join(gatesDir(cwd), f), "utf8"));
      if (typeof g.cost_usd === "number") total += g.cost_usd;
    } catch { /* skip */ }
  }
  return total;
}

function resolveTrack(opts, config) {
  return opts.track
    || (Array.isArray(config.pipeline.custom_stages) ? config.pipeline.custom_stages : null)
    || config.pipeline.default_track
    || "full";
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
 * @param {function} [opts.onEvent]      progress callback (type + fields)
 * @returns {Promise<object>} run summary
 */
async function run(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const config = opts.config || loadConfig(cwd);
  const track = resolveTrack(opts, config);

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

  const order = orderedStageNamesForTrack(track);
  const untilIndex = opts.until ? order.indexOf(opts.until) : -1;

  acquireLock(cwd, { force: opts.force });

  const state = (opts.resume && loadRunState(cwd)) || {
    track: Array.isArray(track) ? track.join(",") : track,
    iterations: 0,
    retries: {},
    started_at: nowIso(),
  };

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
  let lastKey = null;

  try {
    for (let i = 0; i < maxIterations; i++) {
      const r = _next({ cwd, track: opts.track });
      state.iterations = (state.iterations || 0) + 1;
      state.last_action = r.action;
      state.current_stage = r.name || null;
      saveRunState(cwd, state);

      const base = {
        iteration: state.iterations,
        stage: r.stage || null,
        name: r.name || null,
        action: r.action,
        failure_class: r.failure_class || null,
        reason: r.reason,
      };

      if (r.action === "pipeline-complete") {
        summary.completed = true;
        logEvent(cwd, { ...base, outcome: "complete" });
        onEvent({ type: "complete", ...base });
        break;
      }

      // PR-A: the driver does not auto-fix (code-defect) or auto-rule
      // (judgment-gate / convergence-exhausted). Halt and surface the class so
      // the human knows exactly how to respond. PR-B/Phase 2 act on these.
      if (r.action === "fix-and-retry" || r.action === "resolve-escalation") {
        summary.halted = true;
        summary.halt_action = r.action;
        summary.halt_failure_class = r.failure_class || null;
        summary.halt_reason = r.reason;
        summary.blockers = r.blockers || [];
        summary.fix_steps = r.fix_steps || [];
        logEvent(cwd, { ...base, outcome: "halt" });
        onEvent({ type: "halt", ...base, blockers: r.blockers, fix_steps: r.fix_steps });
        break;
      }

      if (r.action === "run-stage" || r.action === "continue-stage") {
        // Consequence ceiling — irreversible/outward-facing stages need a grant.
        if (CONSEQUENCE_CEILING.has(r.name) && !allowStages.has(r.name)) {
          summary.halted = true;
          summary.halt_action = "ceiling";
          summary.halt_reason = `consequence ceiling: "${r.name}" requires an explicit human grant (--allow-stage ${r.name})`;
          logEvent(cwd, { ...base, outcome: "ceiling-halt" });
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
            logEvent(cwd, { ...base, outcome: "until-halt" });
            onEvent({ type: "until", ...base });
            break;
          }
        }

        // Budget — pre-dispatch check. Cost is only known AFTER a dispatch, so
        // this prevents the NEXT stage, not an overrun of the current one.
        if (budgetUsd != null) {
          const spent = totalCostUsd(cwd);
          if (spent >= budgetUsd) {
            summary.halted = true;
            summary.halt_action = "budget";
            summary.halt_reason = `budget cap reached: $${spent.toFixed(2)} ≥ $${budgetUsd.toFixed(2)}`;
            logEvent(cwd, { ...base, outcome: "budget-halt", cost_usd: spent });
            onEvent({ type: "budget", ...base, cost_usd: spent });
            break;
          }
        }

        // No-progress guard: identical (action, stage) twice in a row means the
        // last dispatch wrote no gate (a dispatch failure). Without this the
        // loop would re-dispatch forever (the infinite-loop hole). PR-B replaces
        // this with classifyDispatch (transient → backoff, structural → halt).
        const key = `${r.action}:${r.name}`;
        if (key === lastKey) {
          summary.halted = true;
          summary.halt_action = "no-progress";
          summary.halt_reason =
            `no progress after dispatching "${r.name}" — the host exited without writing a gate ` +
            `(dispatch failure; transient/structural classification lands in PR-B)`;
          logEvent(cwd, { ...base, outcome: "no-progress-halt" });
          onEvent({ type: "no-progress", ...base });
          break;
        }
        lastKey = key;

        onEvent({ type: "dispatch", ...base });
        const t0 = Date.now();
        const results = await _runStageHeadless(r.name, {
          cwd,
          track: opts.track,
          timeoutMs,
          skipCompleted: r.action === "continue-stage",
        });
        const durationMs = Date.now() - t0;
        const anyTimedOut = results.some((x) => x.timedOut);
        const anyNoGate = results.some((x) => !x.gatePath && !x.skipped);
        state.retries[r.name] = (state.retries[r.name] || 0) + 1;
        saveRunState(cwd, state);
        if (!summary.stages_advanced.includes(r.name)) summary.stages_advanced.push(r.name);
        logEvent(cwd, {
          ...base, outcome: "dispatched",
          duration_ms: durationMs, workstreams: results.length,
          timed_out: anyTimedOut, no_gate: anyNoGate,
        });
        onEvent({ type: "dispatched", ...base, duration_ms: durationMs, timed_out: anyTimedOut });
        continue;
      }

      if (r.action === "merge") {
        lastKey = null; // merging is forward progress
        onEvent({ type: "merge", ...base });
        const m = _merge(r.name, { cwd, track: opts.track });
        logEvent(cwd, { ...base, outcome: m.merged ? "merged" : "merge-failed", reason: m.reason || null });
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
      logEvent(cwd, { ...base, outcome: "unhandled" });
      onEvent({ type: "unhandled", ...base });
      break;
    }

    if (!summary.completed && !summary.halted) {
      summary.halted = true;
      summary.halt_action = "max-iterations";
      summary.halt_reason = `reached max iterations (${maxIterations})`;
      logEvent(cwd, { iteration: state.iterations, outcome: "max-iterations-halt" });
    }
  } finally {
    summary.iterations = state.iterations || 0;
    summary.cost_usd = totalCostUsd(cwd);
    saveRunState(cwd, state);
    releaseLock(cwd);
  }

  return summary;
}

module.exports = { run, CONSEQUENCE_CEILING, DEFAULT_MAX_ITERATIONS, totalCostUsd };
