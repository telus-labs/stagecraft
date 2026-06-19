"use strict";

const path = require("node:path");
const { generateHelp } = require(path.join(__dirname, "..", "flags"));
const { loadConfig, checkBoundedFence } = require(path.join(__dirname, "..", "..", "config"));
const { resolveChangeId } = require(path.join(__dirname, "..", "resolve-change-id"));
const { pipelineRoot } = require(path.join(__dirname, "..", "..", "paths"));
const { readEvidenceSources } = require(path.join(__dirname, "..", "..", "evidence", "readers"));
const { analyzeEvidence } = require(path.join(__dirname, "..", "..", "evidence", "analyzer"));
const {
  assertExportDestination, createBundle, writeBundle,
} = require(path.join(__dirname, "..", "..", "evidence", "bundle"));
const {
  readIdentity, getOrCreateIdentity, rotateIdentity, deleteIdentity,
} = require(path.join(__dirname, "..", "..", "evidence", "identity"));
const { analyzePortfolio } = require(path.join(__dirname, "..", "..", "evidence", "portfolio"));

const name = "evidence";
const flags = {
  cwd: { type: "string", description: "Target project directory" },
  feature: { type: "string", description: "Feature name for bounded isolation" },
  json: { type: "boolean", description: "Emit stable aggregate JSON" },
  out: { type: "string", description: "New local export file" },
  consent: { type: "boolean", description: "Acknowledge the documented export boundary" },
  bundle: { type: "list", description: "Validated bundle for portfolio status (repeatable)" },
  rotate: { type: "boolean", description: "Rotate the local project identity" },
  delete: { type: "boolean", description: "Delete the local project identity" },
  yes: { type: "boolean", description: "Confirm identity rotation or deletion" },
  help: { type: "boolean", description: "Show this help" },
};

function renderCondition(item) {
  const marker = item.met ? "met" : "missing";
  const reason = item.reason_code ? ` (${item.reason_code})` : "";
  return `    [${marker}] ${item.id}: ${item.value}/${item.threshold}${reason}`;
}

function renderProject(report) {
  const lines = [
    "# Evidence readiness", "",
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
    : degraded === 0 ? "complete for available sources" : `degraded (${degraded} source/record issue(s))`;
  lines.push(`Evidence quality: ${sourceState}`, "");
  for (const item of report.readiness) {
    lines.push(`${item.capability} (#${item.issue}): ${item.status}`);
    for (const local of item.local_conditions) lines.push(renderCondition(local));
    lines.push(`    [portfolio] ${item.portfolio_status} (${item.portfolio_reason_code})`, "");
  }
  lines.push("This command is read-only. Threshold progress is evidence, not capability approval.");
  return `${lines.join("\n")}\n`;
}

function renderPortfolio(report) {
  const lines = [
    "# Portfolio evidence readiness", "",
    `Projects: ${report.scope.project_count} from ${report.scope.bundle_count} bundle(s) (${report.scope.duplicate_bundles} duplicate(s) ignored)`,
    `Runs observed: ${report.scope.run_count} (${report.scope.complete_run_count} complete, ${report.scope.repair_run_count} repair)`, "",
  ];
  for (const item of report.readiness) {
    lines.push(`${item.capability} (#${item.issue}): ${item.status}`);
    for (const entry of item.conditions) lines.push(renderCondition(entry));
    lines.push("");
  }
  lines.push("Threshold progress is evidence for human review, not capability approval.");
  return `${lines.join("\n")}\n`;
}

function localReport(commandFlags) {
  const cwd = path.resolve(commandFlags.cwd || process.cwd());
  const config = loadConfig(cwd);
  checkBoundedFence(config, name);
  const changeId = resolveChangeId(commandFlags, config);
  const sources = readEvidenceSources(pipelineRoot(cwd, changeId));
  return { cwd, report: analyzeEvidence(sources) };
}

function rejectFlags(commandFlags, names, subcommand) {
  const found = names.filter((flag) => commandFlags[flag] !== undefined);
  if (found.length > 0) {
    throw new Error(`${subcommand} does not accept ${found.map((flag) => `--${flag}`).join(", ")}`);
  }
}

function runStatus(commandFlags) {
  rejectFlags(commandFlags, ["out", "consent", "rotate", "delete", "yes"], "status");
  if (commandFlags.bundle) {
    if (commandFlags.cwd || commandFlags.feature) {
      throw new Error("--bundle cannot be combined with --cwd or --feature");
    }
    const report = analyzePortfolio(commandFlags.bundle.map((file) => path.resolve(file)));
    if (commandFlags.json) console.log(JSON.stringify(report, null, 2));
    else process.stdout.write(renderPortfolio(report));
    return;
  }
  const { report } = localReport(commandFlags);
  if (commandFlags.json) console.log(JSON.stringify(report, null, 2));
  else process.stdout.write(renderProject(report));
}

function runExport(commandFlags) {
  if (!commandFlags.out) throw new Error("evidence export requires --out <new-file.json>");
  if (!commandFlags.consent) throw new Error("evidence export requires --consent");
  rejectFlags(commandFlags, ["bundle", "rotate", "delete", "yes"], "export");
  const destination = assertExportDestination(commandFlags.out);
  const { cwd, report } = localReport(commandFlags);
  const identity = getOrCreateIdentity(cwd);
  const bundle = createBundle(report, identity.project_ref);
  writeBundle(destination, bundle);
  const result = {
    written: destination,
    project_ref: identity.project_ref,
    suppressed_observations: bundle.suppressed_observations,
  };
  if (commandFlags.json) console.log(JSON.stringify(result, null, 2));
  else {
    process.stdout.write(`Evidence bundle written: ${destination}\n`);
    process.stdout.write(`Project reference: ${identity.project_ref}\n`);
    process.stdout.write(`${bundle.suppressed_observations} sparse observation(s) suppressed. Inspect before sharing; retention and deletion are operator-owned.\n`);
  }
}

function publicIdentity(result) {
  return { exists: result.exists, project_ref: result.project_ref };
}

function runIdentity(commandFlags) {
  rejectFlags(commandFlags, ["feature", "out", "consent", "bundle"], "identity");
  if (commandFlags.rotate && commandFlags.delete) throw new Error("choose only one of --rotate or --delete");
  if ((commandFlags.rotate || commandFlags.delete) && !commandFlags.yes) {
    throw new Error("identity rotation and deletion require --yes");
  }
  const cwd = path.resolve(commandFlags.cwd || process.cwd());
  let result;
  let action = "status";
  if (commandFlags.rotate) {
    result = rotateIdentity(cwd);
    action = "rotated";
  } else if (commandFlags.delete) {
    const deleted = deleteIdentity(cwd);
    result = { exists: !deleted.deleted, project_ref: deleted.deleted ? null : readIdentity(cwd).project_ref };
    action = deleted.deleted ? "deleted" : "absent";
  } else {
    result = readIdentity(cwd);
  }
  const output = publicIdentity(result);
  if (commandFlags.json) console.log(JSON.stringify(output, null, 2));
  else process.stdout.write(`Evidence identity: ${action}; project reference: ${output.project_ref || "none"}\n`);
}

function run(positional, commandFlags) {
  if (commandFlags.help) {
    console.log(generateHelp("devteam evidence <status|export|identity> [options]", flags));
    process.exit(0);
  }
  if (positional.length !== 1 || !["status", "export", "identity"].includes(positional[0])) {
    process.stderr.write("Usage: devteam evidence <status|export|identity> [options]\n");
    process.exit(2);
  }
  if (positional[0] === "status") return runStatus(commandFlags);
  if (positional[0] === "export") return runExport(commandFlags);
  return runIdentity(commandFlags);
}

module.exports = { name, flags, run, renderHuman: renderProject, renderPortfolio };
