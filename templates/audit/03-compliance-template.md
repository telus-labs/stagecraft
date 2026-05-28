# 03 — Convention compliance

> Phase 1.1 output. Read `00-project-context.md` and `01-architecture.md` first. Audit the codebase against its own stated rules; if no rules are documented, audit for internal consistency.

## Summary

One paragraph: how consistent is this codebase with its stated (or implied) conventions? Are deviations rare or systemic?

## What "the convention" is

For each category, name the source of truth.

| Category | Source | Stated explicitly? |
|---|---|---|
| Naming (files, identifiers) | <e.g. CONTRIBUTING.md §3 / dominant pattern> | yes / no (implied) |
| Error handling | | |
| Architecture (layering, ports/adapters) | | |
| Logging | | |
| Dependency usage | | |
| Test structure | | |

## Findings

Each finding cites file + line, the convention or dominant pattern, how the code deviates, the suggested fix, and a confidence rating.

### Naming

#### Finding N1: <short title>

- **Where:** `path/to/file.ext:NN`
- **Convention:** <stated or implied>
- **Deviation:** <how this code differs>
- **Suggested fix:** <what to change>
- **Confidence:** HIGH / MEDIUM / LOW
- **Notes:** <optional context>

### Error handling

…

### Architecture

…

### Logging

…

### Dependency usage

…

### Test structure

…

## Possibly intentional deviations

Code that breaks a pattern but might do so for a defensible reason. These are *questions*, not findings — the author may have a good answer.

- <deviation> — <where> — <why it might be intentional>

## Project-Specific

> *(Appended by extensions if applicable.)*
