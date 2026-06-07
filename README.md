# Stagecraft

**Stagecraft is an orchestrator that runs your AI coding tool through a structured 17-stage pipeline.** PM writes the brief. Principal designs. Specialists build their areas. Reviewers critique. QA tests. Each stage produces an artifact and a machine-readable gate. The next stage cannot start until the gate passes. The full run is on disk: auditable, resumable, not buried in a chat log.

Works across **Claude Code**, **Codex CLI**, **Gemini CLI**, and a **generic** no-host mode. One project, one config, one or more hosts. Different roles can run on different models — Claude for design, Codex for backend, Gemini for QA, Claude for review. The gate JSON is the seam.

```bash
devteam init --host claude-code        # one-time install in your project
devteam stage requirements --feature "Add SMS notification opt-in"
# (model writes brief + gate; hooks validate)
devteam next                           # → "▶️ run-stage design (stage-02)"
# … 15 more stages, then "🎉 pipeline-complete"
```

> The CLI binary is `devteam`. Stagecraft is the project; `devteam` is what you type.

## Table of contents

- [First 30 minutes](#first-30-minutes)
- [Documentation map](#documentation-map)
- [Why "Stagecraft"?](#why-stagecraft)
- [What this gives you](#what-this-gives-you)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [What `devteam init` installs](#what-devteam-init-installs)
- [CLI reference](#cli-reference)
- [Auditing an existing codebase](#auditing-an-existing-codebase)
- [Architecture in one diagram](#architecture-in-one-diagram)
- [Repository layout](#repository-layout)
- [Design decisions](#design-decisions)
- [What's deferred](#whats-deferred)
- [Why this exists](#why-this-exists)
- [License](#license)

## First 30 minutes

If you're evaluating Stagecraft, this is the fastest path to a working answer:

1. **(5 min) Install the framework.** `git clone <this-repo> && cd stagecraft && npm install && npm link`. Verify with `devteam --help`.
2. **(2 min) Initialize a throwaway target project.** `mkdir /tmp/scratch && cd /tmp/scratch && devteam init --host claude-code`. Then `devteam doctor` should be all green.
3. **(3 min) Read [EXAMPLE.md](EXAMPLE.md).** One feature traced through all 17 stages with real CLI captures. Tells you what each stage actually does.
4. **(15 min) Run one full pipeline yourself.** The simplest path: run each stage with `--headless` and let the orchestrator drive Claude Code directly.
   ```bash
   devteam stage requirements --feature "a one-paragraph feature you understand" --headless
   devteam next   # tells you the next command to run
   ```
   Walk forward through design, build, peer-review, qa, sign-off. For deploy, write the gate by hand if you don't want to actually deploy: `echo '{"stage":"stage-08","status":"PASS","track":"full","timestamp":"'$(date -u +%FT%TZ)'","blockers":[],"warnings":[]}' > pipeline/gates/stage-08.json`.
5. **(5 min) Inspect the audit trail.** `ls pipeline/gates/` — every stage's outcome on disk. `cat pipeline/brief.md`, `pipeline/design-spec.md`, `pipeline/code-review/by-*.md`. The pipeline is reconstructable from these files alone.

If after 30 minutes you can see how this would help your team, run a 2-week pilot ([adoption-guide.md](docs/adoption-guide.md) has the script). If you can't, it may not be the right tool for your team.

## Documentation map

New here? Read in this order:

1. **[EXAMPLE.md](EXAMPLE.md)** — one full pipeline run traced end-to-end. The single best onboarding artifact.
2. **[docs/concepts.md](docs/concepts.md)** — six primitives (stage, role, workstream, host, gate, track) in one table.
3. **[docs/methodology.md](docs/methodology.md)** — the development methodology Stagecraft enforces: ATDD loop, phase-gate progression, the adversarial red-team layer, multi-role peer review, and the four coding principles.
4. **[docs/user-guide.md](docs/user-guide.md)** — daily-use reference: running stages, multi-host setups, headless mode, troubleshooting.
5. **[docs/adoption-guide.md](docs/adoption-guide.md)** — for team leads deciding whether to adopt. Covers pilot, objections, success criteria.
6. **[docs/presentation-notes.md](docs/presentation-notes.md)** — slide deck + speaker notes for pitching this to a team or stakeholder.
7. **[docs/tracks.md](docs/tracks.md)** — which of the six tracks to pick.
8. **[docs/faq.md](docs/faq.md)** — operational questions, common gotchas, comparisons to other tools.

Reference / extension:
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — 11 locked design decisions. Read when you want to know *why*.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — recipes for adding a host, role, stage, or skill.
- **[core/adapters/host-adapter.md](core/adapters/host-adapter.md)** — the host-adapter contract. ~150 lines; defines everything an adapter must implement.
- **[docs/walkthroughs/stage-04-split-host.md](docs/walkthroughs/stage-04-split-host.md)** — multi-workstream contract stress-test trace.
- **[docs/walkthroughs/soc2-evidence-collector.md](docs/walkthroughs/soc2-evidence-collector.md)** — end-to-end showcase: building a SOC 2 evidence collector through the full 17-stage pipeline.
- **[docs/runbooks/escalation.md](docs/runbooks/escalation.md)** — procedural playbook: what to read, how to decide, and how to encode the result when `devteam next` says `resolve-escalation`.
- **[docs/runbooks/fix-and-retry.md](docs/runbooks/fix-and-retry.md)** — procedural playbook for `fix-and-retry` halts: red-team FAIL, QA-within-build FAIL, pre-review FAIL, peer-review CHANGES_REQUESTED. Covers the `--patch --from <stage>` flow with a worked example.
- **[docs/runbooks/open-followups.md](docs/runbooks/open-followups.md)** — how to extract ticket-ready stubs from `open_followups[]` in the stage-07 and stage-09 gates after a pipeline run completes. Includes field mapping to JIRA, Linear, and GitHub Issues.
- **[docs/runbooks/deploy-failure.md](docs/runbooks/deploy-failure.md)** — Stage 8 failure playbook: classify the failure shape, adapter-specific diagnostics, rollback procedure, and retry sequences for code vs. infrastructure fixes.
- **[docs/conventions.md](docs/conventions.md)** — operator-facing catalogue of pipeline markers (`QUESTION:`/`PM-ANSWER:`, `BLOCKER:`/`SUGGESTION:`/`PATTERN:`, `## Brief Changes`, `## Verify`, magic comments, …) — where each lives, who writes it, what reads it.
- **[docs/comparative-analysis.md](docs/comparative-analysis.md)** — Stagecraft vs adjacent AI-dev frameworks (BMAD-METHOD, GitHub Spec Kit, Agent OS, OpenSpec, AWS Kiro, AI-DLC). Four-school taxonomy, comparison matrix, three defensible claims, three cases where Stagecraft *isn't* the best fit, evolution opportunities with effort estimates.

Feature deep-dives:
- **[docs/FEATURES.md](docs/FEATURES.md)** — every shipped feature, organized by area. Start here to see what Stagecraft does.
- **[docs/cost.md](docs/cost.md)** — cost tracking, the pricing table, and the budget workflow.
- **[docs/memory.md](docs/memory.md)** — persistent project memory: embedder options, `.gitignore` note, org-shared store.
- **[docs/observability.md](docs/observability.md)** — OpenTelemetry span schema and collector setup.
- **[docs/reproducibility.md](docs/reproducibility.md)** — audit trail: gate fingerprint fields, replay readiness, drift detection.
- **[docs/ci.md](docs/ci.md)** — GitHub Actions workflow: template, environment variables, PR check runs.
- **[docs/git-workflow.md](docs/git-workflow.md)** — end-to-end git practice for a Stagecraft pipeline run: branch setup, what to commit and when, Stage 4 worktrees, when to open the PR, and how the final branch history should look.
- **[docs/migration-safety.md](docs/migration-safety.md)** — veto criteria, gate fields, and what triggers the migration heuristic.
- **[docs/red-team.md](docs/red-team.md)** — 10 attack surfaces, gate fields, routing, and how it differs from security review.
- **[docs/spec-authoring.md](docs/spec-authoring.md)** — writing AC-N criteria, scaffolding the spec file, drift detection.
- **[docs/verification-beyond-tests.md](docs/verification-beyond-tests.md)** — property-based, mutation, and formal verification: candidates, gate fields, skip policy.

## Why "Stagecraft"?

The pipeline is a staged production. PM writes the brief. Principal directs the architecture. Specialist developers each build their part. Reviewers critique. QA tests. Deploy is the curtain. Each stage has its cast, its script (the rules under `rules/`), and its gate that decides whether the show moves on. Multi-model peer review is the panel of critics; the red-team is the adversary in the wings. The discipline of coordinating specialized roles in a sequenced production is **stagecraft**.

The vocabulary extends naturally: a *run* is one pipeline invocation, *dress rehearsal* is pre-review (Stage 4a), *curtain call* is the retrospective (Stage 9), and *notes* are peer-review comments. The metaphor is structural, not decorative.

## What this gives you

A coordinated team of role-specific subagents running a structured software-development pipeline end-to-end:

- **17 stages** — requirements (PM) → design (Principal) → clarification → executable-spec (PM, Gherkin) → build (Backend|Frontend|Platform|QA) → pre-review (Platform) → security review (conditional) → red-team (always-on full+hotfix) → migration-safety (conditional, veto) → peer-review (Reviewer × 4) → qa → accessibility → observability → verification-beyond-tests (full only) → sign-off (PM+Platform) → deploy → retrospective.
- **6 tracks** — `full`, `quick`, `nano`, `config-only`, `dep-update`, `hotfix`. Pick by change size.
- **Per-workstream gate JSON** — every stage writes a machine-readable gate to `pipeline/gates/`. Validator enforces shape; orchestrator merges multi-role stage gates.
- **Per-stage host routing** — `.devteam/config.yml` picks which host runs which role. Single-host install is the same code path as multi-host.
- **Conditional dispatch** — security review fires only when pre-review's heuristic flags it. Migration-safety fires on data-layer diffs.
- **Veto stages** — security and migration-safety can halt the pipeline regardless of peer-review approval.
- **Hooks** (Claude Code) — auto-validate gates on `Stop`/`SubagentStop`; auto-derive Stage 5 approvals from per-area `REVIEW:` markers via PostToolUse.
- **Headless invocation** — `devteam stage <name> --headless` drives each workstream's host CLI (`claude --print`, `codex exec`) non-interactively.
- **Reproducibility + replay** — every gate can record `model_version`, `temperature`, `seed`, `system_prompt_hash`, `tools_hash`. `devteam replay <stage>` re-runs and diffs.
- **Routing learns from data** — `npm run routing:suggest` reads cost + first-try pass rates per (role, host) and proposes config swaps.

## Prerequisites

- Node.js ≥ 18
- At least one of: **Claude Code** (`claude --version` works), **Codex CLI** (`codex --version` works), **Gemini CLI** (`gemini --version` works), or just a terminal (generic adapter — prompts rendered for manual use, no automation)
- Git (recommended for version-controlling artifacts; the pipeline itself does not require it)

## Quick start

```bash
# 1. Get the framework (one time, anywhere)
git clone <this-repo> && cd stagecraft && npm install && npm link

# 2. In your target project — install the host adapter surface
cd ~/projects/my-app
devteam init --host claude-code         # or: codex / gemini-cli / claude-code,codex

# 3. Verify
devteam doctor                           # should be all green
```

Then drive the pipeline. There are two ways to run a stage:

### Path A — `--headless` (single terminal, start here)

The orchestrator drives the host CLI for you (`claude --print`, `codex exec`, `gemini`). One command per stage; model output streams to your terminal. Best for first runs, CI, and scripted use.

```bash
devteam stage requirements --feature "Add SMS notification opt-in" --headless
# [devteam] dispatching pm → claude-code (headless)
# (model output streams to your terminal as it works)
#   ✓ pm (claude-code): exit 0, 23000ms → pipeline/gates/stage-01.json

cat pipeline/brief.md                    # the artifact the model wrote
cat pipeline/gates/stage-01.json          # the gate JSON

devteam next                              # → "▶️ run-stage design (stage-02)"
devteam stage design --headless           # next stage
# … keep going until "🎉 pipeline-complete"
```

One terminal. One command per stage. The gate file appears when the model is done. `devteam next` tells you the next command.

### Path B — Interactive in Claude Code (two windows)

Use this when you want to watch the subagent work, observe file edits, or intervene mid-stage. The slash command `/devteam` is installed by `devteam init`.

```bash
# Terminal 1 (your project dir):
devteam stage requirements --feature "Add SMS notification opt-in"
#   → prints a prompt with an onboarding preamble explaining what to do with it
```

In **Terminal 2** (or a separate window), inside Claude Code at the same project root:

```
/devteam stage requirements --feature "Add SMS notification opt-in"
```

Claude Code recognizes the slash command, dispatches the `pm` subagent. You see Claude write `pipeline/brief.md`, then write `pipeline/gates/stage-01.json`. The `Stop` hook fires and validates:

```
[gate-validator] ✅ GATE PASS — stage-01/pm (claude-code)
```

Back in Terminal 1:

```bash
devteam next                              # → "▶️ run-stage design (stage-02)"
```

Repeat for each stage.

### Which path should I pick?

| | Path A: `--headless` | Path B: interactive in Claude Code |
|---|---|---|
| Terminal windows | 1 | 2 (terminal + Claude Code) |
| You see the agent's work | streamed text in your terminal | full Claude Code UI |
| Best for | first runs, CI, scripted use, multi-host fanout | watching agents work, mid-stage intervention, debugging a stage |
| Auth | `claude --version` must work | Claude Code app/CLI logged in |
| Speed | usually faster (no UI overhead) | usually slower (UI overhead, human pauses) |

**Recommendation for first-timers:** Path A. One terminal, one command per stage, results on disk. Switch to Path B when you want to observe a specific stage in detail.

For a complete walked-through example with the actual output you'll see at each step, read **[EXAMPLE.md](EXAMPLE.md)**.

## What `devteam init` installs

For `--host claude-code` in a target project:

| Path | Contents |
|---|---|
| `.devteam/config.yml` | Routing config — which host handles which role/stage |
| `.devteam/rules/*.md` | Pipeline, gate, escalation, retrospective rules (10 top-level docs + per-stage `stage-NN.md` files) |
| `.claude/agents/*.md` | Role subagents with Claude Code YAML frontmatter (12) |
| `.claude/skills/*/SKILL.md` | Task helpers — implement, review-rubric, security-checklist, etc. (13) |
| `.claude/commands/devteam.md` | Slash command wrapper |
| `.claude/settings.local.json` | Hooks: validator on `Stop`/`SubagentStop`; approval-derivation on `PostToolUse`; secret-scan on `PreToolUse` |
| `pipeline/gates/` | Empty workspace dir for gate files |

For `--host codex`: similar but rendered into `.codex/prompts/roles/`, `.codex/skills/`, with no hooks or slash commands (codex doesn't have those primitives).

For multi-host (`--host claude-code,codex`): both surfaces installed side-by-side; the routing config decides who handles what at runtime.

## CLI reference

| Command | What it does |
|---|---|
| `devteam init --host <name>[,<name>...]` | Install host adapter(s) into the current project; write `.devteam/config.yml` |
| `devteam stage <name> [--feature "..."] [--headless]` | Render (and optionally execute) a stage prompt; `--headless` drives the host CLI automatically |
| `devteam next [--json]` | Report the next action the pipeline needs (run-stage, merge, fix-and-retry, resolve-escalation, pipeline-complete) |
| `devteam restart <stage> [--cascade] [--keep-context] [--dry-run]` | Clear a stage's gate(s) so the pipeline can re-run it. With `--cascade`, also clears every stage that comes after. Use after FAIL/ESCALATE. See [docs/runbooks/escalation.md](docs/runbooks/escalation.md). |
| `devteam ruling --topic "..." [--context <paths>] [--target-gate <gate>] [--headless]` | Dispatch the Principal subagent for an ad-hoc ruling outside the normal stage flow. Writes a `PRINCIPAL-RULING:` line to `pipeline/context.md`; no gate is touched. |
| `devteam merge <stage>` | Aggregate per-workstream gate files into a single merged stage gate (required after multi-role stages) |
| `devteam derive-approvals [<file>] [--cwd <dir>] [--json]` | Re-run the `approval-derivation` hook on `pipeline/code-review/by-*.md` and update the per-area `stage-05.<area>.json` gates. Use after hand-editing a review file outside an active Claude Code session — the hook only fires on agent saves; shell/editor saves bypass it. Follow with `devteam merge peer-review` to rebuild the merged gate. See [docs/runbooks/fix-and-retry.md § Case 5](docs/runbooks/fix-and-retry.md#case-5-peer-review-stage-5-fail-with-no-objections--quorum-miss). |
| `devteam validate` | Run the gate validator manually against the current gate directory |
| `devteam verify <stage-id> [--json]` | Orchestrator-stamped verification. For stage-04a (lint+tests) and stage-06 (tests + AC mapping), runs the configured commands and stamps the gate with what was actually observed. Flips status to FAIL if the orchestrator's truth disagrees with the model's claim. |
| `devteam summary` | One-screen view of all stages: pass/warn/fail/escalate/pending per stage and workstream |
| `devteam log [--follow] [--json]` | Chronological event timeline: every gate + every artifact write, mtime-sorted, with per-stage key fields. `--follow` polls at 1s for live tailing. Works in headless and user-driven modes. |
| `devteam stages` | List all stages and their stage IDs |
| `devteam hosts` | List available host adapters |
| `devteam doctor` | Check that the install is healthy: hooks wired, agent files present, host CLIs on PATH |
| `devteam reproduce <stage-id> [--json]` | Read a past gate and report replay readiness — which reproducibility fields are recorded, what's missing, whether the current prompt's hash matches what the gate captured. |
| `devteam replay <stage-id> [--dry-run] [--json]` | Re-run a recorded stage against the current config; diff the result across status, blockers, cost, tokens, duration, reproducibility fields. New gate goes to `pipeline/gates/replay/`. |
| `devteam ci install [--ci github-actions] [--out <dir>] [--force]` | Drop a CI workflow template into the target project's `.github/workflows/`. The workflow validates gates and posts each as a GitHub check run on PRs. Does NOT run the LLM pipeline in CI by design. |
| `devteam memory <ingest\|query\|stats\|promote\|clear> [--org]` | Persistent project memory: ingest briefs/ADRs/lessons; query by similarity. `--org` targets the cross-project shared store at `~/.stagecraft/memory/`. |
| `devteam architecture lookup "<topic>"` | Friendlier wrapper around `memory query --org --kind adr`. Surfaces prior ADRs at design time so architecture decisions don't silently re-litigate. |
| `devteam ui` | Open the web dashboard (live gate view, cost, performance charts) |
| `devteam spec generate` | Scaffold `pipeline/spec.feature` from AC-N criteria in `pipeline/brief.md` |
| `devteam spec verify` | Check `pipeline/spec.feature` for drift against the brief |
| `devteam consistency analyze [--strict] [--json]` | Cross-artifact drift check across the full pipeline chain — brief → spec → `pr-*.md ## Verify` → red-team `must_address` → test-report → gate field reality. Generalizes `devteam spec verify` to every intermediate artifact + the gate-vs-reality dimension. Exits non-zero on any drift. |
| `devteam assess [--description "..."] [--json] [--apply] [files...]` | G6 — rule-based track recommendation for a proposed change. Analyzes description keywords and file/content heuristics (security patterns, migration files, config-only paths) and returns the recommended track with rationale. `--apply` writes `pipeline.custom_stages` to `.devteam/config.yml` so `devteam next` uses the custom track automatically. Useful before starting a run to confirm you picked the right track. |
| `devteam standards discover [--cwd <dir>] [--json] [--dry-run] [--force]` | B10 — scan the current project and produce `docs/project-conventions.md` with detected tech stack, module system, file layout, naming conventions, tooling, test configuration, and most-used import sources. `--dry-run` prints without writing; `--json` emits the structured discovery result. Add the output file to your AGENTS.md or readFirst lists to inject discovered conventions into agent prompts. |

See `devteam help` for the up-to-date list with flags.

## Auditing an existing codebase

The pipeline builds features. The **audit** workflow analyzes an existing codebase and produces a prioritized improvement roadmap under `docs/audit/00–10`, plus a `status.json` for resume. It is read-only by design: it writes findings, never source code. The `implement` skill consumes `docs/audit/10-roadmap.md` to pick the next change.

Inside Claude Code:

```
/audit              # full audit: Phases 0-3, ~30-60 min, 11 output files
/audit-quick        # Phases 0-1 only: ~5-15 min, 6 output files
```

The slash commands are claude-code-only; on other hosts the `auditor` role and `audit` skill ship with every `devteam init` and you dispatch them as a normal role-plus-skill prompt.

For auditing a feature *built with* Stagecraft (where the pipeline left a rich on-disk trail), the audit splits into **four modes** — code / process / consistency / threat — each answering a different question with a different tool. See [`docs/user-guide.md` § Auditing a feature built with Stagecraft](docs/user-guide.md#auditing-a-feature-built-with-stagecraft--the-four-modes).

Full operational guidance: [`docs/user-guide.md` § Auditing a codebase](docs/user-guide.md#auditing-a-codebase). Phase definitions: [`skills/audit/SKILL.md`](skills/audit/SKILL.md).

## Architecture in one diagram

```
User in any AI tool (Claude Code, Codex, terminal)
         │
         │  /devteam slash command, or `devteam` CLI
         ▼
Host adapter (hosts/<host>/adapter.js)
  - declares capabilities (hooks, subagents, …)
  - renders stage prompt for this host
  - installs surface into the target project
         │
         ▼
Core (model-agnostic spine, never invokes a model)
  - stage definitions + tracks       (core/pipeline/stages.js)
  - gate schemas + validator         (core/gates/)
  - guards: stoplist, security-heuristic
  - routing + orchestrator           (core/router.js, core/orchestrator.js)
         │
         ▼
Stage prompt rendered for the LLM
         │
         │  consumed by the model inside the host
         ▼
Model produces:
  - the artifact (brief, design-spec, code, test report, …)
  - a gate JSON conforming to core/gates/schemas/stage-NN.schema.json
         │
         ▼
Core validates, advances, escalates, or halts.
```

Full design notes: [ARCHITECTURE.md](ARCHITECTURE.md). Host-adapter contract: [core/adapters/host-adapter.md](core/adapters/host-adapter.md).

## Repository layout

```
stagecraft/
├── ARCHITECTURE.md             ← design model + locked decisions
├── README.md                   ← you are here
├── LICENSE                     ← MIT
├── package.json
├── bin/devteam                 ← CLI entrypoint
├── core/                       ← model-agnostic spine
│   ├── adapters/               ← host-adapter contract + shared helpers
│   ├── config.js               ← .devteam/config.yml loader + routing
│   ├── gates/                  ← validator + per-stage schemas
│   ├── guards/                 ← stoplist, security/migration heuristics
│   ├── hooks/                  ← approval-derivation, secret-scan
│   ├── memory/                 ← persistent project memory (embed/store/index)
│   ├── spec/                   ← Gherkin generator + drift verifier
│   ├── ui/                     ← dashboard web server
│   ├── orchestrator.js         ← runStage, mergeWorkstreamGates, next
│   ├── pipeline/stages.js      ← STAGES table + STAGES_BY_TRACK
│   └── router.js               ← per-(stage, role) host resolution
├── roles/                      ← single source of truth for role briefs (12)
├── rules/                      ← pipeline rules docs (10 top-level + 9 per-stage)
├── skills/                     ← task-oriented helpers (13)
├── templates/                  ← artifact templates (15)
├── hosts/                      ← per-host adapters
│   ├── claude-code/
│   ├── codex/
│   ├── gemini-cli/
│   └── generic/
└── docs/                       ← guides, walkthroughs, BACKLOG
```

## Design decisions

11 locked decisions are documented in [ARCHITECTURE.md](ARCHITECTURE.md). The big ones:

1. **The core never spawns a model.** It emits prompts and validates JSON.
2. **Gate JSON is the stable seam.** Identity fields: `stage`, `workstream`, `orchestrator`, `host`, `status`. Anything host-specific stays in the adapter.
3. **Role briefs have one source.** `roles/*.md`. Adapters render into host-expected paths at install time.
4. **Per-workstream host selection.** A single pipeline can route different roles to different hosts; the orchestrator merges across them via the gate seam.
5. **Multi-host install is the default code path.** Single-host is just a list of length 1.
6. **Capability negotiation.** Each adapter declares hooks, subagents, slashCommands, worktrees, headless, and where it enforces each core rule.

## What's deferred

- Programmatic `invoke()` testing requires `claude` / `codex` on PATH (the contract works with stubs).
- See [docs/BACKLOG.md](docs/BACKLOG.md) for the prioritized list of next ideas — bucketed by reach, depth, quality, observability, DX, integrations, and innovation bets.

## Why this exists

`claude-dev-team` and `codex-dev-team` ran the same pipeline with the same templates, schemas, and ~80% of scripts, but as separate forks that were slowly diverging. This project unifies them into a single core with thin per-host adapters. The stress-test that locked the design is in [docs/walkthroughs/stage-04-split-host.md](docs/walkthroughs/stage-04-split-host.md): one feature traced end-to-end through a mixed-host pipeline.

## License

[MIT](LICENSE). © 2026 Mumit Khan.
