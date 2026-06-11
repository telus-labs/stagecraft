"use strict";

const path = require("node:path");
const { generateHelp } = require(path.join(__dirname, "..", "flags"));
const { loadConfig } = require(path.join(__dirname, "..", "..", "config"));

const name = "preflight";

const flags = {
  cwd:          { type: "string",  description: "Target project directory" },
  "skip-write": { type: "boolean", description: "Run checks but do not write stage-04e.json" },
  help:         { type: "boolean", description: "Show this help" },
};

function run(positional, _flags) {
  if (_flags.help) { console.log(generateHelp("devteam preflight [options]", flags)); process.exit(0); }
  const cwd = _flags.cwd || process.cwd();
  const { runPreflight } = require(path.join(__dirname, "..", "..", "preflight"));
  const track = loadConfig(cwd).pipeline.default_track;
  const result = runPreflight(cwd, { track, skipWrite: _flags.skipWrite });
  if (result.status === "PASS") {
    console.log(`[preflight] PASS — all checks clean${result.warnings.length > 0 ? ` (${result.warnings.length} warning(s))` : ""}`);
    result.warnings.forEach((w) => console.log(`  WARN: ${w}`));
    process.exit(0);
  } else {
    console.error(`[preflight] FAIL — ${result.blockers.length} blocker(s) must be fixed before peer-review:`);
    result.blockers.forEach((b) => console.error(`  BLOCKER: ${b}`));
    if (result.warnings.length > 0) {
      result.warnings.forEach((w) => console.warn(`  WARN: ${w}`));
    }
    console.error("\nSee docs/runbooks/fix-and-retry.md § Case 10 for resolution steps.");
    process.exit(1);
  }
}

module.exports = { name, flags, run };
