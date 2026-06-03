# 00 — Project context

## Summary

Stagecraft is a model-agnostic AI dev-team pipeline orchestrator. It installs role briefs, slash commands, hooks, and rules into a target project, then orchestrates a 17-stage software-development pipeline across one or more AI coding tools (Claude Code, Codex CLI, Gemini CLI, generic). It also ships a codebase audit feature — which is what's producing this very document.

This is the **second self-audit** — Stagecraft auditing itself, six days after the first dogfood run on 2026-05-28. The prior audit's full output is preserved at `docs/audit-archive/2026-05-28-v0.4.0-initial-dogfood/`. Phase 3 of this audit will carry forward unresolved items from that backlog (per the new audit skill § 3.1 rule).

## Languages and frameworks

| Language | Version | Where |
|---|---|---|
| JavaScript (Node) | ≥20 (engines.node) | `core/`, `bin/`, `hosts/`, `scripts/`, `tests/` |
| Markdown | — | `docs/`, `rules/`, `roles/`, `skills/`, `templates/`, root |
| JSON Schema | draft 2020-12 | `core/gates/schemas/` |
| YAML | — | host adapter `capabilities.json`, `.devteam/config.yml` (in target projects) |

**Frameworks:** none. No web framework, no test framework beyond `node --test` (built-in), no ORM. All deliberate — this is an orchestrator, not an application.

## Build & dependency manager

- Manager: `npm`. Lockfile present (`package-lock.json`).
- Build step: none. Pure Node, no transpilation, no bundler.
- Dependencies (production): `@huggingface/transformers` (memory embedder), 6 `@opentelemetry/*` packages (observability SDK), `js-yaml`. No dev dependencies.

## Commands

```sh
npm install                                # install dependencies
npm test                                   # 778 tests across 123 suites, ~5s wall-clock
npm run consistency                        # cross-artifact consistency lint
./bin/devteam help                         # CLI entry
./bin/devteam init --host claude-code      # install host adapter into a target project
./bin/devteam stages                       # list known pipeline stages
```

Other npm scripts: `visualize`, `pr-pack`, `pr-publish`, `dashboard`, `dashboard:cost`, `performance`, `routing:suggest`, `budget`, `release:check`, `release:notes`.

## Deployment target

Not deployed. Developer tool installed via `npm link` (or future `npm install -g`). Users `git clone` the framework, run `npm install`, then run `devteam init` in target projects to lay down per-host surfaces.

CI: `.github/workflows/test.yml` runs `npm test` + `npm run consistency` + `./bin/devteam help` + `devteam init --host claude-code` + `devteam doctor` against a fresh `mktemp -d` target. Matrix: Node 20, 22, 24. No artifacts published.

## Documented vs. undocumented-but-implied conventions

**Documented** (load-bearing, codified in `AGENTS.md` / `ARCHITECTURE.md` / rules):

- Gate JSON identity fields: `stage`, `status`, `orchestrator`, `track`, `timestamp`, `blockers`, `warnings`. Workstream gates add `workstream`, `host`. Merged gates add `workstreams[]`. No `agent` field anywhere.
- Workstream gate naming: `pipeline/gates/<stage>.<workstream>.json` (dot separator). Stage merged: `pipeline/gates/<stage>.json`.
- Routing precedence: `routing.stages[stage] → routing.roles[role] → routing.default_host`.
- `node:` prefix on every built-in import (`require("node:fs")`, `require("node:path")`).
- stdout = primary output, stderr = framing/logs. Validator + hooks are exit-code-driven (exception).
- Host-neutral paths in shared content (`.devteam/rules/`, `roles/`, `skills/`). Adapters do path transforms at install time.
- Idempotent installs — every adapter `install()` must be safe to re-run.
- 11 locked design decisions in `ARCHITECTURE.md` — not casually editable.
- **NEW since prior audit:** Audit-archive convention — past audits land in `docs/audit-archive/<date>-<version>-<context>/`; the skill's Step 0.0 enforces. Inter-agent marker vocabulary catalogued in `docs/conventions.md` (`QUESTION:` / `PM-ANSWER:` / `BLOCKER:` / `SUGGESTION:` / `PATTERN:` / `REVIEW:` / `ESCALATE:` / `PRINCIPAL-RULING:`).

**Undocumented but implied** (still load-bearing, surfaces in code but no dedicated docs):

- Naming: `cmdX` for `bin/devteam` subcommand functions, `parseFlags()` shape for flag handling.
- Error handling: `console.error` + `process.exit(N)` rather than throwing.
- Test file naming: `tests/*.test.js`, single-level (no subdirectories).
- Slash command `.md` files live under `hosts/<host>/install/commands/`, copied to `.claude/commands/` at install for claude-code.

## Codebase size

| Surface | Count |
|---|---|
| Total files (excluding node_modules, .git, docs/audit-archive) | 254 |
| `core/` JS files | 29 |
| `core/` lines (incl. `bin/devteam`) | 9,146 |
| Tests | 49 files, 778 tests, 123 suites |
| Hosts | 4 (`claude-code`, `codex`, `gemini-cli`, `generic`) |
| Roles | 14 `.md` briefs under `roles/` |
| Stages | 17 (full track), 6 tracks total |
| Rules docs | 21 files under `rules/` |
| Skills | 13 under `skills/` |
| Per-stage schemas | under `core/gates/schemas/` |
| Templates | under `templates/` |

## Monorepo vs single app

Single app. One Node package, one CLI binary (`devteam`), one test suite. The `hosts/<host>/` directories aren't separate packages — they're adapters loaded by the core.

## Surprises and open questions for this audit

What's changed since 2026-05-28 (high-level — for the full picture, see CHANGELOG.md `[Unreleased]` and PR history #20–#28):

- **New CLI subcommands**: `devteam ruling`, `devteam derive-approvals`, `devteam log`, `devteam restart`, `devteam verify`. The CLI surface grew significantly.
- **Stage 7 auto-fold actually implemented** (the prior audit's biggest finding — documented-but-not-shipped feature).
- **Orchestrator-stamped verification gates** for stage-04a and stage-06 — the orchestrator now runs commands itself instead of trusting model claims.
- **`--patch --from <gate>` flow** for scoped re-runs after red-team / QA-within-build / peer-review FAIL. Auto-injected blocker sections in `pipeline/context.md` with idempotent strip-on-resolve.
- **Per-stage rules files** — `pipeline-build.md` (358 lines) split into per-stage `rules/stage-NN.md` files loaded on demand.
- **De-duplicated `renderStagePrompt`** across the three host adapters (claude-code, codex, gemini-cli).
- **Security heuristic** now scans both paths and file contents (10 content patterns + new path patterns).
- **`adapter-contract.test.js`** upgraded from 24 existence-of-method assertions to 56 behavioural assertions.
- **New role briefs**: dev roles now have a `## Verify` forcing function; `auditor` brief still in `roles/`.
- **Two new runbooks**: `docs/runbooks/escalation.md`, `docs/runbooks/fix-and-retry.md`.
- **New `docs/conventions.md`** documenting the inter-agent marker vocabulary.
- **Four-mode audit framing** in `docs/user-guide.md` — distinguishing code / process / consistency / threat audits.
- **Audit-archive convention** (this audit's existence depends on it).

Open questions for later phases:

- Has the increase in CLI surface (5+ new subcommands) been documented coherently, or is there drift between `--help`, README, and user-guide?
- Are the orchestrator-stamped verification commands' fall-through behavior (config → package.json → skip) tested for all three paths?
- Does the security-heuristic content scan have false-positive escape hatches (the `devteam-allow-secret:` magic comment exists for the secret-scan hook — does the security-heuristic have similar)?
- The codebase still has no `.eslintrc`, no `prettier` config, no `.editorconfig`. Is the style consistency holding by convention alone, and is that scaling?
- Are the per-host installs still consistent? `renderStagePrompt` de-duplication means adapters share footer code, but the contract test only verifies the contract — not that all four hosts produce equivalent prompts for the same descriptor.
