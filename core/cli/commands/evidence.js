"use strict";

const path = require("node:path");
const { generateHelp } = require(path.join(__dirname, "..", "flags"));
const { loadConfig, checkBoundedFence } = require(path.join(__dirname, "..", "..", "config"));
const { resolveChangeId } = require(path.join(__dirname, "..", "resolve-change-id"));
const { pipelineRoot } = require(path.join(__dirname, "..", "..", "paths"));
const { readEvidenceSources } = require(path.join(__dirname, "..", "..", "evidence", "readers"));
const { analyzeEvidence } = require(path.join(__dirname, "..", "..", "evidence", "analyzer"));

const name = "evidence";
const flags = {
  cwd: { type: "string", description: "Target project directory" },
  feature: { type: "string", description: "Feature name for bounded isolation" },
  json: { type: "boolean", description: "Emit stable aggregate JSON" },
  help: { type: "boolean", description: "Show this help" },
};

function renderCondition(item) {
  const marker = item.met ? "met" : "missing";
  const reason = item.reason_code ? ` (${item.reason_code})` : "";
  return `    [${marker}] ${item.id}: ${item.value}/${item.threshold}${reason}`;
}

function renderHuman(report) {
  const lines = [
    "# Evidence readiness",
    "",
    `Runs observed: ${report.scope.run_count} (${report.scope.complete_run_count} complete, ${report.scope.repair_run_count} repair)`,
    `Gate files read: ${report.quality.gate_files}`,
  ];
  const degraded = report.quality.malformed_records
    + report.quality.oversized_records
    + report.quality.unreadable_sources
    + report.quality.truncated_sources
    + report.quality.symlink_sources;
  const sourceState = !report.quality.log_present && report.quality.gate_files === 0
    ? "no evidence sources found"
    : degraded === 0
      ? "complete for available sources"
      : `degraded (${degraded} source/record issue(s))`;
  lines.push(`Evidence quality: ${sourceState}`);
  lines.push("");
  for (const item of report.readiness) {
    lines.push(`${item.capability} (#${item.issue}): ${item.status}`);
    for (const local of item.local_conditions) lines.push(renderCondition(local));
    lines.push(`    [portfolio] ${item.portfolio_status} (${item.portfolio_reason_code})`);
    lines.push("");
  }
  lines.push("This command is read-only. Threshold progress is evidence, not capability approval.");
  return lines.join("\n") + "\n";
}

function run(positional, commandFlags) {
  if (commandFlags.help) {
    console.log(generateHelp("devteam evidence status [options]", flags));
    process.exit(0);
  }
  if (positional.length !== 1 || positional[0] !== "status") {
    process.stderr.write("Usage: devteam evidence status [--json] [--cwd <dir>] [--feature <name>]\n");
    process.exit(2);
  }

  const cwd = path.resolve(commandFlags.cwd || process.cwd());
  const config = loadConfig(cwd);
  checkBoundedFence(config, name);
  const changeId = resolveChangeId(commandFlags, config);
  const sources = readEvidenceSources(pipelineRoot(cwd, changeId));
  const report = analyzeEvidence(sources);
  if (commandFlags.json) console.log(JSON.stringify(report, null, 2));
  else process.stdout.write(renderHuman(report));
}

module.exports = { name, flags, run, renderHuman };
