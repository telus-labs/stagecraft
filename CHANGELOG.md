# Changelog

All notable changes to ai-dev-team.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org).

---

## [Unreleased]

### Added

- **OpenTelemetry tracing** (`docs/BACKLOG.md` D1). Every pipeline operation emits spans: `pipeline.stage`, `pipeline.workstream`, `pipeline.stage.headless`, `pipeline.merge`, `pipeline.next`, `adapter.renderStagePrompt`, `adapter.invoke`. Opt-in via the standard `OTEL_EXPORTER_OTLP_ENDPOINT` env var; no-op tracer when unset (zero overhead). Ships spans via OTLP/HTTP to Jaeger, Tempo, Honeycomb, Datadog Agent, etc.
- `core/observability.js` — tracer bootstrap + `withSpan` helper.
- `docs/observability.md` — setup cookbooks for Jaeger / Honeycomb / Datadog.
- `tests/observability.test.js` — 9 tests asserting expected spans + attributes using `InMemorySpanExporter`.
- **Secret scanning PreToolUse hook** (`docs/BACKLOG.md` C2). Blocks `Write` / `Edit` operations that introduce AWS keys, GitHub / Anthropic / OpenAI / Google / Slack / Stripe credentials, private keys, JWTs, or postgres URLs with embedded passwords. Built-in regex patterns; no external scanner required. Path allowlist (`.env.example`, `docs/`, `examples/`, tests, snapshots). Magic-comment override `devteam-allow-secret:` for verified false positives. Findings are redacted before being echoed back. `DEVTEAM_SECRET_SCAN_ALLOW` env var accepts additional path-regex allowlist entries.
- `core/hooks/secret-scan.js` — hook script + exported `scanContent()`.
- `tests/secret-scan.test.js` — 32 tests across pattern detection, false-positive guards, magic-comment override, path allowlist, end-to-end PreToolUse stdin parsing, and snippet redaction.
- **Gemini CLI host adapter** (`docs/BACKLOG.md` A1). Third real host alongside claude-code and codex. Symmetric to codex (no hooks, no slash commands, headless via `gemini`). Installs roles → `.gemini/prompts/roles/<role>.md`, rules → `.devteam/rules/` (shared), skills → `.gemini/skills/<name>/`. Tri-host install (`devteam init --host claude-code,codex,gemini-cli`) lays down all three side-by-side with shared rules deduped automatically.
- **Accessibility audit stage** (`docs/BACKLOG.md` B1). New `stage-06b` between QA and sign-off, role: `qa`. Gate carries `audit_method` (axe-core / pa11y / lighthouse / manual), `wcag_level` (A / AA / AAA), `violations` (critical / serious / moderate / minor counts), `components_audited`, and an `audit_skipped_reason` escape for backend-only changes. PASS requires zero critical AND zero serious; moderate/minor flow through as WARN. Included in `full`, `quick`, `hotfix` tracks (skipped on `nano`, `config-only`, `dep-update`). `skills/accessibility-audit/SKILL.md` walks through tool choice, procedure, triage, gate writing, and gotchas (Storybook-passes-route-fails, color-contrast in real browsers, manual audit for hover/focus/error states).
- **Observability gate** (`docs/BACKLOG.md` B4). New `stage-06c` between accessibility-audit and sign-off, role: `platform`. Verifies that every metric / log / trace the brief's §9 "Observability requirements" promised is actually emitted by the shipped code. Gate carries `metrics`, `logs`, `traces` each with `{required[], verified[], gap[]}` plus a `verification_method` enum (`code-grep` → `runtime-probe`). PASS requires every gap empty; weak verification methods PASS with WARN ("recommend runtime-probe post-deploy"). Non-empty gap → FAIL with missing signals as blockers. Included in `full` + `hotfix` tracks (the tracks where brief §9 is mandatory). `skills/observability-verification/SKILL.md` walks through extraction, naming conventions to match (`_` ↔ `.` ↔ `-`), grep patterns per signal type, and the decision matrix.
- **Gate-pass-rate dashboards** (`docs/BACKLOG.md` D2). `scripts/dashboard.js` aggregates `pipeline/gates/` across one or more projects and produces a per-stage / per-host / per-role / per-status pass-rate report. Default: Markdown with ASCII stacked-bar charts (`▰` PASS, `▱` WARN, `▨` FAIL, `▩` ESCALATE); `--json` for tooling integration. `--from p1,p2,...` for multi-project rollups, `--since YYYY-MM-DD` for time-windowed views. Expands merged stage gates into their constituent workstreams so per-host / per-role attribution is correct (e.g. a stage-04 merged gate counts as 4 rows in the host breakdown, one per workstream). `npm run dashboard` exposes it. Foundation for the not-yet-built D4 (per-role per-model performance scores) and D5 (adaptive routing).
- `scripts/dashboard.js` + `tests/dashboard.test.js` (14 tests).

---

## [0.1.0] — 2026-05-26

First tagged release. This is the unification of `claude-dev-team` and `codex-dev-team` into a single model-agnostic core with per-host adapters. The 0.x signals that the public surface — gate JSON shape, host adapter contract, CLI subcommands, `.devteam/config.yml` schema — may break before 1.0. 1.0.0 is reserved for a substantial future release (see `docs/BACKLOG.md`).

### Added

#### Core architecture
- **Model-agnostic core (`core/`)** that never invokes a model — emits stage prompts and validates gate JSON.
- **Host adapter contract** (`core/adapters/host-adapter.md`) — minimum surface a host must implement: `capabilities`, `install`, `renderStagePrompt`, `status`, `uninstall`, optional `invoke`.
- **Router** (`core/router.js`) — adapter discovery + per-(stage, role) resolution with precedence `routing.stages > routing.roles > routing.default_host`.
- **Orchestrator** (`core/orchestrator.js`) — `runStage`, `runStageHeadless`, `mergeWorkstreamGates`, `next`, `summary`. Decomposes multi-role stages into per-workstream dispatches.
- **Config** (`core/config.js`) — loads `.devteam/config.yml` (js-yaml), resolves host per workstream, generates default config for `devteam init`.
- **Stage definitions** (`core/pipeline/stages.js`) — 11 stages, 6 tracks, role-keyed gate skeletons, per-role allowedWrites overrides, conditional dispatch.

#### Pipeline stages
- Stage 1–9 with sub-stages 4a (pre-review) and **new 4b (security review, conditional)**.
- Conditional dispatch via `conditionalOn: { stage, field, equals }` — generic mechanism, currently used by security-review.
- Per-workstream gates (`pipeline/gates/<stage>.<workstream>.json`) for multi-role stages, merged into stage gate (`pipeline/gates/<stage>.json`) by the orchestrator with aggregate status `ESCALATE > FAIL > WARN > PASS`.

#### Host adapters
- `hosts/claude-code/` — full capabilities (hooks, subagents, slashCommands, worktrees, headless). Installs subagents to `.claude/agents/<name>.md` with YAML frontmatter, rules to `.devteam/rules/`, skills to `.claude/skills/<name>/`, slash command to `.claude/commands/devteam.md`, hooks (Stop/SubagentStop/PostToolUse) to `.claude/settings.local.json`.
- `hosts/codex/` — moderate capabilities (no hooks, no subagents, headless via `codex exec`). Installs roles to `.codex/prompts/roles/<role>.md`, rules to `.devteam/rules/`, skills to `.codex/skills/<name>/`.
- `hosts/generic/` — zero in-host integration. Proves the contract is genuinely host-neutral; install is a no-op.

#### CLI (`bin/devteam`)
- `init --host <list> [--force]` — install one or more adapters into a target project; write `.devteam/config.yml`; create `pipeline/gates/`.
- `stage <name> [--feature "..."] [--headless] [--force]` — render prompts (or drive headlessly); stoplist-guarded on lighter tracks unless `--force`.
- `next [--json]` — read pipeline state, decide what to do next (run/continue/merge/fix/escalate/complete).
- `merge <stage>` — aggregate per-workstream gates into stage gate.
- `validate` — run the gate validator against `pipeline/gates/`. Exit codes propagate (0 PASS/WARN, 1 malformed, 2 FAIL, 3 ESCALATE).
- `summary [--json]` — one-screen pipeline-state report.
- `doctor` — pre-flight check: framework install, target project layout, config validity, per-adapter status, host CLIs on PATH.
- `stages`, `hosts`, `help`.

#### Guards
- `core/guards/stoplist.js` — phrase-based safety guard; wired into `devteam stage` for STOPLIST_GUARDED_TRACKS (`quick`, `nano`, `config-only`, `dep-update`).
- `core/guards/budget.js` — token + wall-clock budget tracking (lifted, not yet wired into the CLI).
- `core/guards/security-heuristic.js` — file-path patterns that trigger Stage 4b security review.

#### Hooks
- `core/gates/validator.js` — gate validator; wired into Claude Code's Stop + SubagentStop events.
- `core/hooks/approval-derivation.js` — Stage 5 PostToolUse hook that parses per-area `REVIEW:` markers in `pipeline/code-review/by-<reviewer>.md` files and upserts the per-area workstream gates.
- `core/adapters/headless.js` — shared helper for adapter `invoke()` implementations.

#### Schemas
- `core/gates/schemas/gate.schema.json` — base schema with **contract F** identity fields: `stage`, `status`, `orchestrator`, `track`, `timestamp`, `blockers`, `warnings`, plus `workstream` and `host` (workstream gates only) and `workstreams[]` (merged stage gates only). **Legacy `agent` field is removed.**
- Per-stage schemas `stage-01` through `stage-09`, plus `stage-04a` (pre-review) and `stage-04b` (security review).

#### Single-source content
- `roles/` — 8 host-neutral role briefs (pm, principal, backend, frontend, platform, qa, reviewer, security).
- `rules/` — 10 pipeline rules docs (gates, pipeline, escalation, retrospective, orchestrator, coding-principles, compaction, pipeline-build, pipeline-core, pipeline-tracks).
- `skills/` — 6 task-oriented helpers (api-conventions, code-conventions, implement, pre-pr-review, review-rubric, security-checklist).
- `templates/` — 12 artifact templates (brief, design-spec, build, clarification, pr-summary, pre-review, review, runbook, test-report, retrospective, adr).
- `core/deploy/` — 4 deploy adapter docs (docker-compose, kubernetes, terraform, custom) + README.

#### Documentation
- `README.md` — concise entry point.
- `ARCHITECTURE.md` — design model + 11 locked decisions.
- `AGENTS.md` — host-neutral context for LLMs working on this repo.
- `CONTRIBUTING.md` — recipes to add a host adapter, stage, role, or skill.
- `EXAMPLE.md` — end-to-end walkthrough of one pipeline run with real CLI captures.
- `docs/concepts.md` — one-sentence definitions of every primitive.
- `docs/GAP-ANALYSIS.md` — comparison vs claude-dev-team / codex-dev-team.
- `docs/TESTING.md` — testing strategy.
- `docs/BACKLOG.md` — bucketed roadmap with impact/effort scores + innovation bets.
- `docs/walkthroughs/stage-04-split-host.md` — stress-test trace that locked the multi-workstream contract.

#### Tests
- 113 tests across 8 files: contract, config, router, adapter-contract, gate-validator, orchestrator, next, install-roundtrip, approval-derivation. `npm test` passes in ~500ms.

### Locked design decisions

11 decisions in `ARCHITECTURE.md` — most consequential:

1. The core never spawns a model. Emits prompts and validates JSON.
2. Gate JSON is the stable seam. Identity fields `stage`, `status`, `orchestrator`, `host`, `workstream` (no more `agent`).
3. Role briefs have one source (`roles/*.md`); adapters render into host-expected paths at install time.
4. **Per-workstream host selection.** A single pipeline can route different roles to different hosts; merged via the gate seam.
5. Multi-host install is the default code path. Single-host is a list of length 1.
6. Capability negotiation per adapter — declares `hooks`, `subagents`, `slashCommands`, `worktrees`, `headless`, plus an `enforces` map.

### Differences from claude-dev-team and codex-dev-team

- No fork to maintain — one core, three host adapters.
- Contract F applied everywhere: `agent` field replaced with `orchestrator` + `host` + `workstream`.
- WARN status added (PASS-with-warnings, non-blocking).
- Generic `conditionalOn` mechanism for conditional stages.
- Per-role `roleWrites` map narrows allowed writes per workstream in multi-role stages (backend's prompt no longer lists `src/frontend/`).
- `stage.subagent` override lets multi-workstream stages dispatch all workstreams to a single named subagent (used by peer-review).
- Multi-host install (`devteam init --host claude-code,codex`) is first-class.

### Migration history

Land in 5 logical commits then iterate (see `git log`):

1. `scaffold` — architecture, host-adapter contract, stress-test walkthrough.
2. `core` — templates, schemas, validator, guards, stages.js (contracts A/F applied).
3. `roles + rules` — single source of truth, host-neutral paths.
4. `orchestrator + CLI + generic adapter + init command` (contract B merge).
5. `claude-code adapter` (agents + slash command + rules install).

Then iteratively: codex adapter, `next`, hooks wiring, headless `invoke()`, track filtering, per-role allowedWrites, peer-review structural fix, conditional security review, skills, version-note cleanup, role-brief refinements, README/LICENSE/gap-analysis/testing, tier-1 doc + test + CLI set.
