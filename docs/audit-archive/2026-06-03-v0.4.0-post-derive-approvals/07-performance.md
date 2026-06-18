# 07 — Performance and reliability

## Summary

Performance is **healthy across the board**. CLI cold-start is ~30-60 ms; the test suite runs in ~3 seconds; no async/sync confusion; no unbounded memory growth observed. The architecture is naturally constrained — the orchestrator never holds runtime state, gate files are bounded, and the heaviest operation (the memory embedder) is opt-in and lazy-loaded.

Three contained findings, all low-severity.

## CLI latency

| Command | Cold time |
|---|---|
| `node bin/devteam help` | ~42-60 ms |
| `node bin/devteam stages` | ~42 ms |
| `node bin/devteam doctor --cwd /tmp` | ~43 ms |

These are essentially "Node startup plus a few requires" — Stagecraft itself contributes very little overhead. The dominant cost is Node's module loader resolving the imports in `bin/devteam` lines 17-21 (orchestrator, router, stages, config, guards). Reading the orchestrator module alone is ~42 ms (matching the help-command total), so the help command is bottlenecked entirely on module loading, not on Stagecraft's logic.

### P-1 — Eager imports in `bin/devteam` (LOW, HIGH confidence)

`bin/devteam:17-21` eagerly imports `core/orchestrator.js`, `core/router.js`, `core/pipeline/stages.js`, `core/config.js`, `core/guards/stoplist.js` at module load — regardless of which subcommand the user invoked. Even `devteam help` and `devteam --help` pay the full module-load cost.

| Subcommand | Imports actually needed |
|---|---|
| `help` / `stages` / `hosts` | None of the orchestrator/router |
| `init` | Router (to list hosts) — not orchestrator |
| `stage` | All of them |
| `next` / `summary` / `validate` / `merge` | Orchestrator + config; not stoplist |
| `derive-approvals` / `restart` | None of the orchestrator (spawn the hook / read gates directly) |
| `log` | None of the orchestrator (reads `pipeline/gates/` mtime-sorted) |
| `memory <subcmd>` | None of the orchestrator |
| `ui` | None of the orchestrator (own server) |

**Impact**: minor — Stagecraft is invoked interactively, not in tight loops. 40 ms is invisible to humans. But it would matter in tight CI loops (a `devteam next --json` invoked 50 times in a workflow pays 2 seconds of pointless module loading). The cost will also grow as the orchestrator grows: it's already ~720 LOC and pulls in 6 transitive imports.

**Recommended fix**: lazy-require inside each `cmdX` function. Pattern:
```js
function cmdNext(argv) {
  const { next } = require("../core/orchestrator");
  // ...
}
```
Total impact: bring CLI cold-start for non-pipeline commands down to ~15-20 ms (just Node + bin/devteam itself). Effort: ~30 minutes (mechanical refactor + one test pass). Risk: very low.

### P-2 — Sync I/O in I/O-bound paths (POSITIVE finding — no action)

Stagecraft uses `*Sync` filesystem calls almost everywhere — `readFileSync`, `writeFileSync`, `statSync`, `existsSync`, `readdirSync`. Conventional wisdom says "use async I/O for performance"; here the choice is **deliberate and correct**:

- The orchestrator runs as a one-shot CLI invocation, not a long-running server. There's no event loop with concurrent work to block.
- File operations are small (gate JSON files are < 5KB typical; size-capped at 1MB).
- Hooks run as PreToolUse/PostToolUse subprocess invocations with one job each; sync I/O is the simplest correct shape.
- The `runStageHeadless` flow does use async (it `spawn`s host CLIs and awaits them), but the surrounding gate I/O is sync because it's the cheap part.

The codebase has **one** non-sync I/O path (`core/adapters/headless.js` spawns child processes), which is correct (you need an async path to await the child). No mixed sync/async confusion observed.

## Hot paths

### Approval-derivation hook

`core/hooks/approval-derivation.js` fires on **every** Claude Code `Write` or `Edit` tool call. For non-review-file writes (the common case), it short-circuits at `isReviewFile(filePath) === false` and exits in microseconds — confirmed by reading the function structure. No regex evaluation or filesystem walks happen on the hot non-review path.

For review-file writes, the work is bounded:
1. Read the review file (size-capped at 1 MB).
2. Parse with two simple regexes (`SECTION_HEADER_RE`, `REVIEW_MARKER_RE`).
3. Per-area gate upsert with file lock (retry up to 20× at 30ms delay → max 600ms wait).
4. Atomic rename write.

Test runtime confirms: the approval-derivation end-to-end test takes ~1.1 seconds (largest single test in the suite) — and that's the full upsert cycle including spawn. Per-invocation cost on a real save is much lower (subprocess startup amortized).

### Validator (Stop / SubagentStop hook)

`core/gates/validator.js` is the Stop hook — fires after every agent invocation completes. The validator:
1. Reads `pipeline/gates/*.json` (size-capped, with bounded count — pipeline gates are at most ~30 per run).
2. Validates the most recent gate against its JSON schema.
3. Auto-injects orchestrator + host attribution if missing.
4. Conditionally injects blocker sections (red-team / QA-in-build) into `pipeline/context.md`.
5. Idempotent strip on resolve.

Cost is bounded by gate count and gate size. Both are O(1) per stage.

### Secret-scan (PreToolUse hook)

See finding S-1 in `06-security.md` — the secret-scan hook lacks a size cap, which is both a security and performance concern. Adding `MAX_SCAN_BYTES` closes both.

## Reliability

### EPIPE handling in `bin/devteam:cmdRuling`

A real bug was fixed in commit `f4270f8`: when the spawned host process exits before consuming stdin, the parent's `child.stdin.write()` fired EPIPE which was previously unhandled. The fix (`child.stdin.on("error", () => {})`) swallows the EPIPE. **Positive**: the pattern is the same one used in `core/adapters/headless.js:69`. Both call sites are consistent.

### File locking in approval-derivation

`core/hooks/approval-derivation.js` uses a per-gate lock file (`.stage-05-<area>.lock`) with stale-detection (5-second mtime threshold) and a 20-retry × 30ms backoff loop. This is the right shape for the concurrent-reviewer case — two reviewers saving their files in close succession won't corrupt the per-area gate.

**Atomics.wait** is used for the backoff (line 135): `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_DELAY_MS)`. This is a synchronous busy-wait that blocks the process for the delay duration. For a 30ms × 20 retry max = 600ms total wait worst-case, this is acceptable in a one-shot hook invocation. Worth knowing.

### Headless runner timeout + EPIPE handling

`core/adapters/headless.js` correctly:
- Pipes stdin with EPIPE error handler.
- Implements `ctx.timeoutMs` (default 600,000 / 10 min) with SIGKILL grace.
- Buffers logs in memory and writes via `writeFileSync` on exit (avoids the async stream race the prior implementation hit).
- 13 tests in `tests/headless.test.js` covering spawn ENOENT, exit codes, timeouts, EPIPE swallow, log tee, log disable.

The reliability discipline here is strong.

### P-3 — `Atomics.wait` busy-wait in approval-derivation lock loop (LOW, MEDIUM confidence)

`core/hooks/approval-derivation.js:135`:
```js
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_DELAY_MS);
```

This creates a SharedArrayBuffer + Int32Array on **every** retry iteration just to call `Atomics.wait` for a 30ms blocking sleep. The hook is single-threaded and the SharedArrayBuffer is unused after the wait — it's a CPU-friendly busy-wait emulating `sleep()`. Works correctly but allocates GC pressure (20 retries × 12 bytes = 240 bytes, then collected).

`setTimeout(resolve, LOCK_DELAY_MS)` wrapped in an `await` would require making the hook async; an `executeJavaScript`-style busy spin would be worse; the current pattern is one of the few sync-block-current-thread idioms in Node. **Acceptable as-is.** Flagging because it's an unusual pattern that benefits from a one-line comment ("synchronous sleep — no async loop available in this hook context").

## Memory

### Embedder loading (opt-in, lazy)

`@huggingface/transformers` is required only inside `core/memory/embed.js` `makeLocal()` — not at module top-level. The first call to `devteam memory ingest` downloads ~150 MB of model weights to `~/.cache/huggingface/` and pins them. Subsequent operations are offline. The CLI doesn't pay any cost for `transformers` unless `devteam memory` is invoked.

**Verified**: a fresh `node -e "require('./core/memory/embed')"` takes 44 ms — the require is just the JavaScript module's surface, not the heavy native bindings.

### Test runtime profile

3.1 seconds for 778 tests with `node --test` parallel execution. Slowest 10 tests (subprocess invocations) account for ~5-6 seconds of CPU time combined — but parallelism keeps wall-clock low.

No memory leaks in the test suite (no `--leaks` flag, but the suite runs cleanly without timeouts or RSS growth).

## Reproducibility

Stagecraft tracks reproducibility fields on every gate: `model_version`, `temperature`, `seed`, `system_prompt_hash`, `tools_hash`. The `devteam reproduce` and `devteam replay` subcommands compare current rendering against the recorded hashes to detect drift. This is the right shape for an AI orchestrator — non-determinism is the rule, so the contract is "record enough to know if the inputs changed."

The hashing logic lives in `core/reproducibility.js`. **No findings here** — covered by `tests/reproducibility.test.js` (286 LOC, multiple suites).

## Recommendation summary

| # | Finding | Severity | Effort | Priority |
|---|---|---|---|---|
| P-1 | Lazy-require inside `cmdX` functions in `bin/devteam` | LOW | S (30 min) | P2 |
| P-3 | Comment on `Atomics.wait` busy-sleep pattern | LOW | XS (1 line) | P3 |
| (S-1) | Add `MAX_SCAN_BYTES` to `secret-scan.js` (also perf) | MEDIUM | XS | P1 — covered in 06-security.md |

Net: performance is fine for the use case. The lazy-import refactor (P-1) is the only non-trivial win and it's a 30-minute mechanical change. Nothing here is "fix urgently."
