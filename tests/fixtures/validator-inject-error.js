#!/usr/bin/env node
/**
 * Test fixture: runs the gate validator with fs.writeFileSync patched to
 * throw a plain JavaScript TypeError (no .code property) when the validator
 * tries to write the auto-injected metadata back to the gate file.
 *
 * Usage: node validator-inject-error.js <cwd> [--strict]
 *
 * <cwd> must be a directory that already has pipeline/gates/ with a gate file
 * missing the `orchestrator` field (so autoInjectMetadata attempts a write).
 *
 * Injection path:
 *   main()
 *     → autoInjectMetadata(gate, latest.full)   [no try/catch at call site]
 *       → fs.writeFileSync(gateFilePath, ...)    [THROWS TypeError — no .code]
 *     ← TypeError propagates out of main()
 *   runMain() outer catch → unknown-error path
 *
 * Exit codes:
 *   0 — hook mode (default): warn-and-pass; writes pipeline/validator-errors.log
 *   1 — --strict flag or CI=true env: fail closed
 */

const fs = require("node:fs");

// cwd is provided as first positional arg (after node + script path).
const cwdArg = process.argv[2];
if (!cwdArg) {
  console.error("Usage: validator-inject-error.js <cwd>");
  process.exit(2);
}
process.chdir(cwdArg);

// Patch writeFileSync: throw a plain TypeError (no .code) when the validator
// tries to write the auto-injected metadata back to the gate file.
const origWriteFileSync = fs.writeFileSync;
let intercepted = false;
fs.writeFileSync = function(filePath, data, opts) {
  if (!intercepted && typeof filePath === "string" && filePath.endsWith(".json")) {
    intercepted = true;
    throw new TypeError("injected-internal-error: simulated validator bug");
  }
  return origWriteFileSync(filePath, data, opts);
};

// Require the validator AFTER patching and AFTER chdir so STRICT_MODE,
// gatesDir(), and the log path all see the right environment.
const { runMain } = require("../../core/gates/validator.js");
runMain();
