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
const os = require("node:os");
const path = require("node:path");
const { chunkByHeading, extractTitle } = require("./chunker");
const { getEmbedder } = require("./embed");
const { JSONMemoryStore, makeRecord } = require("./store");

// Org-shared memory: a second store rooted in the user's home dir,
// shared across all projects on this machine. Per BACKLOG D3 + G8 —
// "the architect always remembers" via cross-project ADR + lessons
// access. The path is overridable via STAGECRAFT_ORG_MEMORY_DIR for
// testing and for users who want to point at a shared network mount.
const ORG_MEMORY_DIR = process.env.STAGECRAFT_ORG_MEMORY_DIR
  || path.join(os.homedir(), ".stagecraft", "memory");

function newOrgStore() {
  return new JSONMemoryStore({ dir: ORG_MEMORY_DIR });
}

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

// ---------------------------------------------------------------------------
// Org-shared memory (D3 + G8)
// ---------------------------------------------------------------------------
//
// The org store is a second JSONMemoryStore rooted at ORG_MEMORY_DIR
// (~/.stagecraft/memory/ by default). It uses the same schema and the
// same embedder as the per-project store, so promotions are 1:1 copies
// of records into the shared pool.
//
// Promotion is explicit: nothing flows to org memory automatically.
// `devteam memory promote <kind>` (e.g. `promote adr`, `promote
// lessons-learned`) copies a project's records of that kind into the
// org store. This makes the trust boundary explicit — only artifacts a
// team intentionally shares end up cross-project.

/**
 * Promote records from a per-project store to the org store.
 * Default `kinds = ["adr", "lessons-learned"]` — the two artifact
 * kinds whose value compounds across projects (architectural decisions
 * + reinforced lessons).
 *
 * Returns { promoted: { <kind>: count, ... }, skipped: [...] }.
 */
function promote(opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const kinds = opts.kinds || ["adr", "lessons-learned"];
  const project = new JSONMemoryStore({ cwd });
  const org = newOrgStore();

  const promoted = {};
  const skipped = [];

  // Copy meta only if the org store doesn't have one yet — the org
  // store inherits the first promoter's embedder model.
  const projectMeta = project.loadMeta();
  if (projectMeta && !org.loadMeta()) {
    org.saveMeta(projectMeta);
  }

  // Detect embedder mismatch before promoting; refuse if the project's
  // vectors are from a different model than the org store. Avoids
  // mixing incompatible vector dimensions in one shard.
  const orgMeta = org.loadMeta();
  if (orgMeta && projectMeta && projectMeta.embedder.modelId !== orgMeta.embedder.modelId) {
    return {
      promoted: {},
      skipped: [],
      error: `embedder mismatch: project uses ${projectMeta.embedder.modelId}, org pool uses ${orgMeta.embedder.modelId}. Run \`devteam memory reindex\` in this project (or in the org pool) first.`,
    };
  }

  for (const kind of kinds) {
    const projectShard = project._loadShard(kind);
    if (projectShard.length === 0) {
      skipped.push(kind);
      continue;
    }
    // Group by doc_id so upsertDoc replaces atomically.
    const byDoc = new Map();
    for (const rec of projectShard) {
      if (!byDoc.has(rec.doc_id)) byDoc.set(rec.doc_id, []);
      byDoc.get(rec.doc_id).push({
        ...rec,
        // Tag the record with the source project so org-queries can
        // attribute results back to the originating project.
        project_cwd: cwd,
      });
    }
    let count = 0;
    for (const [/* docId */, records] of byDoc) {
      // The first record's `source` field is the path (e.g.
      // "pipeline/adr/0001-foo.md"). Re-project it to the
      // project-qualified form for org storage so multiple projects'
      // ADRs don't collide on path.
      const source = `${cwd}#${records[0].source}`;
      org.upsertDoc(source, kind, records.map((r) => ({ ...r, source })));
      count += records.length;
    }
    promoted[kind] = count;
  }

  return { promoted, skipped, dir: ORG_MEMORY_DIR };
}

/** Query the org-shared store. Same interface as query(). */
async function queryOrg(text, opts = {}) {
  const store = newOrgStore();
  const embedder = await getEmbedder();
  const meta = store.loadMeta();
  if (meta && meta.embedder && meta.embedder.modelId !== embedder.modelId) {
    process.stderr.write(
      `[memory] note: org store was indexed with ${meta.embedder.modelId} but the current embedder is ${embedder.modelId}. ` +
      `Results will be poor until both stores use the same embedder.\n`,
    );
  }
  const q = await embedder.embed(text);
  return store.query(q, { limit: opts.limit, kind: opts.kind });
}

/** Stats on the org store. */
function statsOrg() {
  return newOrgStore().stats();
}

/** Wipe the org store (rare; mostly for tests). */
function clearOrg() {
  newOrgStore().clear();
}

module.exports = {
  ingest, query, stats, clear, reindex, discoverArtifacts, ARTIFACT_KINDS,
  // D3 — cross-project memory
  promote, queryOrg, statsOrg, clearOrg, newOrgStore, ORG_MEMORY_DIR,
};
