"use strict";

// B9 (item 5.4): shared helper for CLI commands to derive changeId from
// --feature flag + isolation config. Returns null for in-place mode or
// when feature is blank (in-place behaviour within a bounded install).
//
// resolveChangeId is the wiring marker the meta-test in bounded-fence.test.js
// greps for: any command file that contains resolveChangeId is considered wired
// and must NOT appear in BOUNDED_UNWIRED_COMMANDS.

const { changeIdFromFeature } = require("../config");

function resolveChangeId(flags, config) {
  if (config.pipeline.isolation !== "bounded") return null;
  return changeIdFromFeature(flags.feature || "");
}

module.exports = { resolveChangeId };
