"use strict";

const path = require("node:path");
const { generateHelp } = require(path.join(__dirname, "..", "flags"));

const name = "validate";

const flags = {
  cwd:  { type: "string",  description: "Target project directory" },
  help: { type: "boolean", description: "Show this help" },
};

function run(positional, _flags) {
  if (_flags.help) { console.log(generateHelp("devteam validate [options]", flags)); process.exit(0); }
  if (_flags.cwd) process.chdir(_flags.cwd);
  const { runMain } = require(path.join(__dirname, "..", "..", "gates", "validator"));
  runMain();
}

module.exports = { name, flags, run };
