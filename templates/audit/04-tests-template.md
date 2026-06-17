# 04 — Test health

> Phase 1.2 output. Read `01-architecture.md` first.

## Summary

One paragraph: how healthy is the test suite? Does it run? Does it catch real bugs? Is coverage targeted or scattershot?

## Test infrastructure

| Item | Value |
|---|---|
| Runner | <e.g. jest / pytest / cargo test / node --test / …> |
| Test command | <e.g. `npm test`> |
| Currently passing? | yes / no — <if no: how many failing> |
| CI runs tests? | yes / no |
| Coverage tool wired? | yes / no — <tool name> |
| Current coverage (if available) | <%> |

## Coverage map

Where the tests are vs. where the code is.

| Component | Test count | Test types | Notes |
|---|---|---|---|
| | | unit / integration / e2e | |

## Untested critical paths

Business logic, error handling, integrations with zero or near-zero coverage. Each is a concrete risk.

- `path/to/file.ext` — <what this code does> — <why missing tests matter> — **Verified by:** <command / code inspection + observed result>

## Test quality issues

Findings about *how* tests are written, not just whether they exist. Every finding includes direct verification evidence.

| Finding | Where | Why it matters | Verified by |
|---|---|---|---|
| Empty / trivial assertions | | | |
| Implementation coupling (mocks dictate interface) | | | |
| Overbroad mocks (mocking what you shouldn't) | | | |
| External service calls in tests | | | |
| Missing edge cases | | | |
| Order dependencies | | | |

## What's well-tested

Positive examples worth replicating elsewhere.

- <component> — <what's good about its tests>

## Project-Specific

> *(Appended by extensions if applicable.)*
