# Phase 8 — Release v0.7.0 and Semantic Sync

**Goal:** ship the ~34 accumulated fragments as v0.7.0 without misattributing the eight
backfills, and close the *semantic* staleness the consistency checker is blind to:
runbooks that describe the pre-convergence world, a stale ADR index, and the unexecuted
D5 token work.

Findings verified at main `2a1d985`. Prerequisite: Phase 7.1 merged (unpins the
stage-05.md trim in 8.3).

---

## 8.1 Fragment triage + cut v0.7.0

**Problem:** eight fragments (B2, B9, B10, C1, C3, C5, E7, G6) are retroactive backfills
describing code already **in the v0.6.0 tag** (verified via `git tag --contains` on the
implementing commits). Running `release assemble` today records them under v0.7.0 —
a misattribution time-bomb for anyone auditing what each version contained. Also:
`docs/BACKLOG.md`'s B9 row says "landed (Unreleased)" and eight `CHANGELOG.md#unreleased`
links point at content that lives in fragments.

**Change:**
1. Move the eight backfill fragments' content into the existing `[0.6.0]` CHANGELOG
   section (where the code actually shipped), each entry annotated
   "(entry backfilled post-release)". Delete those fragment files. Fix the BACKLOG row
   and the eight links.
2. Run the release flow for **v0.7.0**: assemble the remaining fragments + any
   `[Unreleased]` direct entries into a dated section; bump package.json (and lockfile
   via `npm install --package-lock-only`); the CI-template ref check updates with it.
   Same release-commit discipline as 2.5: verbatim folds, `date -u +%F`, no tag in the
   session (post-merge tag commands in the report), `[skip-changelog]` note for the PR.
3. **EXAMPLE.md re-capture** (the freshness advisory fires at >1 minor — v0.7.0 trips
   it): re-run the traced pipeline per the D6.1 release-checklist step and update the
   stamp. Pipeline behavior genuinely changed since v0.5.0 (convergence evidence,
   recipes, log filtering), so the capture is materially stale, not just stamped stale.
4. **examples/sms-opt-in gate refresh:** the captured gates say
   `"orchestrator": "devteam@0.1.0"` and predate C3/G10 — stage-04a lacks
   `license_check_passed`/`license_findings`, no gate shows `dispatched_tool_budget`.
   Regenerate or hand-update the example gates to current schema (the example is the
   canonical reference the drift sweep aligned everything to; it must not itself rot).

**Verify:** `npm run consistency` (template-ref + freshness checks green);
`node scripts/release.js check` clean; fresh init+doctor smoke; the 0.6.0 section now
contains the backfills with annotations.

---

## 8.2 Runbook and reference sync (the checker-blind staleness)

Each item is a targeted edit; one PR for the set.

1. **`docs/runbooks/escalation.md` convergence rewrite:** §4c still instructs operators
   to confirm exhaustion by jq-ing `retry_number` and says "three times identically" —
   but the implemented mechanism derives attempts from `pipeline/gates/archive/`
   precisely because `retry_number` is agent-falsifiable, and the default ceiling is 2.
   Rewrite to the archive-based reality (`no_progress_evidence`, archive-diff
   post-mortem), matching `autonomous-run.md` which is already correct. Also fix the two
   **dead anchors**: the TOC and §0 still link `#4b-retry-loop-exhaustion-...` but the
   drift sweep renumbered the heading to §4c.
2. **`docs/runbooks/fix-and-retry.md`:** (a) update §"convergence-exhausted" framing
   from pure retry-budget to budget-or-no-progress; (b) **new case: license-gate FAIL**
   (`license_check_passed: false`) — operationally distinct from the lint/test case
   (replace the dependency or change allowlist policy; not a `--patch` code fix), plus a
   row in `docs/runbooks/README.md`; (c) **rewrite Case 7 (a11y)** — it claims blockers
   "always" attribute to frontend, contradicting the shipped three-path recipe in
   `core/pipeline/fix-recipes.js`; document the recipe's actual paths ([verify-first]
   read the recipe AFTER Phase 6.4 lands — write to the post-6.4 behavior, which is why
   this phase follows 6); (d) the #109 lesson in the manual-recovery sections of Cases
   4/5: hand-clearing build gates must include `stage-04a.json` or lint silently
   bypasses; (e) one short entry for **tool-budget denials** (what a native denial looks
   like on claude-code, what prompt-only advisory non-compliance looks like, where
   `dispatched_tool_budget` is recorded) + index row.
3. **`docs/runbooks/autonomous-run.md`:** add the stale-archive symptom to the archive
   row — that `devteam restart` clears archives and that leftover archives from
   pre-Phase-5 versions could trip the breaker falsely (one paragraph; Phase 5.2 fixes
   the cause, the runbook covers operators on older states).
4. **`docs/adr/README.md`:** add ADR-006 to the index; correct ADR-004's status to
   Accepted; add a "Deferred" subsection listing ADR-005 (standing grants), ADR-007
   (heartbeat), ADR-008 (exit semantics) with one line each and a pointer to
   `plans/phase-4-capability-roadmap.md` §4.4 — today nothing under `docs/` records
   that the gap in numbering is deliberate. Consider a tiny consistency rule: every
   `docs/adr/*.md` appears in the index with a matching status ([verify-first] feasible
   within the existing checker classes; if awkward, skip and say so).
5. **`docs/tracks.md`:** one sentence + link for `devteam assess` — the doc whose
   subject is choosing a track never mentions the command that automates the choice.
6. **`rules/stage-02.md`:** the example gate JSON cites fictional project ADR numbers
   ("ADR-007", "ADR-012") that now collide with the real framework ADR namespace —
   rename the examples (e.g. "PADR-1") with a clarifying half-sentence.

**Verify:** `npm run consistency` green; the two fixed anchors resolve; grep shows no
remaining `retry_number` operator instructions in runbooks.

---

## 8.3 Execute D5 step 3 (the deferred token work)

**Problem:** the only remaining real per-dispatch token lever. `roles/platform.md`
(15,617 B — 97.6% of its 16 KB ceiling) and `roles/qa.md` (12,878 B) are loaded on every
dispatch of those roles. The D5 audit proposed moving their stage-conditional content
into skills (loaded only when the stage runs) but executed nothing. Separately
`rules/stage-05.md` (9,985 B) exceeds its 8 KB advisory ceiling — zero dispatch cost
(stage rule files are not in readFirst) but it is the one live advisory and Phase 7.1
unpinned it.

**Change:**
1. Read the D5 step-4 proposal in the docs-prompts report / `changelog.d` D5 fragment
   [verify-first]; move the identified stage-conditional sections from
   `roles/platform.md` and `roles/qa.md` into the corresponding `skills/*/SKILL.md`
   files (which load per-stage), leaving role identity + handoff + gate rules in the
   briefs. Preserve every limitation/caveat moved.
2. Trim `rules/stage-05.md` under its ceiling: the review attributed the overage to
   absorbing both review-shape tables + the full hook contract; move the
   approval-derivation hook contract detail to `docs/conventions.md` (operator/reference
   material) and keep the model-facing essentials.
3. Regenerate `docs/reference/prompt-budget.md` and record before/after per-dispatch
   bytes for the platform and qa dispatches in the PR description. The consistency
   advisory count should drop to zero.

**Verify:** `npm run consistency` — zero advisories; `npm run docs:generate` no diff
after regeneration; contract tests green (role/skill content moves can trip pinned
prose — update deliberately and enumerate).

---

## Sequencing & exit criteria

8.2 items (a)–(c) depend on Phase 6.4's recipe shape; everything else can start after
7.1. Suggested: 8.3 → 8.2 → 8.1 last (the release folds everything, including this
phase's own fragments).

**Phase exit:** v0.7.0 tagged with honest attribution; EXAMPLE.md and example gates
current; zero consistency advisories; an operator following any runbook during a
convergence, license, or tool-budget event gets instructions that match the shipped
system.
