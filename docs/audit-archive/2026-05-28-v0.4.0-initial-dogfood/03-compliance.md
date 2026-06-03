# 03 — Convention compliance

## Summary

Stagecraft is unusually compliant with its own stated rules. The codebase is small, single-author, and recently audited (twice — once by the v0.1.0 audit and once via the P1/P2 cleanups). Most categories audit clean. The findings below are minor — a handful of small consistency issues, mostly cosmetic.

## What "the convention" is

| Category | Source | Stated explicitly? |
|---|---|---|
| Naming (files, identifiers) | `AGENTS.md` (file-naming hints) + dominant pattern | partial (implied) |
| Built-in imports | dominant pattern across `core/` | implied — most files use `require("node:fs")` form |
| Error handling | `core/` modules return structured errors; CLI uses `process.exit()` codes | implied |
| Architecture (core/adapter separation) | `ARCHITECTURE.md` decision #2; `core/adapters/host-adapter.md` contract | yes |
| Logging | `process.stderr.write` for warnings; `console.log` for user output; structured JSON via `LOG_FORMAT=json` for the validator | implied |
| Dependency usage | `package.json` `~` pins for OTel; `^` for `js-yaml` and `@huggingface/transformers` | implied |
| Test structure | `node:test` + `node:assert/strict`; subprocess for `process.exit()`-heavy modules | implied (every test follows this) |
| Commit messages | Conventional Commits | implied — every commit in history conforms |

## Findings

### Naming

Audit clean. File names follow consistent kebab-case (`security-heuristic.js`, `approval-derivation.js`). Module exports use camelCase. No deviations found.

### Built-in imports

#### Finding N1: `core/gates/validator.js` uses bare `fs` / `path` instead of `node:fs` / `node:path`

- **Where:** `core/gates/validator.js:29-30`
- **Convention:** every other JS file in the codebase uses the `node:` prefix on built-in modules (verified: 0 other files use bare names).
- **Deviation:**
  ```js
  const fs = require("fs");
  const path = require("path");
  ```
- **Suggested fix:** change to `require("node:fs")` and `require("node:path")` for consistency.
- **Confidence:** HIGH
- **Notes:** purely cosmetic — both forms are equivalent at runtime. Likely an artifact of validator predating the convention.

### Error handling

Audit clean. Three patterns observed, all consistent with their context:

1. **CLI entry points** (`bin/devteam`, `scripts/*.js`): `process.exit(code)` on errors, with `console.error()` first. Tested via subprocess.
2. **Core modules** (`core/orchestrator.js`, `core/router.js`, etc.): throw `Error` with descriptive messages. Caller decides what to do.
3. **Hooks** (`core/hooks/*.js`): exit non-zero to halt the host's tool call; print to stdout/stderr for the hook log.

No silent failure paths observed. No swallowed exceptions. No catch-and-rethrow with lost context.

### Architecture

Audit clean. The core/adapter contract is honored:

- No `core/*.js` file imports from `hosts/*/`. (Verified via grep.)
- No host adapter imports stage definitions, gate schemas, or routing logic from core — they receive descriptors built by the orchestrator. (Verified via spot-check of `hosts/claude-code/adapter.js`, `hosts/codex/adapter.js`, `hosts/gemini-cli/adapter.js`.)
- `core/adapters/headless.js` is the only shared utility imported by multiple adapters; it lives in `core/` precisely because it's host-neutral.

### Logging

#### Finding L1: mixed `console.log` and `process.stderr.write` patterns

- **Where:** scattered across `bin/devteam`, `core/observability.js`, `core/ui/server.js`.
- **Pattern:** the choice between `console.log` (stdout) and `process.stderr.write` (stderr) is consistent *within* each file but the project-wide convention isn't documented.
- **Convention observed:** stdout for things the user reads as primary output (CLI summaries, prompt rendering); stderr for warnings, errors, and side-channel framing (the onboarding preamble printed by `bin/devteam stage`).
- **Suggested action:** document this in `AGENTS.md` or a new `docs/conventions.md`. Currently it's an unstated norm new contributors would have to reverse-engineer.
- **Confidence:** MEDIUM (the norm is real but unstated)

### Dependency usage

Audit clean. Recent P2 tightening migrated OTel deps to `~` (patch-only); only `js-yaml ^4.1.0` and `@huggingface/transformers ^4.2.0` use caret. Both are stable 1.x+ packages where minor versions don't traditionally break.

### Test structure

Audit clean. Every test file:
- Uses `require("node:test")` + `require("node:assert/strict")` ✅
- Uses `_helpers.js`'s `makeTargetProject` / `seedGate` / `runCLI` for fixtures ✅
- Names tests with the action being verified ("seeds Z when X", not "test_x_y") ✅
- Cleans up tempdirs via `cleanup()` or `afterEach` ✅

### Commit messages

Audit clean. All 47 commits follow Conventional Commits. The least-standard prefix observed (`ux:` on the onboarding-framing commit) is a defensible extension of the standard list.

## Possibly intentional deviations

- **`core/gates/validator.js` is the only `process.exit()`-on-every-branch module in `core/`.** It's intentional — the validator is spawned as a subprocess by Claude Code's Stop hook, and `process.exit()` is the contract surface (exit codes 0/1/2/3). Documented in the file's comment block (line 355–359). Not a finding.

- **`hosts/claude-code/adapter.js` is 404 LOC vs 233 / 234 for codex / gemini-cli.** Reflects the host's larger capability surface (hooks, slash commands, settings management) and isn't a code-quality issue.

- **`scripts/budget.js` carries a `#!/usr/bin/env node` shebang despite being launched via `npm run budget`.** Deliberate — the file was an `argv`-driven script before the recent relocation, and the shebang allows direct invocation if a user `chmod +x`'s it. Acceptable but worth a comment in the file header.

## Project-Specific

*(No `docs/audit-extensions.md` is present in this repo, so no project-specific compliance checks run.)*
