# FAQ

Common questions about Stagecraft. Grows organically; PRs welcome.

## Setup & install

### Do I need Claude Code or Codex CLI installed to use this?

No, not strictly. The **generic** adapter (`hosts/generic/`) has zero in-host integration — it renders prompts to stdout and you consume them however you like (paste into any LLM, copy to a wiki, hand to a human). What you give up: no slash commands, no hooks, no headless invocation. Most people will want at least one real host installed.

### Where does the framework live vs the target project?

Two distinct places:

- **The framework** (this repo, `stagecraft/`) is installed once, anywhere. Contains the orchestrator, schemas, role briefs, host adapters.
- **The target project** is your application repo. `devteam init` lays down `.devteam/config.yml`, host-specific install payloads (`.claude/agents/...`), and `pipeline/gates/`.

You can drive many target projects from one framework install. Updating the framework (`git pull`) updates every target on its next `devteam init --force`.

### Can I run this without Node?

No. The CLI, orchestrator, validator, and hooks are all Node. The host CLIs (`claude`, `codex`) can be whatever they're written in; the framework just calls them.

## Using the pipeline

### What if I want to skip a stage?

If a stage isn't appropriate for your change, pick a track that doesn't include it. See [`docs/tracks.md`](tracks.md) — `nano` skips most stages, `quick` skips design + clarification + pre-review, etc.

If you want to skip a stage that *is* in your active track, just don't run it — the orchestrator won't auto-advance unless the gate exists. But `devteam next` will keep pointing at the skipped stage. If you want to mark it as deliberately bypassed, write a gate by hand with `status: "PASS"` and an explanation in `blockers: []` / `warnings: []` (or set up a custom track in `STAGES_BY_TRACK`).

### Do I have to use all 11 stages?

No. The track system exists precisely to let you opt out of stages per change. The full track has all 11; nano has 2 (build + qa). Pick whatever matches the change's risk profile.

### Can I author the gate JSON by hand instead of via the LLM?

Yes. The orchestrator doesn't care how the gate file got written — it only validates the JSON and advances based on `status`. For trivial stages or when an agent fails, hand-writing the gate is fine. See `rules/gates.md` for the required-fields shape.

### What if my LLM doesn't write the gate?

`devteam next` will keep reporting `run-stage` (or `continue-stage` for partial multi-role). Either re-invoke the agent with a clearer instruction, or hand-write the gate (see above). The orchestrator only knows what's on disk.

### How do hooks know which gate to validate?

Claude Code hooks fire on Stop / SubagentStop / PostToolUse events. The Stop hook runs `core/gates/validator.js`, which scans `pipeline/gates/` for the most-recently-modified gate and validates that one. If you wrote multiple gates in one session, the validator looks at the latest.

### Why is `devteam next` saying "continue-stage" with one role pending, but I already wrote that role's gate?

Check the filename. Multi-role workstream gates use a dot separator: `pipeline/gates/stage-04.backend.json` (not `stage-04-backend.json` or `stage-04/backend.json`). And ensure `.json` extension.

## Multi-host routing

### Can I use two hosts in the same pipeline run?

Yes — that's a first-class feature. Install both adapters (`devteam init --host claude-code,codex`) and edit `.devteam/config.yml`:

```yaml
routing:
  default_host: claude-code
  roles:
    backend: codex
```

`devteam stage build` will produce 4 prompts; backend's points at Codex's role prompt path, the rest point at Claude Code subagents. Each writes its own workstream gate; the orchestrator merges across the seam.

### Which adapter handles the merge?

The orchestrator. The merge is host-agnostic — it just reads JSON files. The `host` field on each workstream gate is preserved in the merged `workstreams[]` array so the merged gate tells you which workstream came from which host.

### Can I add Cursor / Aider / Cline / Windsurf as a host?

Yes. Gemini CLI is already shipped (`hosts/gemini-cli/`). For others, implement `hosts/<your-host>/adapter.js` per the contract in `core/adapters/host-adapter.md` — see [`CONTRIBUTING.md`](../CONTRIBUTING.md) recipe 1. Adding a host is intentionally a small, self-contained task. The codex/gemini-cli adapters are the closest templates for IDE-embedded tools.

### Does the routing config support different model versions of the same host?

Not directly. The routing key is the host name (`claude-code`, `codex`). To use different models per role within the same host, configure that in the host itself (e.g., Claude Code's `.claude/agents/<name>.md` has a `model:` field; Codex prompts can be wrapped with model selection). The framework's routing layer routes to *hosts*, not *models within a host* — see [`docs/BACKLOG.md`](BACKLOG.md) G2 / D5 for the planned "adaptive routing" work.

## Comparing to other tools

### How does this compare to LangGraph / AutoGen / CrewAI?

Different problem space. Those are agent-framework libraries — you write Python (mostly) and they coordinate LLM calls. Stagecraft is a *pipeline scaffold* for AI coding tools (Claude Code, Codex, Gemini CLI): it installs role prompts and orchestrates which one runs when, but the actual model invocation happens inside the coding tool, not via a framework SDK. If your team already lives in Claude Code or Codex, Stagecraft meets you there; if you're building a custom agent app, those frameworks are the right tools.

### How does this compare to Aider's `/architect` mode or Cursor's composer?

Those are single-session multi-agent modes within one tool. Stagecraft is a structured *pipeline* with persistent gates, conditional dispatch, multi-host routing, and a stop/resume model that survives across sessions. The trade-off: more setup, more discipline, more durable for non-trivial features. Use Aider's architect mode for quick interactive sessions; use Stagecraft when you want auditability and stage gates.

### How is this different from claude-dev-team or codex-dev-team?

Stagecraft unifies them into one core. See [ADR 001](adr/001-unification-vs-fork.md) for the full reasoning. Key differences:

- One framework, three host adapters (claude-code, codex, generic). No more parity drift between forks.
- Per-workstream routing: a single pipeline can dispatch different roles to different hosts.
- Contract F: gate identity uses `orchestrator` + `host` + `workstream`. The legacy `agent` field is gone.
- WARN status for non-blocking warnings.
- Conditional stages (security review fires only when pre-review flags it).
- Per-role `allowedWrites` filtering in multi-role stages.
- 201 automated tests vs the forks' 20-26.

## Customization

### Can I add a project-specific role / stage / skill?

Yes. See [`CONTRIBUTING.md`](../CONTRIBUTING.md) for the recipes. The cleanest approach is to fork Stagecraft and add your custom roles in your fork's `roles/` — that way your changes survive framework updates.

### Can I disable the stoplist?

You can bypass per-invocation with `--force`. To disable globally, you'd need to edit `STOPLIST_GUARDED_TRACKS` in `bin/devteam` or remove the patterns from `core/guards/stoplist.js`. The BACKLOG flags "configurable stoplist via `.devteam/config.yml`" as a follow-up.

### Can I use a different deploy adapter (e.g. AWS CDK, Pulumi)?

Yes. Add `core/deploy/<your-adapter>.md` with the procedure, then reference it in `.devteam/config.yml`:

```yaml
deploy:
  adapter: my-adapter
```

The Platform role at Stage 8 reads the config and follows your adapter's procedure.

## Operational

### What happens if a Stage 4b security veto fires?

The pipeline halts at Stage 4b — `devteam next` reports `resolve-escalation`. A veto cannot be overridden by peer-review approvals. The Security role must personally re-review the fix and flip `veto: false` in the gate before the pipeline can advance.

### What if Stage 5 reviewers can't agree?

After two review rounds with persistent CHANGES_REQUESTED, the gate's `escalated_to_principal` should flip to `true` (this is part of the approval-derivation hook's logic). The Principal then makes a binding ruling and either flips the gate to PASS or the team negotiates the change.

### How do I roll back a deploy?

The role's role brief explicitly says **don't auto-rollback** — the runbook (`pipeline/runbook.md`) names the rollback procedure and a human decides whether to roll back or investigate. The deploy gate records `rollback_executed: false` by default; PASS requires this to be false.

### Where do I see the cumulative cost of a pipeline run?

The budget guard (`core/guards/budget.js`) is lifted from the predecessors but not yet wired into the CLI. Tracked in the BACKLOG as a follow-up. For now, costs need to be tracked at the host level (Anthropic/OpenAI dashboards).

## Roadmap

### What's planned next?

See [`docs/BACKLOG.md`](BACKLOG.md). Top items by impact/effort:

1. OpenTelemetry per-stage tracing (debuggability win).
2. Secret-scanning hook on Write/Edit.
3. Gemini CLI host adapter (third real host).
4. Accessibility audit stage.
5. Persistent project memory (embeddings-indexed).
6. Multi-model adversarial peer review.

### When will this hit 1.0?

When the tier-2 items from [`docs/GAP-ANALYSIS.md`](GAP-ANALYSIS.md) are all in (some still pending: budget wiring, more tier-2 tests like dogfood, examples). The framework itself is feature-complete for the original two forks' surface — 1.0 is mostly about hardening + the things you need to operate the framework rather than just use it.
