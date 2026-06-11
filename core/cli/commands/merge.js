"use strict";

const path = require("node:path");
const { generateHelp } = require(path.join(__dirname, "..", "flags"));
const { getOrchestrator } = require(path.join(__dirname, "..", "get-orchestrator"));

const name = "merge";

const flags = {
  cwd:  { type: "string",  description: "Target project directory" },
  track: { type: "string", description: "Override the pipeline track" },
  help: { type: "boolean", description: "Show this help" },
};

function run(positional, _flags) {
  if (_flags.help) { console.log(generateHelp("devteam merge <stage-name> [options]", flags)); process.exit(0); }
  const stageName = positional[0];
  if (!stageName) {
    console.error(generateHelp("devteam merge <stage-name> [options]", flags));
    process.exit(2);
  }
  const { mergeWorkstreamGates } = getOrchestrator();
  const result = mergeWorkstreamGates(stageName, _flags);
  if (!result.merged) {
    console.error(`Merge skipped: ${result.reason}`);
    process.exit(1);
  }
  console.log(`Merged → ${result.file} (status: ${result.gate.status})`);
}

module.exports = { name, flags, run };
