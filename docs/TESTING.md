# Testing

**Current state (v0.2.0):** **362 tests across 24 files, 81 suites, ~1.5s wall-clock**. Runs offline, no external services. `npm test` is green on Node 20 / 22 / 24 in CI.

## Running the suite

```bash
npm test                                     # all tests
node --test tests/orchestrator.test.js       # one file
node --test --test-name-pattern='ESCALATE'   # one pattern across the suite
```

Coverage report (experimental):

```bash
node --experimental-test-coverage --test tests/*.test.js
```

## Test file inventory

| File | What it covers |
|---|---|
| `contract.test.js` | Cross-artifact consistency — every stage in `stages.js` has a matching schema, every role has a matching brief, every schema's fields align with `rules/gates.md`. |
| `gate-validator.test.js` | Validator exit codes (PASS=0, FAIL=2, ESCALATE=3, malformed=1), bypassed-escalation detection, retry-protocol enforcement, malformed reinforced-lines surfacing. |
| `orchestrator.test.js` | `runStage` decomposition, `buildDescriptor` with `roleWrites` + `subagent` overrides, `mergeWorkstreamGates` aggregation (ESCALATE > FAIL > WARN > PASS), `summary` rendering. |
| `next.test.js` | All `next()` scenarios: empty, run-stage, continue-stage, merge, fix-and-retry, resolve-escalation, pipeline-complete, conditional skip, track filter, `--json`. |
| `router.test.js` | Resolution precedence (`stages > roles > default_host`), missing-adapter error path, multi-host install. |
| `config.test.js` | YAML loader: missing → defaults, bad YAML → clear error, routing fields parsed; `writeConfigIfAbsent` idempotency. |
| `adapter-contract.test.js` | Every adapter under `hosts/` exports the required surface (`capabilities`, `install`, `renderStagePrompt`, `status`, `uninstall`) and parses `capabilities.json`. |
| `install-roundtrip.test.js` | Per-adapter install → status (ok) → uninstall → status (missing). Install idempotency. |
| `approval-derivation.test.js` | Stage 5 PostToolUse hook: section + `REVIEW:` marker → verdict, upserts gate, PASS only with approvals ≥ required AND no changes_requested. Lock acquisition under contention. |
| `stoplist.test.js` | Phrase matching across the guarded tracks; bypass requires explicit flag. |
| `security-heuristic.test.js` | Stage 4b trigger paths fire on sensitive files; safe paths don't false-positive. |
| `tracks.test.js` | `orderedStageNamesForTrack(track)` returns the right list per track; unknown → throws; nano excludes most stages; full has all 13. |
| `schemas.test.js` | Each `stage-NN.schema.json` is a valid JSON Schema 2020-12; example gates in `rules/gates.md` validate against their declared schema. |
| `cli.test.js` | `bin/devteam` exit codes for known/unknown commands; `--json` outputs valid JSON; `--cwd` honored uniformly. |
| `observability.test.js` | OpenTelemetry spans emitted at every instrumented call site, with expected attributes, via `InMemorySpanExporter`. |
| `secret-scan.test.js` | PreToolUse hook: pattern detection, false-positive guards, magic-comment override, path allowlist, end-to-end stdin parsing, snippet redaction. |
| `fanout.test.js` | `computeDispatchPlan` correctness with/without fanout; end-to-end `runStage` producing N×M workstream prompts; `mergeWorkstreamGates` aggregation across all fanout gates. |
| `dashboard.test.js` | Gate→row expansion (merged stage gates split into workstream rows); per-host / per-role attribution; multi-project rollup; time-window filter; ASCII chart + JSON output. |
| `pr-publish.test.js` | Gate→check-run translation: PASS→success / WARN→neutral / FAIL+ESCALATE→failure; blockers + warnings + workstreams in summary; auto-detect repo + PR; `--dry-run`. |
| `ui.test.js` | Pure helpers, route correctness, path-traversal rejection, SSE plumbing. |
| `memory.test.js` | Ingest, query, stats, clear, reindex; chunker by level-2 heading; `stagecraft-no-memory` opt-out; embedder mismatch warning; stub embedder for offline CI. |
| `budget.test.js` | `scripts/budget.js`: `parseBudgetMd` round-trip; config parsing; init/update/check sequence; contract-F gate on escalation. |
| `release.test.js` | `scripts/release.js notes` extraction: `[Unreleased]` default, middle section, last section (no trailing header to anchor to), missing-version error, blank-line preservation, trailing `---` stripping. |
| `headless.test.js` | `core/adapters/headless.js`: command resolution, env override, missing-command rejection, exit-code propagation, spawn-ENOENT message, gatePath detection, EPIPE swallowing, whitespace-split. |

## Conventions

**Fixtures.** `tests/_helpers.js` exports `makeTargetProject(opts)` and `seedGate(cwd, name, gate)`. Use these instead of inlining tempdir setup.

**Offline.** Tests never touch a network. `DEVTEAM_EMBEDDING_PROVIDER=stub` is the default in `tests/memory.test.js`; `DEVTEAM_HEADLESS_COMMAND=true|false|node` is used to stub host CLIs.

**Subprocess vs in-process.** Modules that `process.exit()` on every branch (the gate validator, the budget script) get tested via `spawnSync`. Pure-logic exports get tested in-process.

**No LLM evals.** Whether a model produces good code at a given stage is not in scope here. That's a different test suite that hasn't been built.

## CI

`.github/workflows/test.yml` runs on every push and PR against `main`:

- Node 20, 22, 24 (matrix; `fail-fast: false`)
- `npm ci` → `npm test` → `npm run consistency` → `./bin/devteam help` → `./bin/devteam init && ./bin/devteam doctor`

Node 18 was dropped in v0.2.0 — it reached EOL in April 2025 and `@huggingface/transformers ^4.x` requires Node ≥20. The matrix tracks current LTS (20, 22) plus latest (24).

## What's NOT tested (deliberately out of scope)

- **LLM outputs.** Anything that depends on calling Anthropic / OpenAI / Google APIs. CI must run with zero external dependencies.
- **Real `claude --print` / `codex exec` / `gemini`.** Hosts may not be installed on the CI runner; the tests stub via `DEVTEAM_HEADLESS_COMMAND`.
- **Subagent quality.** Whether the `implement` skill produces good code is an eval question, not a unit-test question.
- **Doc prose.** No tests grep prose for wording; brittle.

## Open gaps (tier-3 candidates)

These are nice-to-haves not currently in the suite. If you hit a bug in one of these areas, add the test:

- **`tests/conditionalOn.test.js`** — verifies stage-04b security review fires when the heuristic matches, skips when it doesn't. Currently exercised only indirectly via `next.test.js`.
- **`tests/multi-host.test.js`** — end-to-end with two adapters: install both, run a build with split routing, merge, verify per-workstream gates carry the right host field. The pieces are covered by `router.test.js` + `fanout.test.js` + `install-roundtrip.test.js`, but no single test threads the whole flow.
- **`tests/stage-numbering.test.js`** — grep-based assertion that every role brief's mentioned stage matches a real stage name in `stages.js`. The contract test catches most of this; an explicit numbering check would catch off-by-one bugs at the prose layer.
- **`tests/concurrency.test.js`** — approval-derivation lock under contention (spawn N processes writing to the same area). The lock is exercised by `approval-derivation.test.js` but not under real concurrency.
- **`tests/consistency-meta.test.js`** — meta-test that runs `scripts/consistency.js` as a subprocess and asserts exit 0. Currently the consistency check runs in CI but isn't gated by `npm test`.

## Historical notes

The original strategy doc (pre-v0.1.0) framed tier 1 / tier 2 / tier 3 as work to come. Tier 1 and 2 are done. The remaining gaps above are the surviving tier-3 items.
