"use strict";

// devteam install <host> — install a host adapter into the current project.
// Writes the adapter's config stub (and any required files) to .devteam/.
// Safe to re-run; skips files that already exist unless --force is passed.
//
// Usage:
//   devteam install <host>          install the named adapter
//   devteam install <host> --force  overwrite existing config
//   devteam install                 list available hosts

const path = require("node:path");
const { generateHelp } = require(path.join(__dirname, "..", "flags"));
const { listHosts, loadAdapter } = require(path.join(__dirname, "..", "..", "router"));

const name = "install";

const flags = {
  force: { type: "boolean", description: "Overwrite existing config (re-install)" },
  cwd:   { type: "string",  description: "Target project directory (default: cwd)" },
  help:  { type: "boolean", description: "Show this help" },
};

function run(positional, _flags) {
  if (_flags.help) {
    console.log(generateHelp("devteam install <host> [options]", flags));
    process.exit(0);
  }

  const available = listHosts();

  if (positional.length === 0) {
    console.log(`Available hosts: ${available.join(", ") || "(none)"}`);
    console.log(`Usage: devteam install <host>`);
    process.exit(0);
  }

  const hostName = positional[0];
  if (!available.includes(hostName)) {
    console.error(`Unknown host: ${hostName}`);
    console.error(`Available: ${available.join(", ")}`);
    process.exit(2);
  }

  const cwd = _flags.cwd || process.cwd();
  const adapter = loadAdapter(hostName);
  const result = adapter.install(cwd, { force: !!_flags.force });

  if (result.written && result.written.length > 0) {
    for (const f of result.written) {
      const rel = path.isAbsolute(f) ? path.relative(cwd, f) : f;
      console.log(`  ✓ wrote ${rel}`);
    }
  }
  if (result.skipped && result.skipped.length > 0) {
    for (const msg of result.skipped) {
      console.log(`  - skipped: ${msg}`);
    }
  }
  if (result.warnings && result.warnings.length > 0) {
    for (const w of result.warnings) {
      console.log(`  ⚠  ${w}`);
    }
  }

  if (result.written && result.written.length === 0 && (!result.skipped || result.skipped.length === 0)) {
    console.log(`  (nothing to write)`);
  }

  // Show adapter status after install so the user knows what's still needed.
  const s = adapter.status(cwd);
  console.log(`\nStatus: ${s.ok ? "ready" : "needs configuration"}`);
  if (s.missing && s.missing.length > 0) {
    for (const m of s.missing) console.log(`  missing: ${m}`);
  }
  if (s.notes && s.notes.length > 0) {
    for (const n of s.notes) console.log(`  ${n}`);
  }
}

module.exports = { name, flags, run };
