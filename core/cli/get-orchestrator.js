"use strict";

// Orchestrator pulls in the validator, every gate schema, the spawn helper,
// every host adapter (transitively, via router). ~60ms cold-load. Lazy-load
// it via this helper so `devteam help`, `devteam stages`, `devteam hosts`,
// `devteam doctor` don't pay the cost. Command modules that need orchestrator
// destructure from getOrchestrator() at call entry.
const path = require("node:path");
let _orch;
function getOrchestrator() {
  if (!_orch) _orch = require(path.join(__dirname, "..", "orchestrator"));
  return _orch;
}

module.exports = { getOrchestrator };
