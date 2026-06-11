"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { generateHelp } = require(path.join(__dirname, "..", "flags"));
const { TRACKS } = require(path.join(__dirname, "..", "..", "pipeline", "stages"));

const FRAMEWORK_ROOT = path.join(__dirname, "..", "..", "..");

const name = "doctor";

const flags = {
  cwd:  { type: "string",  description: "Target project directory" },
  help: { type: "boolean", description: "Show this help" },
};

function run(positional, _flags) {
  if (_flags.help) { console.log(generateHelp("devteam doctor [options]", flags)); process.exit(0); }
  const cwd = _flags.cwd || process.cwd();
  const { loadConfig, configPath } = require(path.join(FRAMEWORK_ROOT, "core", "config"));
  let criticalFailures = 0;
  let warnings = 0;

  function check(label, ok, detail) {
    const icon = ok === true ? "✓" : ok === "warn" ? "⚠" : "✗";
    console.log(`  ${icon} ${label}${detail ? `  — ${detail}` : ""}`);
    if (ok === false) criticalFailures++;
    if (ok === "warn") warnings++;
  }

  console.log("Framework install");
  check("bin/devteam exists", fs.existsSync(path.join(FRAMEWORK_ROOT, "bin", "devteam")));
  check("core/orchestrator.js loads", fs.existsSync(path.join(FRAMEWORK_ROOT, "core", "orchestrator.js")));
  check("package.json parses",
    (() => { try { JSON.parse(fs.readFileSync(path.join(FRAMEWORK_ROOT, "package.json"), "utf8")); return true; } catch { return false; } })());
  check("node_modules/js-yaml present", fs.existsSync(path.join(FRAMEWORK_ROOT, "node_modules", "js-yaml")),
    fs.existsSync(path.join(FRAMEWORK_ROOT, "node_modules", "js-yaml")) ? null : "run `npm install` in the framework dir");

  console.log("\nTarget project");
  console.log(`  cwd: ${cwd}`);
  const configFile = configPath(cwd);
  check(".devteam/config.yml exists", fs.existsSync(configFile),
    fs.existsSync(configFile) ? null : "run `devteam init --host <name>`");
  check("pipeline/gates/ exists", fs.existsSync(path.join(cwd, "pipeline", "gates")));

  if (!fs.existsSync(configFile)) {
    console.log(`\n${criticalFailures} critical failure(s), ${warnings} warning(s)`);
    process.exit(1);
  }

  const config = loadConfig(cwd);
  console.log("\nConfig");
  check("config parses", config._source === "file", `source: ${config._source}`);
  check("default_host set", !!config.routing.default_host, `→ ${config.routing.default_host}`);
  check(`default_track is valid`, TRACKS.includes(config.pipeline.default_track),
    `→ ${config.pipeline.default_track}`);

  // Gather all hosts referenced by the config
  const referencedHosts = new Set();
  referencedHosts.add(config.routing.default_host);
  for (const v of Object.values(config.routing.roles || {})) referencedHosts.add(v);
  for (const v of Object.values(config.routing.stages || {})) referencedHosts.add(v);

  console.log("\nAdapters");
  const { listHosts, loadAdapter } = require(path.join(FRAMEWORK_ROOT, "core", "router"));
  const available = new Set(listHosts());
  for (const h of referencedHosts) {
    if (!available.has(h)) {
      check(`host "${h}" available`, false, `no adapter at hosts/${h}/`);
      continue;
    }
    const adapter = loadAdapter(h);
    const status = adapter.status(cwd);
    check(`host "${h}" install`, status.ok, status.ok ? null : `${status.missing.length} missing file(s)`);
    if (adapter.capabilities && adapter.capabilities.headless && adapter.capabilities.headlessCommand) {
      const bin = adapter.capabilities.headlessCommand.split(/\s+/)[0];
      const which = spawnSync("which", [bin], { encoding: "utf8" });
      check(`  ${bin} on PATH (for --headless)`, which.status === 0 ? true : "warn",
        which.status === 0 ? which.stdout.trim() : `${bin} not found; --headless will fail`);
    }
  }

  console.log("");
  if (criticalFailures > 0) {
    console.log(`❌ ${criticalFailures} critical failure(s), ${warnings} warning(s)`);
    process.exit(1);
  }
  if (warnings > 0) {
    console.log(`⚠️  ${warnings} warning(s)`);
    process.exit(0);
  }
  console.log("✅ everything looks good");
}

module.exports = { name, flags, run };
