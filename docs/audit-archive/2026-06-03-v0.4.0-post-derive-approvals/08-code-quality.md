# 08 — Code quality

## Summary

Code quality is **broadly strong**. Style is consistent (without enforcement tooling), error handling follows a stable pattern, test discipline is being held, and recent refactors have actively reduced rather than grown the surface (renderStagePrompt de-dup, per-stage rules split). The codebase reads like one author wrote it — because one author did, and recently. Five findings, all low/medium severity and all addressable cheaply.

## Complexity hotspots

Top long functions in the codebase:

| Lines | File:line | Function | Notes |
|---|---|---|---|
| 208 | `bin/devteam:754` | `cmdReplay(argv)` | Renders + diffs replay output; many display branches |
| 150 | `bin/devteam:29` | `usage()` | Single template literal — not a complexity issue, just long doc |
| 144 | `core/gates/validator.js:437` | `main()` | Top-level Stop-hook entry; sequenced steps |
| 127 | `core/orchestrator.js:474` | `_nextImpl(stageList, gatesDir, track, skipStages)` | "What's next?" decision tree |
| 122 | `bin/devteam:621` | `cmdReproduce(argv)` | Hash comparison + display |
| 106 | `bin/devteam:391` | `cmdMemory(argv)` | Memory subcommand dispatch |
| 101 | `core/hooks/approval-derivation.js:195` | `applyVerdict({...})` | Per-verdict gate upsert with lock acquire |

### Q-1 — `bin/devteam:cmdReplay` is 208 lines (LOW, HIGH confidence)

`cmdReplay` is the longest function in the codebase. Reading it, the structure is:
1. Parse flags (~10 lines)
2. Load the recorded gate (~15 lines)
3. Re-run the stage with current config (~30 lines)
4. Diff the result across status, blockers, cost, tokens, duration, reproducibility fields (~80 lines)
5. Render the diff for stdout (~50 lines)
6. Handle `--dry-run` (~10 lines)
7. Handle `--json` (~10 lines)

It's not pathologically complex — it's mostly sequential — but it's doing 3-4 distinct jobs in one function. Splitting into `loadRecordedGate`, `replayStage`, `diffGates`, `renderDiff` would each be 30-60 lines and individually testable.

**Impact**: maintenance — at 208 lines, a new contributor will spend real time understanding what `cmdReplay` does before they can change it safely. Tests cover the function end-to-end, so refactoring is safe; just not done yet.

**Recommended fix**: split into 4 helpers, keep `cmdReplay` as the orchestration shell. ~2 hours including test updates. Not urgent.

### Q-2 — No style/lint enforcement tooling (MEDIUM, HIGH confidence)

Already flagged in `03-compliance.md`. The codebase has:
- No `.editorconfig`
- No `.eslintrc.*` / `eslint.config.js`
- No `.prettierrc`
- No `tsconfig.json`

Style is currently held by convention — one author, recent. **It is genuinely consistent right now**, which is rare without tooling. But:
- Future contributors will introduce drift unless tooling catches it.
- Some classes of bug (unused variables, shadowed declarations, missing `await`, accidental globals) need a linter to catch — they're below the threshold of `npm test` failures.
- The cost of adoption is small: `eslint:recommended` + `no-unused-vars` + maybe `no-floating-promises` would land in ~30 minutes and have negligible config burden.

**Recommended fix**: add a minimal `.editorconfig` (essentially free) and `eslint.config.js` with `eslint:recommended`. Land before 1.0; otherwise the back-fix on legacy violations grows with the codebase. Probably P2 — not urgent, but cheaper now than later.

### Q-3 — Dead exports (LOW, HIGH confidence)

Three exports are dead (defined and exported but never imported by any non-defining file):

| Export | Defined | Real consumers |
|---|---|---|
| `core/router.js:adapterPath` | line 14 | None — only the file itself uses it |
| `core/config.js:clearConfigCache` | line 35 | None |
| `core/verify/runner.js:DEFAULT_TIMEOUT_MS` | line 23 | None — used internally |

The `clearConfigCache` export is probably intentional (it's the kind of testing hook that callers *might* want), but if nothing uses it, the API is dead until someone needs it. Same for `adapterPath` (could be useful for diagnostics) and `DEFAULT_TIMEOUT_MS` (could be useful for callers wanting to compute timeouts).

**Impact**: minor — extra surface to maintain. Each is one item in a `module.exports = { … }` line.

**Recommended fix**: either remove the exports (and demote the symbols to private helpers) or add usages where they'd be appropriate (e.g., `bin/devteam doctor` could surface `adapterPath` for diagnostic output). Probably 15-minute audit + small PR. Not urgent.

### Q-4 — Security-heuristic has no false-positive escape hatch (LOW, MEDIUM confidence)

Cross-reference with S-3 in `06-security.md`. The secret-scan hook has a `devteam-allow-secret: <reason>` magic-comment override for verified false positives. The security-heuristic content scanner does **not** have an equivalent.

If a benign file (e.g., a documentation file in `docs/` that says "we use bcrypt for password hashing") matches the password-hashing content pattern, it triggers `security_review_required: true` in `stage-04a`, which fires the conditional `stage-04b` security review unnecessarily. There's no clean operator-level suppression.

**Impact**: occasional spurious security-review stages. Not blocking — security-review is read-only and exits quickly with a clean gate — but adds wall-clock time and noise to the audit trail.

**Recommended fix**: add a `devteam-no-security-review: <reason>` magic comment to `core/guards/security-heuristic.js`, scanned the same way the secret-scan magic comment is. ~15 lines.

### Q-5 — Duplication patterns spotted (LOW, HIGH confidence — already partially addressed)

The recent `core/adapters/render-helpers.js` extraction (commit `38ce2a0`) addressed the largest duplication (gate footer rendering across 3 adapters). Remaining duplication candidates:

1. **`spawnSync` + stdin payload + parse exit code** appears in `bin/devteam:cmdDeriveApprovals` and could be a shared helper if we end up with more "invoke-this-hook-from-the-shell" patterns. Defer until a third caller emerges.
2. **JSON.parse wrapped in try/catch** with various error-handling strategies: `core/orchestrator.js:623` returns `null` on parse fail; `core/ui/server.js:80` does the same; `core/memory/store.js:68` returns `[]`; `core/log/journal.js:85` lets the throw bubble. The patterns are all sensible for their callers but a shared `safeReadJSON(path, defaultValue)` helper would be a small cleanup. Maybe in the loadGate consolidation.
3. **Lock file with stale-detection + retry**: `core/hooks/approval-derivation.js` has a hand-rolled lock loop. The pattern doesn't appear elsewhere — single instance, no duplication to extract.

**Recommended fix**: don't extract speculatively. Each instance is small and well-contained. Watch for a third caller emerging and then refactor. P3 / strategic.

## Cohesion observations

- **`core/orchestrator.js` (718 LOC, 15 functions)** is well-organized: `runStage` → `runStageHeadless` → `mergeWorkstreamGates` → `next` → `summary` are the public surface; the rest are helpers serving them. The 127-line `_nextImpl` is the closest thing to a god function, but the responsibility is genuinely "decide what happens next given the full state of the gates directory" — splitting it would introduce coupling.
- **`core/gates/validator.js` (629 LOC, 18 functions)** is high cohesion — all of it is gate-shaped. The `main()` function at 144 lines orchestrates the validate → metadata-inject → blocker-section-inject → strip sequence; splitting would help readability but isn't urgent.
- **`bin/devteam` (1,918 LOC, 29 functions)** is large because the CLI is large. Each subcommand is its own `cmdX(argv)`. The 150-line `usage()` is a template string, not complexity. The shape is right; just keep an eye on it as the CLI grows past 25 subcommands (currently 21).

## Naming consistency

Spot-checked across `core/`, `bin/`, `hosts/`:
- **CLI subcommand functions**: `cmdInit`, `cmdStage`, `cmdNext`, `cmdValidate`, `cmdMerge`, `cmdDeriveApprovals`, `cmdRestart`, `cmdRuling`, `cmdSummary`, `cmdLog`, `cmdDoctor`, etc. Consistent `cmd<PascalCase>` for every subcommand. ✅
- **Orchestrator exports**: `runStage`, `runStageHeadless`, `mergeWorkstreamGates`, `next`, `summary`. ✅
- **Adapter contract**: `capabilities`, `install`, `renderStagePrompt`, `status`, `uninstall`, optional `invoke`. All four adapters use the same names. ✅
- **Hook entry points**: `core/hooks/<hook-name>.js` with the hook logic in `main()` / `runMain()`. ✅
- **File naming**: `kebab-case.js` for modules (`load-gate.js`, `render-helpers.js`, `migration-heuristic.js`); `PascalCase` is reserved for nothing (no classes). Consistent. ✅
- **Test files**: `<feature>.test.js`, single-level. ✅

No inconsistencies worth fixing.

## Error handling consistency

The pattern across the codebase is:
1. **CLI layer (`bin/devteam`)**: try/catch → `console.error("...")` + `process.exit(N)`. No throws bubble up.
2. **Hook layer (`core/hooks/`)**: try/catch → `console.log` warning + `process.exit(0)` to allow the tool call to proceed. **"Hook bugs must not block legitimate sessions."** Documented and held.
3. **Library layer (`core/orchestrator.js`, `core/gates/validator.js`)**: throw for programmer errors; return error objects (`{gate, error}`) for data errors. Callers decide.
4. **Adapter layer (`hosts/<host>/adapter.js`)**: throw for spawn errors; return `{written, skipped, warnings}` shape for install errors.

The split is principled and consistent. No bugs of the "swallowed error" or "throw across module boundaries" shape spotted.

## Comments

`AGENTS.md` § Conventions: "No comments-as-documentation in code. … One-line 'why this is here' comments are fine; multi-paragraph docstrings aren't."

Held. Spot-checks of `core/orchestrator.js`, `core/gates/validator.js`, `bin/devteam` show:
- Short "why" comments (e.g., `// `port: 0` is the conventional "let the OS pick a free port" value used by tests`).
- File-top JSDoc blocks for hooks and major utilities (e.g., `core/hooks/approval-derivation.js` has a 30-line header explaining the hook contract, the format it parses, and concurrency semantics — appropriate for an entry point).
- No multi-paragraph docstrings inside function bodies.

One minor nit: `core/hooks/approval-derivation.js:135` uses `Atomics.wait` as a synchronous sleep, which is an unusual pattern that benefits from one line of explanation (see P-3). Worth adding a `// synchronous sleep — no async loop available in this hook context` comment.

## TODOs in source

The only `TODO:` strings in non-test source are in `core/spec/verify.js:279-281` — and those are intentional placeholders that *get written into generated Gherkin scenarios* when `devteam spec generate` scaffolds a new feature file from acceptance criteria. They're emitted to the user, not leftover code work:

```js
lines.push(`    Given <TODO: precondition for ${id}>`);
lines.push(`    When  <TODO: action being verified>`);
lines.push(`    Then  <TODO: observable outcome>`);
```

**Verified intent**, not a finding.

## Positive observations

- **UI server has defensive bind-host handling.** `core/ui/server.js:144-174` defines a `LOOPBACK_HOSTS` set and refuses to bind to non-loopback addresses unless `STAGECRAFT_UI_ALLOW_REMOTE=1` is set, with a clear warning message. This is exactly the right shape for an authless local UI — *don't trust the operator's typo to expose pipeline state to the network*. Worth highlighting because it's the kind of foresight that catches the gnarliest production bug class.
- **Adapter contract is now behaviourally pinned.** `tests/adapter-contract.test.js` went from 24 existence-of-method assertions to 56 behavioural assertions in the recent cycle. Every adapter's `install` / `status` / `uninstall` round-trip is now exercised. This is the highest-leverage test improvement in the codebase.
- **The CHANGELOG entries are unusually substantive.** Recent CHANGELOG additions are not "added feature X" one-liners; they explain *why* (audit finding number, user-driven pain point), *what* (the technical shape), and *what changed in tests / docs / CLI surface as a consequence). This level of CHANGELOG discipline is rare and worth preserving.
- **PR descriptions live up to the commit messages.** Spot-checks of recent PR bodies show clear summary + background + test plan sections. Operators landing on a closed PR can reconstruct the decision from the PR alone.

## Recommendation summary

| # | Finding | Severity | Effort | Priority |
|---|---|---|---|---|
| Q-1 | Split `bin/devteam:cmdReplay` (208 LOC) into helpers | LOW | M (~2 hr) | P3 |
| Q-2 | Add `.editorconfig` + minimal eslint config | MEDIUM | S (~30 min) | P2 — land before 1.0 |
| Q-3 | Remove or activate 3 dead exports (`adapterPath`, `clearConfigCache`, `DEFAULT_TIMEOUT_MS`) | LOW | XS (~15 min) | P3 |
| Q-4 | Add `devteam-no-security-review:` magic comment to security-heuristic | LOW | XS (~15 min) | P3 |
| Q-5 | Defer further de-duplication until a third caller emerges | LOW | — | P-deferred |

Net: nothing here is "the codebase has a quality problem." Each item is a polish opportunity. The single highest-leverage one is Q-2 (lint tooling) — cheap and prevents drift as the codebase grows.
