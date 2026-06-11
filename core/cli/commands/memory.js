"use strict";

const path = require("node:path");
const { generateHelp } = require(path.join(__dirname, "..", "flags"));

const name = "memory";

const flags = {
  cwd:   { type: "string",  description: "Target project directory" },
  limit: { type: "string",  description: "Max results to return" },
  kind:  { type: "string",  description: "Filter by artifact kind" },
  org:   { type: "boolean", description: "Target org-shared store" },
  json:  { type: "boolean", description: "JSON output" },
  help:  { type: "boolean", description: "Show this help" },
};

function run(positional, _flags) {
  if (_flags.help) { console.log(generateHelp("devteam memory <subcommand> [options]", flags)); process.exit(0); }
  const sub = positional[0];
  const remaining = positional.slice(1);
  const cwd = _flags.cwd || process.cwd();
  const mem = require(path.join(__dirname, "..", "..", "memory"));

  if (sub === "ingest") {
    process.stderr.write(`[memory] ingesting from ${cwd}…\n`);
    mem.ingest({ cwd })
      .then((r) => {
        console.log(`✅ ${r.artifacts} artifact(s) → ${r.chunks} chunk(s)`);
        console.log(`   embedder: ${r.embedder.modelId} (dim ${r.embedder.dim})`);
        if (r.skipped.length > 0) {
          console.log(`   skipped:`);
          for (const s of r.skipped) console.log(`     - ${s}`);
        }
        if (r.artifacts === 0) {
          console.log(`   no pipeline artifacts found. Run a stage first, or check --cwd.`);
        }
      })
      .catch((err) => { console.error(`devteam memory ingest: ${err.message}`); process.exit(1); });
    return;
  }
  if (sub === "query") {
    const text = remaining.join(" ");
    if (!text) { console.error("Usage: devteam memory query \"search text\" [--limit N] [--kind brief|adr|...] [--org]"); process.exit(2); }
    const queryFn = _flags.org ? mem.queryOrg : mem.query;
    const queryArgs = _flags.org
      ? [text, { limit: _flags.limit ? Number(_flags.limit) : undefined, kind: _flags.kind }]
      : [text, { cwd, limit: _flags.limit ? Number(_flags.limit) : undefined, kind: _flags.kind }];
    queryFn(...queryArgs)
      .then((results) => {
        if (_flags.json) { console.log(JSON.stringify(results, null, 2)); return; }
        if (results.length === 0) { console.log("(no matches)"); return; }
        if (_flags.org) process.stderr.write(`[memory] querying org-shared store at ${mem.ORG_MEMORY_DIR}\n`);
        for (const r of results) {
          console.log(`\n  ${r.similarity.toFixed(3)}  [${r.kind}] ${r.title} → ${r.heading}`);
          console.log(`           ${r.source}`);
          if (r.project_cwd) console.log(`           (project: ${r.project_cwd})`);
          const snippet = r.text.split("\n").slice(0, 3).join(" ").slice(0, 180);
          console.log(`           ${snippet}${snippet.length >= 180 ? "…" : ""}`);
        }
      })
      .catch((err) => { console.error(`devteam memory query: ${err.message}`); process.exit(1); });
    return;
  }
  if (sub === "stats") {
    const s = _flags.org ? mem.statsOrg() : mem.stats({ cwd });
    if (_flags.json) { console.log(JSON.stringify(s, null, 2)); return; }
    if (_flags.org) console.log(`Org store at: ${mem.ORG_MEMORY_DIR}`);
    console.log(`Documents: ${s.documents}`);
    console.log(`Chunks:    ${s.chunks}`);
    if (s.embedder) console.log(`Embedder:  ${s.embedder.modelId} (dim ${s.embedder.dim})`);
    console.log(`Schema:    v${s.schemaVersion}`);
    if (Object.keys(s.by_kind).length > 0) {
      console.log("By kind:");
      for (const [k, v] of Object.entries(s.by_kind)) {
        console.log(`  ${k.padEnd(20)} ${v.documents} doc(s), ${v.chunks} chunk(s)`);
      }
    }
    return;
  }
  if (sub === "clear") {
    if (_flags.org) {
      mem.clearOrg();
      console.log(`Cleared org store at ${mem.ORG_MEMORY_DIR}`);
    } else {
      mem.clear({ cwd });
      console.log(`Cleared .devteam/memory/ in ${cwd}`);
    }
    return;
  }
  if (sub === "reindex") {
    mem.reindex({ cwd })
      .then((r) => console.log(`Reindexed: ${r.artifacts} artifact(s) → ${r.chunks} chunk(s) via ${r.embedder.modelId}`))
      .catch((err) => { console.error(`devteam memory reindex: ${err.message}`); process.exit(1); });
    return;
  }
  if (sub === "promote") {
    // Default: promote ADRs and lessons-learned. Override with positional
    // kinds, e.g. `devteam memory promote adr` or `promote adr design-spec`.
    const kinds = remaining.length > 0 ? remaining : ["adr", "lessons-learned"];
    const r = mem.promote({ cwd, kinds });
    if (r.error) {
      console.error(`devteam memory promote: ${r.error}`);
      process.exit(1);
    }
    const total = Object.values(r.promoted).reduce((s, n) => s + n, 0);
    if (total === 0) {
      console.log(`No chunks promoted. Run \`devteam memory ingest\` first, then retry.`);
      if (r.skipped.length > 0) console.log(`  (no records for kinds: ${r.skipped.join(", ")})`);
      return;
    }
    console.log(`✅ Promoted ${total} chunk(s) to ${r.dir}:`);
    for (const [kind, count] of Object.entries(r.promoted)) {
      console.log(`   ${kind}: ${count}`);
    }
    if (r.skipped.length > 0) console.log(`   skipped (no records): ${r.skipped.join(", ")}`);
    return;
  }
  console.error(`Unknown memory subcommand: ${sub || "(none)"}`);
  console.error("Usage: devteam memory <ingest|query|stats|clear|reindex|promote>");
  console.error("       --org on query/stats/clear targets the org-shared store");
  process.exit(2);
}

module.exports = { name, flags, run };
