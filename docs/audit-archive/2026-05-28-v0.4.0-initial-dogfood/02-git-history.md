# 02 — Git history

## Window

- Time window analyzed: all-time (the repo is ~3 months old; full history fits)
- Total commits: **47**
- Distinct authors: 1 (single-author project + Claude as co-author)
- Tags: `v0.1.0`, `v0.2.0`

## Churn hotspots

Top 12 files by all-time commit count:

| Count | File | Type | Note |
|---|---|---|---|
| 20 | `CHANGELOG.md` | doc | Expected — every commit touches it. Healthy. |
| 14 | `docs/BACKLOG.md` | doc | Active prioritization; expected. |
| 13 | `package.json` | config | Version bumps + dep changes. Healthy. |
| 9 | `core/orchestrator.js` | code | Hottest source file. Watch for further growth. |
| 9 | `bin/devteam` | code | CLI entry point. Subcommand additions drive churn. |
| 8 | `hosts/claude-code/adapter.js` | code | Most-capable host; expected to be most-edited. |
| 7 | `README.md` | doc | Recent uplift bumped this. |
| 7 | `package-lock.json` | generated | Tracks `package.json`. Normal. |
| 6 | `core/pipeline/stages.js` | code | New stages added incrementally (4b, 6b, 6c). |
| 5 | `hosts/codex/adapter.js` | code | |
| 5 | `EXAMPLE.md` | doc | |
| 5 | `docs/faq.md` | doc | |

**Hotspot health:** every top entry has a defensible reason. No file looks like it's being thrashed (same area edited repeatedly without convergence). `core/orchestrator.js` at 9 commits is the closest thing to a watch list — it's grown from ~300 LOC to 493 LOC over the period and is the natural future split candidate (BACKLOG item, not done yet).

## Co-change patterns

Significant pairs observed across the 47-commit history (counted manually from recent diffs):

| Pair | Co-change frequency | Plausible? |
|---|---|---|
| `package.json` ↔ `package-lock.json` | every dep change | Yes — generated artifact. |
| `core/pipeline/stages.js` ↔ `core/gates/schemas/stage-NN.schema.json` | every new stage | Yes — schema must match stage. Consistency lint catches drift. |
| `core/pipeline/stages.js` ↔ `roles/<role>.md` | when a stage adds a role | Yes — role briefs must exist for referenced roles. Consistency lint catches drift. |
| `hosts/*/adapter.js` ↔ `roles/*.md` | when a new role lands | Mostly — each adapter has its own `ROLES` list (or `ROLE_FRONTMATTER` for claude-code). **Recent finding: auditor role was added but had to be added to each adapter's role list manually. Three places to update.** Flagged in this audit as a small "could be DRY'd" code-quality item. |
| `CHANGELOG.md` ↔ anything | every feature commit | Yes — disciplined CHANGELOG hygiene. |
| `docs/BACKLOG.md` ↔ feature commits | when items land | Yes — ✅ landed annotations track this. |
| `docs/faq.md` + `docs/user-guide.md` + `docs/concepts.md` | tier 1/2 doc uplift commits | Yes — doc batches landed as logical groups. |

**Missing co-change pairs worth flagging:**

- `core/orchestrator.js` ↔ `tests/orchestrator.test.js` — observed in some commits but not all; some orchestrator changes don't bump the test file (the changes may be covered by other tests, but explicit verification is missing). LOW-confidence concern.
- `scripts/budget.js` ↔ `tests/budget.test.js` — the budget tests landed in the same commit as the script move (good); no subsequent changes to either.

## Recent trajectory

**Actively evolving (this period):**
- Documentation surface (presentation-notes, user-guide, adoption-guide, faq, EXAMPLE, concepts) — multiple commits in tier 1/2/3 uplift, plus the onboarding-gap fix.
- Audit feature (the one running right now) — landed in the most recent commit.

**Stable (no recent changes):**
- `core/pipeline/stages.js` since stage-06c (observability gate) landed.
- `core/gates/validator.js` since the GATES_DIR lazy refactor (P1 audit item).
- `core/router.js` — never had a follow-up edit after initial commit.
- `core/memory/*` — landed at v0.2.0, no churn since.
- Gate schemas (`core/gates/schemas/`) — only churn was the recent `$id` URN migration (P2 audit item).

**Dead-feeling:**
- None observed. Every directory has had at least one commit in the last month.

## Commit quality

Sample size: last 20 commits (over the period since v0.1.0).

- **Small / focused:** Yes — most commits do one thing well. The largest commit is the audit feature (`108ca0a`, 27 files, +1,735 lines) but that's a single coherent feature, not a bag of unrelated changes.
- **Conventional Commits:** Yes — `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:`, `ci:`, `ux:` (a small extension). Consistent across all 47 commits.
- **Review discipline:** No PR reviews visible — single-developer flow with Claude as co-author. Every commit has the `Co-Authored-By: Claude` trailer.
- **Squash vs. merge:** Linear history; no merge commits. Suggests rebase-based workflow or commits-direct-to-main.

## Open observations

- **Audit-driven cadence.** The last ~6 commits trace an explicit audit→fix→cut-release→re-audit pattern (v0.2.0 release, then P1 / P2 audit items, then doc uplift, then the audit feature itself). Healthy, disciplined.
- **No CI failures in history.** Single CI workflow on Node 20/22/24; the only CI fix commit (`4d28e46`) was preemptive (dropping Node 18 EOL before it bit).
- **Co-author trailer is consistent** — every commit credits Claude. Good for attribution; required for the project's stated AI-collaboration norm.
