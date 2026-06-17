# 10 — Sequenced roadmap

## Summary

Two batches of small items (Batch 1 and Batch 2, mostly XS-effort), one batch of structural polish (Batch 3, ~half a day), one strategic item that's a one-time release-discipline action (P2-8 version bump), and five Parked items.

**Total effort to land everything actionable: ~1 day of focused work** — substantially less than the prior audit's 5-day estimate, because the prior audit's items were larger (multi-adapter refactor, role-list deduplication, base-install extraction). This cycle's findings are smaller and more bounded.

The driving insight from carry-forward verification: **the prior audit's 11 actionable items all shipped in 6 days**, so the right read is "the team has the bandwidth to land an audit cycle quickly" — meaning this cycle's lighter weight is the result of fewer remaining gaps, not slower velocity.

## Batch 1 — Immediate (P1 quick wins)

All XS-effort. Land as 1-2 commits. ~1-2 hours total.

### PR 1.1 — Documentation residue sweep

Closes the doc gaps from the recent feature cycle. Group into one commit.

| # | Item | Effort | Verification |
|---|---|---|---|
| 1 | **P1-2**: Add `devteam derive-approvals` row to README CLI reference table | XS | `grep -c "derive-approvals" README.md` returns ≥ 1 |
| 2 | **P1-3**: Fix `docs/user-guide.md:779` link to point at archive | XS | `grep "audit-archive/2026-05-28" docs/user-guide.md` matches; original `audit/10-roadmap.md` reference still present elsewhere for *forward*-pointing (where the next audit lands) |
| 3 | **P1-5**: Update `docs/audit/README.md` to reflect convention now exercised | XS | Note that Step 0.0 will fire on the *next* audit; this one was the bootstrap |

**Parallelize:** all three are independent file edits. One commit.
**Total estimated effort:** XS (~30 minutes).
**Infrastructure changes needed:** none.

### PR 1.2 — Secret-scan size cap

Closes the only security finding above LOW.

| # | Item | Effort | Verification |
|---|---|---|---|
| 1 | **P1-1**: Add `MAX_SCAN_BYTES = 1_000_000` to `core/hooks/secret-scan.js` | XS | New test in `tests/secret-scan.test.js` confirms >1MB content exits 0 with `[secret-scan] ⚠️ content exceeds` log; <1MB still scans normally |

**Total estimated effort:** XS (~15 minutes including test).
**Infrastructure changes needed:** none.

### PR 1.3 — Resolve dormant agent registrations — **RETRACTED 2026-06-03**

**Status:** RETRACTED during Batch 1 implementation. The underlying finding (P1-4, sourced from C-1) was based on a false premise — `architect` and `data-engineer` are not registered as agents anywhere in the codebase. Direct inspection of `hosts/claude-code/adapter.js` `ROLE_FRONTMATTER` confirms 12 entries, none of which are these two names. No PR is required for this item. See `09-backlog.md` § P1-4 RETRACTION and `03-compliance.md` § C-1 RETRACTION for the full citation.

**Lesson preserved:** `skills/audit/SKILL.md` § Process discipline ("verify before promoting") was not applied during the 2026-06-03 audit on this finding. Future audits MUST verify findings that cite specific symbols (agent names, file paths, function names) via direct grep before promotion past LOW confidence.

---

**Original text (now retracted):**

| # | Item | Effort | Verification |
|---|---|---|---|
| 1 | **P1-4**: Either author `roles/architect.md` + `roles/data-engineer.md` OR remove registrations from `hosts/claude-code/adapter.js` | XS | Either both `.md` files present with substantive content, OR the `architect` / `data-engineer` entries in `AGENT_DEFS` are removed. Adapter contract test still passes. |

**Decision required first:** are these intended seats? Recommend the removal path — neither is referenced in any stage definition, and the registrations are dormant. Authoring briefs without a use case is speculative. If a future need surfaces, author at that time.

**Total estimated effort:** XS (~10 minutes for the removal path).
**Infrastructure changes needed:** none.

## Batch 2 — Weeks 1–2 (P2 targeted)

### PR 2.1 — Lint tooling

The highest-leverage cleanup in this cycle. Cheap to land now; expensive to retrofit later.

| # | Item | Effort | Verification |
|---|---|---|---|
| 1 | **P2-1**: Add `.editorconfig` (2-space, LF, UTF-8, final newline) | XS | File present at repo root |
| 2 | **P2-1**: Add `eslint.config.js` with `eslint:recommended` + `no-unused-vars` + `no-floating-promises` | XS | `npm run lint` passes; suite still 778/778 |
| 3 | **P2-1**: Add `lint` script to `package.json` | XS | `npm run lint` invokes ESLint |
| 4 | **P2-1**: Add ESLint step to `.github/workflows/test.yml` | XS | CI runs lint after `npm test` |

**Total estimated effort:** S (~45-60 min including any existing-violation cleanup).
**Risk:** low — minimal rule set; fix any violations inline as they surface.

### PR 2.2 — Operational hygiene cluster

Three small consistency improvements that share a coding session.

| # | Item | Effort | Verification |
|---|---|---|---|
| 1 | **P2-2**: Replace `exec(cmd)` with `spawn(args)` in `core/ui/server.js:tryOpen` | XS | UI server tests still pass; no shell interpolation in the path |
| 2 | **P2-4**: Add `devteam-no-security-review:` magic comment to security-heuristic | XS | New test in `tests/security-heuristic.test.js`: content with the marker doesn't flag |
| 3 | **P2-5**: Lazy-require inside `cmdX` functions in `bin/devteam` | S | `time node bin/devteam help` drops by ~15-20ms; suite still 778/778 |

**Parallelize:** the three are independent. One PR.
**Total estimated effort:** S (~1-1.5 hours).
**Risk:** low.

### PR 2.3 — Documentation completeness

| # | Item | Effort | Verification |
|---|---|---|---|
| 1 | **P2-3**: Add `### Ad-hoc Principal rulings` subsection to `docs/user-guide.md` | XS | Section exists; cross-references escalation runbook |

**Total estimated effort:** XS (~15 min).
**Risk:** none.

### PR 2.4 — Test coverage completion

| # | Item | Effort | Verification |
|---|---|---|---|
| 1 | **P2-6**: Cross-host render-equivalence test in `tests/adapter-contract.test.js` | XS | New test: for a fixed descriptor, all three adapters (claude-code, codex, gemini-cli) produce byte-identical shared-footer content. Generic is exempt (different render path). |
| 2 | **P2-7**: Verify-stamp middle-path fall-through test (config absent, package.json scripts present) | XS | New test in `tests/verify-stamp.test.js`: scripts resolve from package.json when `.devteam/config.yml` lacks `pipeline.verify.*`. Skip if test already exists — spot-check before adding. |

**Parallelize:** independent.
**Total estimated effort:** XS (~30 min).

### PR 2.5 — Version bump to 0.5.0

A one-time release-discipline action. Independent of all other items.

| # | Item | Effort | Verification |
|---|---|---|---|
| 1 | **P2-8**: Bump `package.json` version 0.4.0 → 0.5.0; migrate `[Unreleased]` to `[0.5.0] — 2026-06-XX` in `CHANGELOG.md`; git tag `v0.5.0` | S | `npm test` passes (consistency check verifies version); CHANGELOG has dated section; tag pushed |

**Total estimated effort:** S (~30 min including CHANGELOG migration).
**Risk:** low — no breaking changes; semver-conformant bump.

**Recommended ordering within Batch 2:** PR 2.5 (version bump) can land first or last. PRs 2.1 / 2.2 / 2.3 / 2.4 are mutually independent. **Suggested sequence**: 2.1 → 2.2 → 2.4 → 2.3 → 2.5 (lint first because it catches violations in subsequent PRs; version bump last because it covers everything).

## Batch 3 — Month 2+ (P3 strategic)

Three small structural items + one defer.

### PR 3.1 — `bin/devteam:cmdReplay` refactor

| # | Item | Effort | Verification |
|---|---|---|---|
| 1 | **P3-1**: Split into `loadRecordedGate`, `replayStage`, `diffGates`, `renderDiff` helpers | M | Function reduces from 208 LOC to ~50 LOC orchestration shell; each helper individually testable; `tests/cli.test.js` still passes |

**Effort:** M (~2 hours).
**Risk:** low — mechanical split; tests cover the contract.

### PR 3.2 — Dead-export sweep

| # | Item | Effort | Verification |
|---|---|---|---|
| 1 | **P3-4**: Remove or activate `adapterPath`, `clearConfigCache`, `DEFAULT_TIMEOUT_MS` | XS | Exports either gone OR have at least one external consumer |

**Effort:** XS (~15 min).

### PR 3.3 — Per-stage rules-coverage decision — CLOSED

| # | Item | Effort | Verification |
|---|---|---|---|
| 1 | **P3-3**: Document the per-stage rule-file coverage shape in `rules/pipeline-build.md` and `rules/pipeline.md` | Done | Rules index now explains why stages 3 and 03b stay in `pipeline-core.md` plus role/skill guidance. |

**Status:** closed.
**Risk:** low.

### PR 3.4 — `devteam log --json` event schema doc (deferred)

| # | Item | Effort | Verification |
|---|---|---|---|
| 1 | **P3-2**: Document the JSON shape | S (~30 min when triggered) | New section in `docs/observability.md` |

**Defer until:** an external integration (CI dashboard, audit-trail tool) emerges.

### PR 3.5 — BACKLOG.md noise reduction (optional)

| # | Item | Effort | Verification |
|---|---|---|---|
| 1 | **P3-5**: Migrate `~~landed~~` items to a top `### Shipped` section | S | Backlog scannable; shipped items preserved with date |

**Effort:** S (~30 min).
**Optional** — current convention preserves history; this change just reduces scan friction.

## Roadmap risks

What could go wrong with this sequence:

- **Batch 1's PR 1.1 (doc sweep) could touch the same files as PR 1.2 / 1.3.** Unlikely (different files), but worth holding them as separate commits in one PR if needed.
- **Batch 2's PR 2.1 (lint) might surface existing violations.** Plan for one extra hour of inline fixes. The minimal rule set deliberately keeps this small.
- **Batch 2's PR 2.5 (version bump) interacts with everything else.** If PR 2.5 lands first, every subsequent CHANGELOG entry needs to land under `[Unreleased]` (a new section). If PR 2.5 lands last, all of Batch 2's changes get rolled into the 0.5.0 release notes. Recommend last.
- **Batch 3's PR 3.1 (cmdReplay split) is the only multi-hour item.** Schedule for a focused session; don't context-switch mid-refactor.

## What this audit explicitly did NOT find

For symmetry, the absence of findings is itself useful audit signal:

- **No P0 items.** Codebase is in a defensible state across compliance, security, performance, and quality.
- **No security vulnerabilities** above LOW. `npm audit` is clean. Subprocess hygiene clean. js-yaml in safe mode. No `eval` / `new Function`. UI server defensively guards non-loopback binding.
- **No performance issues.** CLI cold-start is fast, test suite is fast, no leaks, no async/sync confusion.
- **No test debt.** 778 tests in lockstep with features, 0 skipped, 0 todo, +400 since prior audit. The "tests in lockstep with contract change" convention is holding under velocity.
- **No architectural regressions.** The 11 locked design decisions in `ARCHITECTURE.md` are unchanged after 99 commits. Spine + adapter pattern intact. Gate JSON as the seam intact. Core never invokes a model intact.
- **No prior-audit items deferred.** Every actionable P1/P2/P3 from 2026-05-28 shipped in 6 days.

## Audit-archive convention validation

This audit was the **first to operate under the audit-archive convention** introduced in PR #28. Observations on the convention's first exercise:

- The archive was already in place when this audit started (PR #28 moved the prior audit before this run); Phase 0 step 0.0 short-circuited correctly (no `status.json` to archive). The skip path is the simpler of the two; the *real archive path* will get exercised on audit #3, when Phase 0 step 0.0 needs to move *this* audit out.
- Carry-forward in Phase 3.1 worked: reading the archived `09-backlog.md` and `10-roadmap.md` from `docs/audit-archive/2026-05-28-v0.4.0-initial-dogfood/` was straightforward.
- The `HISTORY.md` index proved useful — one-row scan to confirm "this is the most recent archive" before reading.

**Recommended for the next audit (audit #3)**: verify the archive procedure (Phase 0 step 0.0) when it has a *prior completed audit to archive*. That's the real validation of the convention.

## Recommended cadence

When should audit #3 run?

- **After Batch 1 lands** — quick sanity re-audit (`/audit-quick`, just Phase 0-1) to confirm the doc-residue items are closed.
- **After Batch 2's PR 2.1 (lint) lands** — re-audit Phase 1 (compliance) to confirm no surprise violations.
- **On the next minor version bump (0.5.0 → 0.6.0)** — full `/audit` to capture whatever's accumulated.
- **Otherwise**: quarterly `/audit-quick` for fast health check; full `/audit` on significant feature additions or before any external announcement.

## Carry-forward delivery rate

| Audit cycle | Days elapsed | Prior items addressed | Delivery rate |
|---|---|---|---|
| 2026-05-28 → 2026-06-03 | 6 | 11 / 11 actionable | 100% |
| 2026-06-03 → next | — | TBD | — |

100% close rate on the first cycle is the strongest possible signal that the audit-as-tool is producing actionable output and the team is acting on it. The second-cycle delivery rate is the validation that this pattern holds.

## Project-Specific

*(No `docs/audit-extensions.md`.)*
