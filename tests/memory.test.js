// Memory tests. Uses DEVTEAM_EMBEDDING_PROVIDER=stub so the real
// transformers.js model isn't loaded in CI — keeps the test suite
// fast and offline. The stub provider returns deterministic
// hash-based vectors; the storage + chunking + ingest + query
// machinery is exercised end-to-end with those.

process.env.DEVTEAM_EMBEDDING_PROVIDER = "stub";

const { describe, it, afterEach, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { REPO_ROOT, makeTargetProject, cleanup } = require("./_helpers");
const { chunkByHeading, extractTitle } = require(path.join(REPO_ROOT, "core", "memory", "chunker"));
const { JSONMemoryStore, sha1 } = require(path.join(REPO_ROOT, "core", "memory", "store"));
const memory = require(path.join(REPO_ROOT, "core", "memory"));
const { getEmbedder, resetCache } = require(path.join(REPO_ROOT, "core", "memory", "embed"));

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
afterEach(() => { _dirs.forEach(cleanup); _dirs = []; resetCache(); });

function writeArtifact(cwd, rel, body) {
  const p = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, "utf8");
}

const SAMPLE_BRIEF = `# Brief — SMS notification opt-in

## 1. Problem

Users currently get only email notifications. They want SMS for
time-sensitive events like login alerts and payment confirmations.

## 2. User stories

As a user, I can opt into SMS per event type from my account settings.

## 9. Observability requirements

Counter notifications_opt_in_changes_total{channel, event_type, direction}.
Log every opt-in change at INFO. Counter sms_sent_total{event_type, outcome}.
`;

const SAMPLE_DESIGN = `# Design — SMS opt-in service

## Service boundaries

A new NotificationService owns opt-in state in users.notification_preferences.

## Failure modes

If SMS provider is down, fall back to email and log a warning.
`;

// ---------------------------------------------------------------------------
// chunkByHeading
// ---------------------------------------------------------------------------

describe("memory: chunkByHeading", () => {
  it("splits at level-2 headings by default", () => {
    const chunks = chunkByHeading(SAMPLE_BRIEF);
    const headings = chunks.map((c) => c.heading);
    assert.ok(headings.includes("1. Problem"));
    assert.ok(headings.includes("9. Observability requirements"));
  });

  it("drops chunks shorter than minChars", () => {
    const text = "## A\nx\n## B\n" + "y".repeat(100);
    const chunks = chunkByHeading(text);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].heading, "B");
  });

  it("handles documents with no headings as a single (preamble)", () => {
    const chunks = chunkByHeading("just some prose, no headings, " + "x".repeat(50));
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].heading, "(preamble)");
  });

  it("empty input → empty array", () => {
    assert.deepEqual(chunkByHeading(""), []);
    assert.deepEqual(chunkByHeading(null), []);
  });
});

describe("memory: extractTitle", () => {
  it("finds the first H1", () => {
    assert.equal(extractTitle("# Hello\n\n## World"), "Hello");
  });
  it("falls back when no H1", () => {
    assert.equal(extractTitle("no title here", "fallback"), "fallback");
  });
});

// ---------------------------------------------------------------------------
// Embedder (stub)
// ---------------------------------------------------------------------------

describe("memory: stub embedder", () => {
  it("returns L2-normalized vectors of fixed dimension", async () => {
    const e = await getEmbedder();
    const v = await e.embed("hello world");
    assert.equal(v.length, e.dimensions);
    let n = 0;
    for (const x of v) n += x * x;
    assert.ok(Math.abs(n - 1) < 1e-6, `expected unit norm, got ${n}`);
  });

  it("is deterministic — same input → same vector", async () => {
    const e = await getEmbedder();
    const v1 = await e.embed("hello");
    const v2 = await e.embed("hello");
    assert.deepEqual(Array.from(v1), Array.from(v2));
  });

  it("embedBatch returns one vector per input", async () => {
    const e = await getEmbedder();
    const vs = await e.embedBatch(["a", "b", "c"]);
    assert.equal(vs.length, 3);
    assert.ok(vs.every((v) => v.length === e.dimensions));
  });

  it("rejects an unknown provider with an actionable error", () => {
    const before = process.env.DEVTEAM_EMBEDDING_PROVIDER;
    process.env.DEVTEAM_EMBEDDING_PROVIDER = "fakeprovider";
    resetCache();
    return getEmbedder().then(
      () => assert.fail("should have thrown"),
      (err) => {
        assert.match(err.message, /Unknown DEVTEAM_EMBEDDING_PROVIDER/);
        process.env.DEVTEAM_EMBEDDING_PROVIDER = before;
        resetCache();
      },
    );
  });
});

// ---------------------------------------------------------------------------
// JSONMemoryStore
// ---------------------------------------------------------------------------

describe("memory: JSONMemoryStore", () => {
  it("upsertDoc replaces all chunks for a source", () => {
    const cwd = track(makeTargetProject({ gates: false }));
    const store = new JSONMemoryStore({ cwd });
    const mkRec = (heading) => ({
      id: sha1(`x.md|${heading}`), doc_id: sha1("x.md"), kind: "brief",
      source: "x.md", title: "X", heading, text: "...", embedding: [0.1, 0.2],
      timestamp: "t", embedder: { modelId: "stub", dim: 2 },
    });
    store.upsertDoc("x.md", "brief", [mkRec("A"), mkRec("B")]);
    let s = store.stats();
    assert.equal(s.chunks, 2);
    // Re-upsert with a different chunk set → old chunks gone
    store.upsertDoc("x.md", "brief", [mkRec("C")]);
    s = store.stats();
    assert.equal(s.chunks, 1);
    assert.equal(s.by_kind.brief.chunks, 1);
  });

  it("deleteDoc removes all chunks for a source across shards", () => {
    const cwd = track(makeTargetProject({ gates: false }));
    const store = new JSONMemoryStore({ cwd });
    const docId = sha1("a.md");
    store._saveShard("brief", [
      { id: "1", doc_id: docId, kind: "brief", source: "a.md", embedding: [0] },
      { id: "2", doc_id: sha1("b.md"), kind: "brief", source: "b.md", embedding: [0] },
    ]);
    assert.equal(store.deleteDoc("a.md"), 1);
    assert.equal(store.stats().chunks, 1);
  });

  it("clear wipes all shards but preserves the dir", () => {
    const cwd = track(makeTargetProject({ gates: false }));
    const store = new JSONMemoryStore({ cwd });
    store.upsertDoc("x.md", "brief", [{
      id: "1", doc_id: sha1("x.md"), kind: "brief", source: "x.md",
      embedding: [0], title: "x", heading: "h", text: "t", timestamp: "t",
      embedder: { modelId: "stub", dim: 1 },
    }]);
    assert.equal(store.stats().chunks, 1);
    store.clear();
    assert.equal(store.stats().chunks, 0);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: ingest + query
// ---------------------------------------------------------------------------

describe("memory: ingest + query end-to-end", () => {
  it("ingests pipeline/brief.md and finds it via query", async () => {
    const cwd = track(makeTargetProject({ gates: false }));
    writeArtifact(cwd, "pipeline/brief.md", SAMPLE_BRIEF);
    const r = await memory.ingest({ cwd });
    assert.equal(r.artifacts, 1);
    assert.ok(r.chunks >= 2);
    // Query for something that should match the observability section
    const results = await memory.query("observability metrics for sms", { cwd, limit: 3 });
    assert.ok(results.length > 0);
    // All results should come from the brief we ingested
    assert.ok(results.every((res) => res.source === "pipeline/brief.md"));
  });

  it("indexes multiple artifact types with the right `kind`", async () => {
    const cwd = track(makeTargetProject({ gates: false }));
    writeArtifact(cwd, "pipeline/brief.md", SAMPLE_BRIEF);
    writeArtifact(cwd, "pipeline/design-spec.md", SAMPLE_DESIGN);
    writeArtifact(cwd, "pipeline/adr/001-pick-twilio.md", `# ADR 001 — Pick Twilio

## Decision
Use Twilio.

## Context
Cheapest SMS provider for our volume.`);
    await memory.ingest({ cwd });
    const s = memory.stats({ cwd });
    assert.equal(s.documents, 3);
    assert.ok(s.by_kind.brief);
    assert.ok(s.by_kind["design-spec"]);
    assert.ok(s.by_kind.adr);
  });

  it("respects the stagecraft-no-memory marker", async () => {
    const cwd = track(makeTargetProject({ gates: false }));
    writeArtifact(cwd, "pipeline/brief.md", "<!-- stagecraft-no-memory -->\n# Brief\n## 1. Problem\n" + "x".repeat(60));
    const r = await memory.ingest({ cwd });
    assert.equal(r.artifacts, 0);
    assert.ok(r.skipped.some((s) => s.includes("brief.md")));
  });

  it("kind filter narrows results", async () => {
    const cwd = track(makeTargetProject({ gates: false }));
    writeArtifact(cwd, "pipeline/brief.md", SAMPLE_BRIEF);
    writeArtifact(cwd, "pipeline/design-spec.md", SAMPLE_DESIGN);
    await memory.ingest({ cwd });
    const all = await memory.query("opt-in", { cwd, limit: 10 });
    const briefsOnly = await memory.query("opt-in", { cwd, limit: 10, kind: "brief" });
    assert.ok(all.length >= briefsOnly.length);
    assert.ok(briefsOnly.every((r) => r.kind === "brief"));
  });

  it("stats reports embedder + counts", async () => {
    const cwd = track(makeTargetProject({ gates: false }));
    writeArtifact(cwd, "pipeline/brief.md", SAMPLE_BRIEF);
    await memory.ingest({ cwd });
    const s = memory.stats({ cwd });
    assert.ok(s.embedder);
    assert.equal(s.embedder.modelId, "stub");
    assert.equal(s.documents, 1);
    assert.ok(s.chunks > 0);
  });

  it("clear wipes the store", async () => {
    const cwd = track(makeTargetProject({ gates: false }));
    writeArtifact(cwd, "pipeline/brief.md", SAMPLE_BRIEF);
    await memory.ingest({ cwd });
    assert.ok(memory.stats({ cwd }).chunks > 0);
    memory.clear({ cwd });
    assert.equal(memory.stats({ cwd }).chunks, 0);
  });

  it("re-ingesting the same artifact does NOT duplicate chunks", async () => {
    const cwd = track(makeTargetProject({ gates: false }));
    writeArtifact(cwd, "pipeline/brief.md", SAMPLE_BRIEF);
    const r1 = await memory.ingest({ cwd });
    const r2 = await memory.ingest({ cwd });
    assert.equal(r1.chunks, r2.chunks);
    assert.equal(memory.stats({ cwd }).chunks, r1.chunks);
  });

  it("reindex clears then re-ingests", async () => {
    const cwd = track(makeTargetProject({ gates: false }));
    writeArtifact(cwd, "pipeline/brief.md", SAMPLE_BRIEF);
    await memory.ingest({ cwd });
    const before = memory.stats({ cwd }).chunks;
    const r = await memory.reindex({ cwd });
    assert.equal(r.chunks, before);
    assert.equal(memory.stats({ cwd }).chunks, before);
  });

  it("query results are ranked by similarity (highest first)", async () => {
    const cwd = track(makeTargetProject({ gates: false }));
    writeArtifact(cwd, "pipeline/brief.md", SAMPLE_BRIEF);
    await memory.ingest({ cwd });
    const results = await memory.query("test query", { cwd, limit: 10 });
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i - 1].similarity >= results[i].similarity);
    }
  });
});
