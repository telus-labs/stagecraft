# 02 — Git history

> Phase 0.3 output. Read `01-architecture.md` first. If git history is shallow or unavailable (e.g. `--depth=1` clone), note it at the top and skip the rest — don't fabricate findings.

## Window

- Time window analyzed: <e.g. last 6 months>
- Total commits in window: <N>
- Distinct authors in window: <N>

## Churn hotspots

Files / directories with the most commits in the analyzed window. Generated via:

```sh
git log --since="6 months ago" --pretty=format: --name-only | grep -v '^$' | sort | uniq -c | sort -rn | head -30
```

| Count | File / Dir | What it is | Note |
|---|---|---|---|
| | | | |

Hotspots are not automatically bad — they reflect active work. Flag the cases where churn looks like *thrashing* (same area changing repeatedly with no convergence) rather than evolution.

## Co-change patterns

Files that change together. Hidden coupling — when one of them changes, the other often does too. Generated via:

```sh
git log --since="6 months ago" --pretty=format:"---" --name-only | grep -v '^$'
```

Then group by commit and count co-occurrences.

| Pair | Co-change count | Plausible? |
|---|---|---|
| | | |

Look for: surprising pairs (files in unrelated subsystems that keep changing together) and missing pairs (test files that *should* change with source files but don't).

## Recent trajectory

What's actively evolving vs. stable.

- **Actively evolving:** <areas with >10 commits this window>
- **Stable:** <areas with <3 commits this window>
- **Dead-feeling:** <areas with 0 commits this window — worth verifying they're still in use>

## Commit quality

Read a sample of ~20 recent commits.

- **Small / focused** or **large / unfocused**: <observation>
- **Conventional Commits**: yes / no / partial
- **Review discipline**: commits are reviewed PR-by-PR, or direct-pushed?
- **Squash vs. merge**: history style.

## Project-Specific

> *(Appended by extensions if applicable.)*
