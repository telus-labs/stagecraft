# Architecture Decision Records

ADRs capture decisions that shape the system, why they were made, and what alternatives were considered. They are written *when* a decision is made, not retroactively, and not edited after they land (a new ADR supersedes an older one).

## When to write one

Any decision that meets one of:

- Reverses or constrains a previous decision (supersedes another ADR).
- Locks something in `ARCHITECTURE.md`'s "Design decisions (locked)" list.
- Picks one of several plausible alternatives and the reasoning isn't obvious from the code.
- Affects how someone outside this team works with the framework (extension points, file paths, gate shape).

Trivial fixes, refactors that preserve behavior, and incremental polish do not need an ADR.

## File format

`NNNN-short-kebab-title.md`. Numbered sequentially. Front-matter:

```markdown
# ADR NNNN — Title

**Status:** Proposed | Accepted | Superseded by ADR-XXXX
**Date:** YYYY-MM-DD
**Authors:** name(s)

## Context
Why are we deciding this now? What's the situation?

## Decision
What did we decide?

## Consequences
What follows from this — good and bad. What now needs to be true.

## Alternatives considered
What else was on the table and why we didn't pick those.
```

## Index

| ADR | Title | Status |
|---|---|---|
| [001](001-unification-vs-fork.md) | Unification: one core, per-host adapters (vs maintaining two forks) | Accepted |
| [002](002-host-adapter-contract.md) | Host adapter contract: capabilities + install + renderStagePrompt + status + uninstall | Accepted |
| [003](003-bounded-autonomous-execution.md) | Bounded autonomous pipeline execution: typed failure model + authority provenance + consequence-ceilinged driver | Accepted |
| [004](004-role-tool-budgets.md) | Role tool budgets: host-native tool pinning via ROLE_FRONTMATTER, capability-level degradation, MCP vocabulary deferred | Proposed |
