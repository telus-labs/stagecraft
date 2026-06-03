# 02 — Git history

## Summary

The repo is **8 days old** (first commit 2026-05-26, latest 2026-06-03). 146 commits, single author (Mumit Khan), no co-authors except `Claude Opus 4.7 (1M context)` via `Co-Authored-By` trailer on AI-assisted commits. Velocity has been intense and continuous — average ~18 commits/day, with no quiet stretches. **99 of those 146 commits landed since the prior audit (2026-05-28)** — about 2/3 of the entire repo history in 6 days.

The shape of recent work is **doc-heavy with focused code bursts**. The top 5 most-changed files since 2026-05-28 are all documentation: CHANGELOG (29 commits), user-guide (22), README (20), faq (12), BACKLOG (12). The most-changed *code* files are `bin/devteam` (15 — CLI growth), `hosts/claude-code/adapter.js` (11 — adapter de-dup work), `core/orchestrator.js` (10 — auto-fold + restart + stamp-verification logic).

## Churn hotspots (last 6 months — i.e., the whole history)

| Commits | File | Read as |
|---|---|---|
| 48 | `CHANGELOG.md` | Every PR adds an entry; high commit count is expected, not a smell. |
| 26 | `README.md` | Front-door doc; iteration on positioning is the norm. |
| 25 | `docs/user-guide.md` | The canonical detailed reference; gets touched on every feature/process change. |
| 25 | `docs/BACKLOG.md` | Active backlog grooming. |
| 24 | `bin/devteam` | CLI surface growing fast (5 new subcommands in 6 days). |
| 19 | `core/orchestrator.js` | The orchestrator is the dispatch core; lots of recent gravity here (auto-fold, restart, stamp-verification). |
| 18 | `hosts/claude-code/adapter.js` | De-dup work + agent registration updates. |
| 17 | `package.json` | Dependency adjustments + version label. |
| 16 | `docs/faq.md` | New operator pain points keep surfacing. |
| 14 | `docs/concepts.md` | Vocabulary doc; touched whenever a new concept lands. |
| 12 | `core/pipeline/stages.js` | Stage definitions; touched for nano-track scoped-review, sizing tables, auto-fold preconditions. |
| 10 | `hosts/codex/adapter.js` + 10 `core/gates/validator.js` | Validator gains: orchestrator-stamping, blocker-section injection, idempotent strip-on-resolve. |
| 8 | `package-lock.json` | Pairs with `package.json`. |
| 7 | `hosts/gemini-cli/adapter.js` | Tracks claude-code's de-dup work. |

## What this tells us

- **Doc velocity ≥ code velocity.** That's intentional — Stagecraft's value proposition leans on the user's ability to understand the model. The prior audit observed the same shape and explicitly named it a strength, not a smell.
- **No file is hot enough to be alarming.** `bin/devteam` at 24 commits over 146 is healthy — it's the public surface, growing with the CLI. `core/orchestrator.js` at 19 is reasonable for the most load-bearing file.
- **Tests track features**. `tests/tracks.test.js` (5 commits since prior audit) and `tests/next.test.js` (4) lead the test churn — both feed off `core/pipeline/stages.js` changes. `tests/gate-validator.test.js` (4) keeps pace with validator additions.

## Co-change patterns

Reading the recent commit log:

- **`bin/devteam` + a test file + `CHANGELOG.md`** — the canonical "new subcommand" pattern. Seen for `ruling`, `restart`, `log`, `derive-approvals`. All four shipped with tests in the same commit. **Healthy: the test gate is being honored.**
- **`hosts/claude-code/adapter.js` + `hosts/codex/adapter.js` + `hosts/gemini-cli/adapter.js`** — the renderStagePrompt de-duplication landed via simultaneous edits across three adapters plus a new `core/adapters/render-helpers.js`. The fourth adapter (`generic`) doesn't render the same way, so it's exempt. **Healthy: when the contract changes, all implementers move together.**
- **`core/orchestrator.js` + `core/pipeline/stages.js` + `tests/next.test.js`** — the "what's next" decision logic is touched when stage definitions or track lists change. Tests stay in lockstep.
- **`README.md` + `docs/user-guide.md` + `docs/faq.md`** — operator-facing docs cross-reference each other. Recent rationalization (PR #27) tightened this — duplication was removed and pointers added.
- **`skills/audit/SKILL.md` + `hosts/claude-code/install/commands/audit*.md`** — the slash commands are thin wrappers; when the skill grows a step (Step 0.0), both slash command files reference it. **Healthy:** the slash commands explicitly defer to the skill rather than re-implementing.

## Recent trajectory (since 2026-05-28)

99 commits since the prior audit ran. Grouped by theme:

| Theme | Approximate commits | Examples |
|---|---|---|
| New CLI subcommands | 12 | `derive-approvals`, `ruling`, `restart`, `log`, plus follow-ups |
| Orchestrator-stamped verification | 8 | Stage 4a + Stage 6 verify logic, AC mapping cross-check, fall-through behavior |
| Auto-injection of red-team / QA blockers into context.md | 6 | Idempotent injection + strip-on-resolve |
| Per-stage rules split | 4 | `rules/stage-NN.md` files; orchestrator startup load-on-demand |
| Doc rationalization | ~20 | README quote iterations, audit-modes addition, audit-archive convention, runbook (escalation + fix-and-retry), conventions catalogue, FAQ entries |
| Test additions | ~15 | All new features shipped with tests; suite went 378 → 778 (+400) since prior audit |
| Render-prompt de-dup | 3 | `core/adapters/render-helpers.js` + 3 adapter edits |
| Stage 7 auto-fold | 3 | Documented-but-not-shipped feature actually implemented |
| Audit-archive convention | 3 | Step 0.0 + HISTORY.md + slash command updates |
| Misc fixes | ~25 | CHANGELOG conflicts on PR merges, swap files in repo, EPIPE swallow, hook race conditions |

## Stable / not actively evolving

- `LICENSE` — last touched 2026-05-26 (first commit). MIT.
- `ARCHITECTURE.md` — 14.5KB, last touched 2026-05-28. The 11 locked design decisions are still authoritative; subsequent work has respected them. **This is a strong signal:** the architectural seam (spine + adapter, gate as contract, no model calls in core) has held under 99 commits of growth.
- `core/router.js` — 47 lines, essentially unchanged since week 1. Single responsibility, well-bounded.
- Most schema files under `core/gates/schemas/` — schemas evolved early, then stabilized.
- `examples/` and `templates/` — mostly untouched. Templates are the rendered artifacts the model copies; they're stable by intent.

## Commit quality

- **Conventional Commits adherence:** mixed. New commits use `feat(scope):`, `fix(scope):`, `docs:`, `refactor(scope):`, `chore:`. Older commits (week 1) more freeform. Recent commits (post-audit) are well-typed.
- **Commit size:** mostly focused. The `feat: add devteam derive-approvals` commit (cc8e8c4) shipped 6 files + 9 tests in one focused change. The `refactor(rules)` commit (cf3293b) did a larger split but was scope-coherent (rules-only).
- **PR discipline:** all 28 PRs were merged via the GitHub merge-commit path (`Merge pull request #N from telus-labs/<branch>`). Squash-merge is *not* in use, so the granular commit history is preserved — useful for `git blame` and bisect.
- **Co-author trailers** present on AI-assisted commits (`Co-Authored-By: Claude Opus 4.7 (1M context)`). Good provenance.

## Quality concerns flagged in the log

- **Two stray files committed and then removed**: `.README.md.swp` (vim swap) and `.claude/scheduled_tasks.lock` (scheduler artifact). Both were caught and `git rm --cached`d, then added to `.gitignore`. Net result: `.gitignore` now has 5 entries; the leak was caught quickly. The `.claude/scheduled_tasks.lock` file is still present locally as evidence the gitignore is doing its job.
- **CHANGELOG merge conflicts**: Recurring issue. Every PR adds an entry to `[Unreleased] / Added` at the top of the section; concurrent PRs collide. Per-PR resolution has been correct (keep both entries in merge-order), but the pattern is friction. **Worth flagging in Phase 2 code-quality**: a `CHANGELOG.next/<slug>.md` per-PR fragment pattern would eliminate the conflicts.
- **Force-push avoidance**: confirmed — no `git push --force` against main visible in history. PR branches were force-pushed for rebases, but main is linear-merge.
- **Stagecraft hasn't been re-versioned**. `package.json` still says `0.4.0` from 2026-05-28. 99 commits of feature + doc work without a version bump is a smell — semver-wise, several new CLI surfaces have shipped that should be at minimum a minor bump (0.5.0). Tracked further in Phase 3.
