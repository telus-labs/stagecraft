"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { generateHelp } = require(path.join(__dirname, "..", "flags"));
const { listHosts, loadAdapter } = require(path.join(__dirname, "..", "..", "router"));
const { writeConfigIfAbsent, configPath } = require(path.join(__dirname, "..", "..", "config"));

const name = "init";

const flags = {
  host:  { type: "string",  description: "Host adapter(s), comma-separated" },
  force: { type: "boolean", description: "Overwrite existing config/files" },
  cwd:   { type: "string",  description: "Target project directory" },
  help:  { type: "boolean", description: "Show this help" },
};

function run(positional, _flags) {
  if (_flags.help) { console.log(generateHelp("devteam init --host <list> [options]", flags)); process.exit(0); }
  if (!_flags.host) {
    console.error(generateHelp("devteam init --host <list> [options]", flags));
    console.error(`Available hosts: ${listHosts().join(", ") || "(none)"}`);
    process.exit(2);
  }
  const hosts = _flags.host.split(",").map((s) => s.trim()).filter(Boolean);
  const cwd = _flags.cwd || process.cwd();
  const available = new Set(listHosts());
  const unknown = hosts.filter((h) => !available.has(h));
  if (unknown.length > 0) {
    console.error(`Unknown host(s): ${unknown.join(", ")}`);
    console.error(`Available: ${[...available].join(", ")}`);
    process.exit(2);
  }

  console.log(`Initializing devteam in: ${cwd}`);
  console.log(`Host(s): ${hosts.join(", ")}`);

  const cfg = writeConfigIfAbsent(cwd, hosts, { force: !!_flags.force });
  console.log(cfg.written
    ? `  ✓ wrote ${path.relative(cwd, cfg.path)}`
    : `  - skipped ${path.relative(cwd, cfg.path)} (${cfg.reason}; use --force to overwrite)`);

  for (const dir of ["pipeline", "pipeline/gates"]) {
    const p = path.join(cwd, dir);
    if (!fs.existsSync(p)) {
      fs.mkdirSync(p, { recursive: true });
      console.log(`  ✓ created ${dir}/`);
    } else {
      console.log(`  - exists  ${dir}/`);
    }
  }

  for (const hostName of hosts) {
    console.log(`\nInstalling host adapter: ${hostName}`);
    const adapter = loadAdapter(hostName);
    const r = adapter.install(cwd, { force: !!_flags.force });
    console.log(`  written: ${r.written.length}, skipped: ${r.skipped.length}`);
    for (const f of r.warnings) console.log(`  ⚠️  ${f}`);
  }

  console.log(`\nNext: edit ${path.relative(cwd, configPath(cwd))} if you need custom routing, then \`devteam stage requirements --feature "..."\`.`);
}

module.exports = { name, flags, run };
