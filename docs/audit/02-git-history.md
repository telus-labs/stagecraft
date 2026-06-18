# 02 — Git history

## Scope and completeness

History is complete enough for analysis: 692 commits are reachable on the audit branch,
and 550 commits landed after the prior audit commit on 2026-06-03. The repository is
young, so “last six months” effectively means the full project history.

## Churn hotspots

| Commits | Path | Interpretation |
|---:|---|---|
| 103 | `CHANGELOG.md` | Release/history hotspot; fragments now reduce concurrent edits |
| 77 | `core/orchestrator.js` | Central feature and bug-fix hotspot |
| 68 | `bin/devteam` | Historical CLI hotspot; command-module split reduced future pressure |
| 67 | `docs/BACKLOG.md` | Roadmap was updated continuously as features landed |
| 59 | `README.md` | Product surface and onboarding evolved rapidly |
| 53 | `docs/user-guide.md` | Operational surface expanded with CLI features |
| 45 | `docs/FEATURES.md` | Shipped-capability catalog grew substantially |
| 40 | `plans/prompts/ALL-PROMPTS.md` | Fifteen-phase execution program tracked in one source |
| 34 | `plans/README.md` | Phase status and evidence review index |
| 34 | `docs/faq.md` | Operational edge cases documented during dogfooding |
| 34 | `core/driver.js` | Autonomous behavior expanded rapidly |
| 28 | `tests/next.test.js` | Lockstep tests for scheduling/remediation behavior |
| 28 | `core/pipeline/stages.js` | Stage/track expansion and capability metadata |
| 26 | `package.json` | Releases, dependencies, scripts |
| 23 | `hosts/claude-code/adapter.js` | Richest adapter and tool-budget/install surface |
| 23 | `docs/runbooks/fix-and-retry.md` | High operational learning volume |
| 22 | `tests/run.test.js` | Lockstep autonomous-driver coverage |

## Co-change patterns

Strongest pairs:

| Commits | Pair | Meaning |
|---:|---|---|
| 36 | `CHANGELOG.md` + `docs/BACKLOG.md` | Historically, landed work updated both release and roadmap state |
| 28 | `CHANGELOG.md` + `README.md` | User-facing changes frequently touched top-level docs |
| 26 | `plans/README.md` + `plans/prompts/ALL-PROMPTS.md` | Plan status duplicated across two coordinated artifacts |
| 26 | `CHANGELOG.md` + `bin/devteam` | CLI changes were release-noted |
| 23 | `README.md` + `docs/user-guide.md` | Product and operator docs evolved together |
| 21 | `bin/devteam` + `core/orchestrator.js` | Historical CLI/orchestration coupling before command extraction |
| 20 | `core/driver.js` + `tests/run.test.js` | Healthy code/test lockstep |
| 20 | `core/orchestrator.js` + `tests/next.test.js` | Healthy scheduling/test lockstep |
| 14 | `package.json` + `package-lock.json` | Expected dependency/release coupling |
| 11 | Claude and Codex adapters | Shared adapter capabilities/rendering changes |

The strongest code/test pairs are positive. The strongest documentation pairs explain
why the consistency generator and changelog-fragment system were valuable: manual
multi-file synchronization was a recurring tax.

## Recent trajectory

The period since 2026-06-03 has four clear arcs:

1. **Trust and state integrity.** Autonomous-path guards, gate invalidation, archive
   lifecycle, convergence detection, bounded isolation, and mechanical verification.
2. **Promise and documentation integrity.** Generated references, prompt budgets,
   semantic doc synchronization, changelog fragments, and doc/update gates.
3. **Capability expansion.** Repair mode, deploy adapters, git workflow automation,
   liveness/status, adapter conventions, pluggable adapter discovery, Windows work.
4. **Dogfooding correction.** Many narrowly scoped fixes landed from real pipeline use:
   marker repairs, track awareness, restart cleanup, AC parsing, advise parsing,
   convergence, targeted file-owner retries, and transient stub-gate handling.

The project completed fifteen planned phases by 2026-06-16, then shifted into smaller
review-driven PRs. On 2026-06-17 alone, PRs #203–#229 covered dependency updates,
operational fixes, backlog completion, portability, docs gating, and targeted retry
proof. This is high delivery velocity with a meaningful risk of documentation and
backlog lag even though most code changes are small.

## Commit quality

For the 550 commits since the prior audit:

- 368 are non-merge commits.
- Median changed files per non-merge commit: **3**.
- Mean changed files: **4.6**.
- Only **4** non-merge commits touched 20 or more files.
- The largest changes were bounded release, rules-split, lint-bootstrap, and broad
  prose-tightening operations rather than unfocused feature commits.

Commit messages are generally explanatory and PR-oriented. Many describe rationale,
test evidence, known limitations, and follow-up gates. The required co-author trailers
are consistently visible in recent work. Merge commits preserve PR identity.

## Quality signals from history

Positive signals:

- Fixes typically include a focused test in the same commit/PR.
- Broad refactors are rare and named explicitly.
- Plans and ADRs precede high-risk capability work.
- Evidence-gated items (D5, H3, ADR-007 Tier 2) were deliberately not implemented
  without operational data.
- The last audit’s actionable items and between-cycle observations were all addressed.

Risks to examine in later phases:

- `core/orchestrator.js` and `core/driver.js` combine high churn with centrality.
- Backlog/feature/reference docs have high churn and may contain shipped-but-open rows.
- One-day bursts of many merged PRs increase integration risk even with narrow diffs.
- `CHANGELOG.md` remains the top hotspot despite fragments, because release assembly
  and historical edits still touch it.

## Carry-forward record

The prior audit’s open roadmap must be checked in Phase 3:

- P3-1 replay refactor
- P3-2 log JSON schema documentation
- P3-5 backlog noise reduction
- five parked items

The between-cycle observations in `docs/audit-archive/HISTORY.md` must also be closed or
promoted. Preliminary history already shows all three observations led to shipped work:
`eslint-plugin-security`, changelog fragments, and structural `verified_by` evidence.

## Project-specific extensions

No `docs/audit-extensions.md` file is present.
