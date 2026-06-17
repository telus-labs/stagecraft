# 05 — Documentation gaps

> Phase 1.3 output. Read `01-architecture.md` first.

## Summary

One paragraph: what's the state of docs? Adequate, partial, missing, stale?

## README quality

- **Quality:** complete / partial / missing.
- **Has:** <e.g. install, run, test, contributing pointer, …>
- **Missing:** <e.g. no architecture overview, no troubleshooting section>
- **Stale references:** <list of things the README mentions that no longer exist>

## Component docs

Which sub-modules / packages / services have docs (README, doc-comments, in-line) and which don't.

| Component | Has docs? | Coverage | Notes |
|---|---|---|---|
| | yes / no / partial | high / medium / low | |

## API documentation

For services that expose APIs (HTTP, gRPC, CLI, library):

- **Where it lives:** <OpenAPI spec / autogen from code / hand-written / nowhere>
- **Accurate vs. code:** <verify with a spot check>
- **Examples:** present / absent

## Inline documentation

- **Complex logic explained:** sample — was the comment density adequate where the code was non-obvious?
- **Places you had to read 3× to understand:** <list specific files / functions>

## Stale docs

References to things that no longer exist — file paths, APIs, commands, version numbers.

| Doc | Reference | What's wrong | Suggested fix | Verified by |
|---|---|---|---|---|
| `README.md:42` | `scripts/audit.js` | file doesn't exist | remove or update | <command / code inspection + observed result> |

## Onboarding test

Run the install + run + test commands from `00-project-context.md` mentally (or actually). Where would a new developer get stuck?

- <friction point> — **Verified by:** <command / code inspection + observed result>
- <friction point>

## Project-Specific

> *(Appended by extensions if applicable.)*
