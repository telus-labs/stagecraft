// Memory — public API for Stagecraft's persistent project memory.
//
// Per-project (per decision 3): each project has its own .devteam/memory/.
// Cross-project import is planned but not implemented in v1.
//
// API:
//   await ingest({ cwd, only? })        index pipeline artifacts
//   await query("text", { cwd, ... })    semantic search
//   stats({ cwd })                       what's indexed
//   clear({ cwd })                       wipe the store
//   await reindex({ cwd })               re-embed (after model upgrade)
//
// Ingestion scope (decision 4): high-level pipeline artifacts only.
// Briefs, design specs, ADRs, clarification logs, runbooks, test
// reports, accessibility / observability reports, retrospectives,
// and the running lessons-learned file. Code, gates, and configs
// are deliberately excluded.
//
// Opt-out per artifact: a file containing the marker
// "stagecraft-no-memory" anywhere in its body is skipped.

const fs = require("node:fs");
const path = require("node:path");
const { chunkByHeading, extractTitle } = require("./chunker");
const { getEmbedder } = require("./embed");
const { JSONMemoryStore, makeRecord } = require("./store");

// Map artifact path (relative to project cwd) → memory "kind".
const ARTIFACT_KINDS = {
  "pipeline/brief.md":                "brief",
  "pipeline/design-spec.md":          "design-spec",
  "pipeline/clarification-log.md":    "clarification",
  "pipeline/build-plan.md":           "build-plan",
  "pipeline/pre-review.md":           "pre-review",
  "pipeline/security-review.md":      "security-review",
  "pipeline/accessibility-report.md": "accessibility",
  "pipeline/observability-report.md": "observability",
  "pipeline/test-report.md":          "test-report",
  "pipeline/runbook.md":              "runbook",
  "pipeline/retrospective.md":        "retrospective",
  "pipeline/lessons-learned.md":      "lessons-learned",
};

// adr/*.md — discovered dynamically; kind is "adr".

const SKIP_MARKER = /stagecraft-no-memory/i;

function discoverArtifacts(cwd) {
  const found = [];
  for (const [rel, kind] of Object.entries(ARTIFACT_KINDS)) {
    const abs = path.join(cwd, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      found.push({ rel, abs, kind });
    }
  }
  const adrDir = path.join(cwd, "pipeline", "adr");
  if (fs.existsSync(adrDir) && fs.statSync(adrDir).isDirectory()) {
    for (const f of fs.readdirSync(adrDir)) {
      if (!f.endsWith(".md")) continue;
      const rel = path.posix.join("pipeline", "adr", f);
      found.push({ rel, abs: path.join(adrDir, f), kind: "adr" });
    }
  }
  return found;
}

/**
 * Ingest all (or filtered) pipeline artifacts from the project at `cwd`.
 * Replaces existing chunks for any matched document (no duplicate rows).
 *
 * @param {object} opts
 * @param {string} opts.cwd           project root
 * @param {string[]} [opts.only]      restrict to these relative paths
 * @returns {Promise<{ artifacts: number, chunks: number, skipped: string[], embedder: {modelId, dim} }>}
 */
async function ingest(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const store = new JSONMemoryStore({ cwd });
  const embedder = await getEmbedder();
  store.saveMeta({
    schemaVersion: 1,
    embedder: { modelId: embedder.modelId, dim: embedder.dimensions },
  });

  let artifacts = 0;
  let chunkCount = 0;
  const skipped = [];

  let found = discoverArtifacts(cwd);
  if (opts.only && opts.only.length > 0) {
    const onlySet = new Set(opts.only);
    found = found.filter((a) => onlySet.has(a.rel));
  }

  for (const art of found) {
    const text = fs.readFileSync(art.abs, "utf8");
    if (SKIP_MARKER.test(text)) {
      skipped.push(`${art.rel} (stagecraft-no-memory marker)`);
      continue;
    }
    const title = extractTitle(text, art.rel);
    const sections = chunkByHeading(text);
    if (sections.length === 0) continue;
    const vectors = await embedder.embedBatch(sections.map((s) => `${title}\n\n${s.heading}\n\n${s.text}`));
    const records = sections.map((s, i) => makeRecord({
      source: art.rel,
      kind: art.kind,
      title,
      heading: s.heading,
      text: s.text,
      embedding: vectors[i],
      embedderInfo: embedder,
    }));
    store.upsertDoc(art.rel, art.kind, records);
    artifacts += 1;
    chunkCount += records.length;
  }

  return {
    artifacts,
    chunks: chunkCount,
    skipped,
    embedder: { modelId: embedder.modelId, dim: embedder.dimensions },
  };
}

/**
 * Semantic search against the memory.
 *
 * @param {string} text         query text
 * @param {object} opts
 * @param {string} opts.cwd     project root
 * @param {number} [opts.limit] default 5
 * @param {string} [opts.kind]  restrict to one kind ("brief", "adr", ...)
 * @returns {Promise<Array>}
 */
async function query(text, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const store = new JSONMemoryStore({ cwd });
  const embedder = await getEmbedder();
  // Detect dimensional mismatch between query and stored vectors.
  const meta = store.loadMeta();
  if (meta && meta.embedder && meta.embedder.modelId !== embedder.modelId) {
    process.stderr.write(
      `[memory] note: store was indexed with ${meta.embedder.modelId} but the current embedder is ${embedder.modelId}. ` +
      `Results will be poor until you run \`stagecraft memory reindex\`.\n`,
    );
  }
  const q = await embedder.embed(text);
  return store.query(q, { limit: opts.limit, kind: opts.kind });
}

function stats(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  return new JSONMemoryStore({ cwd }).stats();
}

function clear(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  new JSONMemoryStore({ cwd }).clear();
}

/** Re-ingest all known artifacts. Useful after switching embedders. */
async function reindex(opts = {}) {
  clear(opts);
  return ingest(opts);
}

module.exports = { ingest, query, stats, clear, reindex, discoverArtifacts, ARTIFACT_KINDS };
