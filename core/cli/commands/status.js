"use strict";

// ADR-007 §5: read-only liveness status command. Reads run-state.json and
// the tail of run-log.jsonl; reports status/current_stage/last_action/
// iterations/cost_usd/last_heartbeat_age_ms/last_event_age_ms/stall_detected.
// No process interaction — purely a file reader. Live rendering is owned by
// `devteam run --watch`, which consumes the driver's callback stream.

const fs = require("node:fs");
const path = require("node:path");
const { generateHelp } = require(path.join(__dirname, "..", "flags"));

const name = "status";

const flags = {
  cwd:  { type: "string",  description: "Target project directory" },
  json: { type: "boolean", description: "JSON output" },
  help: { type: "boolean", description: "Show this help" },
};

// Scan run-log.jsonl backward for the last line matching a predicate.
// Returns the parsed object or null. Reads at most maxLines from the end.
function lastMatchingEvent(logPath, predicate, maxLines = 500) {
  let content;
  try { content = fs.readFileSync(logPath, "utf8"); } catch { return null; }
  const lines = content.trimEnd().split("\n");
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - maxLines); i--) {
    try {
      const obj = JSON.parse(lines[i]);
      if (predicate(obj)) return obj;
    } catch { /* skip malformed lines */ }
  }
  return null;
}

// Determine the run status from run-state.json and the last log event.
function computeStatus(runState, lastEvent) {
  if (!runState) return "no-run";
  const lastOutcome = lastEvent && lastEvent.outcome;
  if (lastOutcome === "complete") return "completed";
  if (lastOutcome && lastOutcome.includes("halt")) return "halted";
  // Lock removed on exit; if no lock file exists and we have a terminal event → halted/done.
  // Approximate: treat any state that has iterations > 0 and no explicit complete as "running"
  // when no obvious halt outcome was logged.
  if (lastOutcome === "halt" || lastOutcome === "convergence-halt" || lastOutcome === "ceiling-halt" ||
      lastOutcome === "budget-halt" || lastOutcome === "until-halt" || lastOutcome === "structural-halt" ||
      lastOutcome === "no-progress-halt" || lastOutcome === "max-iterations-halt" ||
      lastOutcome === "stoplist-halt") {
    return "halted";
  }
  return "running";
}

function run(positional, _flags) {
  if (_flags.help) { console.log(generateHelp("devteam status [host] [options]", flags)); process.exit(0); }
  const cwd = _flags.cwd || process.cwd();

  // If first positional is a known host name, show adapter status instead of run status.
  if (positional.length > 0) {
    const { listHosts, loadAdapter } = require(path.join(__dirname, "..", "..", "router"));
    const hostName = positional[0];
    if (!listHosts().includes(hostName)) {
      console.error(`Unknown host: ${hostName}`);
      console.error(`Available: ${listHosts().join(", ")}`);
      process.exit(2);
    }
    const adapter = loadAdapter(hostName);
    const s = adapter.status(cwd);
    console.log(`${hostName}: ${s.ok ? "ready" : "needs configuration"}`);
    if (s.missing && s.missing.length > 0) {
      for (const m of s.missing) console.log(`  missing: ${m}`);
    }
    if (s.notes && s.notes.length > 0) {
      for (const n of s.notes) console.log(`  ${n}`);
    }
    if (!s.ok) process.exit(1);
    return;
  }

  const { loadConfig } = require(path.join(__dirname, "..", "..", "config"));
  const { runStatePath, runLogPath } = require(path.join(__dirname, "..", "..", "driver"));

  let config;
  try { config = loadConfig(cwd); } catch { config = {}; }

  const { changeIdFromFeature } = require(path.join(__dirname, "..", "..", "config"));
  const isolation = config.pipeline && config.pipeline.isolation;
  const changeId = (isolation === "bounded" && (_flags.feature || ""))
    ? changeIdFromFeature(_flags.feature || "")
    : null;

  const statePath = runStatePath(cwd, changeId);
  const logPath = runLogPath(cwd, changeId);

  let runState = null;
  try { runState = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch { /* no-run */ }

  const now = Date.now();

  // Last event (any) for last_event_age_ms.
  const lastEvent = lastMatchingEvent(logPath, () => true);
  const lastEventTs = lastEvent && lastEvent.ts ? Date.parse(lastEvent.ts) : null;
  const lastEventAgeMs = lastEventTs != null ? now - lastEventTs : null;

  // Last heartbeat event for last_heartbeat_age_ms.
  const lastHeartbeat = lastMatchingEvent(logPath, (e) => e.outcome === "heartbeat");
  const lastHeartbeatTs = lastHeartbeat && lastHeartbeat.ts ? Date.parse(lastHeartbeat.ts) : null;
  const lastHeartbeatAgeMs = lastHeartbeatTs != null ? now - lastHeartbeatTs : null;

  // stall_detected: true if the most recent dispatch-relevant event is stall-detected.
  const lastDispatchEvent = lastMatchingEvent(logPath,
    (e) => ["stall-detected", "dispatched", "transient-retry"].includes(e.outcome));
  const stallDetected = Boolean(lastDispatchEvent && lastDispatchEvent.outcome === "stall-detected");

  const status = computeStatus(runState, lastEvent);
  const costUsd = runState ? (runState.cost_usd || null) : null;

  const output = {
    status,
    current_stage: runState ? (runState.current_stage || null) : null,
    last_action: runState ? (runState.last_action || null) : null,
    iterations: runState ? (runState.iterations || 0) : 0,
    cost_usd: typeof costUsd === "number" ? costUsd : null,
    last_heartbeat_age_ms: lastHeartbeatAgeMs,
    last_event_age_ms: lastEventAgeMs,
    stall_detected: stallDetected,
  };

  if (_flags.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  const ageStr = (ms) => {
    if (ms == null) return "—";
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    return `${Math.round(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;
  };

  process.stdout.write(`devteam status\n`);
  process.stdout.write(`  status:           ${output.status}\n`);
  process.stdout.write(`  current_stage:    ${output.current_stage || "—"}\n`);
  process.stdout.write(`  last_action:      ${output.last_action || "—"}\n`);
  process.stdout.write(`  iterations:       ${output.iterations}\n`);
  process.stdout.write(`  cost_usd:         ${output.cost_usd != null ? `$${output.cost_usd.toFixed(4)}` : "—"}\n`);
  process.stdout.write(`  heartbeat_age:    ${ageStr(output.last_heartbeat_age_ms)}\n`);
  process.stdout.write(`  last_event_age:   ${ageStr(output.last_event_age_ms)}\n`);
  process.stdout.write(`  stall_detected:   ${output.stall_detected ? "yes" : "no"}\n`);
}

module.exports = { name, flags, run };
