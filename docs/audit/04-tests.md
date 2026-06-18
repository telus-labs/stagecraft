# 04 — Test health

## Summary

Stagecraft has a broad `node:test` suite: 91 files, about 1,800 explicit declarations
that expand to 1,941 runtime tests, no committed skips, and strong lockstep coverage around gates,
routing, orchestration, and autonomous retries. The repository CI is green on Node
20, 22, and 24. The main gap is platform evidence: recently shipped Windows behavior
is simulated on Ubuntu but never executed by a Windows runner.

The final CI-equivalent run passed 1,941/1,941 tests in 66.4 seconds. The audit's first
local run was not a valid product signal: the sandbox
denied local socket binds and the deliberately incomplete new audit directory made
the consistency regression tests fail. A clean final run is required after all audit
files exist.

## Coverage map

| Component | Test surface | Types | Notes |
|---|---:|---|---|
| Gates, schemas, validation, convergence | 15+ files | unit, contract, integration | Mechanical overrides and retry semantics are heavily exercised |
| Orchestrator and stage scheduling | 32 files reference orchestrator | unit, integration | `next`, merge, folding, routing, and bounded paths covered |
| Autonomous driver | 13 files reference driver | unit, integration | Run, repair, restart, scope, retry, liveness, and target ownership |
| CLI commands | 30+ command-focused files | CLI integration | Temp projects and subprocess execution are the dominant pattern |
| Adapters and install rendering | 10+ files | contract, integration | Idempotence and cross-host equivalence covered |
| UI server/client | 3 server-focused files | integration, structural | HTTP routes covered; browser DOM security is not |
| Memory and analytics | 8+ files | unit, integration | Stub/local embedding paths and aggregation covered |
| Consistency/docs generators | 6+ files | meta, fixture integration | Real-repo regression guards plus isolated violations |

The recorded informational baseline is 85.43% lines, 76.02% branches, and 82.42%
functions (`.github/coverage-baseline.json`). CI emits coverage artifacts but does not
enforce regression thresholds.

## Findings

### T-1 — Native Windows behavior has no native Windows CI runner

- **Critical path:** command parsing, PATH probing, timeout termination, and fix-step
  cleanup on Windows.
- **Gap:** `.github/workflows/test.yml` runs only `ubuntu-latest` across three Node
  versions. Tests inject `win32` behavior and mock commands, but no job exercises
  PowerShell/cmd quoting, PATHEXT lookup, or process-tree termination on Windows.
- **Risk:** the backlog and feature docs can move from “POSIX-only” to supported only
  after the OS boundary is proven, not merely simulated.
- **Suggested fix:** add one `windows-latest` smoke lane on Node 22 for command-line,
  doctor, init, process-kill, and CLI loading; keep the full version matrix on Ubuntu.
- **verified_by:** direct inspection of `.github/workflows/test.yml` (`runs-on:
  ubuntu-latest` only), Windows branches in `core/command-line.js`,
  `core/process-kill.js`, and `core/cli/commands/doctor.js`, and their platform-injected
  tests. Merged commits `f2f398a`, `b2c4a7e`, `c78a7d0` confirm the feature recently
  changed.
- **Confidence:** HIGH.

### T-2 — UI rendering has no browser-level security regression test

- **Critical path:** rendering model-authored gate strings into the local dashboard.
- **Gap:** server route tests verify transport and traversal rejection, while client
  tests do not execute the DOM with hostile gate values. `escHtml()` is tested only
  indirectly for fix-step commands and is not applied throughout gate renderers.
- **Risk:** a future or existing unsafe interpolation can persist unnoticed despite
  server tests passing.
- **Suggested fix:** pair the security fix in S-1 with a small DOM/browser test that
  renders `<img onerror=...>` and asserts it remains text.
- **verified_by:** `rg 'escHtml' core/ui/static/app.js` returns one definition and only
  three fix-step uses; `tests/ui.test.js` and the broader test scan contain no XSS or
  sanitization case.
- **Confidence:** HIGH.

## Test quality

- No empty test bodies, `.skip()`, or `.todo()` declarations were found.
- Temp-directory integration tests isolate filesystem state well.
- Injected platform/process helpers make difficult failure paths deterministic, but
  the Windows case demonstrates where simulation should be complemented by one real
  environment.
- The coverage baseline is useful evidence but remains report-only. Keep it parked
  until at least three comparable CI snapshots exist; a threshold chosen from one
  snapshot would be policy theater.

## What's well-tested

- `tests/run.test.js` and the focused repair/convergence suites lock down autonomous
  halt behavior rather than only happy paths.
- `tests/consistency-meta.test.js` tests the checker itself with both live-repository
  and fixture evidence.
- Adapter contract tests protect host-neutral behavior while allowing host-specific
  rendering.

## Project-specific extensions

No `docs/audit-extensions.md` file is present.
