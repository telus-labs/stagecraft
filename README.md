# ai-dev-team

A model-agnostic AI dev team pipeline. A single source of truth for templates, schemas, role briefs, and orchestrator logic, plus per-host adapters that lay down host-native surfaces (subagents, slash commands, hooks, role prompts) into your project.

Today's hosts: **Claude Code**, **Codex CLI**, **Gemini CLI**, and a **generic** no-host adapter. One project, one config, one or more hosts. Stages can route to different hosts — the same pipeline can use Claude for design, Codex for backend, Gemini for QA, Claude for review.

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
# 1. Clone and install
git clone <this-repo> && cd ai-dev-team && npm install

# 2. (Optional) Make devteam available globally
npm link    # so `devteam` is on your PATH

# 3. Initialize in your target project
cd ~/projects/my-app
devteam init --host claude-code         # or: --host codex / --host claude-code,codex

# 4. Drive the pipeline
devteam stage requirements --feature "Add SMS notification opt-in"
# (do the PM work; gate gets written)
devteam next                            # → "▶️ run-stage design (stage-02)"
devteam stage design
# … continue until "🎉 pipeline-complete"
```

That's the whole loop. Single-role stages produce one prompt; multi-role stages produce one prompt per role; `devteam merge <stage>` aggregates per-workstream gates into the stage gate when ready.

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
  - guards: stoplist, budget, security-heuristic
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
ai-dev-team/
├── ARCHITECTURE.md             ← design model + locked decisions
├── README.md                   ← you are here
├── LICENSE                     ← MIT
├── package.json
├── bin/devteam                 ← CLI entrypoint
├── core/                       ← model-agnostic spine
│   ├── adapters/               ← host-adapter contract + shared helpers
│   ├── config.js               ← .devteam/config.yml loader + routing
│   ├── gates/                  ← validator + per-stage schemas
│   ├── guards/                 ← stoplist, budget, security-heuristic
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
