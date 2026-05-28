# 04 — Test health

## Summary

The test suite is one of Stagecraft's strongest assets: **378 tests across 25 files, ~1.5s wall-clock, fully offline, currently 100% passing**. CI runs across Node 20 / 22 / 24. Coverage is broad and shape-driven (contract / schema / config / behavior tests); the suite would catch most regressions in the model-agnostic contract.

Two real gaps: a few helper-script modules with no direct test coverage, and no automated check that `scripts/consistency.js` itself stays green at test time. Both are flagged as roadmap items.

## Test infrastructure

| Item | Value |
|---|---|
| Runner | `node --test` (built-in, Node 20+) |
| Test command | `npm test` |
| Currently passing? | yes — 378/378 |
| CI runs tests? | yes — `.github/workflows/test.yml` on Node 20, 22, 24 |
| CI also runs consistency? | yes — `npm run consistency` (added during CI fix) |
| Coverage tool wired? | no — `node --experimental-test-coverage` is mentioned in docs but not in `npm test` |
| Total wall-clock | ~1.5s on a modern machine |

## Coverage map

By component, the test file(s) that exercise it:

| Component | Test count | Test types | Notes |
|---|---|---|---|
| Orchestrator (`runStage`, `mergeWorkstreamGates`, `next`, `summary`) | ~30 | unit + integration | `tests/orchestrator.test.js`, `tests/next.test.js`, `tests/fanout.test.js` |
| Gate validator | 9 | subprocess integration | `tests/gate-validator.test.js` |
| Router | ~10 | unit | `tests/router.test.js` |
| Config loader | ~10 | unit | `tests/config.test.js` |
| Adapter contract | per-host | structural | `tests/adapter-contract.test.js` |
| Install roundtrip | per-host | integration (spawnSync) | `tests/install-roundtrip.test.js` |
| Approval derivation hook | 16 | unit + integration | `tests/approval-derivation.test.js` |
| Stoplist guard | small | unit | `tests/stoplist.test.js` |
| Security heuristic | small | unit | `tests/security-heuristic.test.js` |
| Stage tracks | small | unit | `tests/tracks.test.js` |
| Stage schemas | per-schema | structural | `tests/schemas.test.js` |
| CLI subcommands | 19 | spawnSync end-to-end | `tests/cli.test.js` |
| Observability spans | 9 | with InMemorySpanExporter | `tests/observability.test.js` |
| Secret-scan hook | 32 | unit + stdin integration | `tests/secret-scan.test.js` |
| Multi-model fanout | 16 | unit + integration | `tests/fanout.test.js` |
| Dashboard script | 14 | unit | `tests/dashboard.test.js` |
| PR-publish script | 12 | unit | `tests/pr-publish.test.js` |
| UI server | 18 | end-to-end (fetch via HTTP) | `tests/ui.test.js` |
| Memory (chunker, embed, store, ingest, query) | 22 | unit + integration (stub embedder) | `tests/memory.test.js` |
| Budget script | 7 | unit + subprocess | `tests/budget.test.js` |
| Release script | 7 | subprocess against fixture | `tests/release.test.js` |
| Headless invoke helper | 8 | unit + spawn stubs | `tests/headless.test.js` |
| Audit feature | 9 | structural | `tests/audit.test.js` (new) |
| Cross-artifact contract | shape-test | structural | `tests/contract.test.js` |

That's substantial breadth. The notable weak spots are listed below.

## Untested critical paths

### Finding T1: `scripts/visualize.js` has no direct tests

- **What it does:** renders the stage graph as DOT / Mermaid output.
- **Risk:** low — it's a small pure-function script (~ low complexity); failures are visually obvious.
- **Suggested action:** smoke test via `tests/visualize.test.js` that runs the script and checks output starts with `digraph` / `graph LR`. Half-page test file.

### Finding T2: `scripts/pr-pack.js` has no direct tests

- **What it does:** bundles PR summary data from `pipeline/gates/` and `pipeline/pr-*.md` into a single markdown for posting.
- **Risk:** medium — used indirectly via `pr-publish.js` which IS tested, but `pr-pack` has its own helpers (markdown rendering, gate→summary mapping) that aren't directly exercised.
- **Suggested action:** unit-test the pure helpers (markdown formatters, gate aggregators) in `tests/pr-pack.test.js`.

### Finding T3: `scripts/consistency.js` is run by CI but not by `npm test`

- **What it does:** 185 cross-artifact structural checks.
- **Risk:** medium — pre-commit CI catches drift, but `npm test` alone doesn't. A developer running `npm test` locally and seeing green could land a contract-breaking change.
- **Suggested action:** add a meta-test `tests/consistency-meta.test.js` that runs `node scripts/consistency.js` as a subprocess and asserts exit 0. Five lines. The cost is ~50ms added to the suite (consistency runs fast).

### Finding T4: no concurrency test on `approval-derivation`

- **What it does:** Stage 5 PostToolUse hook that derives gates from review markdown files. Designed for concurrent writes (multiple reviewers writing simultaneously).
- **Risk:** medium — the lock-acquisition path exists (file lock via lockfile semantics) but isn't exercised under contention.
- **Suggested action:** `tests/concurrency.test.js` that spawns N processes writing different review files in parallel, asserts all N corresponding area gates land correctly. Listed in `docs/TESTING.md` tier-3 already.

## Test quality issues

Audit mostly clean. Notable observations:

- **No empty assertions** — all `assert.equal` / `assert.match` calls test meaningful values.
- **No implementation coupling via mocks** — Stagecraft has no mocking framework. Where stubs are needed (embedder, host CLI), they're real-but-deterministic substitutes (`DEVTEAM_EMBEDDING_PROVIDER=stub`, `DEVTEAM_HEADLESS_COMMAND=true|false`).
- **No external service calls in tests** — all I/O is local. CI runs offline.
- **Edge cases:** memory test covers embedder mismatch warning + opt-out marker; gate-validator covers bypassed escalation + retry integrity. Reasonable depth.
- **Order dependencies:** none observed. Each test creates its own tempdir and cleans up.

## Test infrastructure quality

- Uses `node:test` built-in — zero external dep, fast, no version-skew risk. ✅
- Helper module `tests/_helpers.js` centralizes tempdir + gate seeding + CLI invocation — 80% of setup boilerplate. ✅
- Subprocess-based testing for `process.exit()`-heavy code (validator, CLI, scripts/release) — correct pattern for the constraint. ✅
- Watching tests landed during the doc uplift: every new feature commit added or modified tests. The recent audit feature added `tests/audit.test.js` with 9 tests. ✅

## What's well-tested

Positive examples worth replicating:

- **`tests/fanout.test.js`** — the multi-model adversarial review feature is opt-in and complex (N×M dispatch, 3-segment gate paths, host-aware approval derivation). The test file covers it end-to-end with 16 tests. Sets the bar for "add a feature, write the full test surface."
- **`tests/contract.test.js`** — verifies cross-artifact consistency (every stage in `stages.js` has a schema; every role in `stages.js` has a brief). Catches the broadest class of regressions for the lowest setup cost.
- **`tests/ui.test.js`** — covers a tricky surface (HTTP server, SSE, fs.watch) including security checks (path-traversal, non-loopback bind guard) with 18 tests.

## Project-Specific

*(No `docs/audit-extensions.md` is present, so no project-specific test checks run.)*
