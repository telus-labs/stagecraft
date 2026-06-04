# Audit history

Index of completed Stagecraft self-audits. The current audit lives at [`../audit/`](../audit/); past audits are preserved here, one directory per audit, named `<date>-<version>-<context>/`.

When a new audit starts, the audit skill's step 0.0 archives the prior `docs/audit/` into this tree automatically (`skills/audit/SKILL.md` § Phase 0 step 0.0) and appends a row to the table below.

| Date | Version | Context | Phases completed | Headline |
|------|---------|---------|------------------|----------|
| 2026-05-28 | v0.4.0 | Initial self-audit (dogfood) | 0–3 (all 4) | 0 P0 · 5 P1 quick wins · 5 P2 targeted · 1 P3 strategic. ~5 days total effort to land everything except Parked items. Most value in Batch 1 (XS-effort hygiene). See [`2026-05-28-v0.4.0-initial-dogfood/10-roadmap.md`](2026-05-28-v0.4.0-initial-dogfood/10-roadmap.md). |

## Between-cycle observations

Findings, suggestions, and operational lessons that surfaced **after** the most recent audit closed but **before** the next audit runs. The audit skill's Phase 3.1 (`skills/audit/SKILL.md` § Phase 3.1) reads this section alongside the archived `09-backlog.md` / `10-roadmap.md` and either folds each observation into the new backlog or closes it out with a citation.

Append observations under the most-recent-audit subhead. When a new audit completes, its archive step moves the observations into the archived audit's tree (rename `### Since <date> audit` → `### Pre-<next-date> observations` inside the archived audit's `09-backlog.md`'s "Project-Specific" section, or similar — the operator at archive time decides). The convention is "observations live with the audit they informed."

### Since 2026-06-03 audit

These are not formal findings — they're operational signals from real PR work between audits #2 and #3. The next audit should treat each as a Phase-3 input and either promote it to a finding (with full effort/risk/confidence ratings) or close it out with a citation explaining why not.

- **`eslint-plugin-security` as a P3 candidate.** PR 2.1 (audit Q-2 / P2-1, lint tooling) deliberately deferred this plugin, reasoning that CodeQL on PR scans was already catching the shell-injection-shape class. Empirical signal since v0.5.0: three CodeQL alerts caught in one week — PR #31 (test plumbing `sh -c` with path interpolation), PR #34 (`tryOpen` exec→spawn defense-in-depth), PR #38 (two more — incomplete-sanitization regex escape in a test, and missing workflow permissions). CodeQL is doing real work that local ESLint isn't. Adding `eslint-plugin-security` (or just `no-child-process-exec` flavored custom rules) would catch the same class **pre-push** instead of **post-merge**. Audit #3 should revisit the defer decision.

- **CHANGELOG-per-PR fragments as a P3 candidate.** Merge conflicts on `[Unreleased]` hit 4+ times across Batch 1 + Batch 2 (PRs #25, #35, #36, #37 at minimum). Each was resolved manually — the resolution is always "preserve everything, just under the new heading" — but the friction compounds with PR volume. A `CHANGELOG.next/<slug>.md` per-PR fragment convention (concatenated at version-bump time) would dissolve the friction. The 2026-06-03 audit's `02-git-history.md` § "Quality concerns flagged in the log" mentioned this in passing but didn't promote it to an item; audit #3 should promote.

- **"Verify before promoting" discipline still didn't hold even after codification.** The 2026-05-28 audit's S5 retraction led to a `Process discipline — verify before promoting` rule added to `skills/audit/SKILL.md`. The 2026-06-03 audit then issued finding C-1 / D-4 / P1-4 based on memorized expectation about agent registrations that don't exist — retracted in PR #32 as the exact same failure mode. Codifying a rule once isn't enough: the rule's existence didn't gate the work. Audit #3 should consider an enforceable mechanism, not just textual guidance — e.g., embed a "grep for every symbol you cite" checklist directly in Phase 1.1 / 2.1 step bodies, or require a `verified_by` field on each finding ("grep command run, output observed") that the audit skill validates structurally before allowing promotion past LOW confidence.

## Diffing two audits

To compare the current audit against the most recent archived one:

```bash
# Find the most recent archive
ls -1d docs/audit-archive/*/ | sort | tail -1

# Diff the roadmap files
diff -u docs/audit-archive/<latest>/10-roadmap.md docs/audit/10-roadmap.md

# Or, for a file-by-file side-by-side overview
git diff --no-index docs/audit-archive/<latest>/ docs/audit/
```

Open items from a prior audit that haven't been addressed should be carried forward — the new roadmap should either close them out (with a citation explaining why) or re-prioritize them alongside the new findings.
