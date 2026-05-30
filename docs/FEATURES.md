# Features

Stagecraft is an orchestrator that runs your AI coding tool through a structured software development pipeline. It is not a model — it renders prompts, reads the artifacts and gate files the AI writes back, and decides what to run next. State lives on disk, not in a chat log. This document covers every shipped feature, organized by area. For planned work, see [BACKLOG.md](./BACKLOG.md).

---

## Supported hosts

Stagecraft is model-agnostic. It runs on whichever AI CLI you already have — Claude Code, Codex, Gemini CLI, or any other tool that can accept a prompt and write files.

### Claude Code — full integration with hooks and slash commands

The primary host. Installs the full integration payload on `devteam init`.

- Role briefs land in `.claude/agents/`, rules in `.claude/rules/`, skills in `.claude/skills/`
- `PreToolUse` hooks wire in secret scanning and filesystem enforcement automatically
- Slash command `/devteam` is laid down so you can run stages from inside a Claude Code session
- Headless mode runs via `claude --print`

### Codex CLI — headless, symmetric to Gemini

- Installs roles into `.codex/roles/`, skills into `.codex/skills/`
- No hooks, no slash commands — runs headless via `codex`

### Gemini CLI — headless, third model family for diversity

Running peer-review on a different model family than the one that built the code catches blind spots single-family review misses.

- Installs roles into `.gemini/prompts/roles/`, skills into `.gemini/skills/`
- No hooks, no slash commands — runs headless via `gemini`

### Generic adapter — any other host

Auto-discovers roles and skills with no host-specific install payload. Use this as a fallback for tools not listed above.

---

## Pipeline stages

The pipeline is 17 stages from requirements to retrospective. Every stage renders a prompt, the AI writes an artifact and a JSON gate file, and `devteam next` reads the gate to decide what runs next. State lives on disk — you can stop at any point and pick up exactly where you left off.

### A structured SDLC in the right order

Stage sequence for the `full` track:

| Stage | Role |
|---|---|
| requirements | PM |
| clarification | PM |
| design | Principal |
| executable-spec | PM |
| build | Backend / Frontend / Infra |
| red-team | Red-team |
| peer-review | Reviewer |
| QA | QA |
| accessibility-audit | QA |
| observability-gate | Platform |
| sign-off | PM |
| migration-safety | Migrations |
| deploy | Platform |
| post-deploy | Platform |
| retrospective | PM |

### Tracks — right-size the pipeline to the change

Three main tracks, plus variants for specific change types:

| Track | Stages | Best for |
|---|---|---|
| `full` | 17 | New features, production changes |
| `quick` | 7 | Bug fixes, small enhancements |
| `nano` | 3 | Config changes, docs, hotfixes |
| `hotfix` | — | Emergency fixes with safety gates preserved |
| `config-only` | — | Infrastructure and config changes |
| `dep-update` | — | Dependency bumps |

Pick at `devteam stage requirements --feature "..." --track full`.

### Parallel workstreams within a stage

Build and peer-review can run parallel workstreams — frontend, backend, and infra simultaneously — within a single stage. Each workstream writes its own gate; they merge into one stage-level gate.

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

### Migration safety — untested rollbacks halt the pipeline

Fires conditionally when the heuristic detects data-layer changes (migration files, schema files, DDL fragments like `ALTER TABLE`).

- Walks six questions per migration: what it does, breaking or not, backfill required, dual-write required, rollback plan, rollback tested
- **Has veto power**: an empty rollback plan, an untested rollback on a breaking change, or a missing backfill strategy each auto-veto and halt the pipeline — regardless of who approved the change

---

## Safety and auditability

Two categories of guarantee: things Stagecraft prevents from happening, and things it always records so any AI decision can be explained and replayed.

### Secret scanning — blocks credentials from reaching the repo

Wired into claude-code's `PreToolUse Write|Edit` hook. Runs before every file write.

- Built-in patterns for AWS, GitHub, Anthropic, OpenAI, Google, Slack, Stripe, private keys, JWTs, and postgres URLs
- Path allowlist for `.env.example`, `docs/`, `examples/`, and test files
- Magic-comment override (`devteam-allow-secret:`) for confirmed false positives

### Audit trail — replay any AI decision and see what drifted

Gates optionally record the full reproducibility fingerprint for any stage: `model_version`, `temperature`, `seed`, `max_tokens`, `system_prompt_hash`, and `tools_hash`.

- `devteam reproduce <stage-id>` reads a gate, classifies replay readiness (full / partial / incomplete), prints recorded fields, and re-renders the current prompt to surface hash drift
- Designed to satisfy SOC 2 and EU AI Act audit requirements: the gate JSON is a complete record of how an AI decision was made

---

## Observability and learning

The pipeline records enough data to answer a question most teams can't answer today: which model is actually best for each role on your specific codebase? It surfaces the answer without you having to analyse it manually.

### Cost and token tracking — know what each stage costs

Gates record `tokens_in`, `tokens_out`, `cost_usd`, `model`, and `duration_ms` per stage and per workstream.

- `npm run dashboard:cost` (or `scripts/dashboard.js --view cost`) rolls up by host, role, or stage
- Pricing table covers Claude, GPT, and Gemini families with exact and prefix-match lookup
- Workstream-level detail preserved in `workstreams[]` so host/role attribution is correct

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

### Org-shared lessons-learned — knowledge that travels across projects

Lifts ADRs and lessons from any project into a shared store at `~/.stagecraft/memory/` (overridable via `STAGECRAFT_ORG_MEMORY_DIR`).

- `devteam memory promote` copies current-project records into the org store
- `devteam memory query --org` searches across all contributing projects; results name their source project
- Idempotent — re-promoting the same record doesn't duplicate it
- Foundation for architecture continuity (see Advanced AI capabilities)

---

## Developer tools

### Core commands — the everyday loop

**`devteam init`** — set up a project for the first time.

- Writes `.devteam/config.yml`, lays down role briefs, rules, skills, and the `/devteam` slash command for the chosen host
- `--host claude-code | codex | gemini-cli | generic`

**`devteam doctor`** — verify everything is wired up before you start.

- Checks the Stagecraft install, each declared host CLI is reachable, and roles/rules/skills are correctly laid down
- Prints a green/red checklist; fix what's red before running a stage

**`devteam next`** — find out what to do next.

- Reads the last gate in `pipeline/gates/`, interprets its status, and tells you what to run or what to fix
- The main command in the interactive loop

**Headless mode** — run a stage end-to-end without touching the chat.

- `devteam stage <name> --feature "..." --headless` spawns the host CLI, pipes the rendered prompt to its stdin, waits for the gate, and exits
- Combine with `devteam next` to chain stages in a script

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

**Codebase audit** — a full read-only analysis of any project.

- `devteam audit` (or `/audit` in Claude Code) runs four phases: Bootstrap → Health Assessment → Deep Analysis → Roadmap
- Produces 11 output files in `docs/audit/`; resume-aware via `docs/audit/status.json`
- `/audit-quick` runs phases 1–2 only for a faster assessment

---

## Integrations

Surface pipeline state in the tools your team already uses. The design choice here: validate and publish gates that were produced locally, rather than running the pipeline itself in CI — LLM pipelines are expensive and human-in-the-loop by design.

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

---

## Advanced AI capabilities

These stages go beyond what conventional dev pipelines can enforce. They're only possible because the pipeline is AI-native — the AI isn't just writing code, it's doing work that no static tool could do.

### Multi-model adversarial review — diversity as a correctness strategy

For `full` and `hotfix` tracks, peer-review dispatches to three different model families in parallel. Each is asked to find the strongest objection to the change. A synthesis pass resolves disagreements.

- Different training data means different blind spots — the diversity is the point
- Routed to different hosts than the build agents by design

### Closed-loop acceptance criteria → spec → tests — drift caught structurally

The PM writes numbered acceptance criteria (`AC-N`) in `pipeline/brief.md`. The chain is enforced end-to-end:

1. Stage-03b (executable-spec) translates each `AC-N` into one Gherkin scenario in `pipeline/spec.feature`, tagged `@AC-N`
2. Stage-06 (QA) maps each scenario 1:1 to a test
3. `devteam spec verify` checks all three are still in sync

Catches orphan ACs, orphan scenarios, duplicate AC numbers, and unknown AC refs in tests. `devteam spec generate` scaffolds the `.feature` file from the brief.

### Red-team stage — adversarial review before peer-review

A dedicated `red-team` role runs between build and peer-review on `full` and `hotfix` tracks. It is explicitly routed to a different host than the build agents.

- Walks 10 attack surfaces: input boundaries, state, sequence, integrations, auth edges, resource exhaustion, failure modes mid-operation, abuse cases, downstream effects, observability gaps
- Produces concrete reproducers, not observations; triage by severity × likelihood × scope
- `must_address_before_peer_review[]` in the gate blocks stage-05 until cleared

### Verification beyond tests — make "tests pass" a floor, not a ceiling

Full-track-only stage that runs after QA passes. The `verifier` role applies three methods to the changed code:

- **Property-based testing** (fast-check / hypothesis / proptest) — generates edge cases the author didn't think of; catches entire classes of bugs
- **Mutation testing** (Stryker / mutmut / mull) — introduces deliberate bugs and checks whether the test suite catches them
- **Formal verification** (TLA+ / Alloy / Lean) — optional, for functions where correctness is non-negotiable

A surviving mutant on a critical path, a property counterexample, or a formal counterexample populates `blocking_findings[]` and fails the stage. Skipped methods require a stated reason — "didn't have time" is not accepted.

### Architecture continuity — the architect always remembers

Prior architectural decisions become binding commitments across every future project in the org.

- `devteam architecture lookup "<topic>"` queries the org ADR store before a design stage
- The Principal role brief requires either honoring prior ADRs (cited in "Prior commitments considered") or explicitly superseding them with a new ADR carrying a `Supersedes:` field and rationale
- Silent disagreement with a prior ADR is forbidden by the role brief — it doesn't just fail a lint check, it's a role-level constraint
- Design gate records `adrs_consulted` and `adrs_superseded` for the audit trail

---

> All features above trace back to entries in [BACKLOG.md](./BACKLOG.md) where applicable.
