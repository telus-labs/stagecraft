"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { generateHelp } = require(path.join(__dirname, "..", "flags"));

// Resolved at runtime relative to this file — portable regardless of install location.
const HOOKS = {
  "validate":            path.join(__dirname, "..", "..", "gates", "validator.js"),
  "secret-scan":         path.join(__dirname, "..", "..", "hooks", "secret-scan.js"),
  "approval-derivation": path.join(__dirname, "..", "..", "hooks", "approval-derivation.js"),
};

const name = "hook";

const flags = {
  help: { type: "boolean", description: "Show this help" },
};

function run(positional, _flags) {
  const sub = positional[0];

  if (_flags.help) {
    console.log(generateHelp(`devteam hook <name>`, flags));
    console.log(`\nAvailable hooks: ${Object.keys(HOOKS).join(", ")}`);
    process.exit(0);
  }

  if (!sub) {
    console.log(generateHelp(`devteam hook <name>`, flags));
    console.log(`\nAvailable hooks: ${Object.keys(HOOKS).join(", ")}`);
    process.exit(2);
  }

  const scriptPath = HOOKS[sub];
  if (!scriptPath) {
    process.stderr.write(`devteam hook: unknown hook "${sub}". Known: ${Object.keys(HOOKS).join(", ")}\n`);
    process.exit(2);
  }

  // spawnSync with stdio:"inherit" forwards stdin (required by secret-scan and
  // approval-derivation which read Claude Code JSON payloads) and propagates
  // stdout/stderr and exit codes (0/1/2/3) without modification.
  const result = spawnSync(process.execPath, [scriptPath], { stdio: "inherit" });
  process.exit(result.status ?? 0);
}

module.exports = { name, flags, run, HOOKS };
