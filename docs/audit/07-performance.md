# 07 — Performance and reliability

## Summary

LLM/host execution still dominates wall-clock time, and core orchestration uses bounded
stage/role collections. Timeout and process-tree handling have improved materially.
Two UI/headless lifecycle details are unbounded: transcript capture grows in memory
for the whole dispatch, and dashboard heartbeat intervals survive server closure.

## Findings

### R-1 — Headless transcripts buffer without a size ceiling

- **Impact:** medium.
- **Location:** `core/adapters/headless.js:87-133`.
- **Issue:** stdout and stderr are concatenated into one JavaScript string until the
  child exits (default timeout ten minutes), then synchronously written. A noisy or
  looping host can consume memory proportional to output and repeatedly copy the
  growing string.
- **Suggested fix:** stream to a file with a bounded tail for in-memory/status use, or
  enforce a configurable byte ceiling with a truncation marker. Preserve synchronous
  durability by awaiting stream close before resolving.
- **verified_by:** direct inspection of `logBuffer += ...` and the single
  `writeFileSync()` at close; no max-byte check exists. Timeout bounds duration, not
  output volume.
- **Confidence:** HIGH.

### R-2 — UI heartbeat interval is not cleared by `close()`

- **Impact:** low.
- **Location:** `core/ui/server.js:224-239`.
- **Issue:** every `startServer()` creates an unreferenced 15-second interval. The
  returned `close()` stops the watcher and clients but does not clear the interval.
  Repeated programmatic starts retain broker/server closures for process lifetime.
- **Suggested fix:** retain the timer handle and clear it in `close()` and on listen
  failure.
- **verified_by:** direct lifecycle inspection: `setInterval(...).unref()` return value
  is discarded; `close()` calls only `stopWatch()`, `broker.closeAll()`, and
  `server.close()`.
- **Confidence:** HIGH.

## Reliability strengths

- Host and verification child processes have ten-minute defaults and use a shared
  cross-platform graceful/forced termination helper.
- Gate reads are size-limited and failures generally degrade to explicit halt states.
- Autonomous runs use lock files, resumable state, append-only events, bounded retry
  counts, consequence ceilings, and a maximum-iteration guard.
- OpenTelemetry remains optional and no-ops without configuration.
- Router/stage operations are over small bounded registries; no user-scale O(n²)
  algorithm was found in the orchestration path.

## Parked observations

- Synchronous filesystem calls are acceptable for the single-process CLI model. They
  should be reconsidered only if Stagecraft becomes a long-lived multi-run service.
- Coverage and full-suite runtime should be trended in CI artifacts rather than
  inferred from stale comments; there is no evidence of a user-facing bottleneck yet.

## Project-specific extensions

No `docs/audit-extensions.md` file is present.
