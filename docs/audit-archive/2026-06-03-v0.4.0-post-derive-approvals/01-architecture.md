# 01 — Architecture

## Summary

Stagecraft is a **spine-and-adapter** architecture. A model-agnostic core (`core/`) owns stage definitions, gate validation, dispatch logic, guards, and CLI plumbing. Per-host adapters under `hosts/<host>/` install host-native surfaces (Claude Code subagents + slash commands, Codex / Gemini CLI prompts, generic stdin/stdout) and render shared role briefs into host-expected paths. **The core never calls a model** — that's the architectural choice that buys model-agnosticism for ~9k lines of JS with 4 hosts.

## Component inventory

### Core spine (`core/`, 29 JS files, ~6,000 lines)

| Component | Path | Purpose | LOC |
|---|---|---|---|
| **Orchestrator** | `core/orchestrator.js` | Stage runner, track walk, "what's next" decision, merge, auto-fold | 718 |
| **Gate validator** | `core/gates/validator.js` | Schema-validate gates, inject metadata, idempotent blocker-section injection/strip | 629 |
| **Stage definitions** | `core/pipeline/stages.js` | 17 stages × 6 tracks table, `STAGES` + `STAGES_BY_TRACK` + sizing per track | ~440 |
| **Router** | `core/router.js` | Per-(stage, role) → host adapter resolution | 47 |
| **Config loader** | `core/config.js` | `.devteam/config.yml` loader, routing precedence, schema defaults | 118 |
| **Gate loader** | `core/gates/load-gate.js` | Safe gate-file reader with try/catch on JSON.parse | small |
| **Schemas** | `core/gates/schemas/stage-NN.schema.json` | Per-stage schema files (JSON Schema draft 2020-12) | 17 schemas |
| **Render helpers** | `core/adapters/render-helpers.js` | Shared `appendGateFooter` + `allowedWritesCaption` for adapters | small |
| **Base install** | `core/adapters/base-install.js` | Shared install helpers (mkdir, copy, idempotent) | small |
| **Headless runner** | `core/adapters/headless.js` | Cross-host spawn helper with stdin pipe, timeout, in-memory log tee | medium |
| **Approval-derivation hook** | `core/hooks/approval-derivation.js` | PostToolUse hook for Stage 5 per-area gate writes | medium |
| **Secret-scan hook** | `core/hooks/secret-scan.js` | PreToolUse hook for secret detection on Write/Edit | medium |
| **Guards** | `core/guards/stoplist.js`, `migration-heuristic.js`, `security-heuristic.js` | Track stoplist + heuristics for conditional stage triggers | small ×3 |
| **Verification** | `core/verify/runner.js`, `verify/stamp.js` | Orchestrator-stamped command runner + Stage 4a/6 stamping logic | medium ×2 |
| **Memory** | `core/memory/{chunker.js, embed.js, index.js, store.js}` | Per-project semantic index (briefs, ADRs, retros, lessons) | 4 files |
| **Log journal** | `core/log/journal.js` | Builds chronological event timeline for `devteam log` | small |
| **Spec verify** | `core/spec/{gherkin.js, verify.js}` | brief.md ↔ spec.feature ↔ test-report.md drift checker | 2 files |
| **UI** | `core/ui/server.js`, `core/ui/static/` | Local web UI on `127.0.0.1:3737/` with SSE updates | medium + static |
| **Pricing / cost** | `core/pricing.js` | Cost-per-token table for `devteam dashboard:cost` | small |
| **Reproducibility** | `core/reproducibility.js` | Gate-fingerprint computation for `devteam reproduce` | small |
| **Roles + observability** | `core/roles.js`, `core/observability.js` | Role iteration + OTel spans (no-op when endpoint unset) | small ×2 |
| **Deploy targets** | `core/deploy/{custom, docker-compose, kubernetes, terraform}.md` | Markdown the LLM reads at Stage 8 — host-neutral adapter docs | 4 docs |

### CLI surface (`bin/devteam`, 1,918 lines)

Single binary, 21 subcommands as of 2026-06-03:

`init`, `stage`, `next`, `validate`, `merge`, `derive-approvals` (new), `restart`, `ruling`, `summary`, `log`, `doctor`, `ui`, `memory <subcmd>`, `architecture <subcmd>`, `reproduce`, `verify`, `replay`, `ci <subcmd>`, `spec <subcmd>`, `stages`, `hosts`, `help`.

Each subcommand is a top-level `function cmdX(argv)`; argument parsing centralized in `parseFlags()`. No subcommand framework (no commander.js or yargs) — hand-rolled. CLI exits via `process.exit(N)` rather than throwing.

### Host adapters (`hosts/`, 4 hosts, ~810 lines total)

| Host | Adapter LOC | Capabilities |
|---|---|---|
| `claude-code` | 395 | hooks + subagents + slashCommands + worktrees + headless (`claude --dangerously-skip-permissions --print`); enforces at **tool-call-time** via `Write`/`Edit` permissions |
| `codex` | 159 | headless (`codex exec`); enforces at **post-hoc-audit** via gate validator |
| `gemini-cli` | 160 | headless (`gemini -p`); enforces at **post-hoc-audit** |
| `generic` | 96 | No host integration; renders prompts to stdout; enforces **prompt-only** (text constraints, no enforcement) |

Each adapter must export: `capabilities`, `install`, `renderStagePrompt`, `status`, `uninstall`. Optional: `invoke` (required if `capabilities.headless === true`). Contract spec lives at `core/adapters/host-adapter.md` (load-bearing).

### Pipeline definitions (stage × track)

**17 stages** (full track): requirements, design, clarification, executable-spec, build (4-role multi-workstream), pre-review, security-review (conditional), red-team, migration-safety (conditional veto-power), peer-review (4-role matrix), qa, accessibility-audit (conditional), observability-gate, verification-beyond-tests, sign-off (auto-foldable from QA), deploy, retrospective.

**6 tracks**: `full` (all 17), `quick` (9, no design/clarification/conditionals), `nano` (3 — build + scoped peer-review + qa), `config-only` (6, infra-flavored), `dep-update` (5, library bumps), `hotfix` (12 — production outage path).

### Roles (`roles/`, 14 briefs)

`pm`, `principal`, `backend`, `frontend`, `platform`, `qa`, `reviewer`, `security`, `red-team`, `migrations`, `verifier`, `architect`, `auditor`, `data-engineer`. Each is a single host-neutral markdown file; adapters render into host-expected paths at install (`.claude/agents/`, `.codex/prompts/roles/`, etc.).

### Tests (49 files, 778 tests, 123 suites)

Tier-1 contract tests + tier-2 integration. Examples: `contract.test.js`, `adapter-contract.test.js` (behavioural, 56 assertions across 4 adapters), `auto-fold.test.js` (9), `derive-approvals.test.js` (9), `gate-validator.test.js`, `approval-derivation.test.js`, `red-team.test.js`, `headless.test.js`, `next.test.js`, `pipeline-e2e.test.js`, more. Runtime ~5s wall-clock.

## Dependency graph

```
bin/devteam (CLI)
  ↓
core/orchestrator.js  ──→  core/router.js  ──→  hosts/<host>/adapter.js
        ↓                        ↑
  core/pipeline/stages.js   core/config.js
        ↓
  core/gates/validator.js (writes gate files)
  core/gates/load-gate.js (reads gate files safely)
  core/gates/schemas/*    (validate against JSON Schema)
        ↓
  core/guards/{stoplist, migration-heuristic, security-heuristic}.js
  core/verify/{runner, stamp}.js  (orchestrator-stamped Stage 4a/6)
  core/adapters/{headless, render-helpers, base-install}.js  (shared by hosts)
  core/hooks/{approval-derivation, secret-scan}.js  (PostToolUse / PreToolUse)
```

**Circular dependencies:** none observed. The core never imports from `hosts/`; adapters import from `core/`.

**High fan-in components:**
- `core/orchestrator.js` is imported by `bin/devteam` (5 named imports: `runStage`, `runStageHeadless`, `mergeWorkstreamGates`, `next`, `summary`) — but nothing under `core/` itself imports the orchestrator, so it's a top-of-the-stack consumer.
- `core/gates/validator.js` is imported by every adapter (Stop hook), several scripts (`scripts/pr-publish.js`), and the orchestrator.
- `core/pipeline/stages.js` exports `STAGES`, `STAGES_BY_TRACK`, `ORDERED_STAGE_NAMES`, `rolesForStage`, `requiredApprovalsFor` — imported by orchestrator, validator, approval-derivation hook, and many tests.

## External integrations

| Library | Used by | What for |
|---|---|---|
| `@huggingface/transformers` | `core/memory/embed.js` | Local `Xenova/bge-small-en-v1.5` embedder for `devteam memory`. ~33MB model, offline after first download. |
| `@opentelemetry/api` + 5 `@opentelemetry/*` packages | `core/observability.js` | Per-stage span emission. No-op when `OTEL_EXPORTER_OTLP_ENDPOINT` unset (zero startup cost). |
| `js-yaml` | `core/config.js` | `.devteam/config.yml` parsing. |

No HTTP framework, no DB, no third-party test runner. `node:test` is the only test framework.

**Host CLIs (spawned, not imported):** `claude --dangerously-skip-permissions --print` (claude-code), `codex exec` (codex), `gemini -p` (gemini-cli). These are external dependencies the user installs separately.

## Data flow — primary pipeline run

```
User invokes:  devteam stage requirements --feature "Add SMS opt-in"
   ↓
bin/devteam → cmdStage() → parseFlags() → runStage("requirements", opts)
   ↓
core/orchestrator.js : runStage
   • computeDispatchPlan(stageDef, config, track)   ← stages.js + config.js
   • loadAdapter(host)                              ← router.js → hosts/<host>/adapter.js
   • adapter.renderStagePrompt(descriptor)
   ↓
prompt → stdout (or piped to host CLI in --headless mode via core/adapters/headless.js)
   ↓
model (in host) consumes prompt, writes:
   • artifact (pipeline/brief.md)
   • gate (pipeline/gates/stage-01.json)
   ↓
Claude Code Stop hook fires → core/gates/validator.js
   • validate against core/gates/schemas/stage-01.schema.json
   • auto-inject orchestrator + host attribution
   • for red-team / QA-in-build FAIL: inject blocker section into pipeline/context.md
   ↓
User runs: devteam next
   ↓
core/orchestrator.js : next() walks STAGES_BY_TRACK
   • reports run-stage | continue-stage | merge | fix-and-retry | resolve-escalation | done
   • for stage-07 with stage-06 PASS + 1:1 AC-test mapping: tryAutoFoldSignOff()
```

## Configuration surface

| Where | What | Consumed by |
|---|---|---|
| `.devteam/config.yml` (in target) | `routing.{stages, roles, default_host}`, `pipeline.{default_track, skip_stages, verify}`, `routing.review_fanout`, `routing.embedder` | `core/config.js`, orchestrator, approval-derivation, verify/runner |
| `package.json` (in target) | `scripts.lint`, `scripts.test` (used as fallback when `pipeline.verify.{lint, test}_command` unset) | `core/verify/runner.js` |
| Environment variables | `OTEL_EXPORTER_OTLP_ENDPOINT`, `DEVTEAM_HEADLESS_COMMAND` (test override), `DEVTEAM_NO_LOG`, `DEVTEAM_EMBEDDING_PROVIDER`, `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / etc. (consumed by host CLIs, not by stagecraft) | observability, headless runner, memory, host CLIs |
| `hosts/<host>/capabilities.json` | Per-host flags + paths + enforces map | `core/router.js`, adapters |
| `core/gates/schemas/*.json` | Per-stage required fields | validator |

**Per-project gitignored:** `node_modules/`, `.devteam/memory/` (memory store), nothing else — gates are committed by design.

## What's working well

- **Architectural simplicity.** Spine + adapter pattern. No framework, no DI container, no plugin loader at runtime — adapters resolve via a 47-line `core/router.js`. The whole thing is readable.
- **Single source of truth discipline.** Role briefs in `roles/`, rules in `rules/`, skills in `skills/`. Adapters render into host-specific paths at install. Edits to installed copies in target projects are not the contract.
- **Gate-as-contract.** Stages communicate only through JSON files; the orchestrator never holds in-memory state. Makes the pipeline reconstructable from `pipeline/gates/` alone.
- **No build step.** Pure Node, no transpilation, no bundler. The repo is shippable as-is via `npm link`. CI is fast (~10s).
- **Test count tracks features.** 49 test files for ~9k lines of core code; ratio is healthy. Recent additions (auto-fold, derive-approvals, orchestrator-stamped verification) all shipped with tests in lockstep.
- **`node:` prefix discipline + stdout/stderr separation** — small conventions, consistently held across the codebase.
- **The audit-archive convention** (this audit's existence depends on it) demonstrates the project's willingness to fix the meta-problem rather than the symptom — when the prior audit's overwrite-on-rerun issue surfaced, it got codified into the skill itself.
