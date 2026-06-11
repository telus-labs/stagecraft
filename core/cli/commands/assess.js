"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { generateHelp } = require(path.join(__dirname, "..", "flags"));

const name = "assess";

const flags = {
  cwd:          { type: "string",  description: "Target project directory" },
  description:  { type: "string",  description: "Change description for heuristics" },
  json:         { type: "boolean", description: "JSON output" },
  apply:        { type: "boolean", description: "Write inferred track to .devteam/config.yml" },
  "no-content": { type: "boolean", description: "Skip file content scan" },
  help:         { type: "boolean", description: "Show this help" },
};

// G6 — Infer the best track for the current change.
// Reads changed-files.txt from pipeline/ unless positional file args are given.
// With --apply, writes pipeline.custom_stages to .devteam/config.yml.
function run(positional, _flags) {
  const { assess } = require(path.join(__dirname, "..", "..", "stage-shopping", "assess"));
  if (_flags.help) { console.log(generateHelp("devteam assess [options] [files...]", flags)); process.exit(0); }
  const cwd = _flags.cwd || process.cwd();

  // Resolve file list: positional args > pipeline/changed-files.txt
  let files = positional.length > 0 ? positional : [];
  if (files.length === 0) {
    const changedFilesPath = path.join(cwd, "pipeline", "changed-files.txt");
    if (fs.existsSync(changedFilesPath)) {
      files = fs.readFileSync(changedFilesPath, "utf8").split(/\r?\n/).filter(Boolean);
    }
  }

  const description = _flags.description || "";
  const result = assess(description, files, { scanContent: !_flags.noContent });

  if (_flags.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const conf = { high: "high ✓", medium: "medium", low: "low" }[result.confidence] || result.confidence;
    console.log(`Recommended track: ${result.recommendedTrack}  (confidence: ${conf})`);
    console.log(`Stages (${result.stages.length}): ${result.stages.join(" → ")}`);
    console.log("");
    console.log("Reasons:");
    for (const r of result.reasons) console.log(`  • ${r}`);
    if (result.securityRequired) console.log("  ⚠  security review required");
    if (result.migrationRequired) console.log("  ⚠  migration safety required");
    console.log("");
    if (_flags.apply) {
      console.log(`Applying: writing pipeline.custom_stages to .devteam/config.yml…`);
    } else {
      console.log("To apply this track, run with --apply or set pipeline.custom_stages in .devteam/config.yml:");
      console.log(`  pipeline:`);
      console.log(`    custom_stages: [${result.stages.map((s) => `"${s}"`).join(", ")}]`);
    }
  }

  if (_flags.apply) {
    const yaml = require("js-yaml");
    const { configPath: getConfigPath, clearConfigCache } = require(path.join(__dirname, "..", "..", "config"));
    const cfgPath = getConfigPath(cwd);
    let parsed = {};
    if (fs.existsSync(cfgPath)) {
      try { parsed = yaml.load(fs.readFileSync(cfgPath, "utf8")) || {}; } catch { parsed = {}; }
    } else {
      fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
    }
    parsed.pipeline = parsed.pipeline || {};
    parsed.pipeline.custom_stages = result.stages;
    fs.writeFileSync(cfgPath, yaml.dump(parsed, { lineWidth: 120 }), "utf8");
    // Flush the per-cwd cache so any subsequent loadConfig() in this process
    // (e.g. a chained devteam stage call) sees the new custom_stages value.
    clearConfigCache();
    if (!_flags.json) console.log(`  ✓ wrote ${path.relative(cwd, cfgPath)}`);
  }
}

module.exports = { name, flags, run };
