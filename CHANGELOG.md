# Changelog

All notable changes to Stagecraft.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org).

---

## [Unreleased]

### Added

- **Codebase audit feature** (`docs/BACKLOG.md` E8). Read-only end-to-end analysis pass with prioritized roadmap output — separate from the 13-stage pipeline (which builds features; the audit analyzes existing code). New `skills/audit/SKILL.md` defines 4 phases (Bootstrap → Health Assessment → Deep Analysis → Roadmap) producing 11 output files in `docs/audit/00-project-context.md` through `docs/audit/10-roadmap.md`. New `roles/auditor.md` (read-only by design — never writes source). New `/audit` and `/audit-quick` slash commands installed by the claude-code host adapter; the audit skill + auditor role brief also install for codex and gemini-cli hosts (no slash commands there, but the skill is invocable). 11 phase output templates in `templates/audit/` as framework-side reference. Resume capability via `docs/audit/status.json`. Monorepo-aware. Extensible via `docs/audit-extensions.md` for project-specific checks (compliance frameworks, custom security policies, team conventions). 9 new tests in `tests/audit.test.js`; 15 new consistency checks in `scripts/consistency.js`. Fixes the dangling `scripts/audit.js` reference in `ARCHITECTURE.md` that's been wrong since v0.1.0.

- **Documentation uplift across three tiers.** Major rewrite of seven docs to bring Stagecraft to parity with claude-dev-team's documentation quality. New: `docs/presentation-notes.md` (13-slide deck + speaker notes, ~22KB, with timing references and Q&A primers), `docs/brief-template.md`, `docs/design-spec-template.md`, `docs/runbook-template.md` (section-by-section "what to write, why, what to skip" guides for the three load-bearing artifacts). Rewritten: `docs/concepts.md` (restructured around a 6-primitives table), `docs/user-guide.md` (14KB → 26KB, adds "shape of one run" diagram + "Your three moments of control" framing + sections on UI / memory / OTel / fanout), `docs/adoption-guide.md` (10KB → 16KB, deeper Q&A answers + 12-month success milestones), `docs/faq.md` (10KB → 22KB, +25 questions across 6 new topic groups), `EXAMPLE.md` (adds a hotfix-track walkthrough as a second worked example), `README.md` (problem-first hook + "First 30 minutes" checklist + documentation map). New BACKLOG entry E7 for `/goal` integration.

- **`devteam stage` onboarding framing.** In user-driven mode (the default), the rendered stage prompt is now wrapped with a preamble that names the stage, explains that `devteam` does not call a model, and lists the three ways to feed the prompt to a host (Claude Code paste, `/devteam stage <name>` slash command, or `--headless` to drive `claude --print` automatically). A postamble points at the next concrete action (`devteam next` after the gate is written). Framing is suppressed under `--headless` (the prompt is piped to the host CLI) and reserved-suppressed under `--json`. Closes the #1 first-run footgun where new users ran `devteam stage` and got a raw prompt block with no context. 3 new tests in `tests/cli.test.js`.
- **Un-initialised target warning.** `devteam stage` now stderr-warns when the target directory has no `.devteam/config.yml`, with the exact `devteam init --host claude-code --cwd "..."` command to fix it. The warning fires before the prompt renders, so users see the fix path before they see a prompt that references files that don't exist. 1 new test in `tests/cli.test.js`.
- **Quickstart section in `devteam help`.** Five numbered steps from `init` through the first `devteam next`, plus a one-line statement of the model-agnostic invariant ("devteam never calls a model itself").
- `tests/headless.test.js` (8 tests) — covers `core/adapters/headless.js`: command resolution, env override, missing-command rejection, exit-code propagation, spawn-ENOENT error, gatePath detection, EPIPE swallowing, whitespace splitting.
- `tests/release.test.js` (7 tests) — covers `scripts/release.js notes`: `[Unreleased]` default, middle section, last-section (no trailing header to anchor to — the regression that bit v0.1.0's tag), missing-version error, blank-line preservation, trailing `---` stripping.
- `tests/ui.test.js`: 4 new tests for the non-loopback bind guard — accepts loopback (`127.0.0.1`, `localhost`) without opt-in, rejects non-loopback bind with `EREMOTEBIND` unless `STAGECRAFT_UI_ALLOW_REMOTE=1` is set, allows non-loopback with a stderr warning when opt-in is given.

### Changed

- `core/gates/validator.js`: lifted `GATES_DIR` / `LESSONS_FILE` from module-load constants to `gatesDir()` / `lessonsFile()` functions. The validator is normally spawned as a subprocess (each invocation has a fresh cwd), so behavior is unchanged in production; the lazy resolution makes the module require()-able from tests and other callers that chdir().
- `scripts/release.js notes`: strips the trailing `---` separator from extracted sections. CHANGELOG uses `---` between sections structurally, but it was bleeding into annotated tag messages. Annotated tags built from `release:notes <version>` now end cleanly at the section body.
- `docs/TESTING.md`: rewritten to reflect current reality (362 tests / 24 files / 81 suites / ~1.5s, tiers 1+2 shipped) instead of the original strategy-doc framing where tiers 1 and 2 were aspirational.
- `docs/GAP-ANALYSIS.md`: rewritten as a historical-then-current doc. Migration is complete; most listed gaps are closed. The load-bearing section now is the feature inventory of what Stagecraft has that the forks didn't (contracts A/B/C/F, conditionalOn, stage-04b/06b/06c, OTel, memory, fanout, dashboards, PR integration, web UI, secret scanning, consistency lint). For active gap tracking, see `docs/BACKLOG.md`.
- Schema `$id` URLs: switched from the placeholder `https://example.local/ai-dev-team/<name>.schema.json` to `urn:stagecraft:schema:<name>`. Internal identifiers; the URN form avoids claiming a DNS namespace we don't own. `tests/schemas.test.js` and `scripts/consistency.js` updated to assert the new form.
- `core/ui/server.js`: refuses to bind to non-loopback hosts unless `STAGECRAFT_UI_ALLOW_REMOTE=1` is set. The UI has no auth, no rate limits, and exposes full pipeline state — making a remote bind a conscious opt-in instead of a typo-distance default. Loopback bind (`127.0.0.1`, `::1`, `localhost`) is unaffected. When opt-in is given, a loud stderr warning prints at startup.
- OpenTelemetry dependency pins: `^x.y.z` → `~x.y.z` for all `@opentelemetry/*` packages. Pre-1.0 OTel SDK packages have historically shipped breaks in minor releases; tilde restricts to patch-only updates.

### Security

- **GHSA-q7rr-3cgh-j5r3 resolved by removing the vulnerable package.** `@opentelemetry/sdk-node` was a convenience wrapper that we only used to wire `OTLPTraceExporter` + `Resource` onto a tracer provider — work that `NodeTracerProvider` (from `@opentelemetry/sdk-trace-node`, already in our deps as stable 1.x) does directly. `core/observability.js` now uses `NodeTracerProvider` + `BatchSpanProcessor` explicitly, and `@opentelemetry/sdk-node` is removed from `package.json`. `npm install` drops 51 transitive packages (including the vulnerable Prometheus exporter). `npm audit` reports `found 0 vulnerabilities` post-change. Production tracing behavior is unchanged: same span shape, same OTLP/HTTP transport, same shutdown flush on `beforeExit` / `SIGINT` / `SIGTERM`.

---

## [0.2.0] — 2026-05-27

Ten priority BACKLOG items shipped in a row, plus the rename from `ai-dev-team` to **Stagecraft**. The CLI binary remains `devteam`; only the project identity changed. Public surfaces unchanged from 0.1.0: gate JSON shape, host adapter contract, `.devteam/config.yml` schema. Additive features only — no breaking changes.

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
- **GitHub PR integration** (`docs/BACKLOG.md` F1). `scripts/pr-publish.js` uses the `gh` CLI to publish pipeline state to a PR. Two modes: `body` (replace PR description with pr-pack output — idempotent; re-run after each pipeline change to keep the PR in sync) and `checks` (post each gate as a GitHub check run on the PR head commit — PASS→success, WARN→neutral, FAIL/ESCALATE→failure, with blockers + warnings + workstreams in the check run's summary text). Auto-detects repo from git remote and PR from current branch; `--dry-run` previews what would happen (works without `gh` configured when `--pr` and `--repo` are supplied). `npm run pr-publish` exposes it. Auth via `gh` — we never handle tokens directly.
- `scripts/pr-publish.js` + `tests/pr-publish.test.js` (12 tests — gate-to-check-run translation, including PASS/WARN/FAIL/ESCALATE conclusion mapping, workstream gate naming, blockers/warnings/workstreams in output text, edge cases).
- **Web UI for pipeline runs** (`docs/BACKLOG.md` E2). `devteam ui` starts a local HTTP server (default http://127.0.0.1:3737/). Single-page UI shows the active track + pipeline state (one row per stage, expandable workstreams for multi-role stages, status icons + colors), gate detail on click (status, identity fields, blockers, warnings, workstreams table, raw JSON), and live updates via Server-Sent Events backed by `fs.watch` on `pipeline/gates/`. Zero build step (vanilla HTML / CSS / JS); zero new dependencies. `--open` launches the default browser; `--port N` overrides; loopback-only by default. Path-traversal-safe static serving.
- `core/ui/server.js` + `core/ui/static/{index.html, app.js, styles.css}` + `tests/ui.test.js` (14 tests covering pure helpers, route correctness, security, and SSE plumbing).
- **Multi-model adversarial peer review** (`docs/BACKLOG.md` G1). New `routing.review_fanout: [host, host, ...]` config field. When set, stage-05 (peer-review) workstreams duplicate across all listed hosts — 4 areas × 3 hosts = 12 parallel reviews. Each host produces its own review file (`pipeline/code-review/by-<host>.md`); the approval-derivation hook recognizes host-based filenames and writes gates to a new 3-segment path (`pipeline/gates/stage-05.<area>.<host>.json`). `mergeWorkstreamGates` reads all expected fanout gates and aggregates pessimistically (any FAIL anywhere → merged FAIL). Adapter contract, host install payload, and gate JSON schema unchanged — fanout is pure composition of existing infrastructure. Default `review_fanout: []` (off); opt-in via config.
- `core/orchestrator.js`: new `computeDispatchPlan(stageDef, config)` helper that computes the full set of `(role, hostName, workstreamId, gateFile)` entries the orchestrator should dispatch — one per role normally, N×M when fanout is active.
- `core/hooks/approval-derivation.js`: new `hostFromPath()` helper + `KNOWN_HOSTS` export; `applyVerdict` accepts an optional `host` param that flips gate naming to 3-segment.
- `tests/fanout.test.js` (16 tests covering dispatch plan correctness for fanout / non-fanout / non-peer-review stages, end-to-end runStage producing N×M workstream prompts, mergeWorkstreamGates aggregation across all 12 gates, missing-gate detection, hostFromPath recognition, and approval-derivation end-to-end with host-based review files).
- **Persistent project memory** (`docs/BACKLOG.md` D7, v1). Per-project semantic memory under `.devteam/memory/`. `devteam memory ingest` indexes briefs / design specs / ADRs / clarification logs / runbooks / test reports / accessibility / observability / security reviews / retrospectives / lessons-learned by splitting at level-2 markdown headings and embedding each chunk. `devteam memory query "text"` returns top-K matches by cosine similarity, ranked, with source path + section heading + snippet + similarity score. Local-default embedder (`Xenova/bge-small-en-v1.5` via `@huggingface/transformers`, ~33MB model lazy-downloaded to `~/.cache/huggingface/`, fully offline thereafter). JSON-backed storage (git-friendly); `MemoryStore` interface ready for the sqlite-vec backend planned for v0.3. Opt-out per artifact via the `stagecraft-no-memory` marker. Re-ingest replaces existing chunks (no duplicate rows). Cross-project import is deferred per D7 decision 3.
- `core/memory/{embed,chunker,store,index}.js` + `tests/memory.test.js` (22 tests using `DEVTEAM_EMBEDDING_PROVIDER=stub` to keep CI fast and offline; live BGE smoke-tested separately against the example project).
- Dependency: `@huggingface/transformers ^3.x` (the v3 successor to `@xenova/transformers`).
- `tests/budget.test.js` (7 tests covering `parseBudgetMd` round-trip, config parsing, init/update/check round-trip, and the contract-F gate emitted on escalation).

### Changed

- **Project rename** `ai-dev-team` → **Stagecraft** (marketing / identity surface only). The CLI binary, config dir (`.devteam/`), gate-file paths, and ORCHESTRATOR_ID prefix (`devteam@<version>`) are all unchanged. README, ARCHITECTURE, AGENTS, CONTRIBUTING, and docs/* reflect the new name and tagline.
- **Budget tracking relocated** from `core/guards/budget.js` → `scripts/budget.js`. It was never wired into the orchestrator as a runtime guard — it's an out-of-band tracker fed by external telemetry. New `npm run budget` exposes it. Fixed a latent contract-F violation: the gate it writes on escalation now carries `orchestrator: "devteam@<version>"` instead of the legacy `agent:` field. The exported `root()` is now lazy so the script's pure-logic exports can be called from tests after `chdir()`.

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
