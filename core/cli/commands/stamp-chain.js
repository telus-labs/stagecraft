"use strict";

const path = require("node:path");
const { generateHelp } = require(path.join(__dirname, "..", "flags"));

const name = "stamp-chain";

const flags = {
  cwd:  { type: "string",  description: "Target project directory" },
  track: { type: "string", description: "Override the pipeline track" },
  help: { type: "boolean", description: "Show this help" },
};

// `devteam stamp-chain [--track <t>] [--cwd <dir>]` (C6).
// (Re)stamps the chain on every existing stage gate, in order. Use after a
// deliberate earlier-stage re-run, or to stamp gates written interactively.
function run(positional, _flags) {
  if (_flags.help) { console.log(generateHelp("devteam stamp-chain [options]", flags)); process.exit(0); }
  const cwd = _flags.cwd || process.cwd();
  const { loadConfig } = require(path.join(__dirname, "..", "..", "config"));
  const { gatesDir: getGatesDir } = require(path.join(__dirname, "..", "..", "paths"));
  const { stampAll } = require(path.join(__dirname, "..", "..", "gates", "chain"));
  const config = loadConfig(cwd);
  const track = _flags.track
    || (Array.isArray(config.pipeline.custom_stages) ? config.pipeline.custom_stages : null)
    || config.pipeline.default_track || "full";
  const r = stampAll(getGatesDir(cwd, null), track);
  console.log(`Stamped chain on ${r.stamped.length} stage gate(s): ${r.stamped.join(", ") || "(none)"}`);
}

module.exports = { name, flags, run };
