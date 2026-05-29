# FAQ

Common questions about Stagecraft. Grouped by topic. Grows organically; PRs welcome.

If you can't find what you need: skim [`docs/user-guide.md`](user-guide.md)'s "When things go wrong" section, [`docs/concepts.md`](concepts.md) for vocabulary, or open an issue.

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

### Do I have to use all 17 stages?

No. The track system exists precisely to let you opt out of stages per change. The full track has all 17; nano has 2 (build + qa). Pick whatever matches the change's risk profile.

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

Two complementary surfaces:

- `npm run dashboard:cost` rolls up `tokens_in / tokens_out / cost_usd / duration_ms` from every gate in `pipeline/gates/`. Group by host / role / stage.
- `npm run budget` against a per-project budget config alerts when a run exceeds a configured ceiling.

Both read fields that gates already record (the C4 reproducibility set). Host-level dashboards (Anthropic / OpenAI billing) remain the source of truth for actual invoiced cost.

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

1.0 is reserved for a substantial future release — when the public surface (gate JSON shape, host adapter contract, CLI subcommands, `.devteam/config.yml` schema) is stable enough that we're willing to commit to semver. We're currently in 0.x specifically because we may break those surfaces before 1.0. The pace of breaking changes has slowed considerably; expect 1.0 within a few months if nothing major surfaces.

## Stuck pipelines and recovery

### A workstream is stuck — the LLM stopped responding or got confused

Two recovery options:

- **Re-invoke the subagent** with a clearer instruction. The most common cause is the model lost context mid-task or misread the prompt. Re-running the stage is safe — the orchestrator overwrites the workstream's previous (incomplete) gate when a new one is written.
- **Hand-write the gate.** If the model produced the artifact but not the gate, you can write the gate JSON yourself. See `rules/gates.md` for the required-fields shape per stage. The orchestrator doesn't care how the gate got there.

If neither works: write the gate with `status: "ESCALATE"`, fill `escalation_reason` with what happened, and run `devteam next` — it'll route you to `resolve-escalation` and the pipeline halts cleanly until you decide.

### The pipeline is in a state I can't reason about

Three diagnostic commands:

```bash
devteam summary           # one-screen view of every stage's status
devteam validate          # what the validator thinks of the most recent gate
ls -la pipeline/gates/    # the ground truth — gate files in order of mtime
```

The pipeline state is **only** the JSON files in `pipeline/gates/`. There's no hidden state, no database, no in-memory cache. If you can read the gate files, you can reason about the pipeline. Worst case: delete the gate files for stages you want to re-run and start over.

### Can I roll back to an earlier stage?

Yes. Two ways:

- **Re-run an earlier stage.** Writing a new gate file for an earlier stage doesn't roll back the later ones — they still exist on disk. But `devteam next` only cares about the most recent gate per stage, so re-running a stage with `--feature "..."` and producing a new gate effectively "rewinds" that stage.
- **Delete later gates manually.** If you want to truly start over from stage-04, `rm pipeline/gates/stage-04*.json pipeline/gates/stage-05*.json …`. The orchestrator will then see those stages as pending.

There's no `devteam rewind <stage>` command today (BACKLOG E6 — `devteam replay <run-id>` is the closest planned feature). Manual file ops work fine for now.

## Running offline / in CI

### Can I run Stagecraft fully offline?

Mostly yes. The framework itself is offline (Node, no network calls). The model invocation is whatever the host CLI does — `claude --print` and `codex exec` need network; `generic` host doesn't run a model at all.

The memory system's default embedder (`Xenova/bge-small-en-v1.5`) downloads ~33MB on first use, then runs offline. If your CI doesn't have network access, set `DEVTEAM_EMBEDDING_PROVIDER=stub` to skip embedding entirely.

OpenTelemetry is no-op when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset — no network attempts.

### How do I run Stagecraft in CI?

Add `devteam init --host <name>` to your project bootstrap script and use `--headless` for stage invocations:

```yaml
# .github/workflows/pipeline.yml
- run: npm ci
- run: devteam init --host claude-code
- run: devteam stage build --feature "${{ github.event.pull_request.title }}" --headless
- run: devteam next --json | jq .action
```

Set the host CLI's auth via the standard env (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.) in your CI secrets. The orchestrator never handles tokens — it just shells out to `claude` / `codex` / `gemini`.

`scripts/pr-publish.js` (run via `npm run pr-publish`) posts gate status as GitHub check runs on the PR head commit. PASS → success, WARN → neutral, FAIL/ESCALATE → failure.

### What about running on a remote worker / cloud function?

BACKLOG A3 covers this — a "cloud-runner" adapter that ships the stage to a remote worker. Not built yet. For now, if you need long-running stages (multi-hour audits, big test suites), run them on a beefier machine and `rsync` the gates back, or set up SSH-based remote invocation via the `generic` adapter.

## Auditing past runs

### How do I see every change a feature went through?

`pipeline/gates/` is the audit trail. After a full-track run:

```bash
ls -la pipeline/gates/
# stage-01.json  through  stage-09.json
# plus per-workstream gates for multi-role stages

cat pipeline/gates/stage-01.json | jq    # the brief gate
cat pipeline/brief.md                     # the artifact
cat pipeline/design-spec.md
cat pipeline/code-review/by-*.md          # all reviewer comments
cat pipeline/test-report.md
cat pipeline/runbook.md
cat pipeline/retrospective.md
```

If you commit `pipeline/` to git (recommended), `git log pipeline/` is a complete history of every change every feature went through.

### How do I get pass rates across past runs?

`scripts/dashboard.js` (alias `npm run dashboard`) aggregates `pipeline/gates/` and produces per-stage / per-host / per-role / per-status pass-rate reports. Flags:

```bash
npm run dashboard                              # current project
npm run dashboard -- --from proj1,proj2,proj3  # multi-project rollup
npm run dashboard -- --since 2026-03-01         # time-windowed
npm run dashboard -- --json                     # machine-readable
```

Useful for monthly pipeline retrospectives — "which stages are flakiest?" / "which model is best at which role?" / "are we trending up or down?".

### Can I see who approved what?

For Stage 5 peer-review specifically: yes. The reviewer files (`pipeline/code-review/by-<reviewer>.md`) carry one section per area being reviewed, with explicit `REVIEW: APPROVED` / `REVIEW: CHANGES REQUESTED` markers. The merged stage-05 gate's `workstreams[]` array shows who approved what area and which host they came from (for fanout configurations).

For other gates: the `host` field on workstream gates tells you which model produced it, and the `orchestrator` field tells you which framework version validated it. Beyond that, attribution is whatever your git log shows.

## Multi-host specifics

### What if Claude says PASS and Codex says FAIL in fanout review?

Pessimistic merge. Any FAIL anywhere → merged FAIL. Any WARN → merged WARN. Only all-PASS gives merged PASS. The intent is to err on the side of "if any model has concerns, surface them" — which is the whole point of fanout.

The blockers list in the merged gate concatenates blockers from all FAILing workstreams, prefixed with the host that produced them. So you can see exactly which model flagged what.

### Do hosts share context between workstreams?

No. Each workstream is a fresh dispatch with its own prompt. The shared state is the files on disk (`pipeline/brief.md`, `pipeline/design-spec.md`, prior gates, etc.). One workstream's output becomes another workstream's input through the file system, not through model state.

This is by design. Cross-workstream context-sharing would tie workstreams to specific hosts (which model can share state with which other model?) and break the model-agnostic story. The gate JSON + artifact files are the seam.

### What if my OTel collector goes down mid-pipeline?

Tracing fails gracefully. The OTLP exporter logs a connection error to stderr and continues; pipeline execution is unaffected. Spans for that period are lost. The pipeline itself doesn't depend on observability working.

If you'd rather not see the error messages: unset `OTEL_EXPORTER_OTLP_ENDPOINT` to disable tracing entirely, or set `DEVTEAM_OTEL_DISABLE=1` for a hard disable.

### Can I use a different model within Claude Code itself?

Yes. Edit `.claude/agents/<name>.md`'s frontmatter — the `model:` field lets you pin a specific model per subagent. Stagecraft's routing layer routes to *hosts*, not *models within a host*; for finer-grained model selection, configure that inside the host.

The Claude Code adapter sets reasonable defaults in `hosts/claude-code/adapter.js` (Principal → Opus, dev-* → Sonnet, QA → Haiku, etc.) — adjust as you see fit.

## Memory and learning

### How does the memory system handle outdated information?

It doesn't — that's intentional. The memory store is append-only by design; re-running `devteam memory ingest` on an updated artifact replaces that artifact's chunks (no duplicates), but historical chunks from previous projects or older versions of the same artifact stay if you indexed them.

If you want to clean stale memory: `devteam memory clear` (wipes everything), then re-ingest current artifacts. There's no per-chunk pruning today (BACKLOG D3 candidate).

### Can memory leak sensitive content?

Potentially yes. The memory store contains plaintext copies of every chunk it indexes — briefs, design specs, retros — which may include sensitive material. **Add `.devteam/memory/` to your `.gitignore`** unless you have a deliberate sharing strategy. The default behavior is per-project memory only; cross-project import (BACKLOG D3) will be opt-in.

For per-artifact opt-out: include `stagecraft-no-memory` anywhere in the file (a comment line works). Stagecraft skips that artifact at ingest.

### What happens to lessons-learned that aren't reinforced?

They age out automatically. Each lesson in `pipeline/lessons-learned.md` carries a `**Reinforced:** N (last: YYYY-MM-DD)` line. The Stage 9 retrospective synthesis bumps the count when a similar pattern recurs. Lessons that haven't been reinforced in 10 runs are aged out by the auto-prune rule — they get retired with a note about why.

This prevents lessons-learned from becoming a wall of accumulated wisdom that nobody reads. The 10-run threshold is in `rules/retrospective.md`; tune for your team if needed.

## Operational gotchas

### My hooks are firing but nothing happens

Check the hook output. Claude Code writes hook output to its own log; `devteam validate` runs the validator directly and prints to stdout. If a hook is silently no-op'ing, the most common causes:

- The hook script wasn't installed — re-run `devteam init --host claude-code --force`.
- The hook is firing on a different event than you think. `cat .claude/settings.local.json | jq .hooks` to see the wiring.
- The gate file isn't where the hook expects. Validator scans `pipeline/gates/` — if you're writing gates elsewhere (e.g. `pipeline/gates/stage-04/backend.json` instead of `stage-04.backend.json`), the validator won't find them.

### `devteam doctor` says everything's green but stages fail

Doctor verifies install integrity — the right files in the right places. It doesn't verify the host CLI actually works for your project. Check:

- Does the host CLI run interactively? `claude` should drop you into a session.
- Are credentials set? `claude --version` works without auth; `claude --print "test"` needs auth.
- Is your project's source tree something the host can read? Permissions matter.

### A gate has the right shape but the validator rejects it

Run `devteam validate` for the exact error. Common causes:

- The gate has a field with the wrong type (e.g. `status: 1` instead of `"PASS"`).
- The `status` value is outside the allowed set (`PASS`, `WARN`, `FAIL`, `ESCALATE`).
- The gate has a `retry_number >= 1` but no `this_attempt_differs_by` field — the retry-integrity check.
- An older gate in `pipeline/gates/` has `status: ESCALATE` that's unresolved — bypassed-escalation halts the pipeline regardless of which gate you just wrote.

### How big can a gate file be?

The validator caps gates at 1 MB. Real gates are typically <1 KB. If you're hitting the cap, something has gone wrong — usually a huge `blockers` array or a stringified test output that should have been a separate artifact.

## Auditing a codebase

### How do I audit a codebase?

In Claude Code: `/audit` (full) or `/audit-quick` (Phases 0-1 only). On other hosts, invoke the `auditor` role with the `audit` skill (installed at `.codex/skills/audit/` or `.gemini/skills/audit/` after `devteam init`). See [`docs/user-guide.md`](user-guide.md#auditing-a-codebase) for the full reference.

The audit is read-only. It writes findings to `docs/audit/00-project-context.md` through `docs/audit/10-roadmap.md`. It never modifies source code.

### What's the difference between the audit and the pipeline?

The **pipeline** (`devteam stage <name>`) *builds* features through 17 staged production steps with gate JSON between them. Audits are NOT pipeline stages.

The **audit** (`/audit` or `/audit-quick`) *analyzes* an existing codebase and produces a prioritized improvement roadmap. Read-only.

You'd run the pipeline when you want to ship something. You'd run the audit when you want to understand what's there.

### Can I run an audit on Stagecraft itself?

You can but you usually shouldn't — the audit feature is designed to be invoked from within a target project, against that project's code. If you point it at the Stagecraft framework, you'll get an audit of the framework's own code (which is interesting but not what most users want).

If you genuinely want to audit Stagecraft (e.g. you're contributing): `cd` into the framework and run the audit there. The output lands at `docs/audit/` in the framework repo. Add it to `.gitignore` so audits don't pollute the framework's git history unless you want them to.

### How long does an audit take?

- `/audit-quick` (Phases 0-1): ~5-15 minutes on a medium codebase.
- `/audit` (Phases 0-3): ~30-60 minutes. Longer for large codebases; deep analysis (security, performance, code quality) does the heavy lifting.

Wall-clock varies by codebase size and how many findings each phase produces. The human checkpoints between phases (after 0, 1, 2) add whatever review time you take.

### What if the audit interrupts mid-run?

The audit writes `docs/audit/status.json` after each phase completes. Run `/audit --resume` to continue from the last completed phase. Phase outputs already on disk aren't re-written.

### Can the audit be re-run as a periodic health check?

Yes. Re-running `/audit` against a project that has previous audit outputs overwrites them with fresh findings. There's no automatic diff between runs (BACKLOG candidate); you'd compare by reading both versions or by version-controlling `docs/audit/` and using `git diff`.

Recommended cadence: re-audit quarterly, after major refactors, after major dependency upgrades, before a release that touches sensitive paths.

### What if I want to add project-specific checks?

Create `docs/audit-extensions.md` in your project. Per phase, describe the project-specific checks to run. The audit reads this file at the start of each phase and appends results under a `## Project-Specific` heading in the relevant phase output file.

Use cases: PCI / HIPAA / SOC 2 compliance checks, team-specific naming conventions, custom security policies, internal patterns you want to track.

## Comparing to /goal and similar features

### Should I use Stagecraft or Claude Code's `/goal` command?

Both, for different things. `/goal` is a *continuation primitive* — set a session-level condition and the host loops until the condition holds. Stagecraft is a *decomposition primitive* — one feature → 17 stages with defined artifacts and gates.

They compose: you could plausibly set a `/goal` like "tests pass and lint clean" at the start of stage-04 build, and let Claude loop on it. Then read the gate. We don't emit `/goal` invocations from the adapter today — that's BACKLOG E-series. Manually setting one before running a convergence-shaped stage works fine.

### Where does Stagecraft fit relative to Codex's autonomous task mode?

Codex's autonomous mode (the "agentic" loop) is one model running until a task is done. Stagecraft is a structured *pipeline* across roles, with artifacts and gates between them. If your task fits in one model's context and you trust it to converge — use Codex's autonomous mode. If your task needs structure across stages, multiple roles, or auditability — use Stagecraft.

You can also run Stagecraft with Codex as the host. The `codex` adapter dispatches each workstream as a separate `codex exec` invocation. Codex still operates autonomously per workstream; Stagecraft provides the cross-workstream structure.
