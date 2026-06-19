"use strict";

const { scanContent } = require("../hooks/secret-scan");

const SAFE_CATEGORY = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,79}$/;
const KNOWN_STATUSES = new Set(["PASS", "WARN", "FAIL", "ESCALATE"]);

function category(value) {
  if (typeof value !== "string" || !SAFE_CATEGORY.test(value)) return "other";
  return scanContent(value).length === 0 ? value : "other";
}

function number(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function groupRuns(events) {
  const runs = [];
  let current = null;
  let orphanEvents = 0;
  for (const event of events) {
    if (event.outcome === "run-start") {
      current = { intent: category(event.intent), events: [] };
      runs.push(current);
    }
    if (!current) {
      orphanEvents += 1;
      continue;
    }
    current.events.push(event);
  }
  return { runs, orphanEvents };
}

function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function rowsFromMap(map, keys, valueKey = "observations") {
  return [...map.entries()].map(([compound, value]) => {
    const parts = compound.split("\0");
    const row = {};
    keys.forEach((key, index) => { row[key] = parts[index]; });
    row[valueKey] = value;
    return row;
  }).sort((a, b) => keys.map((key) => a[key]).join("\0").localeCompare(
    keys.map((key) => b[key]).join("\0"),
  ));
}

function extractRouting(gateRecords) {
  const observationSource = (record) => record.source === "current" ? "current" : record.source_id;
  const direct = new Set();
  for (const record of gateRecords) {
    const gate = record.gate;
    if (gate.workstream && gate.host) {
      direct.add(`${observationSource(record)}\0${category(gate.stage)}\0${category(gate.workstream)}`);
    }
  }

  const groups = new Map();
  for (const record of gateRecords) {
    const gate = record.gate;
    const observations = [];
    if (gate.workstream && gate.host) {
      observations.push(gate);
    } else if (Array.isArray(gate.workstreams)) {
      for (const workstream of gate.workstreams) {
        const directKey = `${observationSource(record)}\0${category(gate.stage)}\0${category(workstream.workstream)}`;
        if (!direct.has(directKey)) observations.push({ ...workstream, stage: gate.stage });
      }
    }
    for (const item of observations) {
      const role = category(item.workstream);
      const host = category(item.host);
      const model = category(item.model || gate.model || "unknown");
      const key = `${role}\0${host}\0${model}`;
      if (!groups.has(key)) {
        groups.set(key, {
          role, host, model, gate_observations: 0, pass: 0, warn: 0, fail: 0,
          escalate: 0, cost_observations: 0, total_cost_usd: 0,
          duration_observations: 0, total_duration_ms: 0,
        });
      }
      const row = groups.get(key);
      row.gate_observations += 1;
      const status = KNOWN_STATUSES.has(item.status) ? item.status : gate.status;
      if (status === "PASS") row.pass += 1;
      else if (status === "WARN") row.warn += 1;
      else if (status === "FAIL") row.fail += 1;
      else if (status === "ESCALATE") row.escalate += 1;
      const cost = number(item.cost_usd ?? gate.cost_usd);
      if (cost !== null) { row.cost_observations += 1; row.total_cost_usd += cost; }
      const duration = number(item.duration_ms ?? gate.duration_ms);
      if (duration !== null) {
        row.duration_observations += 1;
        row.total_duration_ms += duration;
      }
    }
  }
  return [...groups.values()].sort((a, b) =>
    `${a.role}\0${a.host}\0${a.model}`.localeCompare(`${b.role}\0${b.host}\0${b.model}`));
}

function condition(id, value, threshold, met, reasonCode = null) {
  return { id, value, threshold, met, reason_code: met ? null : reasonCode };
}

function readinessSummary({ runs, routing, recovery, rulings, stalls }) {
  const fixRetryRuns = runs.filter((run) => run.events.some((e) => e.outcome === "fix-retry")).length;
  const repairRuns = runs.filter((run) => run.intent === "repair").length;
  const maxRecoveryRuns = recovery.reduce((max, row) => Math.max(max, row.runs), 0);
  const costCoverage = routing.reduce((sum, row) => sum + row.cost_observations, 0);
  const roleHosts = new Map();
  for (const row of routing) {
    if (!roleHosts.has(row.role)) roleHosts.set(row.role, new Map());
    const hosts = roleHosts.get(row.role);
    hosts.set(row.host, (hosts.get(row.host) || 0) + row.gate_observations);
  }
  const comparableRoles = [...roleHosts.values()].filter((hosts) =>
    [...hosts.values()].filter((count) => count >= 5).length >= 2).length;
  const ceilingEvents = runs.reduce((sum, run) =>
    sum + run.events.filter((e) => e.outcome === "ceiling-halt").length, 0);
  const rulingEvents = rulings.reduce((sum, row) => sum + row.observations, 0);
  const stallEvents = stalls.reduce((sum, row) => sum + row.observations, 0);

  return [
    {
      capability: "h3-recipe-suggestions",
      issue: 142,
      status: "not-ready",
      portfolio_status: "not-assessable",
      local_conditions: [
        condition("fix-retry-runs", fixRetryRuns, 5, fixRetryRuns >= 5, "insufficient-fix-retry-runs"),
        condition("recurring-failure-runs", maxRecoveryRuns, 3, maxRecoveryRuns >= 3, "insufficient-recurrence"),
        condition("accepted-resolution-signal", 0, 1, false, "accepted-resolution-signal-unavailable"),
      ],
      portfolio_reason_code: "multiple-project-bundles-required",
    },
    {
      capability: "d5-continuous-routing",
      issue: 143,
      status: "not-ready",
      portfolio_status: "not-assessable",
      local_conditions: [
        condition("comparable-roles", comparableRoles, 1, comparableRoles >= 1, "insufficient-host-comparison"),
        condition("cost-covered-observations", costCoverage, 1, costCoverage >= 1, "cost-telemetry-unavailable"),
        condition("durable-dispatch-history", 0, 1, false, "durable-dispatch-history-unavailable"),
      ],
      portfolio_reason_code: "multiple-project-bundles-required",
    },
    {
      capability: "standing-grants",
      issue: 144,
      status: "not-ready",
      portfolio_status: "not-assessable",
      local_conditions: [
        condition("repair-runs", repairRuns, 10, repairRuns >= 10, "insufficient-repair-runs"),
        condition("consequence-ceiling-events", ceilingEvents, 1, ceilingEvents >= 1, "no-consequence-ceiling-evidence"),
        condition("granted-ruling-events", rulingEvents, 1, rulingEvents >= 1, "no-granted-ruling-evidence"),
      ],
      portfolio_reason_code: "multiple-project-bundles-required",
    },
    {
      capability: "active-stall-response",
      issue: 145,
      status: "not-ready",
      portfolio_status: "not-assessable",
      local_conditions: [
        condition("stall-events", stallEvents, 1, stallEvents >= 1, "no-stall-evidence"),
        condition("calibrated-threshold", 0, 1, false, "stall-threshold-not-defined"),
      ],
      portfolio_reason_code: "multiple-project-bundles-required",
    },
  ];
}

function analyzeEvidence({ events = [], gates = [], quality = {} }) {
  const { runs, orphanEvents } = groupRuns(events);
  const recoveryMap = new Map();
  const recoveryRuns = new Map();
  const rulingMap = new Map();
  const stallMap = new Map();

  runs.forEach((run, runIndex) => {
    for (const event of run.events) {
      if (["fix-retry", "convergence-halt", "no-progress-halt"].includes(event.outcome)) {
        const key = `${category(event.stage)}\0${category(event.failure_class)}`;
        increment(recoveryMap, key);
        if (!recoveryRuns.has(key)) recoveryRuns.set(key, new Set());
        recoveryRuns.get(key).add(runIndex);
      }
      if (event.outcome === "auto-ruled") {
        increment(rulingMap, category(event.grant_class));
      }
      if (event.outcome === "stall-detected") {
        increment(stallMap, `${category(event.stage)}\0${category(event.stall_class)}`);
      }
    }
  });

  const recovery = rowsFromMap(recoveryMap, ["stage", "failure_class"]);
  for (const row of recovery) {
    row.runs = recoveryRuns.get(`${row.stage}\0${row.failure_class}`).size;
  }
  const rulings = rowsFromMap(rulingMap, ["ruling_class"]);
  const stalls = rowsFromMap(stallMap, ["stage", "stall_class"]);
  const routing = extractRouting(gates);
  const completedRuns = runs.filter((run) => run.events.some((e) => e.outcome === "complete")).length;
  const normalizedQuality = {
    log_present: false,
    gate_files: 0,
    malformed_records: 0,
    oversized_records: 0,
    unreadable_sources: 0,
    truncated_sources: 0,
    symlink_sources: 0,
    ...quality,
    orphan_events: orphanEvents,
  };

  return {
    schema_version: "1.0",
    mode: "project",
    scope: {
      project_count: 1,
      run_count: runs.length,
      complete_run_count: completedRuns,
      repair_run_count: runs.filter((run) => run.intent === "repair").length,
    },
    quality: normalizedQuality,
    routing,
    recovery,
    rulings,
    stalls,
    readiness: readinessSummary({ runs, routing, recovery, rulings, stalls }),
  };
}

module.exports = { analyzeEvidence, category, groupRuns, extractRouting };
