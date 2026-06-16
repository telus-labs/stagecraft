# Features

Stagecraft is an orchestrator that runs your AI coding tool through a structured software development pipeline. It is not a model. It renders prompts, reads the artifacts and gate files the AI writes back, and decides what to run next. State lives on disk, not in a chat log. This document covers every shipped feature, organized by area. For planned work, see [BACKLOG.md](./BACKLOG.md).

- [Supported hosts](#supported-hosts)
- [Pipeline stages](#pipeline-stages)
- [Safety and auditability](#safety-and-auditability)
- [Observability and learning](#observability-and-learning)
- [Developer tools](#developer-tools)
- [Integrations](#integrations)
- [Advanced AI capabilities](#advanced-ai-capabilities)

---

## Supported hosts

Stagecraft is model-agnostic. It runs on whichever AI CLI you already have — Claude Code, Codex, Gemini CLI, or any other tool that can accept a prompt and write files.

Four adapters ship: `claude-code` (primary, with hooks and slash commands), `codex`, `gemini-cli`, and `generic`. Each declares its capabilities — headless support, hooks, subagents, enforcement levels — in `hosts/<host>/capabilities.json`.

See **[`docs/reference/hosts.md`](reference/hosts.md)** for the full capability and enforcement matrix across all four hosts.

---

## Pipeline stages

The pipeline is 18 stages from requirements to retrospective. Every stage renders a prompt, the AI writes an artifact and a JSON gate file, and `devteam next` reads the gate to decide what runs next. State lives on disk — you can stop at any point and pick up exactly where you left off.

### A structured SDLC in the right order

The pipeline is 18 stages from requirements to retrospective, grouped into five phases (Planning, Build, Peer Review, Verification, Delivery). Conditional stages (security-review, migration-safety) only run when a prior gate field triggers them; the mechanical preflight (stage-04e) is auto-run before peer-review, not dispatched to an LLM.

See **[`docs/reference/stages.md`](reference/stages.md)** for the full stage table: ID, roles, conditionalOn, gate files, artifacts, and templates, grouped by phase.

### Tracks — right-size the pipeline to the change

Six tracks control which stages run. `full` runs all 18 stages; lighter tracks skip phases not relevant to the change type. See **[`docs/tracks.md`](tracks.md)** for the per-track stage matrix.

Pick at `devteam stage requirements --feature "..." --track full`.

### Parallel workstreams within a stage

Build and peer-review can run parallel workstreams — frontend, backend, and infra simultaneously — within a single stage. Each workstream writes its own gate; they merge into one stage-level gate.

### License compatibility gate — dependency licenses checked at pre-review

`stage-04a` (pre-review) runs a license check on all installed packages as part of Platform's pre-review pass.

- Gate carries `license_check_passed` (bool) and `license_findings[]` (per-package `{ package, license, policy: allowed|warned|denied, note? }`)
- Default policy: MIT/Apache-2.0/BSD-*/ISC/CC0/Unlicense → allowed; UNLICENSED/SSPL/BUSL → warned; GPL-*/AGPL-*/LGPL-* → denied
- Override with `license.extra_allowed: ["LicenseId"]` in `.devteam/config.yml` to whitelist additional licenses for your project
- Denied licenses cause `license_check_passed: false` and fail the pre-review gate

### Performance budget gate — Lighthouse, bundle size, load tests

New `stage-06e`, role `qa`. Runs after stage-06d on `full`; after stage-06c on `quick`/`hotfix`. Not included in nano/config-only/dep-update.

- Checks Lighthouse Web Vitals, bundle size delta, and load-test throughput (k6 / autocannon) against configured budgets in `performance.budget.json` or `.devteam/config.yml` defaults
- Gate carries `budget_exceeded`, `checks_run[]`, and `skipped_reason` (for changes with no performance-relevant surface)
- `budget_exceeded: true` → FAIL; `skipped_reason` populated → PASS with a note
- **Requires shell capability** — `assertCapabilities()` refuses at dispatch if the routed host doesn't declare `enforces.shell: true`

See `skills/performance-budget/SKILL.md` for the 7-step procedure and `templates/performance-report-template.md`.

### Accessibility audit — WCAG findings in the gate

Runs automatically after QA on `full`, `quick`, and `hotfix` tracks.

- Gate records WCAG finding counts by severity: critical / serious / moderate / minor
- Records `audit_method` (axe-core, pa11y, Lighthouse) and `components_audited`

### Observability gate — confirm metrics, logs, and traces are wired

Platform role verifies that observability signals are actually in place before sign-off.

- Gate carries `required`, `verified`, and `gap` arrays for metrics, logs, and traces
- Records the `verification_method` used
- Warns when the verification method is too weak to be trusted
- Tracks: `full`, `hotfix`

### Documentation gate — PM must confirm doc coverage at sign-off

At Stage 7 (PM sign-off), the PM classifies whether the change touches a **user-visible surface** — a CLI flag, config key, API endpoint, or user-visible behaviour change — and must confirm that the appropriate documentation has been updated.

- `docs_surface_affected` (bool) records the classification; `docs_updated` (bool) records whether the required update was completed; `docs_skipped_reason` (string) records the waiver rationale for internal-only changes
- `docs_updated: false` with `docs_surface_affected: true` is a gate **blocker** — the PM cannot sign off until docs are updated
- Internal refactors, tests, and infrastructure changes require only a one-line skip reason; no doc update is mandated
- Auto-fold from Stage 6 is blocked when `docs_surface_affected: true` and `docs_updated` cannot be confirmed from the pipeline artifacts — the PM is invoked to resolve it

The pattern mirrors `runbook_referenced` (Stage 8): the gate cannot PASS without an explicit answer.

### Migration safety — untested rollbacks halt the pipeline

Fires conditionally when the heuristic detects data-layer changes (migration files, schema files, DDL fragments like `ALTER TABLE`).

- Walks six questions per migration: what it does, breaking or not, backfill required, dual-write required, rollback plan, rollback tested
- **Has veto power**: an empty rollback plan, an untested rollback on a breaking change, or a missing backfill strategy each auto-veto and halt the pipeline — regardless of who approved the change

See [`docs/migration-safety.md`](migration-safety.md) for the veto criteria, gate fields, and routing guidance.

---

## Safety and auditability

Two categories of guarantee: things Stagecraft prevents from happening, and things it always records so any AI decision can be explained and replayed.

### Filesystem-level `allowedWrites` enforcement — cross-workstream writes caught on all hosts

Each build workstream's prompt declares `allowedWrites`, which is the set of paths that workstream is permitted to touch. Enforcement method depends on the host:

- **claude-code**: blocks unauthorized writes at tool-call time via its `PreToolUse Write|Edit` hook. The write never reaches disk.
- **codex and gemini-cli**: run a post-hoc git-status diff after the workstream exits. Any file outside `allowedWrites` is captured in `writeViolations[]` and the orchestrator patches the gate to `FAIL` with violations listed in `blockers[]`.

The `generic` adapter declares `prompt-only` enforcement: violations are discouraged but not technically blocked.

`writeViolations[]` appears in the orchestrator's result when violations are found; it is merged into the gate `blockers[]` so `devteam next` reports `fix-and-retry`.

### Role tool budgets — per-role tool-surface restriction

Each role has a declared tool budget — the list of tools it may use during its workstream. The budget is declared in `ROLE_FRONTMATTER` in `hosts/claude-code/adapter.js` and propagated through the dispatch descriptor so every host can apply it.

Enforcement method depends on the host:

- **claude-code** (`enforces.tool_budget: "native"`): the subagent `tools:` YAML line limits the tool surface at the tool-call boundary. The model cannot call undeclared tools; no prompt instruction needed.
- **codex, gemini-cli, generic** (`enforces.tool_budget: "prompt-only"`): the tool budget is injected as an advisory section in the stage prompt. The model is told which tools to prefer and which to avoid; violations are not technically blocked.

At dispatch time, the orchestrator warns (not blocks) when a budget-carrying role is routed to a prompt-only host, so operators can see the enforcement gap in `devteam plan` output. Gate files carry a `dispatched_tool_budget` field (orchestrator-stamped for headless runs; auto-injected by the validator for user-driven runs) recording what the role was *permitted* to do — extending the audit trail beyond *what it wrote*.

Current budgets by role (higher-trust roles get broader surfaces):

| Role | Tools |
|---|---|
| pm | Read, Write, Glob |
| reviewer | Read, Write, Glob, Grep |
| principal | Read, Write, Glob, Grep, Bash |
| backend / frontend / platform / qa | Read, Write, Edit, Glob, Grep, Bash |
| auditor / red-team / migrations / verifier | Read, Glob, Grep, Bash, Write |

### Capability-required permissions — stages declare what they need; adapters declare what they have

Four stages require shell execution to do their work: pre-review (stage-04a), qa (stage-06), verification-beyond-tests (stage-06d), and deploy (stage-08), plus the new performance-budget (stage-06e). Each declares `requiredCapabilities: { shell: true }` in `stages.js`.

At dispatch time, `assertCapabilities()` in the orchestrator checks that the routed host's adapter declares the required capabilities. If not, the orchestrator throws a named error before invoking the host. This prevents silent failures where a stage appears to run but skips all shell-dependent checks because the host can't execute them.

All three primary adapters (claude-code, codex, gemini-cli) declare `enforces.shell: true`. The generic adapter does not; use `routing.stages` overrides in `.devteam/config.yml` to route shell-requiring stages to a capable host.

### Bounded workspace isolation — separate artifact trees per feature

When multiple features are in flight, enable bounded workspace mode so their pipeline artifacts stay separate:

```yaml
pipeline:
  isolation: bounded
```

With `isolation: bounded`, artifacts (gates, logs, context files) land under `pipeline/changes/<changeId>/` instead of the global `pipeline/`. The `changeId` is derived by slugifying the `--feature` value. `devteam next` and `devteam summary` can distinguish in-flight features; `devteam validate` reads `DEVTEAM_CHANGE_ID` from the environment to validate gates in the bounded directory. Default is `in-place`, which has no impact on existing setups.

### Secret scanning — blocks credentials from reaching the repo

Wired into claude-code's `PreToolUse Write|Edit` hook. Runs before every file write.

- Built-in patterns for AWS, GitHub, Anthropic, OpenAI, Google, Slack, Stripe, private keys, JWTs, and postgres URLs
- Path allowlist for `.env.example`, `docs/`, `examples/`, and test files
- Magic-comment override (`devteam-allow-secret:`) for confirmed false positives

### Audit trail — replay any AI decision and see what drifted

Gates optionally record the full reproducibility fingerprint for any stage: `model_version`, `temperature`, `seed`, `max_tokens`, `system_prompt_hash`, and `tools_hash`.

- `devteam reproduce <stage-id>` reads a gate, classifies replay readiness (full / partial / incomplete), prints recorded fields, and re-renders the current prompt to surface hash drift
- Designed to satisfy SOC 2 and EU AI Act audit requirements: the gate JSON is a complete record of how an AI decision was made

See [`docs/reproducibility.md`](reproducibility.md) for the gate fields, replay readiness classification, and drift-detection details.

### Tamper-evident gate chain — the audit record can't be quietly rewritten (C6)

Recording *what* decided a stage is only half the audit story; the record also has to be **tamper-evident**. Each stage-level gate carries `chain.prev_hash` — a canonical-JSON SHA-256 of its predecessor stage gate — so the gates form a linear chain (`stage-01 → … → stage-09`).

- Mutating any earlier gate changes its hash, so every gate downstream of it no longer matches what it recorded. `devteam verify-chain` recomputes the chain, **locates the break**, and exits non-zero (CI-usable).
- The hash covers the predecessor's full content including its own `chain` field, so the chain is transitive — re-stamping a tampered middle gate just moves the break downstream.
- Stamped automatically by the orchestrator (`mergeWorkstreamGates` for multi-role stages, `runStageHeadless` for single-role); `devteam stamp-chain` re-stamps after a deliberate earlier-stage re-run.
- Makes the autonomous driver's authority records (which `--auto-rule` decision resolved which escalation) part of a tamper-evident trail — the EU AI Act / SOC 2 "who decided this, and was the record altered?" guarantee.

---

## Observability and learning

The pipeline records enough data to identify which model performs best for each role on your specific codebase, without manual analysis.

### Cost and token tracking — know what each stage costs

Gates record `tokens_in`, `tokens_out`, `cost_usd`, `model`, and `duration_ms` per stage and per workstream.

- `npm run dashboard:cost` (or `scripts/dashboard.js --view cost`) rolls up by host, role, or stage
- Pricing table covers Claude, GPT, and Gemini families with exact and prefix-match lookup
- Workstream-level detail preserved in `workstreams[]` so host/role attribution is correct

See [`docs/cost.md`](cost.md) for the pricing table, dashboard flags, and budget workflow.

### OpenTelemetry tracing — every workstream emits spans

Standard OTel spans for every workstream, compatible with any collector. See `docs/observability.md` for the span schema and collector configuration.

### Gate-pass-rate dashboards — spot where the pipeline struggles

`npm run dashboard` aggregates `pipeline/gates/` across one or more projects.

- Groups by stage, host, role, and status; markdown report with ASCII bar chart or `--json` for tooling
- `--from p1,p2,...` for multi-project rollups; `--since YYYY-MM-DD` for time windows

### Per-role per-model performance scores — measure what actually works

`npm run performance` (or `scripts/performance.js`) computes, for each (role, host) pair:

- Dispatch count, first-try pass rate, mean retries to pass
- Total cost, mean cost, cost per pass, mean duration
- Pairwise comparisons when two or more hosts serve the same role

### Adaptive routing — let your own data reconfigure the pipeline

`npm run routing:suggest` reads performance scores, compares them against the current `.devteam/config.yml`, and proposes role-level host swaps.

- Minimum dispatch threshold (5 by default) and minimum pass-rate delta (10pp) prevent noisy suggestions
- `--apply` rewrites the config after a confirmation prompt; `--yes` skips the prompt for CI

### Project memory — the pipeline remembers what it has seen

Per-project semantic memory under `.devteam/memory/`. Uses a local embedder (`Xenova/bge-small-en-v1.5`, ~33 MB, lazy download) with a git-friendly JSON backend.

- Indexes briefs, design specs, ADRs, retros, lessons, runbooks, and audit reports
- `devteam memory ingest`, `query`, `stats`, `clear`, `reindex`

See [`docs/memory.md`](memory.md) for embedder options, the `.gitignore` note, and the opt-out marker.

### Org-shared lessons-learned — knowledge that travels across projects

Lifts ADRs and lessons from any project into a shared store at `~/.stagecraft/memory/` (overridable via `STAGECRAFT_ORG_MEMORY_DIR`).

- `devteam memory promote` copies current-project records into the org store
- `devteam memory query --org` searches across all contributing projects; results name their source project
- Idempotent — re-promoting the same record doesn't duplicate it
- Foundation for architecture continuity (see Advanced AI capabilities)

---

## Developer tools

### Core commands — the everyday loop

**`devteam assess [--description "..."] [--json] [--apply] [--confirm] [files...]`** — rule-based track recommendation before starting a run.

- Analyzes description keywords and file/content heuristics (security patterns, migration files, config-only paths) to recommend a track
- Priority order: hotfix keywords → dep-update → config-only → nano → quick → full (default)
- Heuristic overrides: migration-safety-required bumps lighter tracks to full; security-required bumps nano to quick
- **Default (no flags):** writes `pipeline/track.json` with the inferred track and `source: "inferred"` — per-run provenance record read by `devteam run`
- **`--confirm`:** writes `pipeline/track.json` with `source: "human"` — use after verifying the recommendation; silences the unconfirmed-track guard in `devteam run`
- **`--apply`:** writes `pipeline.custom_stages` to `.devteam/config.yml` (project-wide setting) so `devteam next`/`devteam summary`/`devteam stage` use the custom track; orthogonal to `pipeline/track.json` behavior
- `--json` emits structured output including recommended track, rationale, and which heuristics fired

**`devteam standards discover [--cwd <dir>] [--json] [--dry-run] [--force]`** — static analysis of a project's conventions.

- Scans the project file system and writes `docs/project-conventions.md` with seven detected properties: tech stack (JS/TS/Python/Go/Rust), module system (ESM/CJS/mixed), file layout (top-level dirs + source subdirs), naming style (kebab/PascalCase/camelCase/snake_case plurality), tooling (TypeScript/ESLint/Prettier/Biome/Husky/EditorConfig), test configuration (framework, co-location, pattern), and most-used imports (top 10 by frequency, skipping builtins)
- `--dry-run` prints without writing; `--json` emits the structured discovery result; `--force` overwrites an existing file
- Pure static analysis — no external processes, no network, no AI. Reads manifests, source files, and config files only
- Add `docs/project-conventions.md` to your AGENTS.md or readFirst lists to inject discovered conventions into agent prompts

**`devteam commit [--all] [--dry-run] [--message <msg>] [--json]`** — stage exactly the right pipeline artifacts and commit. (Phase 12.2, ADR-010)

- Reads `pipeline/run-state.json` and determines which stages have not yet been committed (via an idempotency cursor, `last_committed_stage_index`)
- Stages the gate file for each completed stage (PASS or WARN) plus the stage's named output files (brief.md, design-spec.md, spec.feature, code-review/, test-report.md, etc.) — never `git add -A`
- Volatile runtime files (`run-state.json`, `run.lock`, `run-log.jsonl`, logs/, gates/archive/, etc.) are excluded unconditionally, even if they somehow appear in an artifact slot
- Generates a commit message: `"pipeline: stages NN–NN PASS"` (or `"pipeline(repair): ..."` for repair runs) with a `Co-Authored-By: Stagecraft` trailer
- Prompts `y/n/e` before committing; `--dry-run` prints the file list without prompting; `--all` ignores the cursor and re-stages everything; `--message` overrides the generated subject
- Calling it twice is safe: the second call prints "nothing to commit"
- Limitation: supports in-place pipeline mode only (changeId=null); bounded-workspace (B9) support is a Phase 12.3+ follow-on

**`devteam init`** — set up a project for the first time.

- Writes `.devteam/config.yml`, lays down role briefs, rules, skills, and the `/devteam` slash command for the chosen host
- Writes (or updates) a managed `# BEGIN stagecraft` / `# END stagecraft` block in `.gitignore` listing all volatile Stagecraft runtime files — run once and your `.gitignore` is machine-maintained; re-running updates an outdated block
- `--host claude-code | codex | gemini-cli | generic`

**`devteam doctor`** — verify everything is wired up before you start.

- Checks the Stagecraft install, each declared host CLI is reachable, and roles/rules/skills are correctly laid down
- Prints a green/red checklist; fix what's red before running a stage
- Reports local embedding availability as informational (`ℹ`) — absence is not a failure; run `npm install @huggingface/transformers` to enable `devteam memory` with the default local embedder
- Prints a warning (not a hard exit) when run on Windows (`process.platform === "win32"`) — Stagecraft is POSIX-only; WSL2 is the supported path on Windows

**`devteam next [--json] [--skip-advise]`** — find out what to do next.

- Reads the last gate in `pipeline/gates/`, interprets its status, and tells you what to run or what to fix
- The main command in the interactive loop
- Every non-pass action carries a **`failure_class`** so you know *how* to respond: `code-defect` (change code, re-run), `state-corruption` (gate unreadable — repair it, don't re-run), `external-blocked` (a human/external action is required), `judgment-gate` (escalation — make a ruling), `convergence-exhausted` (retry budget spent → escalate). Surfaces a typed `PRINCIPAL-CANNOT-DECIDE` question directly when one is written
- `--json` adds a `schema_version` for programmatic callers (the autonomous driver)

**`devteam advise [--apply <decisions>] [--json]`** — triage deferred findings.

- Advisory panel for `noted_for_followup[]` items across all completed gate files
- Classifies each item: `QA_BLOCKER` (missing AC coverage in spec.feature), `PEER_REVIEW_RISK` (high-severity, no AC ref), `QA_NOISE` (timing/flakiness keywords), `INFO`
- Generates ranked options (scaffold, defer, amend, nothing, known-flaky, wontfix) per item
- `--apply AC-11=A,AC-10=B:PROJ-123,AC-12=A` encodes stage manager decisions into `pipeline/context.md` as advisory markers
- Downstream stages respect the markers: QA skips coverage checks for `DEFERRED:` items, retries `KNOWN-FLAKY:` tests once; peer-review notes `BRIEF-AMEND-NEEDED:` entries
- Idempotent: re-running `--apply` replaces the advisory section without duplicating entries
- See [`rules/advise.md`](../rules/advise.md) and [`docs/runbooks/fix-and-retry.md` § Case 11](runbooks/fix-and-retry.md#case-11-advise-workflow--triage-follow-up-items-before-downstream-stages)

**`devteam preflight`** — run pre-peer-review mechanical checks standalone.

- Runs git hygiene (committed-but-ignored files), import path validation, and deferred-items risk check
- Auto-invoked by `devteam stage peer-review`; use standalone for early feedback
- Writes `pipeline/gates/stage-04e.json`; see [Case 10](runbooks/fix-and-retry.md#case-10-preflight-stage-04e-fail--committed-ignored-files-or-broken-import-path) for fix steps

**Headless mode** — run a stage end-to-end without touching the chat.

- `devteam stage <name> --feature "..." --headless` spawns the host CLI, pipes the rendered prompt to its stdin, waits for the gate, and exits
- Combine with `devteam next` to chain stages in a script

**`devteam run [--feature "..."] [--repair "<symptom>"] [--repair-at <file>:<line>] [--track <t>] [--until <s>] [--budget-usd X] [--timeout-ms N] [--retry-delay-ms N] [--auto-rule <classes>] [--allow-stage <s>] [--max-iterations N] [--resume] [--force] [--json]`** — drive the whole pipeline unattended. See the **Autonomous pipeline execution** section under Advanced AI capabilities (and [`docs/runbooks/autonomous-run.md`](runbooks/autonomous-run.md)) for the full behavior.

- Loops `next → dispatch → merge` to completion; auto-fixes `code-defect` failures and retries transient dispatch blips
- Halts cleanly for a human at the consequence ceiling, on un-granted escalations, a budget cap, or a structural failure
- Writes `pipeline/run.lock`, `run-state.json`, and an audit-trail `run-log.jsonl`
- **`--repair "<symptom>"`** — bug-fix intent mode (ADR-009). Orthogonal to `--track`; defaults to hotfix depth. Auth/payments/migration symptoms auto-upgrade to full via the stoplist. Mutually exclusive with `--feature`. Automatically routes through a **diagnosis stage** (see below) before build; the diagnosed `affected_files` list activates the structural scope gate. The build runs in **PATCH MODE** (`renderPatchBlock` injects a `⚠️ PATCH MODE — targeted fix only` block so the AI scopes its changes to the diagnosed files). Run-state records `intent: "repair"` and `repair: "<symptom>"`; every run-log event carries the intent tag.
- **`--repair-at <file>:<line>`** — escape hatch for when you already know the defect location. Comma-separated `file:line` pairs (e.g. `src/auth.js:42,src/session.js:18`) seed the affected-files list directly, write a synthetic PASS stage-01 gate, and skip the LLM diagnosis dispatch entirely. Combine with `--repair` to bypass the diagnosis stage while retaining PATCH MODE scoping and the scope gate.

### Repair mode diagnosis stage — stage-01 produces a DIAGNOSIS in repair mode (ADR-009 Phase 2)

When `devteam run --repair` is used, stage-01 (requirements) switches its artifact from a feature brief to a **DIAGNOSIS** document. Same stage, same gate file path, fix-aware output — no new stages, no parallel pipeline.

- **Diagnosis document** (`pipeline/diagnosis.md`): root cause with specific `file:line` references, proposed fix, every file the fix must touch (`affected_files`), and a regression criterion the executable-spec stage can translate into a runnable test.
- **Judgment gate**: the diagnosis gate is always ESCALATE-shaped — it requires explicit human approval or `--auto-rule diagnosis-approved` before the build proceeds. This prevents the AI from autonomously proceeding on an incorrect root-cause assessment.
  - Interactive mode: the gate lands as an ESCALATE; `devteam next` shows the judgment question before you proceed.
  - Autonomous mode: `--auto-rule diagnosis-approved` grants the driver permission to auto-rule the diagnosis; the Principal issues a `PRINCIPAL-RULING: ... [class: diagnosis-approved]` line and the run continues.
- **Scope gate activation**: once stage-01 PASSes (after approval), the driver reads `affected_files` from the diagnosis gate and stores it in run-state. The structural scope gate — which was wired in Phase 1 but inert without a list — now FAILs any build that writes files outside the diagnosed set.
- **`--repair-at` escape hatch**: when the defect location is already known, pass `--repair-at src/auth.js:42` to seed `affected_files` directly and skip the LLM diagnosis dispatch. A synthetic PASS stage-01 gate is written so `next()` advances past requirements immediately.

### Repair mode reproduction stage — stage-03b in repair mode (ADR-009 Phase 3)

When `devteam run --repair` is used, stage-03b (executable-spec) is injected into the stage order immediately before build — even on hotfix depth, which previously skipped it. The stage author writes a **failing-first regression scenario** for the reported bug: a Gherkin Scenario that exercises the defect so the regression test is RED before the fix and GREEN after.

- **Tri-state `reproduced` gate field**: set by the agent; verified by the orchestrator stamp.
  - `true` — bug reproduced; a runnable failing test was written.
  - `false` — could not reproduce the defect at all.
  - `"unverifiable: <reason>"` — an automated test is impossible (external API, nondeterminism, data dependency). Stamp emits a loud `WARN reproduction-unverifiable` and continues without blocking.
- **Stamp verification (not agent-asserted)**:
  - `stampStage03b` captures the pre-build test baseline (`reproduction_pre_build` audit record). If unverifiable, the baseline is skipped; the WARN is embedded in the gate.
  - `stampStage04a` finalizes `reproduced` on the stage-03b gate after the post-build test run: `red_before_confirmed` (pre-build failed) + `green_after_confirmed` (post-build passed) confirm the regression test actually turned green. Written to `reproduction_verification` in the stage-03b `_orchestrator_stamped.runs`.
- **No double-inject on full track**: stage-03b is already in the full track order; the driver filters it out before re-injecting it at the correct position (immediately before build).
- **`--repair-at` still includes it**: the escape hatch skips diagnosis but not the reproduction stage.

### Repair mode vocabulary and operator runbook (ADR-009 Phase 4)

The authoritative term map lives in [docs/conventions.md](conventions.md#repair-mode-vocabulary-adr-009-decision8): it distinguishes `--repair` (intent), `hotfix` (track depth), `fix-and-retry` / `fix_steps` (internal self-correction machinery), and PATCH MODE (build-scoping mechanism). The runbook at [docs/runbooks/repair-flow.md](runbooks/repair-flow.md) covers the three operator decision points: diagnosis gate approval (interactive or `--auto-rule diagnosis-approved`), scope-gate FAIL recovery, and tri-state reproduction handling.

### Inspection and power tools

**`devteam validate`** — confirm gate files haven't been edited by hand.

- Validates all gates in `pipeline/gates/` against their JSON schemas
- Used in CI; fails if any gate is invalid

**Web UI** — a live dashboard of your pipeline as it runs.

- `devteam ui --open` starts a local server at `http://127.0.0.1:3737/`
- Stage rows show PASS / WARN / FAIL / ESCALATE status; updates live via SSE as gate files land
- Click a row for gate detail and raw JSON; click a role chip to read its brief inline
- Zero build step, zero new production dependencies; loopback-only by default

**`devteam replay <stage-id>`** — re-run a past stage and see what changed.

- Re-runs a recorded stage with current config, writes the new gate to `pipeline/gates/replay/`
- Diffs the result against the original: status, blockers, cost/tokens/duration, reproducibility fields
- `--dry-run` shows the plan and prompt-hash drift without invoking the host
- **Crash-safe:** the original gate is snapshotted to `pipeline/gates/.replay-backup/` before dispatch and restored from disk on any exit — a crash mid-run no longer silently replaces the original; leftover backups from a prior crash are detected and reported on next invocation

**Codebase audit** — a full read-only analysis of any project.

- `/audit` in Claude Code runs four phases: Bootstrap → Health Assessment → Deep Analysis → Roadmap
- Produces 11 output files in `docs/audit/`; resume-aware via `docs/audit/status.json`
- `/audit-quick` runs phases 1–2 only for a faster assessment

### Generated reference documentation

Machine-derived docs stay in sync with the codebase by construction — a CI advisory fires when committed output diverges from a fresh generation.

**`npm run docs:generate`** regenerates three reference files:

- **[`docs/reference/stages.md`](reference/stages.md)** — full stage table (ID, roles, conditionalOn, gate files, artifacts, grouped by phase). Source of truth: `core/pipeline/stages.js`.
- **[`docs/reference/hosts.md`](reference/hosts.md)** — capability and enforcement matrix across all four adapters. Source of truth: `hosts/*/capabilities.json`.
- **[`docs/reference/cli.md`](reference/cli.md)** — full CLI reference per command: synopsis, flag table (name, type, description), and registry order. Source of truth: the per-command flag schemas in `core/cli/commands/`.

**`npm run prompt:budget`** regenerates:

- **[`docs/reference/prompt-budget.md`](reference/prompt-budget.md)** — per-stage framework context size in bytes and estimated tokens (bytes ÷ 4), plus the top-5 heaviest files per stage. Used to track readFirst weight over time; a CI advisory fires when any stage grows >10% from its committed baseline.

**`npm run consistency`** — cross-artifact consistency checker (313+ checks). Catches prose-vs-code drift across stage names, track lists, command surface, referenced-file existence, file-size ceiling violations, and EXAMPLE.md freshness. Runs in CI; advisory-only checks print without failing the build; hard checks exit non-zero.

---

## Integrations

Surface pipeline state in the tools your team already uses. The integration approach is to validate and publish gates produced locally, rather than running the pipeline itself in CI. LLM pipelines are expensive and human-in-the-loop by design.

### GitHub PR integration — pipeline state as PR checks

`scripts/pr-publish.js` posts pipeline state via the `gh` CLI. Two modes:

- `body` — replaces the PR description with a formatted pipeline summary
- `checks` — posts each gate as a GitHub check run: PASS → success, WARN → neutral, FAIL/ESCALATE → failure

Auto-detects repo and PR from the current branch. `--dry-run` previews without API calls.

### GitHub Actions workflow — validate gates on every PR

`devteam ci install` drops a reusable workflow into `.github/workflows/`.

- On PR: validates `pipeline/gates/` against schemas, posts each gate as a check run, runs `devteam reproduce` as an advisory drift check
- Skips cleanly when the PR doesn't touch `pipeline/`
- `devteam ci show` previews the template before installing

See [`docs/ci.md`](ci.md) for the full workflow template and environment variable reference.

---

## Advanced AI capabilities

These capabilities perform work that static tooling cannot replicate. They depend on the pipeline being AI-native.

### Autonomous pipeline execution (`devteam run`) — drives the pipeline to completion

A deterministic code loop around `devteam next` that advances the pipeline unattended and **halts cleanly the moment a human is genuinely needed**. The loop itself is code; the only LLMs are the workstream agents it dispatches (and, at escalation, the Principal). The human shifts from *mechanical sequencer* to *authority grantor*. Built on a **typed failure model** ([ADR-003](adr/003-bounded-autonomous-execution.md)).

- **Auto-fixes machine-diagnosable failures.** On a `code-defect` it clears the failing gate, writes the blockers into `pipeline/context.md` as cross-stage context, and re-dispatches — bounded by `autonomy.max_retries` (default 2). Transient dispatch failures (no gate written) back off and retry; structural ones (clean exit, no output) halt.
- **Progress-based convergence.** Before each fix-and-retry the driver archives the failing gate to `pipeline/gates/archive/<stage>.attempt-N.json`. If normalized blocker fingerprints are identical across two consecutive archived attempts the breaker trips immediately — spends no more retries on a stuck stage and surfaces what didn't change (`"blocker 'X' identical across attempts 1,2"`) so the escalation context is actionable. The count ceiling (`max_retries`) remains as a backstop for the first retry.
- **Consequence ceiling.** Never advances *into* `sign-off` (stage-07) or `deploy` (stage-08) — irreversible/outward-facing stages — without an explicit `--allow-stage` grant.
- **Bounded autonomous escalation resolution.** By default every escalation halts for a human (the Principal isn't even dispatched). Opt in with `--auto-rule <classes>` — a **CLI-only, allowlist-only** grant of bounded ruling categories (e.g. `formatting-only`, `doc-only`). The driver then auto-applies a Principal ruling whose `[class:]` is granted, and **never** crosses the hard stops: a typed `PRINCIPAL-CANNOT-DECIDE` (missing authority / information / value), the consequence ceiling, or `convergence-exhausted`. A given escalation is auto-ruled at most once.
- **Safety rails.** An exclusive `pipeline/run.lock`, resumable `run-state.json` (`--resume`), a pre-dispatch `--budget-usd` cap, a per-stage `--timeout-ms`, and a `--max-iterations` guard.
- **Audit trail.** Every transition — including each auto-fix and auto-ruling with its `grant_class` and authority — is appended to `pipeline/run-log.jsonl`.
- **Liveness heartbeat + observe-only stall detection (ADR-007 Tier 1).** A `heartbeat` event is emitted to `run-log.jsonl` (and via `onEvent`) at the start of every driver loop iteration, bounding the last-event age. Alongside each dispatch a fire-and-forget stall probe watches for silent hangs: it emits `stall-detected` (`stall_class: "observed"`) when neither the workstream log (`pipeline/logs/`) grew ≥ 512 bytes nor any gate updated within 5 minutes — the dispatch is never killed (observe-only; no `Promise.race`). Config: `autonomy.stall_threshold_ms` and `autonomy.stall_min_growth_bytes` in `.devteam/config.yml`. Query liveness with `devteam status`.
- **Advisory sweep on completion + `--fail-on-advisory` (ADR-008).** After `pipeline-complete` the driver runs an in-process advisory sweep (reusing `core/advise.js`: `QA_BLOCKER` / `PEER_REVIEW_RISK` / `A11Y_FIX`), adds `advisory_blockers_count` and `advisory_breakdown` to the `--json` summary, and prints a loud stderr line when blockers remain. Default exit is unchanged; opt in to exit **3** with `--fail-on-advisory` (QA_BLOCKER + A11Y_FIX threshold; `=all` adds PEER_REVIEW_RISK).
- Exit codes: `0` complete or a clean configured stop (`--until` / ceiling); `1` needs attention; `2` lock held; `3` `--fail-on-advisory` and blocker-class items remain.

See [`docs/runbooks/autonomous-run.md`](runbooks/autonomous-run.md) for the launch guide, halt reasons, and honest limitations.

### `/goal` injection — convergent headless stages loop until their objective is met

For `build` (stage-04) and `qa` (stage-06) stages, hosts that declare `capabilities.goalLoop: true` (claude-code and codex) automatically receive `/goal "<condition>"` prepended to the headless prompt. The condition is a workstream-specific exit criterion from `stages.js`; the host loops internally until its stated objective is met rather than running a fixed number of turns.

- Automatically active when: stage has a `goalCondition`, host declares `goalLoop: true`, and workstream runs headless
- Gemini CLI and generic adapter do not declare `goalLoop: true` — unaffected; receive the prompt unchanged
- Interactive (non-headless) runs are also unaffected

### Multi-model peer review — diversity as a correctness strategy

When `routing.review_fanout` is configured, Stage 5 (peer-review) duplicates each of the four area reviews across the listed hosts in parallel. 4 areas × 3 hosts = 12 parallel reviews; merge is pessimistic (any FAIL blocks the stage).

- Different training data produces different blind spots. The diversity comes from model family, not from changing the rubric.
- Each reviewer applies the same four-principles rubric; the cross-model signal is the value of fanout.
- This is execution-diversity, not method-diversity. For adversarial method, see the Red-team stage below.

### Closed-loop acceptance criteria → spec → tests — drift caught structurally

The PM writes numbered acceptance criteria (`AC-N`) in `pipeline/brief.md`. The chain is enforced end-to-end:

1. Stage-03b (executable-spec) translates each `AC-N` into one Gherkin scenario in `pipeline/spec.feature`, tagged `@AC-N`
2. Stage-06 (QA) maps each scenario 1:1 to a test
3. `devteam spec verify` checks all three are still in sync

Catches orphan ACs, orphan scenarios, duplicate AC numbers, and unknown AC refs in tests. `devteam spec generate` scaffolds the `.feature` file from the brief.

See [`docs/spec-authoring.md`](spec-authoring.md) for how to write AC-N criteria, scaffold the spec file, and interpret drift reports.

### Cross-artifact consistency analysis — catch incoherence the gate chain misses

Each gate can pass while the artifacts it governs silently diverge. `devteam consistency analyze` detects that class of bug in one pass.

- Walks the full artifact chain: `pipeline/brief.md` → `pipeline/spec.feature` → `pipeline/pr-*.md` → red-team gate → test-report → gate fields
- **Three drift classes checked**: AC-to-scenario (orphan acceptance criteria, orphan Gherkin scenarios), scenario-to-test (uncovered scenarios, unmapped test references), red-team-to-build (findings referencing files not touched by any workstream PR)
- Exit 0 = clean; exit 1 = drift found — safe to use in CI gates
- `--json` flag for structured output; fix recommendations printed per drift item when running interactively
- Builds on `devteam spec verify` (G2's AC↔spec↔test drift check) and extends it to the full artifact chain

Use `devteam consistency analyze` after every merge to catch cross-artifact drift before it reaches peer-review.

### Red-team stage — adversarial review before peer-review

A dedicated `red-team` role runs between build and peer-review on `full` and `hotfix` tracks. It is explicitly routed to a different host than the build agents.

- Walks 10 attack surfaces: input boundaries, state, sequence, integrations, auth edges, resource exhaustion, failure modes mid-operation, abuse cases, downstream effects, observability gaps
- Produces concrete reproducers, not observations; triage by severity × likelihood × scope
- `must_address_before_peer_review[]` in the gate blocks stage-05 until cleared

See [`docs/red-team.md`](red-team.md) for the 10 attack surfaces, gate fields, and how it differs from the conditional security review (stage 4b).

### Verification beyond tests — structural verification after QA

Full-track-only stage that runs after QA passes. The `verifier` role applies three methods to the changed code:

- **Property-based testing** (fast-check / hypothesis / proptest) — generates edge cases the author didn't think of; catches entire classes of bugs
- **Mutation testing** (Stryker / mutmut / mull) — introduces deliberate bugs and checks whether the test suite catches them
- **Formal verification** (TLA+ / Alloy / Lean) — optional, for functions where correctness is non-negotiable

A surviving mutant on a critical path, a property counterexample, or a formal counterexample populates `blocking_findings[]` and fails the stage. Skipped methods require a stated reason — "didn't have time" is not accepted.

See [`docs/verification-beyond-tests.md`](verification-beyond-tests.md) for candidate identification, gate fields, and skip-reason policy.

### Production feedback seam — close the brief→production SLO loop (G3)

After deploy, the operator copies `templates/production-feedback-template.md` to `pipeline/production-feedback.md` and fills in production signals — SLO/metric deltas vs. the brief's targets, incidents since deploy, adoption signals. No automated ingestion; the file is the integration seam (Jira/Datadog automation can write it without framework changes).

- Stage 9 (retrospective) reads the file when present and adds a `## Production Deltas` section to `pipeline/retrospective.md`, recording which brief SLOs were met or missed and whether any incident suggests a promotable lesson
- Gate field `production_feedback_reviewed` records `true` (reviewed) / `false` (present but skipped) / `"absent"` (not present this run)
- `devteam next` on a completed pipeline mentions the file once as an optional follow-up when absent — not a nag, not a blocker
- Effort-1 by design: no automation, no new commands, no integrations. The file is the seam; automation plugs in later at the write side with no framework changes

See `docs/conventions.md` for the full file convention and `templates/production-feedback-template.md` for the scaffold.

### Architecture continuity — binding architectural decisions across projects

Prior architectural decisions become binding commitments across every future project in the org.

- `devteam architecture lookup "<topic>"` queries the org ADR store before a design stage
- The Principal role brief requires either honoring prior ADRs (cited in "Prior commitments considered") or explicitly superseding them with a new ADR carrying a `Supersedes:` field and rationale
- Silent disagreement with a prior ADR is forbidden by the role brief — it doesn't just fail a lint check, it's a role-level constraint
- Design gate records `adrs_consulted` and `adrs_superseded` for the audit trail

---

> All features above trace back to entries in [BACKLOG.md](./BACKLOG.md) where applicable.
