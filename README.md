# Stagecraft

> *Your Claude session went sideways again. Context reset. The agent forgot the architecture you spent ten minutes explaining. It edited the wrong file, then "fixed" the symptom instead of the cause. You're three hours in and you don't have a brief, a design, tests, or a deployable change — just a chat log.*

**Stagecraft is an orchestrator that runs your AI coding tool through a structured 13-stage pipeline.** PM writes the brief. Principal designs. Specialists build their areas. Reviewers critique. QA tests. Each stage produces an artifact and a machine-readable gate. The next stage can't start until the gate passes. You see the whole run on disk, auditable, resumable, not in a chat log.

Works across **Claude Code**, **Codex CLI**, **Gemini CLI**, and a **generic** no-host mode. One project, one config, one or more hosts. Different roles can run on different models — Claude for design, Codex for backend, Gemini for QA, Claude for review. The gate JSON is the seam.

```bash
devteam init --host claude-code        # one-time install in your project
devteam stage requirements --feature "Add SMS notification opt-in"
# (model writes brief + gate; hooks validate)
devteam next                           # → "▶️ run-stage design (stage-02)"
# … 11 more stages, then "🎉 pipeline-complete"
```

> The CLI binary is `devteam`. Stagecraft is the project; `devteam` is what you type.

## First 30 minutes

If you're evaluating Stagecraft, this is the cheapest path to "does it work for my team?":

1. **(5 min) Install the framework.** `git clone <this-repo> && cd stagecraft && npm install && npm link`. Verify with `devteam --help`.
2. **(2 min) Initialize a throwaway target project.** `mkdir /tmp/scratch && cd /tmp/scratch && devteam init --host claude-code`. Then `devteam doctor` should be all green.
3. **(3 min) Read [EXAMPLE.md](EXAMPLE.md).** One feature traced through all 17 stages with real CLI captures. Tells you what each stage actually does.
4. **(15 min) Run one full pipeline yourself.** `devteam stage requirements --feature "a one-paragraph feature you understand"`. Drop the prompt into Claude Code. Let the PM subagent write the brief. Run `devteam next`. Walk forward through design, build, peer-review, qa, sign-off. Skip deploy if you don't want to actually deploy anything (just write `{"status":"PASS",...}` into the gate by hand).
5. **(5 min) Inspect the audit trail.** `ls pipeline/gates/` — every stage's outcome on disk. `cat pipeline/brief.md`, `pipeline/design-spec.md`, `pipeline/code-review/by-*.md`. The pipeline is reconstructable from these files alone.

If after 30 minutes you can see how this would help your team, run a 2-week pilot ([adoption-guide.md](docs/adoption-guide.md) has the script). If you can't, drop it — it's not the right tool for every team.

## Documentation map

New here? Read in this order:

1. **[EXAMPLE.md](EXAMPLE.md)** — one full pipeline run traced end-to-end. The single best onboarding artifact.
2. **[docs/concepts.md](docs/concepts.md)** — six primitives (stage, role, workstream, host, gate, track) in one table.
3. **[docs/user-guide.md](docs/user-guide.md)** — daily-use reference: running stages, multi-host setups, headless mode, troubleshooting.
4. **[docs/adoption-guide.md](docs/adoption-guide.md)** — for team leads deciding whether to adopt. Covers pilot, objections, success criteria.
5. **[docs/presentation-notes.md](docs/presentation-notes.md)** — slide deck + speaker notes for pitching this to a team or stakeholder.
6. **[docs/tracks.md](docs/tracks.md)** — which of the six tracks to pick.
7. **[docs/faq.md](docs/faq.md)** — operational questions, common gotchas, comparisons to other tools.

Reference / extension:
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — 11 locked design decisions. Read when you want to know *why*.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — recipes for adding a host, role, stage, or skill.
- **[core/adapters/host-adapter.md](core/adapters/host-adapter.md)** — the host-adapter contract. ~150 lines; defines everything an adapter must implement.
- **[docs/walkthroughs/stage-04-split-host.md](docs/walkthroughs/stage-04-split-host.md)** — multi-workstream contract stress-test trace.

## Why "Stagecraft"?

The pipeline is a staged production. PM writes the brief. Principal directs the architecture. Specialist developers each build their part. Reviewers critique. QA tests. The curtain rises on deploy. Each stage has its cast, its script (the rules under `rules/`), and its gate that decides if the show moves on. Multi-host adversarial review is the panel of critics. The discipline of putting all of that together — staged work by specialized roles in a choreographed production — is **stagecraft**.

The vocabulary extends naturally: a *run* is one pipeline invocation, *dress rehearsal* is pre-review (Stage 4a), *curtain call* is the retrospective (Stage 9), and *notes* are peer-review comments. The metaphor isn't decoration — it's how the system thinks.

## What this gives you

A coordinated team of role-specific subagents running a structured software-development pipeline end-to-end:

- **10 stages** — requirements (PM) → design (Principal) → clarification → build (Backend|Frontend|Platform|QA) → pre-review (Platform) → security review (conditional, Security) → peer-review (Reviewer × 4 areas) → tests (QA) → sign-off (PM+Platform) → deploy (Platform, adapter-driven) → retrospective (Principal).
- **6 tracks** — `full`, `quick`, `nano`, `config-only`, `dep-update`, `hotfix`. Pick by change size.
- **Per-workstream gate JSON** — every stage writes a machine-readable gate to `pipeline/gates/`. Validator enforces shape; orchestrator merges multi-role stage gates.
- **Per-stage host routing** — `.devteam/config.yml` picks which host runs which role. Single-host install is the same code path as multi-host.
- **Conditional dispatch** — security review fires only when pre-review's heuristic flags it.
- **Hooks** (Claude Code) — auto-validate gates on `Stop`/`SubagentStop`; auto-derive Stage 5 approvals from per-area `REVIEW:` markers via PostToolUse.
- **Headless invocation** — `devteam stage <name> --headless` drives each workstream's host CLI (`claude --print`, `codex exec`) non-interactively.

## Prerequisites

- Node.js ≥ 18
- At least one of: **Claude Code** (`claude --version` works), **Codex CLI** (`codex --version` works), or just a terminal (generic adapter only)
- Git (recommended; the pipeline writes artifacts under `pipeline/`)

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

Then drive the pipeline. **There are two ways to run a stage.** Pick the one that matches what you want to see:

### Path A — `--headless` (single terminal, simpler — start here)

The orchestrator drives the host CLI for you (`claude --print`, `codex exec`, `gemini`). You type one command, watch model output stream to your terminal, then move on. Best for your first run, CI, and scripted use.

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

### Path B — Interactive in Claude Code (two windows, see the agent work)

Useful when you want to see what the subagent is doing, watch the file edits, intervene mid-stage. The slash command `/devteam` was installed by `devteam init`.

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

**Recommendation for first-timers:** Path A. One terminal, one command per stage, results on disk. You can switch to Path B later when you want to watch a specific stage.

For a complete walked-through example with the actual output you'll see at each step, read **[EXAMPLE.md](EXAMPLE.md)**.

## What `devteam init` installs

For `--host claude-code` in a target project:

| Path | Contents |
|---|---|
| `.devteam/config.yml` | Routing config — which host handles which role/stage |
| `.devteam/rules/*.md` | Pipeline, gate, escalation, retrospective rules (10 docs) |
| `.claude/agents/*.md` | Role subagents with Claude Code YAML frontmatter (8) |
| `.claude/skills/*/SKILL.md` | Task helpers — implement, review-rubric, security-checklist, etc. (6) |
| `.claude/commands/devteam.md` | Slash command wrapper |
| `.claude/settings.local.json` | Hooks: validator on `Stop`/`SubagentStop`; approval-derivation on `PostToolUse` |
| `pipeline/gates/` | Empty workspace dir for gate files |

For `--host codex`: similar but rendered into `.codex/prompts/roles/`, `.codex/skills/`, with no hooks or slash commands (codex doesn't have those primitives).

For multi-host (`--host claude-code,codex`): both surfaces installed side-by-side; the routing config decides who handles what at runtime.

## CLI reference

```
devteam init --host <name>[,<name>...] [--force]
devteam stage <name> [--feature "..."] [--headless]
devteam next [--json]
devteam merge <stage>
devteam validate
devteam stages
devteam hosts
```

See `bin/devteam help` for the up-to-date list.

## Auditing an existing codebase

Separate from the pipeline (which *builds* features) is the **audit feature**, which *analyzes* an existing codebase end-to-end and produces a prioritized improvement roadmap. Read-only by design — it writes findings, never source code.

Inside Claude Code (after `devteam init --host claude-code`):

```
/audit                  # full audit: Phases 0-3, ~30-60 min, 11 output files
/audit-quick            # Phases 0-1 only: ~5-15 min, 6 output files
/audit src/backend/     # scope to a subtree
/audit --resume         # continue from the last completed phase
```

On other hosts (Codex, Gemini CLI, generic), invoke the `auditor` role with the `audit` skill — there's no slash command but the skill is installed to `.codex/skills/audit/` or `.gemini/skills/audit/`.

Output lands under `docs/audit/` in your project: `00-project-context.md` through `10-roadmap.md`, plus a `status.json` for resume capability. The `implement` skill consumes `docs/audit/10-roadmap.md` to pick the next change to work on.

See [`skills/audit/SKILL.md`](skills/audit/SKILL.md) for the phase definitions.

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
│   ├── guards/                 ← stoplist, security-heuristic
│   ├── hooks/                  ← approval-derivation (Stage 5)
│   ├── orchestrator.js         ← runStage, mergeWorkstreamGates, next
│   ├── pipeline/stages.js      ← STAGES table + STAGES_BY_TRACK
│   └── router.js               ← per-(stage, role) host resolution
├── roles/                      ← single source of truth for role briefs (8)
├── rules/                      ← pipeline rules docs (10)
├── skills/                     ← task-oriented helpers (6)
├── templates/                  ← artifact templates (12)
├── hosts/                      ← per-host adapters
│   ├── claude-code/
│   ├── codex/
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

Pre-existing tools `claude-dev-team` and `codex-dev-team` did the same pipeline differently — same templates, same schemas, same ~80% of scripts, slowly drifting forks. This project unifies them into a single core with thin per-host adapters. The stress-test that locked the design is in [docs/walkthroughs/stage-04-split-host.md](docs/walkthroughs/stage-04-split-host.md) — one feature traced end-to-end through a mixed-host pipeline.

## License

[MIT](LICENSE). © 2026 Mumit Khan.
