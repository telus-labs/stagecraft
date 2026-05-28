# 07 — Performance & reliability

> Phase 2.2 output. Read `01-architecture.md` and `02-git-history.md` first. Focus on highest-churn components and components with the most external integrations.

## Summary

One paragraph: how robust is this codebase under load and failure? Where are the most likely production issues?

## Findings

### Resource lifecycle

Connection / client reuse, leaks, missing cleanup.

#### Finding P1: <short title>

- **Where:** `path/to/file.ext:NN`
- **Issue:** <e.g. database connection opened per request, never closed>
- **Impact:** <connection pool exhaustion / memory leak / file-descriptor exhaustion / …>
- **Suggested fix:** <pooling / `using` / context manager / cleanup hook / …>

### Concurrency

Race conditions, blocking calls in async paths, unprotected shared state.

…

### Error handling quality

Swallowed exceptions, catch-alls, leaked internals in error messages, missing retries.

…

### Timeout discipline

Missing timeouts on external calls. Default timeouts that are too generous.

| Site | Has timeout? | Value | Notes |
|---|---|---|---|
| | yes / no | | |

### Scaling concerns

In-memory state that doesn't survive restart, unbounded queues, O(n²) algorithms on user input, missing pagination.

…

### Observability

Structured logging? Metrics? Tracing? Health checks?

| Signal | Present? | Quality |
|---|---|---|
| Structured logs | yes / no | <good / partial / noisy> |
| Metrics | yes / no | <coverage of critical paths> |
| Tracing | yes / no | <propagation works?> |
| Health checks | yes / no | </health endpoint? readiness vs. liveness?> |

### Graceful degradation

What happens when a dependency is down? Circuit breakers? Fallback paths? Cached responses?

- <dependency> — <behavior when it fails>

## Project-Specific

> *(Appended by extensions if applicable.)*
