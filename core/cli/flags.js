"use strict";

// core/cli/flags.js — schema-driven CLI flag parser for devteam.
//
// Centralises flag parsing so per-command unknown-flag checking is
// automatic and --help can be generated from the same schema that
// drives parsing. Replaces the flat shared parseFlags in bin/devteam,
// eliminating the --apply dual-mode hack and the silent --skip-*
// omissions (phase-3-structural-debt.md §3.1 PR 1).

// Convert --flag-name to flagName (for default dest key).
function toCamelCase(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

// parseFlags(argv, schema) — parse argv against a schema.
//
// schema = {
//   "flag-name": {
//     type:        "boolean" | "string" | "number" | "list",
//     key?:        string,    // dest property; default = camelCase of flag-name
//     split?:      boolean,   // list only: comma-split the value (--auto-rule a,b)
//     description?: string,
//   }
// }
//
// Returns { positional: string[], flags: object }.
// Unknown --flags exit 2. String/number/list with no value exit 2.
function parseFlags(argv, schema) {
  const flags = {};
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }

    const flagName = a.slice(2);
    const def = schema[flagName];
    if (!def) {
      process.stderr.write(`Unknown flag: ${a}\n`);
      process.exit(2);
    }

    const key = def.key !== undefined ? def.key : toCamelCase(flagName);

    switch (def.type) {
      case "boolean":
        flags[key] = true;
        break;

      case "string": {
        i++;
        if (i >= argv.length) {
          process.stderr.write(`${a} requires a value\n`);
          process.exit(2);
        }
        flags[key] = argv[i];
        break;
      }

      case "number": {
        i++;
        if (i >= argv.length) {
          process.stderr.write(`${a} requires a value\n`);
          process.exit(2);
        }
        flags[key] = Number(argv[i]);
        break;
      }

      case "list": {
        i++;
        if (i >= argv.length) {
          process.stderr.write(`${a} requires a value\n`);
          process.exit(2);
        }
        if (!flags[key]) flags[key] = [];
        const v = argv[i];
        if (def.split) {
          flags[key].push(...v.split(",").map((s) => s.trim()).filter(Boolean));
        } else {
          flags[key].push(v);
        }
        break;
      }

      default:
        process.stderr.write(`Internal error: unknown type "${def.type}" for --${flagName}\n`);
        process.exit(2);
    }
  }

  return { positional, flags };
}

// generateHelp(commandLine, schema) — produce a Usage string from a schema.
// commandLine: e.g. "devteam stage <name> [options]"
function generateHelp(commandLine, schema) {
  const lines = [`Usage: ${commandLine}`];
  const entries = Object.entries(schema).filter(([k]) => k !== "help");
  if (entries.length > 0) {
    lines.push("", "Options:");
    for (const [flagName, def] of entries) {
      const valPart = def.type === "boolean" ? "" : ` <${flagName}>`;
      const desc = def.description || "";
      lines.push(`  --${flagName}${valPart}${desc ? `  ${desc}` : ""}`);
    }
  }
  lines.push("  --help  Show this help");
  return lines.join("\n");
}

module.exports = { parseFlags, generateHelp };
