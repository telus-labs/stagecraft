"use strict";

const path = require("node:path");
const { generateHelp } = require(path.join(__dirname, "..", "flags"));

const name = "verify-chain";

const flags = {
  cwd:  { type: "string",  description: "Target project directory" },
  track: { type: "string", description: "Override the pipeline track" },
  json: { type: "boolean", description: "JSON output" },
  help: { type: "boolean", description: "Show this help" },
};

// `devteam verify-chain [--track <t>] [--cwd <dir>] [--json]` (C6).
// Walks the tamper-evident stage-gate chain and reports breaks + unstamped
// gates. Exit 0 = intact, 1 = a break (CI-usable).
function run(positional, _flags) {
  if (_flags.help) { console.log(generateHelp("devteam verify-chain [options]", flags)); process.exit(0); }
  const cwd = _flags.cwd || process.cwd();
  const { loadConfig } = require(path.join(__dirname, "..", "..", "config"));
  const { gatesDir: getGatesDir } = require(path.join(__dirname, "..", "..", "paths"));
  const { verifyChain } = require(path.join(__dirname, "..", "..", "gates", "chain"));
  const config = loadConfig(cwd);
  const track = _flags.track
    || (Array.isArray(config.pipeline.custom_stages) ? config.pipeline.custom_stages : null)
    || config.pipeline.default_track || "full";
  const r = verifyChain(getGatesDir(cwd, null), track);
  if (_flags.json) {
    console.log(JSON.stringify({ schema_version: "1.0", ...r }, null, 2));
    process.exit(r.ok ? 0 : 1);
  }
  if (r.ok) {
    console.log(`✅ gate chain intact — ${r.checked} stage gate(s) verified`);
    if (r.unstamped.length) console.log(`   ⚠ unstamped: ${r.unstamped.join(", ")} — run \`devteam stamp-chain\``);
    for (const x of (r.resolved || [])) {
      console.log(`   ⚖ ${x.stage}: autonomously resolved under ${x.authority} — "${x.ruling}"`);
    }
    process.exit(0);
  }
  console.error(`❌ gate chain BROKEN — ${r.breaks.length} break(s):`);
  for (const b of r.breaks) {
    console.error(`   ${b.stage}: recorded prev_hash for ${b.prev_stage || "(genesis)"} ≠ current content`);
    console.error(`      recorded:   ${b.recorded}`);
    console.error(`      recomputed: ${b.recomputed}`);
  }
  if (r.unstamped.length) console.error(`   ⚠ unstamped: ${r.unstamped.join(", ")}`);
  console.error(`\n   A break means an earlier gate changed after it was chained — tampering, or a`);
  console.error(`   deliberate earlier-stage re-run (then re-stamp with \`devteam stamp-chain\`).`);
  process.exit(1);
}

module.exports = { name, flags, run };
