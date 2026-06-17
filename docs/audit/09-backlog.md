# 09 — Backlog

## Summary

This audit surfaced **0 P0 items** (no critical defects, no security vulnerabilities, no broken tests). All 11 actionable items from the 2026-05-28 audit are **closed** — every P1, P2, and P3 item shipped in the 6 days between audits. The four Parked items remain appropriately parked.

The new findings are smaller and more bounded than last cycle's. The dominant shape is "polish residue from the rapid feature cycle" — documentation cross-references that drifted, a couple of size-cap inconsistencies, and pre-1.0 tooling decisions that are getting cheaper to make now than later.

## Prior-audit carry-forward (the audit-archive convention's first exercise)

Per `skills/audit/SKILL.md` § Phase 3.1, this audit reads the most-recent archived `09-backlog.md` and `10-roadmap.md` and either closes prior items with a citation or carries them forward. Result of the cross-check:

| Prior item | Status | Evidence in current codebase |
|---|---|---|
| **P1-1** validator.js `node:` import prefix | ✅ Closed | `core/gates/validator.js:29-30` uses `node:fs`, `node:path` |
| **P1-2** `docs/TESTING.md` summary numbers | ✅ Closed (better than expected) | TESTING.md now says "currently around 380 tests / 25+ files… this doc avoids quoting specific numbers since they drift" |
| **P1-3** `tests/consistency-meta.test.js` | ✅ Closed | File exists, dated 2026-05-28 |
| **P1-4** Document stdout-vs-stderr norm | ✅ Closed | `AGENTS.md:81` + `docs/conventions.md` |
| **P1-5** "Verify before promoting" lesson | ✅ Closed | `skills/audit/SKILL.md` § "Process discipline — verify before promoting" |
| **P2-1** `visualize.test.js`, `pr-pack.test.js` | ✅ Closed | Both files exist |
| **P2-2** DRY role list across adapters | ✅ Closed | `core/roles.listRoles()` shared by codex, gemini-cli, claude-code |
| **P2-3** `--timeout-ms` for headless mode | ✅ Closed | CLI flag, tested in `tests/headless.test.js` |
| **P2-4** Template-annotation asymmetry decision | ✅ Closed | `docs/concepts.md`'s "Files at a glance" table explicitly documents the asymmetric coverage |
| **P2-5** Comments on `computeDispatchPlan`/`hostFromPath` | ✅ Closed | Both functions have 2-3 line context comments above |
| **P3-1** Extract `core/adapters/base-install.js` | ✅ Closed | File exists (4,059 bytes); 3 adapters use it |
| **P3-2** Split `core/orchestrator.js` | Defer (unchanged) | File is 718 LOC — same scale as audit-time. Still working fine; re-check next cycle |
| **Parked-1** Onboarding video / GIF | Remains parked | No user feedback suggesting text walkthrough insufficient |
| **Parked-2** HF model hash-verify | Remains parked | No incident |
| **Parked-3** sqlite-vec memory backend | Remains parked | No latency complaints; JSON backend still adequate |
| **Parked-4** Concurrency test for approval-derivation | Remains parked | Lock acquisition tested in unit tests; real-contention test still tier-3 |

**Carry-forward summary:** 11 / 11 actionable items closed in 6 days. This is an extremely strong delivery rate and validates the prior audit's prioritization. None of the prior items need to be re-prioritized into this cycle's backlog.

## Themes

The 22 findings across `03-compliance.md`, `04-tests.md`, `05-documentation.md`, `06-security.md`, `07-performance.md`, and `08-code-quality.md` cluster into four themes.

### Theme 1 — Documentation residue from rapid feature velocity

The 99 commits in 6 days landed real features but a few doc updates lagged. Findings: **D-1** (derive-approvals missing from README CLI table), **D-2** (broken inbound link to archived audit), **D-3** (devteam ruling not in user-guide / FAQ), **D-6** (BACKLOG.md noise from inline-strikethrough), **D-7** (devteam log JSON shape undocumented). Same shape as prior audit's Theme 1; the fix pattern is the same — sweep and update. The fact that the residue is **smaller this cycle** suggests the discipline is improving, not slipping.

### Theme 2 — Pre-1.0 tooling debts

The codebase has held style consistency by author convention through ~9k LOC and 99 commits. Bringing lint / format tooling in *now* (Q-2) is cheaper than retrofitting later. Same applies to the version-bump observation (`package.json` still says `0.4.0` despite multiple feature additions that warrant a 0.5.0 — a release-discipline decision rather than a code issue). These items aren't urgent today, but they get more expensive each week.

### Theme 3 — Size-cap consistency for input-bound components

Three components correctly cap their input reads (security-heuristic, approval-derivation, validator). One does not (secret-scan, S-1). The fix is to extend the same pattern. Small, low-risk, important — secret-scan is in the security-critical PreToolUse path.

### Theme 4 — Symmetry gaps in escape hatches

The secret-scan hook has a `devteam-allow-secret:` magic-comment override for false positives (Q-4 / S-3). The security-heuristic has no equivalent — a documentation file that mentions security primitives can trigger an unnecessary stage-04b. Adding parity (`devteam-no-security-review:` magic comment) closes the gap.

## P0 — Fix now

**None.** The codebase has no critical issues, no broken builds, no security vulnerabilities, no failing tests.

## P1 — Quick wins

Land in next 1–2 commits.

### P1-1: Add `MAX_SCAN_BYTES` to `core/hooks/secret-scan.js`

- **Theme:** Size-cap consistency (Theme 3) + security hardening.
- **Source:** Finding S-1.
- **Description:** The secret-scan PreToolUse hook reads full file content and runs ~20 regex patterns. Other components (security-heuristic, approval-derivation, validator) cap input at 1 MB. Adding the same cap here prevents two failure modes: (a) hook timeout on huge content → fail-open (tool call proceeds without secret check); (b) pathological regex backtracking. Pattern: `if (content.length > MAX_SCAN_BYTES) { console.log warning + exit 0 }`.
- **Affected:** `core/hooks/secret-scan.js`.
- **Effort:** XS (~5 lines).
- **Risk of change:** low (skips on oversize, consistent with conservative-on-error policy elsewhere).
- **Risk of NOT changing:** medium (security: fail-open under load is the worst class of fail).
- **Confidence:** HIGH.

### P1-2: Add `devteam derive-approvals` row to README CLI reference

- **Theme:** Documentation residue (Theme 1).
- **Source:** Finding D-1.
- **Description:** PR #26 shipped `derive-approvals` with tests, runbook reference, FAQ entry — but didn't add a row to the README CLI reference table. Operators scanning the reference won't know the command exists.
- **Affected:** `README.md` § CLI reference.
- **Effort:** XS (~3 lines).
- **Risk of change:** low.
- **Risk of NOT changing:** medium (discoverability).
- **Confidence:** HIGH.

### P1-3: Fix broken inbound link in `docs/user-guide.md:779`

- **Theme:** Documentation residue (Theme 1).
- **Source:** Finding D-2.
- **Description:** PR #28 moved the prior audit to `docs/audit-archive/2026-05-28-v0.4.0-initial-dogfood/` but left `docs/user-guide.md:779`'s link pointing at the old `audit/10-roadmap.md` path. 404 today.
- **Affected:** `docs/user-guide.md:779`.
- **Effort:** XS (1 line).
- **Risk of change:** none.
- **Risk of NOT changing:** low (the link is in a "what the output looks like" example, easily missed but real).
- **Confidence:** HIGH.

### P1-4: Resolve `architect` and `data-engineer` agent registrations — **RETRACTED 2026-06-03**

- **Status:** RETRACTED during Batch 1 implementation. The premise is false: `hosts/claude-code/adapter.js`'s `ROLE_FRONTMATTER` does **not** register `architect` or `data-engineer`. Direct grep confirms 12 entries (`pm`, `principal`, `reviewer`, `security`, `backend`, `frontend`, `platform`, `qa`, `auditor`, `red-team`, `migrations`, `verifier`); the audit listed two names that simply don't exist in the codebase. The "missing role briefs" gap is not a gap. See `03-compliance.md` § C-1 RETRACTION for the citation.
- **Lesson:** the `skills/audit/SKILL.md` § Process discipline rule ("verify before promoting" — added after the 2026-05-28 audit's S5 retraction) wasn't applied here. Findings that name specific symbols must be confirmed via direct code inspection, not from memorized expectation, before being promoted to a backlog item.
- **Original text preserved below** for audit-trail integrity.

---

**Original text (now retracted):**

- **Theme:** Documentation residue (Theme 1) + single-source-of-truth convention.
- **Source:** Findings C-1, D-4.
- **Description:** `hosts/claude-code/adapter.js` registers `architect` and `data-engineer` subagents with no corresponding `roles/<name>.md` brief files. Two options: (a) author the briefs (decision: are these intended seats?); (b) remove the registrations. The latter is the safer default — these agents aren't referenced in any stage definition, so they're dormant. If a future need surfaces, the brief authoring happens at that time.
- **Affected:** `hosts/claude-code/adapter.js` (registrations) or new `roles/architect.md` + `roles/data-engineer.md`.
- **Effort:** XS (decision + 5-10 lines either way).
- **Risk of change:** low.
- **Risk of NOT changing:** low (no active break, but breaks single-source-of-truth convention).
- **Confidence:** HIGH.

### P1-5: Reset `docs/audit/README.md` discovery message after first archive

- **Theme:** Documentation residue (Theme 1) — meta.
- **Source:** This audit run.
- **Description:** The audit-archive convention's first real exercise lands with this PR. After it merges, `docs/audit/` contains the new (2026-06-03) audit + a `README.md` whose text describes the archive convention as if it hasn't been exercised yet. Worth a 2-line update reflecting that the convention is now working (Phase 0 step 0.0 will fire on the *next* audit).
- **Affected:** `docs/audit/README.md`.
- **Effort:** XS (~2 lines).
- **Risk of change:** none.
- **Risk of NOT changing:** trivial.
- **Confidence:** HIGH.

## P2 — Targeted improvements

Land in weeks 1–3.

### P2-1: Add minimal `.editorconfig` + `eslint.config.js`

- **Theme:** Pre-1.0 tooling debts (Theme 2).
- **Source:** Finding Q-2.
- **Description:** Style is currently held by author convention. Bringing in lint tooling now (cheap) prevents drift later (expensive). Suggested minimum: `.editorconfig` with 2-space indent, LF endings, UTF-8, final newline; `eslint.config.js` with `eslint:recommended` + `no-unused-vars` + `no-floating-promises`. Add `npm run lint` to CI.
- **Affected:** new files at repo root, `package.json` scripts, `.github/workflows/test.yml`.
- **Effort:** S (~30-45 min; ~1 hour with CI hookup).
- **Risk of change:** low — minimal rule set; if any existing violations surface, fix them inline.
- **Risk of NOT changing:** medium (cost of retrofit grows with codebase size; drift risk grows with contributor count).
- **Confidence:** HIGH.

### P2-2: Replace `exec(cmd)` with `spawn(args)` in `core/ui/server.js:tryOpen`

- **Theme:** Pre-1.0 tooling debts (Theme 2) — defense in depth.
- **Source:** Finding S-2.
- **Description:** Today's URL source (`server.address()`) is safe, but the shell-string-interpolation pattern is brittle. `spawn(args)` with array arguments eliminates the entire injection-shape class regardless of future URL sources.
- **Affected:** `core/ui/server.js:232-237`.
- **Effort:** XS (~10 lines).
- **Risk of change:** low.
- **Risk of NOT changing:** low today; medium if URL source changes in future.
- **Confidence:** HIGH.

### P2-3: Add `devteam ruling` section to `docs/user-guide.md`

- **Theme:** Documentation residue (Theme 1).
- **Source:** Finding D-3.
- **Description:** `devteam ruling` is documented in README CLI reference + `docs/runbooks/escalation.md` but absent from the daily-use reference. A user-guide subsection ("Ad-hoc Principal rulings") explaining when to use it, basic invocation, and where the ruling lands.
- **Affected:** `docs/user-guide.md`.
- **Effort:** XS (~15 lines).
- **Risk of change:** none.
- **Risk of NOT changing:** medium (operator discoverability).
- **Confidence:** HIGH.

### P2-4: Add `devteam-no-security-review:` magic comment to security-heuristic

- **Theme:** Symmetry gaps (Theme 4).
- **Source:** Findings Q-4, S-3.
- **Description:** Parity with the secret-scan hook's `devteam-allow-secret:` escape hatch. A doc file that mentions `bcrypt` shouldn't trigger stage-04b. Pattern: scan content for `devteam-no-security-review: <reason>` (case-insensitive); if present, skip the heuristic for that file.
- **Affected:** `core/guards/security-heuristic.js` + `tests/security-heuristic.test.js` (false-positive test case).
- **Effort:** XS (~15 lines).
- **Risk of change:** low.
- **Risk of NOT changing:** low (occasional spurious stage-04b; not blocking).
- **Confidence:** HIGH.

### P2-5: Lazy-require inside `cmdX` functions in `bin/devteam`

- **Theme:** Performance hygiene.
- **Source:** Finding P-1.
- **Description:** Eager imports in `bin/devteam:17-21` make `devteam help` pay ~30 ms of orchestrator module-load cost. Lazy-require inside each `cmdX` function brings non-pipeline commands to ~15-20 ms. Mechanical refactor.
- **Affected:** `bin/devteam` (~25 functions; small per-function change).
- **Effort:** S (~30-60 min).
- **Risk of change:** low (mechanical; all tests cover the call sites).
- **Risk of NOT changing:** low today; growing with each new subcommand.
- **Confidence:** HIGH.

### P2-6: Cross-host render-equivalence test

- **Theme:** Test coverage.
- **Source:** Finding T-2.
- **Description:** Post-`renderStagePrompt` de-duplication, three adapters share the gate-footer rendering code. The current contract test verifies each adapter individually but doesn't pin equivalence across (claude-code, codex, gemini-cli) for the shared portion. Add: for a fixed descriptor, compute each adapter's prompt, verify the shared-footer bytes match. ~15 lines.
- **Affected:** `tests/adapter-contract.test.js`.
- **Effort:** XS.
- **Risk of change:** low.
- **Risk of NOT changing:** low (silent drift risk).
- **Confidence:** MEDIUM.

### P2-7: Verify-stamp middle-path fall-through test

- **Theme:** Test coverage.
- **Source:** Finding T-3.
- **Description:** `core/verify/runner.js` resolves commands via `.devteam/config.yml` → `package.json` scripts → skip. Happy path and skip path are tested; the middle path (config absent, package.json scripts present) needs spot-confirmation. If missing, add ~10 lines.
- **Affected:** `tests/verify-stamp.test.js`.
- **Effort:** XS.
- **Risk of change:** low.
- **Risk of NOT changing:** low.
- **Confidence:** MEDIUM.

### P2-8: Version bump to 0.5.0

- **Theme:** Pre-1.0 tooling debts (Theme 2) — release discipline.
- **Source:** Finding in `02-git-history.md` "Quality concerns flagged in the log."
- **Description:** `package.json` still says `0.4.0` from 2026-05-28. 99 commits since, with multiple new CLI subcommands (`derive-approvals`, `ruling`, `restart`, `log`, `verify`), new conditional stages (migration-safety, verification-beyond-tests), new runbooks, new conventions doc. Semver-wise, this warrants a minor bump.
- **Affected:** `package.json`, `CHANGELOG.md` (move `[Unreleased]` content to `[0.5.0]`), git tag, README "Version" mention if any.
- **Effort:** S (~30 min including CHANGELOG migration).
- **Risk of change:** low (no breaking changes).
- **Risk of NOT changing:** low today; growing — release discipline matters more as external users adopt.
- **Confidence:** HIGH.

## P3 — Strategic investments

Month 2+.

### P3-1: Split `bin/devteam:cmdReplay` (208 LOC) into helpers

- **Theme:** Code structure.
- **Source:** Finding Q-1.
- **Description:** The longest function in the codebase. Doing 3-4 distinct jobs (load gate, re-run stage, diff, render). Splitting into `loadRecordedGate`, `replayStage`, `diffGates`, `renderDiff` would each be 30-60 lines and individually testable. Not urgent — tests cover the function end-to-end — but maintenance-friendly.
- **Effort:** M (~2 hours including test updates).
- **Risk of change:** low (mechanical; existing tests cover the contract).
- **Risk of NOT changing:** low (currently working).
- **Confidence:** MEDIUM.

### P3-2: Document `devteam log --json` event schema

- **Theme:** API surface for external integrations.
- **Source:** Finding D-7.
- **Description:** When external integrations (CI dashboards, audit-trail tools, pipeline monitors) want to consume `devteam log --json`, the event-shape contract benefits from explicit documentation. Probably ~30 lines in `docs/observability.md` or a new `docs/log-schema.md`. Defer until an external integration emerges.
- **Effort:** S.
- **Risk of change:** low.
- **Risk of NOT changing:** low until external integration emerges.
- **Confidence:** MEDIUM.

### P3-3: Document per-stage rules coverage — CLOSED

- **Theme:** Documentation completeness.
- **Source:** Findings C-2, D-5.
- **Resolution:** `rules/pipeline-build.md` and `rules/pipeline.md` now document the intentional coverage shape: stages 1, 2, 4-8, and 9 have dedicated `stage-NN.md` files; stage 3 and stage 03b remain in `pipeline-core.md` plus role/skill guidance because they are lightweight routing/spec-authoring steps.
- **Confidence:** HIGH.

### P3-4: Tidy 3 dead exports

- **Theme:** Code structure.
- **Source:** Finding Q-3.
- **Description:** `core/router.js:adapterPath`, `core/config.js:clearConfigCache`, `core/verify/runner.js:DEFAULT_TIMEOUT_MS` are exported but never imported externally. Decide: remove (demote to private) or find a real consumer (e.g., `devteam doctor` could surface `adapterPath` diagnostically).
- **Effort:** XS (~15 min).
- **Risk of change:** very low.
- **Risk of NOT changing:** trivial (extra API surface).
- **Confidence:** HIGH.

### P3-5: BACKLOG.md noise reduction

- **Theme:** Documentation completeness.
- **Source:** Finding D-6.
- **Description:** `docs/BACKLOG.md` uses `~~item~~ ✅ landed` inline strikethrough rather than removing shipped items. Convention preserves history but adds scan noise at 99 commits of growth. Optional alternative: migrate shipped items to a top `### Shipped` section with date column, leaving the active backlog scannable.
- **Effort:** S (~30 min).
- **Risk of change:** low.
- **Risk of NOT changing:** low (cognitive load only).
- **Confidence:** MEDIUM.

## Parked

Items that don't justify work right now. All four prior-audit Parked items remain valid.

### Parked-1 (inherited): Onboarding video / GIF

- **Source:** Prior audit Parked-1.
- **Reason for parking:** Text walkthroughs in `EXAMPLE.md` + `docs/walkthroughs/soc2-evidence-collector.md` are sufficient. No user feedback otherwise.
- **What would change this:** sustained feedback that text-only onboarding isn't enough.

### Parked-2 (inherited): Hash-verify Hugging Face model downloads

- **Source:** Prior audit Parked-2.
- **Reason for parking:** Supply-chain risk real but low. Implementation friction would exceed risk reduction.
- **What would change this:** a publicized HF CDN incident or security-conscious user request.

### Parked-3 (inherited): Memory `MemoryStore` sqlite-vec backend

- **Source:** Prior audit Parked-3.
- **Reason for parking:** JSON backend adequate at current per-project scale.
- **What would change this:** any user report of >100ms query latency.

### Parked-4 (inherited): Concurrency test for approval-derivation

- **Source:** Prior audit Parked-4.
- **Reason for parking:** Lock acquisition unit-tested; real-contention test useful but not urgent.
- **What would change this:** any observed gate-corruption incident under multi-reviewer Stage 5.

### Parked-5 (new): Split `core/orchestrator.js`

- **Source:** Prior audit P3-2; carried forward unchanged.
- **Reason for parking:** Still 718 LOC, well-organized, no signal it's becoming a maintenance hazard.
- **What would change this:** the file growing past ~1,000 LOC, or the `_nextImpl` function past ~200 LOC.

## Project-Specific

*(No `docs/audit-extensions.md`.)*
