# AGENTS.md

Host-neutral context for any LLM working on the **Stagecraft** codebase itself. (The CLI binary is `devteam`; the project is Stagecraft.)

If you're using Stagecraft to drive *another* project's pipeline, this file is not for you — read the [`README.md`](README.md) and [`docs/concepts.md`](docs/concepts.md) instead. This file is for someone editing the framework.

## What this is

A model-agnostic AI dev team pipeline. A single model-neutral core plus per-host adapters that lay down host-native surfaces (subagents, slash commands, hooks, role prompts) into target projects.

It replaces two prior forks (`claude-dev-team`, `codex-dev-team`) that diverged ~80% identical. The unification is the whole reason this repo exists.

## What to read first, in order

1. [`README.md`](README.md) — what the system does end-to-end, the CLI surface, the install layout.
2. [`ARCHITECTURE.md`](ARCHITECTURE.md) — the design model (spine + adapter), the proposed directory tree, and **11 locked design decisions** that are load-bearing. Do not edit these casually.
3. [`core/adapters/host-adapter.md`](core/adapters/host-adapter.md) — the contract a host adapter must satisfy.
4. [`docs/concepts.md`](docs/concepts.md) — one-sentence definitions of stage, role, workstream, gate, track, adapter, host, capability.
5. [`docs/walkthroughs/stage-04-split-host.md`](docs/walkthroughs/stage-04-split-host.md) — the stress-test trace that locked the multi-workstream contract. Read this before changing anything in the multi-role dispatch path.

## Where everything lives

| Concern | Path |
|---|---|
| Stage definitions, tracks, role assignments | `core/pipeline/stages.js` |
| Routing config loader, defaults | `core/config.js` |
| Adapter discovery + per-(stage, role) resolution | `core/router.js` |
| Dispatch logic: runStage / runStageHeadless / mergeWorkstreamGates / next | `core/orchestrator.js` |
| Gate validator | `core/gates/validator.js` |
| Per-stage schemas | `core/gates/schemas/stage-NN.schema.json` |
| Stoplist, budget, security-heuristic | `core/guards/` |
| Approval-derivation hook | `core/hooks/approval-derivation.js` |
| Headless invoke helper (shared across hosts) | `core/adapters/headless.js` |
| Role briefs (single source of truth) | `roles/*.md` |
| Rules docs (gates, pipeline, escalation, …) | `rules/*.md` |
| Task skills (implement, review-rubric, …) | `skills/*/SKILL.md` |
| Artifact templates | `templates/*.md` |
| Per-host adapters | `hosts/<name>/{adapter.js, capabilities.json, install/}` |
| Deploy-target adapter docs (markdown the LLM reads at Stage 8) | `core/deploy/*.md` |
| CLI entry point | `bin/devteam` |

## Load-bearing contracts (do not break)

These are the things downstream code, tests, and adapters depend on. Edit only with conscious intent — and update tests in lockstep.

1. **Gate JSON identity fields**: `stage`, `status`, `orchestrator`, `track`, `timestamp`, `blockers`, `warnings`. Workstream gates additionally carry `workstream` and `host`. Merged stage gates carry a `workstreams[]` array. **The legacy `agent` field is removed.** Schema: `core/gates/schemas/gate.schema.json`.

2. **Stage definitions** in `core/pipeline/stages.js`:
   - `stage` (id, e.g. `"stage-04a"`)
   - `roles` (array — single-role stages have length 1)
   - `objective`, `readFirst`, `allowedWrites`, `artifact`, `template`, `gate` (skeleton)
   - Optional: `roleWrites` (per-role allowedWrites override), `subagent` (use this subagent for all workstreams regardless of role), `conditionalOn` (skip the stage unless prerequisite gate matches)

3. **Stages-by-track table** (`STAGES_BY_TRACK`): the list of stage names per track. Adding a track requires adding to this map.

4. **Host adapter contract** (see `core/adapters/host-adapter.md`): every adapter must export `capabilities`, `install`, `renderStagePrompt`, `status`, `uninstall`. Optional: `invoke` (only required if `capabilities.headless === true`).

5. **`capabilities.json` enforces map**: declares where the host enforces each rule (`tool-call-time` / `post-hoc-audit` / `prompt-only`). The orchestrator uses this to decide whether to run post-hoc audits.

6. **Routing precedence**: `routing.stages[stage] → routing.roles[role] → routing.default_host`. Per workstream. Do not reorder or add new layers without an ADR.

7. **Workstream gate filename**: `pipeline/gates/<stage>.<workstream>.json` (dot separator). Stage-level merged gates are `pipeline/gates/<stage>.json`. Do not introduce other naming.

8. **The core never invokes a model.** `core/orchestrator.js` and friends emit prompts and validate JSON. Anything that calls a host CLI lives in `hosts/<host>/adapter.js` or `core/adapters/headless.js`.

## Decisions deferred (do not solve in the wrong place)

- **Auth, cost limits, model routing inside a host** — that's the host's job, not ours. Budget *tracking* is in `core/guards/budget.js` and is host-neutral; budget *enforcement at the API level* belongs to the host.
- **Multi-language reach** — Node only for now. See locked decision #11.
- **Where the orchestrator runs** — user's machine for now. CI / cloud-worker dispatch is in the backlog.

## Conventions

- **No `agent` field anywhere.** Use `workstream` and `host` (workstream gates) or `orchestrator` (stage-level gates).
- **Host-neutral paths in shared content.** `.devteam/rules/...`, `AGENTS.md`, `roles/...`. Adapters do path transforms at install time if their host needs `.claude/`-flavored paths.
- **Idempotent installs.** Every adapter's `install()` must be safe to re-run; second call returns `written: 0, skipped: N`. Force flag overrides.
- **No comments-as-documentation in code.** If a fact needs explaining and isn't obvious from the code, it goes in `ARCHITECTURE.md`, `host-adapter.md`, or a rule file under `rules/`. One-line "why this is here" comments are fine; multi-paragraph docstrings aren't.
- **Single source of truth.** Role briefs in `roles/`, rules in `rules/`, skills in `skills/`. Adapters render these into host-specific paths at install time. **Do not edit installed copies in target projects.**

## Adding things

Common changes and where they go:

| You want to… | Edit / create |
|---|---|
| Add a new stage | `core/pipeline/stages.js` (entry + add to `ORDERED_STAGE_NAMES` and `STAGES_BY_TRACK`) + new schema under `core/gates/schemas/` + update `rules/pipeline*.md` + add to `tests/contract.test.js` (when tests exist) |
| Add a new role | `roles/<role>.md` (host-neutral brief) + add to `ROLE_FRONTMATTER` in each adapter that uses subagents + reference from at least one stage's `roles` array |
| Add a new host adapter | `hosts/<name>/{adapter.js, capabilities.json, install/}` — implement the contract in `core/adapters/host-adapter.md` |
| Add a new skill | `skills/<name>/SKILL.md` + verify each adapter's `installSkills` picks it up (currently they auto-iterate `SKILLS_DIR`) |
| Add a new CLI subcommand | `bin/devteam` (parseFlags + cmdX + switch case + help text) |
| Add a new track | `STAGES_BY_TRACK` in `core/pipeline/stages.js` |
| Add a deploy target | `core/deploy/<adapter>.md` (markdown the LLM reads, not JS) |

## What the tests currently cover

Stagecraft has a tier-1 + tier-2 test suite (300+ tests; run `npm test`). See [`docs/TESTING.md`](docs/TESTING.md) for the strategy and tier layout. Add tests in lockstep with any contract change.

## Open backlog

[`docs/BACKLOG.md`](docs/BACKLOG.md) — bucketed list of next ideas with impact/effort scores. Top items: OpenTelemetry per-stage tracing, secret-scanning hook, Gemini CLI adapter, accessibility audit stage, gate-pass-rate dashboards, GitHub PR integration, web UI, persistent embeddings-indexed memory, multi-model adversarial review.

## Working on this codebase

Practical:

- `npm install` then `./bin/devteam help` to verify the CLI loads.
- Most smoke testing uses `mktemp -d` as a fake target project, runs `./bin/devteam init --host claude-code --cwd $TMPDIR`, then exercises subcommands against that.
- `DEVTEAM_HEADLESS_COMMAND=cat` or `=true` stubs the host CLI for testing `--headless` without `claude` / `codex` installed.
- Stage prompts go to stdout; orchestrator logs go to stderr (`[devteam] …`). Don't mix.
- Every contract change should land with: (a) the code change, (b) the doc update under `ARCHITECTURE.md` / `rules/gates.md` / `core/adapters/host-adapter.md` as relevant, (c) a corresponding test (once the test suite exists).
