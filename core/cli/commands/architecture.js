"use strict";

const path = require("node:path");
const { generateHelp } = require(path.join(__dirname, "..", "flags"));

const name = "architecture";

const flags = {
  cwd:   { type: "string",  description: "Target project directory" },
  limit: { type: "string",  description: "Max results to return" },
  kind:  { type: "string",  description: "Artifact kind (default: adr)" },
  json:  { type: "boolean", description: "JSON output" },
  help:  { type: "boolean", description: "Show this help" },
};

// G8 — architecture continuity. Thin wrapper around the org-memory
// ADR query. Same shape as `devteam memory query --org --kind adr`
// but with a friendlier name + a "lookup" subcommand the Principal
// role brief points at.
function run(positional, _flags) {
  if (_flags.help) { console.log(generateHelp("devteam architecture <subcommand> [options]", flags)); process.exit(0); }
  const sub = positional[0];
  const remaining = positional.slice(1);
  const mem = require(path.join(__dirname, "..", "..", "memory"));

  if (sub === "lookup") {
    const text = remaining.join(" ");
    if (!text) {
      console.error("Usage: devteam architecture lookup \"<topic>\" [--limit N] [--kind adr|lessons-learned]");
      process.exit(2);
    }
    const kind = _flags.kind || "adr"; // architecture-flavored default
    mem.queryOrg(text, { limit: _flags.limit ? Number(_flags.limit) : 5, kind })
      .then((results) => {
        if (_flags.json) { console.log(JSON.stringify(results, null, 2)); return; }
        if (results.length === 0) {
          console.log(`(no prior ${kind} entries match "${text}" in the org store at ${mem.ORG_MEMORY_DIR})`);
          console.log(`Record this in the new design's "Prior commitments considered" section as "none — query returned no related results".`);
          return;
        }
        process.stderr.write(`[architecture] org store at ${mem.ORG_MEMORY_DIR}\n`);
        console.log(`Prior ${kind} entries relevant to "${text}":\n`);
        for (const r of results) {
          console.log(`  ${r.similarity.toFixed(3)}  ${r.title} → ${r.heading}`);
          console.log(`           ${r.source}`);
          if (r.project_cwd) console.log(`           (project: ${r.project_cwd})`);
          const snippet = r.text.split("\n").slice(0, 4).join(" ").slice(0, 220);
          console.log(`           ${snippet}${snippet.length >= 220 ? "…" : ""}`);
          console.log("");
        }
        console.log(`Cite the relevant ones in the new design's "Prior commitments considered" section. If a prior ADR conflicts with the new design, either follow it OR write a new ADR with Supersedes: <id> and a rationale.`);
      })
      .catch((err) => { console.error(`devteam architecture lookup: ${err.message}`); process.exit(1); });
    return;
  }

  console.error(`Unknown architecture subcommand: ${sub || "(none)"}`);
  console.error("Usage: devteam architecture lookup \"<topic>\" [--limit N] [--kind adr|lessons-learned]");
  console.error("");
  console.error("Equivalent to `devteam memory query --org --kind adr \"<topic>\"` — the Principal");
  console.error("role brief uses this name when prompting designers to consult prior commitments");
  console.error("See: devteam memory promote + devteam architecture lookup.");
  process.exit(2);
}

module.exports = { name, flags, run };
