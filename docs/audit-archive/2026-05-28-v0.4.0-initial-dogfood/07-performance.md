# 07 — Performance & reliability

## Summary

Stagecraft is an orchestrator, not a hot-path service. The orchestrator itself runs once per CLI invocation, walks the gate files, dispatches one or more LLM calls (which dominate wall-clock), and exits. Performance characteristics are dominated by (a) the LLM call latency, (b) embedding generation if the memory subsystem is in use, and (c) `fs.watch` in the UI.

Findings are mostly positive. The only concrete reliability concern is that the OTel batch processor can leak slow shutdowns on `process.exit()` paths that don't await it.

## Findings

### Resource lifecycle

#### Finding P1: OTel batch processor may not flush on hard `process.exit()`

- **Where:** `core/observability.js:55-64`. Handlers wired to `beforeExit`, `SIGINT`, `SIGTERM` await `provider.shutdown()` then exit.
- **Issue:** `process.exit()` from other modules (e.g. the validator subprocess, the CLI on stoplist match, hooks) bypasses these handlers — `process.exit()` doesn't fire `beforeExit`. Any spans started in those paths may not flush before the process dies.
- **Practical impact:** the orchestrator's main flow uses `beforeExit` via natural process termination, so spans flush correctly. The hooks (validator, secret-scan) don't initialize OTel — they're stateless subprocesses. So the leak only matters if a future module starts OTel spans then `process.exit()`s.
- **Severity:** low (latent — affects future, not present).
- **Confidence:** HIGH.
- **Suggested action:** document in `docs/observability.md` that `process.exit()` from new modules should call `provider.shutdown()` first. Not urgent.

#### Finding P2: UI server's `setInterval` heartbeat is `.unref()`'d but the broker holds client sockets

- **Where:** `core/ui/server.js:175` (`setInterval(...).unref()`).
- **Issue:** the heartbeat is `.unref()`'d (won't keep the event loop alive) but `broker.addClient(res)` (line 163) holds open HTTP responses for SSE. If clients don't disconnect cleanly, the server can't exit on its own — needs explicit `close()`.
- **Practical impact:** none in current usage (`devteam ui` is interactive; users Ctrl-C). But the `close()` method (returned in `startServer`'s resolve value) doesn't actively close client sockets — it only closes the server. SSE-connected clients may keep the process running.
- **Severity:** low (interactive tool, not a service).
- **Confidence:** MEDIUM (would need a load test to confirm).
- **Suggested fix:** `broker.closeAll()` IS called in the close path (line 188 — verified). The `setInterval`'s `.unref()` is correct. **Re-verified: this is actually fine.** Striking the finding.

### Concurrency

#### Finding P3: `approval-derivation.js` uses lockfile-style mutex for concurrent writes

- **Where:** `core/hooks/approval-derivation.js` (lock acquisition path).
- **Pattern:** when multiple reviewers write their review files in parallel (a realistic Stage 5 scenario), the hook fires per-write. The hook uses lockfile semantics to serialize gate writes.
- **Coverage:** the lock acquisition is tested in `tests/approval-derivation.test.js`. **Real concurrent contention is not tested** — see Finding T4 in the test-health doc.
- **Severity:** low (works in practice; concurrent contention test would close the loop).
- **Confidence:** MEDIUM (the contention path is exercised in unit tests but not under real concurrency).

#### Finding P4: memory ingest serializes embedder calls

- **Where:** `core/memory/index.js`'s ingest loop.
- **Pattern:** chunks are embedded sequentially. On a CPU running the local BGE-small model, this is ~50-200ms/chunk → 5-20 seconds for a 100-chunk project.
- **Mitigation in place:** small projects don't hit this; the embedder is CPU-bound so parallelism wouldn't help on a single core. Multi-core machines could batch but the model's batch API isn't currently used.
- **Severity:** low (acceptable for current scale).
- **Confidence:** HIGH.
- **Suggested action:** if memory becomes a daily-use feature on large projects, switch to the embedder's batch API. BACKLOG candidate, not urgent.

### Error handling quality

Audit clean. Spot-check of error paths:

- **`runHeadless()`** (`core/adapters/headless.js`): explicitly surfaces spawn-ENOENT with a helpful message ("Is `<bin>` installed and on PATH?"). Swallows EPIPE on stdin (correct — child may close stdin early). Tested in `tests/headless.test.js`.
- **`loadGate()`** (`core/gates/validator.js`): catches `JSON.parse` errors and reports them as malformed gates (exit 1). Catches `EACCES` / `EPERM` / `ENOTDIR` / `EISDIR` / `EROFS` and halts. Catches generic errors and downgrades to a WARN (so a validator bug doesn't kill the user's session). Mature.
- **CLI**: every subcommand exits non-zero on user errors with a clear `console.error()` message first.

No swallowed exceptions, no catch-all-rethrow patterns. No leaked internals in error messages.

### Timeout discipline

#### Finding P5: subprocess spawns have no timeout

- **Where:** every `spawn` / `spawnSync` call site (11 locations).
- **Pattern:** none specify a `timeout` option. The orchestrator awaits the child process indefinitely.
- **Practical impact:**
  - `runHeadless`: a hung `claude --print` would hang the pipeline indefinitely. Users can Ctrl-C, but unattended (CI) usage would block.
  - validator subprocess: short-lived, finishes within ms. No real concern.
  - test infrastructure: tests can fail by timeout (Node's test runner does timeout tests, ~30s default).
- **Severity:** medium for headless orchestration; low for everything else.
- **Confidence:** HIGH.
- **Suggested fix:** add a `--timeout-ms` flag to `devteam stage --headless` (default ~10 minutes) that propagates to `spawn`'s `timeout` option. Documented escape: `--timeout-ms 0` for "no timeout." BACKLOG candidate.

### Scaling concerns

#### Finding P6: pipeline state is read from disk every time

- **Where:** every `devteam next`, `devteam summary`, every UI request loads `pipeline/gates/*.json` from disk.
- **Pattern:** no caching; `fs.readdirSync` + `JSON.parse` per gate.
- **Practical impact:** at current scale (≤20 gates per pipeline run), trivial — entire load is sub-millisecond. The model invocations dwarf this.
- **Severity:** n/a at current scale.
- **Confidence:** HIGH.
- **Suggested action:** none. Don't optimize until there's a measurable problem.

#### Finding P7: memory store is in-memory cosine search

- **Where:** `core/memory/store.js`.
- **Pattern:** all chunks loaded into memory, cosine similarity computed for every query.
- **Practical impact:** at the documented scale (≤1k chunks per project), single-digit ms query time. Past that, JSON load + linear scan becomes noticeable.
- **Severity:** n/a at current scale.
- **Confidence:** HIGH.
- **Suggested action:** the `MemoryStore` interface is ready for a sqlite-vec backend (documented in `docs/memory.md`). Implement when a project hits 5k+ chunks.

### Observability

Audit clean. OpenTelemetry tracing is wired across the orchestrator with the right span hierarchy:
- `pipeline.stage` (root) → `pipeline.workstream` (per workstream) → `adapter.renderStagePrompt` / `adapter.invoke`.
- `pipeline.merge`, `pipeline.next`, `pipeline.stage.headless` as standalone roots.
- Attributes include stage, workstream id, role, host, status.

Opt-in via standard `OTEL_EXPORTER_OTLP_ENDPOINT`. No-op when unset (zero overhead). Hard-disable via `DEVTEAM_OTEL_DISABLE=1`. Tests use `InMemorySpanExporter`.

`scripts/dashboard.js` aggregates gates into per-stage / per-host / per-role pass rates — useful for spotting where the pipeline is brittle. Not in OTel; reads gate files directly.

### Graceful degradation

Audit clean. Major degradation paths:

- **OTel collector down** → tracing fails to connect (logged to stderr), orchestrator continues normally.
- **`claude` CLI not on PATH** → `--headless` fails with a clear error; user-driven mode unaffected.
- **Hugging Face CDN unreachable** → first ingest fails with a clear error; cached model works offline thereafter. `DEVTEAM_EMBEDDING_PROVIDER=stub` bypasses entirely.
- **Hook crashes** → `core/gates/validator.js` catches unknown errors and exits 0 (downgrades to WARN). Pipeline doesn't halt on a hook bug.

## Project-Specific

*(No `docs/audit-extensions.md`.)*
