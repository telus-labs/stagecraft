# Persistent project memory

Stagecraft indexes the artifacts a pipeline produces — briefs, design specs, ADRs, retrospectives, lessons-learned — into a per-project semantic memory. Once indexed, you can ask "have we built anything like this before?" and get the relevant past sections back, ranked by similarity.

This is the **D7** item from the BACKLOG. v1 is per-project; cross-project search is planned.

## Quick start

```bash
# After running a pipeline, index everything it produced:
devteam memory ingest

# Ask the memory things:
devteam memory query "user notification opt-in flows"
devteam memory query "schema migration safety" --kind design-spec
devteam memory query "lessons we learned about Twilio" --limit 10

# Check what's indexed:
devteam memory stats

# Wipe the store:
devteam memory clear
```

The first `ingest` downloads the embedding model (~33MB for BGE-small) into `~/.cache/huggingface/`. Subsequent runs use the cached copy — fully offline.

## What it does

For each pipeline artifact under `pipeline/` — `brief.md`, `design-spec.md`, `clarification-log.md`, `runbook.md`, `test-report.md`, `retrospective.md`, `lessons-learned.md`, accessibility/observability/security reports, and any ADRs under `pipeline/adr/` — Stagecraft:

1. Splits the markdown by level-2 heading (so each section becomes its own retrieval target).
2. Embeds each chunk with the configured embedder.
3. Stores the chunk + embedding + metadata in `.devteam/memory/chunks-<kind>.json`.

When you query, your query text is embedded and ranked by cosine similarity against everything in the store. Top-K results come back with the source path, parent document title, the specific section heading, the chunk text, and a similarity score.

## Storage layout

```
.devteam/memory/
├── meta.json                       # { schemaVersion, embedder: { modelId, dim } }
├── chunks-brief.json               # one file per artifact "kind"
├── chunks-design-spec.json
├── chunks-adr.json
├── chunks-retrospective.json
└── chunks-lessons-learned.json
```

JSON files are deliberately git-friendly. Most teams will gitignore `.devteam/memory/` (it can contain sensitive snippets from briefs and designs), but if you want to commit a curated subset to share across the team, the file format makes that possible.

## Privacy

The store contains plaintext copies of every chunk it embeds — which includes whatever was in the brief, design spec, etc. Treat it like a backup:

- **Add `.devteam/memory/` to your project's `.gitignore`** unless you have a deliberate sharing strategy.
- **Opt out per-artifact** by including the marker `stagecraft-no-memory` anywhere in the file (a comment line works). Stagecraft will skip that artifact at ingest time.
- **No cross-project leakage by default** — v1 is strictly per-project. If you work for multiple clients, each project's memory is its own silo. Cross-project import is planned and will be opt-in only.

## Embedder

Default is **local**: `Xenova/bge-small-en-v1.5` via `@huggingface/transformers`. Runs on CPU, embeds ~10-50 chunks/sec depending on hardware, no external account or API key required, no data leaves the machine.

The model is downloaded lazily on first use and cached. ~33MB on disk.

### Switching embedders (future, not yet implemented)

```bash
export DEVTEAM_EMBEDDING_PROVIDER=openai
export OPENAI_API_KEY=sk-...
devteam memory reindex
```

Planned for v0.3. Today only `local` (default) and `stub` (deterministic vectors for tests) work.

### Switching models

```bash
export DEVTEAM_EMBEDDING_MODEL=Xenova/bge-base-en-v1.5  # 110MB, 768-dim, more accurate
devteam memory reindex
```

**Important:** vectors from different models aren't comparable. Always `reindex` after changing the model or provider. Stagecraft records the embedder used in `meta.json` and warns at query time if the current embedder doesn't match.

## Chunking

Splits at level-2 (`##`) markdown headings. Each chunk carries:
- Its heading (e.g. `"9. Observability requirements"`).
- The parent document's title (from the level-1 `#` line).
- The source path (e.g. `pipeline/brief.md`).
- The artifact "kind" (e.g. `brief`, `design-spec`, `adr`).

Chunks under 32 chars are dropped (typically just empty sections). Documents with no headings get a single `(preamble)` chunk.

## Performance

For the realistic scale of a single project (10–100 artifacts, 100–1000 chunks), the in-memory cosine search runs in single-digit milliseconds. Local embedding adds 50–200ms per chunk on a modern CPU. A 12-chunk brief ingests in 1–3 seconds.

The JSON backend's ceiling is roughly 1k chunks per project before query latency becomes noticeable. Past that, switch to the planned sqlite-vec backend (interface ready in `core/memory/store.js`; impl planned for v0.3).

## When to ingest

Two trigger points:

1. **Manual** — `devteam memory ingest` after any artifact-producing stage finishes. Safe to run repeatedly: re-ingesting an artifact replaces its old chunks (no duplicates).
2. **End of pipeline** — typically after Stage 9 (retrospective). The retrospective is when the team's view of "what we built and learned" crystallizes; ingesting then captures the most-complete picture.

Future: automatic ingest on retro-gate write, via a hook. Not in v1 — manual `devteam memory ingest` is the explicit interface for now.

## What's NOT in memory

Deliberately excluded:

- **Source code.** Different problem space; symbol search (grep, ctags, language servers) beats semantic for code lookup.
- **Gate JSON files.** Too structured and short to benefit from embedding.
- **Configs.** Same.
- **Artifacts marked `stagecraft-no-memory`.** Opt-out per file.

## Troubleshooting

**"@huggingface/transformers not installed."** Run `npm install` in the Stagecraft framework directory. If you're getting this error on a CI runner or a constrained environment, set `DEVTEAM_EMBEDDING_PROVIDER=stub` to bypass the local model (stub vectors are useless for real retrieval but unblock tests).

**Slow first ingest.** The first call downloads the embedding model. Subsequent runs use the cache. If you keep hitting the download, check that `~/.cache/huggingface/` is writable.

**"store was indexed with X but the current embedder is Y."** Your embedder changed. Run `devteam memory reindex` to re-embed with the new model. Vectors from different models aren't comparable.

**Memory takes too much disk.** Each chunk's embedding is ~1.5KB (384 floats × 4 bytes + JSON overhead). A project with 1000 chunks is ~1.5MB. If that's too much, switch to the sqlite-vec backend (when available) or `devteam memory clear` after particularly large runs.

## Reference

- Source: `core/memory/{index,embed,chunker,store}.js`
- Tests: `tests/memory.test.js` (run with `DEVTEAM_EMBEDDING_PROVIDER=stub` for CI speed)
- BACKLOG entry: [D7](BACKLOG.md#g--innovation-bets)
- Related decisions in [ADR](adr/) when they land.
