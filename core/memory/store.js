// MemoryStore — the storage layer behind Stagecraft's memory system.
//
// Designed as an interface so we can swap backends later without
// touching call sites:
//   - JSONMemoryStore (this file): default, one .json file per kind under
//     .devteam/memory/, git-friendly. O(N) cosine search; fine up to ~1k
//     chunks per project.
//   - sqlite-vec backend: planned for v0.3 (better-sqlite3 + sqlite-vec
//     extension). Same interface; binary .db; gitignored.
//
// Per-project. Cross-project sharing is deferred (cf. D7 decision 3).
//
// Storage layout under <cwd>/.devteam/memory/ :
//   chunks-<kind>.json    one per kind (brief, design-spec, etc.)
//   meta.json             { schemaVersion, embedder: {modelId, dim} }
//
// A "record" is one chunk:
//   {
//     id:        "<sha1 of source path + heading>",
//     doc_id:    "<sha1 of source path>",         // groups chunks by doc
//     kind:      "brief" | "design-spec" | "adr" | ...,
//     source:    "pipeline/brief.md",             // relative to project cwd
//     title:     "Brief — Add SMS notification opt-in",
//     heading:   "9. Observability requirements",
//     text:      "The full chunk text...",
//     embedding: number[]                         // L2-normalized vector
//     timestamp: "<ISO-8601>",
//     embedder:  { modelId, dim }                 // recorded for upgrade detection
//   }

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SCHEMA_VERSION = 1;

function sha1(s) { return crypto.createHash("sha1").update(s).digest("hex"); }

function makeRecord({ source, kind, title, heading, text, embedding, embedderInfo }) {
  const doc_id = sha1(source);
  const id = sha1(`${source}|${heading}`);
  return {
    id, doc_id, kind, source, title, heading, text,
    embedding: Array.from(embedding),
    timestamp: new Date().toISOString(),
    embedder: { modelId: embedderInfo.modelId, dim: embedderInfo.dimensions },
  };
}

// ---------------------------------------------------------------------------
// JSON-backed implementation
// ---------------------------------------------------------------------------

class JSONMemoryStore {
  constructor(opts = {}) {
    this.cwd = opts.cwd || process.cwd();
    // `dir` overrides the default per-project path. Used by the org-shared
    // store (rooted at ~/.stagecraft/memory/) to share the same backend.
    this.dir = opts.dir || path.join(this.cwd, ".devteam", "memory");
  }
  _ensureDir() { fs.mkdirSync(this.dir, { recursive: true }); }
  _shardFile(kind) { return path.join(this.dir, `chunks-${kind}.json`); }
  _metaFile()      { return path.join(this.dir, "meta.json"); }

  _loadShard(kind) {
    const p = this._shardFile(kind);
    if (!fs.existsSync(p)) return [];
    try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return []; }
  }
  _saveShard(kind, records) {
    this._ensureDir();
    fs.writeFileSync(this._shardFile(kind), JSON.stringify(records, null, 2) + "\n", "utf8");
  }
  _allShards() {
    if (!fs.existsSync(this.dir)) return {};
    const out = {};
    for (const f of fs.readdirSync(this.dir)) {
      const m = f.match(/^chunks-(.+)\.json$/);
      if (m) out[m[1]] = this._loadShard(m[1]);
    }
    return out;
  }

  loadMeta() {
    if (!fs.existsSync(this._metaFile())) return null;
    try { return JSON.parse(fs.readFileSync(this._metaFile(), "utf8")); } catch { return null; }
  }
  saveMeta(meta) {
    this._ensureDir();
    fs.writeFileSync(this._metaFile(), JSON.stringify(meta, null, 2) + "\n", "utf8");
  }

  /** Replace all chunks belonging to a source. Returns { added, removed }. */
  upsertDoc(source, kind, records) {
    const shard = this._loadShard(kind);
    const docId = records.length > 0 ? records[0].doc_id : sha1(source);
    const kept = shard.filter((r) => r.doc_id !== docId);
    const next = kept.concat(records);
    this._saveShard(kind, next);
    return { added: records.length, removed: shard.length - kept.length };
  }

  deleteDoc(source) {
    const shards = this._allShards();
    const docId = sha1(source);
    let removed = 0;
    for (const [kind, shard] of Object.entries(shards)) {
      const kept = shard.filter((r) => r.doc_id !== docId);
      if (kept.length !== shard.length) {
        this._saveShard(kind, kept);
        removed += shard.length - kept.length;
      }
    }
    return removed;
  }

  clear() {
    if (!fs.existsSync(this.dir)) return;
    for (const f of fs.readdirSync(this.dir)) {
      if (f.endsWith(".json")) fs.unlinkSync(path.join(this.dir, f));
    }
  }

  /** Returns { documents, chunks, by_kind, embedder, schemaVersion }. */
  stats() {
    const shards = this._allShards();
    const by_kind = {};
    const docs = new Set();
    let chunks = 0;
    for (const [kind, shard] of Object.entries(shards)) {
      by_kind[kind] = { chunks: shard.length, documents: new Set(shard.map((r) => r.doc_id)).size };
      chunks += shard.length;
      for (const r of shard) docs.add(r.doc_id);
    }
    return {
      documents: docs.size,
      chunks,
      by_kind,
      embedder: (this.loadMeta() || {}).embedder || null,
      schemaVersion: SCHEMA_VERSION,
    };
  }

  /**
   * Cosine search across all shards.
   *
   * @param {Float32Array|number[]} queryVec  L2-normalized query vector
   * @param {object} opts
   * @param {number} opts.limit  default 5
   * @param {string|null} opts.kind  filter to one kind, e.g. "brief"
   * @returns {Array<{ similarity, ...record-fields }>}
   */
  query(queryVec, opts = {}) {
    const limit = opts.limit || 5;
    const shards = this._allShards();
    const candidates = [];
    for (const [kind, shard] of Object.entries(shards)) {
      if (opts.kind && opts.kind !== kind) continue;
      for (const r of shard) {
        candidates.push({ rec: r, similarity: dot(queryVec, r.embedding) });
      }
    }
    candidates.sort((a, b) => b.similarity - a.similarity);
    return candidates.slice(0, limit).map((c) => {
      const out = {
        similarity: Number(c.similarity.toFixed(4)),
        id: c.rec.id,
        doc_id: c.rec.doc_id,
        kind: c.rec.kind,
        source: c.rec.source,
        title: c.rec.title,
        heading: c.rec.heading,
        text: c.rec.text,
        timestamp: c.rec.timestamp,
      };
      // Optional fields that pass through when present (set by the
      // promote() flow for org-store records).
      if (c.rec.project_cwd) out.project_cwd = c.rec.project_cwd;
      return out;
    });
  }
}

function dot(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

module.exports = { JSONMemoryStore, makeRecord, sha1, SCHEMA_VERSION };
