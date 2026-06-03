# 01 — Architecture map

## Summary

Stagecraft is a **two-workflow orchestrator** with strict separation between the model-agnostic core (`core/`) and per-host adapters (`hosts/<host>/`). The core never invokes a model; adapters do, via host-specific primitives. The two workflows are: (1) a 13-stage pipeline that builds features, decomposing into per-workstream dispatches that produce gate JSON; (2) a 4-phase audit that analyzes existing code and produces a roadmap. Both write to disk as the seam — there's no in-memory state outside an active CLI invocation.

## Component inventory

| Component | Purpose | Entry point | Internal deps |
|---|---|---|---|
| **CLI** (`bin/devteam`) | Subcommand dispatcher (`init`, `stage`, `next`, `merge`, `validate`, `ui`, `memory`, `doctor`, …) | `bin/devteam` | `core/*`, `hosts/*` (resolved via router) |
| **Orchestrator** (`core/orchestrator.js`, 493 LOC) | `runStage`, `runStageHeadless`, `mergeWorkstreamGates`, `next`, `summary` | exported | `core/pipeline/stages`, `core/config`, `core/router`, `core/observability` |
| **Pipeline definitions** (`core/pipeline/stages.js`, 300 LOC) | STAGES table, tracks, ordering, decomposition rules | exported | none |
| **Gate validator** (`core/gates/validator.js`, 401 LOC) | Spawned subprocess; reads `pipeline/gates/`, validates JSON, returns exit codes for hook-driven flow | `bin/devteam validate` and Claude Code's Stop hook | none |
| **Gate schemas** (`core/gates/schemas/`) | 14 JSON Schema files, one per stage (+ base) | loaded by `tests/schemas.test.js` and `scripts/consistency.js` | none |
| **Hooks** (`core/hooks/`) | `approval-derivation.js` (313 LOC, Stage 5 review→gate), `secret-scan.js` (247 LOC, PreToolUse credential block) | Claude Code event triggers | none |
| **Guards** (`core/guards/`) | `stoplist.js` (137 LOC), `security-heuristic.js` | `bin/devteam stage` (stoplist), pre-review stage logic (heuristic) | none |
| **Router** (`core/router.js`) | Adapter discovery + per-(stage, role) host resolution | orchestrator | `core/config`, dynamic require of `hosts/<name>` |
| **Config** (`core/config.js`) | `.devteam/config.yml` loader, `writeConfigIfAbsent`, host resolution helpers | orchestrator, init | `js-yaml` |
| **Observability** (`core/observability.js`, 120 LOC) | OTel bootstrap, `withSpan` helper | orchestrator | `@opentelemetry/api`, `@opentelemetry/sdk-trace-node`, `@opentelemetry/sdk-trace-base` |
| **Memory** (`core/memory/`) | Semantic memory: ingest, query, embed, store | `bin/devteam memory <sub>` | `@huggingface/transformers` (lazy) |
| **UI** (`core/ui/server.js` 239 LOC + static/) | Local HTTP + SSE pipeline-state view | `bin/devteam ui` | none |
| **Headless helper** (`core/adapters/headless.js`) | Shared spawn-host-CLI flow | each host adapter's `invoke()` | none |
| **claude-code adapter** (`hosts/claude-code/adapter.js`, 404 LOC) | Most capable host (hooks, subagents, slashCommands, worktrees, headless) | `core/router` | `core/adapters/headless` |
| **codex adapter** (`hosts/codex/adapter.js`, 233 LOC) | Headless via `codex exec`; no hooks, no slash commands | `core/router` | `core/adapters/headless` |
| **gemini-cli adapter** (`hosts/gemini-cli/adapter.js`, 234 LOC) | Headless via `gemini`; no hooks, no slash commands | `core/router` | `core/adapters/headless` |
| **generic adapter** (`hosts/generic/adapter.js`) | Zero in-host integration; renders prompt to stdout only | `core/router` | none |

## Dependency graph

```
   bin/devteam
       │
       ├──► core/orchestrator ─┬──► core/pipeline/stages
       │                       ├──► core/config (js-yaml)
       │                       ├──► core/router ──► hosts/<host>/adapter ──► core/adapters/headless
       │                       └──► core/observability (@opentelemetry/*)
       │
       ├──► core/memory/index ──► core/memory/{chunker, embed, store}
       │                                                  │
       │                                                  └──► @huggingface/transformers (lazy)
       │
       ├──► core/guards/stoplist
       ├──► core/ui/server (no external deps)
       └──► (subprocess) core/gates/validator
```

### Circular dependencies

None observed. All `require()` calls form a DAG.

### High fan-in components

- **`core/pipeline/stages.js`** — read by orchestrator, router (transitively), tests, consistency lint, dashboard script. The single source of truth for what stages exist; changes here ripple widely.
- **`core/config.js`** — read by orchestrator, CLI, every host adapter (via `capabilities.json`), tests. Config schema changes are breaking.
- **`core/orchestrator.js`** — read by CLI, tests, observability tests. Hottest file (9 commits) and the natural future split candidate.

## External integrations

| Integration | Used by | Abstracted? | Notes |
|---|---|---|---|
| **OpenTelemetry** (`@opentelemetry/*`, 7 packages) | `core/observability.js` only | Yes — fully encapsulated; no-op when env var unset | Pinned `~` (patch-only). Recently swapped from `sdk-node` (advisory) to `sdk-trace-node` directly. |
| **Hugging Face Transformers** (`@huggingface/transformers`) | `core/memory/embed.js` only | Yes — lazy require, stub embedder for tests | Local-default `Xenova/bge-small-en-v1.5`, ~33MB lazy download |
| **js-yaml** | `core/config.js` only | Yes — single import site | |
| **`claude` CLI** (Claude Code) | claude-code adapter's `invoke()` via spawn | Yes — env override (`DEVTEAM_HEADLESS_COMMAND`) | Not a Node dep; user-installed |
| **`codex` CLI** | codex adapter `invoke()` | Yes — same override | User-installed |
| **`gemini` CLI** | gemini-cli adapter `invoke()` | Yes | User-installed |
| **`gh` CLI** | `scripts/pr-publish.js` | Indirectly (via subprocess); auth deferred to user's `gh` | Optional |
| **`git`** | `scripts/release.js` check, audit Phase 0.3 | Yes — via subprocess | Required for full functionality |

No databases, no HTTP clients to remote APIs (OTel exporter doesn't count — local OTLP collector), no cloud SDKs. Surface is unusually small.

## Data flow

### Flow 1: `devteam stage build` (user-driven, the most common path)

```
1. User runs `devteam stage build --feature "..."`
2. bin/devteam.cmdStage parses flags, checks stoplist (core/guards/stoplist)
3. orchestrator.runStage(stageName, opts):
   - getStage("build") → stage descriptor with roles=[backend, frontend, platform, qa]
   - computeDispatchPlan(stageDef, config) → one dispatch entry per role (or N×M if review_fanout active)
   - for each dispatch:
       resolveAdapter(hostName) → loadAdapter("claude-code") → hosts/claude-code/adapter.js
       buildDescriptor(stageDef, role, opts) → StageDescriptor
       adapter.renderStagePrompt(descriptor, ctx) → prompt string
4. CLI prints onboarding preamble + per-workstream prompts (separated by ────────)
5. User feeds prompt(s) to the model (in Claude Code, or copy-paste)
6. Model writes pipeline/brief.md (artifact) + pipeline/gates/stage-04.<role>.json (gate)
7. Claude Code Stop hook fires → spawns core/gates/validator.js → exit code propagates
8. User runs `devteam next` → orchestrator.next() reads gates, decides next action
```

### Flow 2: `devteam stage build --headless`

```
1. User runs `devteam stage build --feature "..." --headless`
2. orchestrator.runStageHeadless():
   - computeDispatchPlan → dispatches
   - for each dispatch:
       adapter.invoke(descriptor, ctx) → core/adapters/headless.runHeadless():
         - resolves capabilities.headlessCommand
         - spawn `claude --print` (or codex/gemini) with prompt on stdin
         - awaits exit, checks pipeline/gates/<workstreamId>.json
         - returns { exitCode, gatePath, durationMs }
3. Aggregate per-workstream results, print summary, exit 0/1
```

### Flow 3: `/audit` (Claude Code)

```
1. User runs `/audit` in Claude Code
2. Claude Code resolves .claude/commands/audit.md → reads the slash command
3. Command instructs: read .claude/skills/audit/SKILL.md
4. Skill defines 4 phases; agent (Claude) executes each phase against the user's codebase
5. Agent writes docs/audit/00-…10.md + status.json
6. Stop hook → validator (no gate written, so no halt)
```

## Configuration surface

| Setting | Defined in | Consumed by | Notes |
|---|---|---|---|
| `routing.default_host` | `.devteam/config.yml` (target) | `core/router`, `core/config` | precedence: stages > roles > default_host |
| `routing.roles.<role>` | `.devteam/config.yml` | `core/router` | per-role host override |
| `routing.stages.<stage>` | `.devteam/config.yml` | `core/router` | per-stage host override (most specific wins) |
| `routing.review_fanout` | `.devteam/config.yml` | `core/orchestrator.computeDispatchPlan` | opt-in multi-model adversarial peer review |
| `pipeline.default_track` | `.devteam/config.yml` | `core/orchestrator`, `bin/devteam stage` | full / quick / nano / config-only / dep-update / hotfix |
| `deploy.adapter` | `.devteam/config.yml` | Stage 8 (Platform role) | names `core/deploy/<adapter>.md` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | env | `core/observability` | opt-in tracing |
| `DEVTEAM_OTEL_DISABLE` | env | `core/observability` | hard-disable even if endpoint set |
| `DEVTEAM_HEADLESS_COMMAND` | env | `core/adapters/headless` | override host CLI command (for stubbing) |
| `DEVTEAM_EMBEDDING_PROVIDER` | env | `core/memory/embed` | `stub` skips model download |
| `DEVTEAM_EMBEDDING_MODEL` | env | `core/memory/embed` | override default `Xenova/bge-small-en-v1.5` |
| `DEVTEAM_SECRET_SCAN_ALLOW` | env | `core/hooks/secret-scan` | additional path-allowlist regex |
| `STAGECRAFT_UI_ALLOW_REMOTE` | env | `core/ui/server` | opt-in non-loopback UI bind |
| `LOG_FORMAT=json` | env | `core/gates/validator` | structured-log mode |

Secrets: none in this codebase (no API keys, no tokens). All credentials are user-installed (Claude/Codex/Gemini CLIs authenticate themselves; `gh` for GitHub).

## What's working well

Positive findings worth preserving:

- **Strict core / adapter separation.** The core never invokes a model. This invariant is what makes multi-host possible. Easy to violate accidentally during a refactor; the contract test catches some of it but most of the discipline is cultural.
- **Single source of truth.** Role briefs live in `roles/<role>.md`; adapters render them per-host at install time. No drift between hosts because there's nowhere to drift to.
- **Gate JSON as the seam.** Every stage's output is a validated JSON file. Pipeline state is reconstructable from `pipeline/gates/` alone — no hidden state, no database, no cache. This makes resumability and auditability free.
- **Tests are fast and offline.** 378 tests in ~1.5 seconds, no network, no model calls. `DEVTEAM_EMBEDDING_PROVIDER=stub` and `DEVTEAM_HEADLESS_COMMAND=true|false` keep CI green without external services.
- **Consistency lint** (185 checks). Catches cross-artifact drift (schemas ↔ stages ↔ role briefs ↔ rules) at lint time, before tests run.
- **Subprocess discipline for the validator.** `core/gates/validator.js` is a subprocess (spawned by hooks and by `bin/devteam validate`). Its `process.exit()` discipline doesn't pollute the rest of the codebase. Recent `gatesDir()` / `lessonsFile()` lazy lookup makes it require()-able too.
- **Doc-uplift commits show care.** The recent presentation-notes / user-guide / adoption-guide / faq uplift produced ~50KB of concrete onboarding material. The "Your three moments of control" framing and the "two paths" (headless vs interactive) Quick Start are real improvements over what existed.
