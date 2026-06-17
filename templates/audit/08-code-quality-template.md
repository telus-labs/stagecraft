# 08 — Code quality

> Phase 2.3 output. Read `01-architecture.md` and `02-git-history.md` first. Focus on highest-churn files. Every finding gets Effort + Impact + Confidence ratings plus Verified by evidence.

## Summary

One paragraph: the overall quality picture. Is the code tidy, drift-y, or fragmented?

## Rating scales

- **Effort to fix:** small (one PR, <1 day) / medium (a few PRs, days) / large (epic, weeks)
- **Impact if fixed:** high / medium / low
- **Confidence:** HIGH / MEDIUM / LOW

## Findings

### Duplication

Significant duplicated logic. Identify shared-abstraction candidates; flag intentional duplication.

#### Finding Q1: <short title>

- **Where:** `path/to/A.ext` and `path/to/B.ext` (and possibly more)
- **What's duplicated:** <e.g. validation logic for user input, retry wrapper, …>
- **Effort:** small / medium / large
- **Impact:** high / medium / low
- **Confidence:** HIGH / MEDIUM / LOW
- **Verified by:** <command / code inspection + observed result>
- **Suggested abstraction:** <name + shape>
- **Note:** if intentional, say so and stop here.

### Complexity hotspots

Deep nesting, high cyclomatic complexity, functions you had to trace 3× to understand.

| Location | Why it's complex | Effort | Impact | Verified by |
|---|---|---|---|---|
| | | | | |

### Dead code

Unused imports, unreachable branches, commented-out blocks, orphaned files. Distinguish "obviously dead" from "possibly used dynamically" (reflection, dynamic dispatch, plugin loading).

| Code | Type | Confidence dead | Verified by |
|---|---|---|---|
| | unused import / unreachable / orphan file / commented-out | HIGH / MEDIUM / LOW | |

### Abstraction health

God classes, leaky abstractions, over-abstraction (single-use helpers, premature inheritance).

…

### Naming and clarity

Misleading names, magic numbers, undocumented constants.

…

### Dependency health

Unused deps, duplicate functionality across packages, very outdated packages.

| Package | Version | Latest | Used? | Recommendation | Verified by |
|---|---|---|---|---|---|
| | | | yes / no / unclear | keep / remove / upgrade | |

## Project-Specific

> *(Appended by extensions if applicable.)*
