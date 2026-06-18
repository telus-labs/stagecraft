# 04 — Test health

## Summary

Test health is **strong and improving**. 778 tests across 123 suites all passing, 0 skipped, 0 todo. Suite runs in ~3.1 seconds wall-clock locally. Since the prior audit (378 tests on 2026-05-28), the suite has grown by **400 tests (+106%)** — exactly tracking the feature additions (auto-fold, orchestrator-stamped verify, derive-approvals, ruling, restart, log, render-helpers, fanout, spec verify, memory, etc.).

The "tests in lockstep with features" convention from `AGENTS.md` is being honored: every PR that added a new CLI subcommand or contract change shipped with a corresponding test file. No test debt has accumulated.

## Test inventory

| Metric | Value |
|---|---|
| Test files | 49 |
| Total tests | 778 |
| Suites | 123 |
| Pass | 778 (100%) |
| Fail | 0 |
| Skipped | 0 |
| TODO | 0 |
| Cancelled | 0 |
| Wall-clock (local, Apple Silicon) | ~3.1 seconds |
| Lines of test code | 8,778 |
| Avg test-LOC per test-file | ~179 |
| Largest test file | `tests/spec-g2.test.js` (530 LOC) |

## Coverage shape

The suite is **dominated by integration / behavioural tests** (spawning subprocesses, building tmp directories, exercising file-on-disk contracts) rather than pure unit tests. Examples of the heavy patterns:

- `tests/adapter-contract.test.js` (upgraded in the recent cycle from 24 existence-of-method assertions to **56 behavioural assertions** — every adapter is now exercised against the contract: `renderStagePrompt` must return non-empty string containing workstreamId; `install` must return documented `{written, skipped}` shape; `status` must report `ok:false` on a clean dir; round-trip to `ok:true`; `uninstall` actually deletes; idempotent install). This is the **highest-leverage test in the codebase** — it pins the host-adapter contract for all 4 hosts simultaneously.
- `tests/pipeline-e2e.test.js` — end-to-end pipeline walks across multiple stages.
- `tests/install-roundtrip.test.js` — full `devteam init` → `doctor` → `uninstall` cycle for each adapter.
- `tests/derive-approvals.test.js`, `tests/auto-fold.test.js`, `tests/headless.test.js`, `tests/restart.test.js`, `tests/log.test.js` — each covers a single feature with multiple scenarios (single-file + no-arg + error paths + JSON output).

## Coverage gaps

### T-1 — `core/adapters/base-install.js` has no direct test (LOW, HIGH confidence)

Of the 29 core JS files, exactly one has no direct test reference: `core/adapters/base-install.js`. The file provides shared install helpers (mkdir, copy, idempotent semantics) used by all four host adapters. It's covered **indirectly** via `tests/install-roundtrip.test.js` and `tests/adapter-contract.test.js` — every adapter's `install()` goes through it — so a regression would be caught, just one level removed.

**Recommended fix**: not urgent. If a future refactor splits the helpers further or introduces edge cases (e.g., symlink handling), a unit test would prevent flaky regressions. For now, the indirect coverage is sufficient.

### T-2 — Cross-host equivalence not pinned (MEDIUM, MEDIUM confidence)

The `renderStagePrompt` de-duplication (commit `38ce2a0`) moved gate-footer rendering into `core/adapters/render-helpers.js`. Three adapters (claude-code, codex, gemini-cli) now share the footer code. The `adapter-contract.test.js` verifies each adapter individually returns a valid prompt; it does **not** verify that the three sharing adapters produce *equivalent* prompts when given the same descriptor (modulo the host-specific header).

**Risk**: a future change to one adapter's header rendering could silently diverge — the contract test wouldn't catch it. The reproducibility-hash logic (used in `devteam reproduce` / `devteam replay`) compares hashes to a known baseline; if the per-host headers drift, replay across hosts becomes inconsistent.

**Recommended fix**: add a cross-host equivalence test to `adapter-contract.test.js` — for a fixed descriptor, compute each adapter's render output, then verify the shared-footer content is byte-identical across (claude-code, codex, gemini-cli). Probably ~15 lines. Generic is exempt (different render path).

### T-3 — Orchestrator-stamped verify fall-through paths (MEDIUM, MEDIUM confidence)

`core/verify/runner.js` resolves the lint and test commands via fall-through: `.devteam/config.yml` `pipeline.verify.{lint, test}_command` → `package.json` scripts → skip-with-reason. The current `tests/verify-stamp.test.js` (4 suites, 209 LOC) verifies the **happy path** (commands resolve and run) and the **skip path** (no command available, gate carries `attempted_but_blocked` with reason). It does not appear to test the **middle path** — config absent, but `package.json` scripts present — though I'd need to spot-check the file to be sure. Worth confirming.

**Recommended fix**: if missing, add the middle-path test. ~10 lines.

### T-4 — Security-heuristic content scan false-positive cases (LOW, MEDIUM confidence)

The security heuristic was upgraded in the recent cycle to scan **file contents** (10 content patterns + new path patterns) in addition to paths. `tests/security-heuristic.test.js` (220 LOC) covers the positive cases (each pattern matches expected files). Less clear: how aggressively false positives are exercised. For instance, a comment that says `// uses bcrypt for password hashing` — does the heuristic flag the *commenting file* as security-flavored, or does it require the actual import?

**Recommended fix**: Phase 2 will look at the heuristic logic directly. If patterns can match in comments / string literals / test fixtures, the heuristic could over-trigger and force `security_review_required: true` on benign files. Worth a few false-positive-shaped test additions.

## Test runtime distribution

Slowest 10 tests (each measuring an end-to-end subprocess invocation):

| Time | Test |
|---|---|
| 1094 ms | approval-derivation: gate upsert (end-to-end) |
| 1016 ms | derive-approvals: end-to-end |
| 610 ms | gate-validator: blocker section cleanup on resolve |
| 564 ms | devteam log CLI |
| 558 ms | ruling: user-driven mode (no --headless) |
| 557 ms | gate-validator: exit codes |
| 548 ms | cli: stage |
| 513 ms | install round-trip per adapter |
| 508 ms | secret-scan: PreToolUse hook (end-to-end via stdin) |
| 507 ms | derive-approvals: error paths |

Each of these spawns subprocesses (test fixtures invoking `node bin/devteam …` or hooks via stdin). That's expected — the highest-value tests are the end-to-end ones. 1 second per high-leverage test is acceptable. The suite total of 3.1s reflects parallel execution (`node --test` runs files concurrently).

## CI coverage

GitHub Actions matrix runs on Node 20, 22, 24 (with `fail-fast: false`). Per matrix entry: `npm install && npm test && npm run consistency && devteam help && devteam init && devteam doctor`. **No coverage report is collected.** No `c8` / `istanbul` / `nyc` configured.

**Recommended fix**: not urgent, but a coverage badge on the README would be a small low-cost discoverability win for evaluators (per the README's "If you're evaluating Stagecraft, this is the cheapest path…" framing — coverage info supports the evaluation). `c8` works out-of-the-box with `node --test`. Maybe 20 minutes including CI integration.

## What's working well

- **Test count tracks features.** 378 → 778 in 6 days, perfectly aligned with the PR cadence. No PRs landed without tests.
- **Adapter contract is now behaviourally pinned**, not just structurally. The 24 → 56 assertion upgrade was the right move and removes a real class of silent-regression risk.
- **End-to-end tests dominate.** Subprocess invocation, real filesystem, real spawn — these are the tests that catch actual bugs, vs. mocked unit tests that catch only the bugs you imagined.
- **No skipped / todo tests.** The discipline of either landing a test or deleting it is being held.
- **Fast wall-clock.** 3.1s for 778 tests means the suite stays usable as a tight feedback loop during development. Slowest tests don't dominate.
- **Cross-version matrix.** Node 20 / 22 / 24 catches the version drift class of bug (e.g., `child_process` behavior changes between LTS lines).
