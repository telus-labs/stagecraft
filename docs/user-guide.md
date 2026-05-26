# User guide

How to use ai-dev-team day-to-day. This is the long-form companion to:

- [`README.md`](../README.md) — what it is + quick start.
- [`EXAMPLE.md`](../EXAMPLE.md) — one full pipeline run end-to-end.
- [`docs/concepts.md`](concepts.md) — the vocabulary.
- [`docs/tracks.md`](tracks.md) — which track to pick.

If you've never used it before, read EXAMPLE first.

## Table of contents

1. [Install + first run](#install--first-run)
2. [Daily loop](#daily-loop)
3. [Running each stage](#running-each-stage)
4. [Multi-host setups](#multi-host-setups)
5. [Headless mode](#headless-mode)
6. [When things go wrong](#when-things-go-wrong)
7. [Customizing for your project](#customizing-for-your-project)
8. [Upgrading](#upgrading)

---

## Install + first run

```bash
# 1. Get the framework
git clone <repo> /path/to/ai-dev-team
cd /path/to/ai-dev-team
npm install

# 2. Make the CLI available globally (optional but recommended)
npm link

# 3. In your target project
cd ~/projects/my-app
devteam init --host claude-code        # or codex / claude-code,codex
```

`devteam init` lays down:

```
my-app/
├── .devteam/
│   ├── config.yml              ← routing + track defaults
│   └── rules/                  ← 10 rule docs (pipeline, gates, escalation, …)
├── .claude/                    ← (or .codex/, depending on host)
│   ├── agents/                 ← 8 role subagents
│   ├── skills/                 ← 6 task helpers
│   ├── commands/devteam.md     ← /devteam slash command
│   └── settings.local.json     ← Stop/SubagentStop/PostToolUse hooks
└── pipeline/
    └── gates/                  ← empty; gates land here as stages run
```

Verify with:

```bash
devteam doctor
```

A green doctor means everything is wired. Read `cat .devteam/config.yml` to see/edit the routing.

## Daily loop

Two commands cover 80% of usage:

```bash
devteam next            # "what's next?"
devteam stage <name>    # "run that stage"
```

After every stage's gate is written (by the LLM, via the host's hooks, or manually), `devteam next` tells you what comes next: run-stage, continue-stage (multi-role partial), merge, fix-and-retry, resolve-escalation, or pipeline-complete.

For a snapshot of where the pipeline is right now:

```bash
devteam summary
```

Looks like:

```
Pipeline state — track: full
──────────────────────────────────────────────────
✅ requirements      stage-01  PASS
✅ design            stage-02  PASS
✅ clarification     stage-03  PASS
⏳ build             stage-04  PARTIAL
    ✅ backend       (codex)            PASS
    ⚠️  frontend      (claude-code)      WARN
    pending workstreams: platform, qa
○  pre-review        stage-04a  PENDING
…
```

## Running each stage

The CLI emits a prompt aimed at the routed host. You consume the prompt by invoking the named subagent in your AI tool — typically via a slash command or natural language.

```bash
devteam stage requirements --feature "Add SMS notification opt-in"
```

Then inside Claude Code: `Use the pm subagent to do this stage` and paste/reference the prompt. The PM subagent reads its brief (`.claude/agents/pm.md`), produces `pipeline/brief.md` and the stage-01 gate.

For multi-role stages (`build`, `peer-review`, `sign-off`), one CLI invocation produces multiple prompts — one per role. Each prompt points at its own subagent. You can run them in parallel (claude-code's `subagents: true` capability) or sequentially.

After all per-role workstreams of a multi-role stage have written their gates:

```bash
devteam merge build
# → Merged → /…/pipeline/gates/stage-04.json (status: PASS)
```

`devteam next` will tell you when a merge is needed — you don't have to remember.

### Per-stage details

- **Stage 1 — Requirements (PM).** PM writes `pipeline/brief.md` from `templates/brief-template.md`. Gate carries `acceptance_criteria_count`, `out_of_scope_items`, `required_sections_complete`.

- **Stage 2 — Design (Principal).** Principal writes `pipeline/design-spec.md` and any ADRs under `pipeline/adr/`. Gate carries `arch_approved`, `pm_approved`, `adr_count`.

- **Stage 3 — Clarification (PM).** Resolves any open questions from design before build starts. Skipped on `quick` and `nano` tracks.

- **Stage 4 — Build (4 workstreams).** Backend / Frontend / Platform / QA each write to their owned source dir and produce a PR summary. **Each workstream sees a narrower `allowedWrites`** — backend cannot write `src/frontend/`. Per-workstream gates at `pipeline/gates/stage-04.<role>.json`; `devteam merge build` aggregates.

- **Stage 4a — Pre-review (Platform).** Lint, type-check, dep review, security heuristic. Gate carries `lint_passed`, `tests_passed`, `dependency_review_passed`, `security_review_required`. The last flag conditionally triggers Stage 4b.

- **Stage 4b — Security review (Security, conditional).** Runs only when `stage-04a.security_review_required` is `true`. Gate carries `security_approved`, `veto`, `triggering_conditions`. **A `veto: true` halts the pipeline regardless of any subsequent approvals.**

- **Stage 5 — Peer review (4 area workstreams via reviewer subagent).** All 4 workstreams (one per area being reviewed) dispatch to the *same* reviewer subagent. Reviewers write per-area sections in `pipeline/code-review/by-<reviewer>.md`. The PostToolUse hook (`approval-derivation.js`) parses `REVIEW: APPROVED` / `REVIEW: CHANGES REQUESTED` markers and upserts the per-area gates. Don't write the gates manually — let the hook do it.

- **Stage 6 — Tests (QA).** QA runs the test suite, writes `pipeline/test-report.md`. Gate carries `all_acceptance_criteria_met`, `tests_total/passed/failed`, `criterion_to_test_mapping_is_one_to_one`. The last flag enables Stage 7 auto-fold.

- **Stage 7 — Sign-off (PM + Platform).** PM signs off on QA results; Platform prepares `pipeline/runbook.md`. **Auto-fold:** if Stage 6 reports `all_acceptance_criteria_met: true` AND a 1:1 mapping, the orchestrator writes Stage 7 directly with `auto_from_stage_06: true`.

- **Stage 8 — Deploy (Platform, adapter-driven).** Platform reads `.devteam/config.yml`'s `deploy.adapter` setting, follows `core/deploy/<adapter>.md`. **Do not auto-rollback on FAIL** — the runbook names the rollback procedure; a human decides whether to roll back or investigate.

- **Stage 9 — Retrospective (Principal).** Principal harvests `PATTERN:` lines from Stage 5 reviews, promotes ≤2 rules into `pipeline/lessons-learned.md`, ages out rules that haven't been reinforced in 10 runs.

## Multi-host setups

Install multiple hosts side-by-side:

```bash
devteam init --host claude-code,codex
```

Both adapters install their surfaces; the rules are shared (the second adapter sees them already on disk and skips). Then edit `.devteam/config.yml`:

```yaml
routing:
  default_host: claude-code
  roles:
    backend: codex           # backend goes to Codex
  stages:
    stage-08: claude-code    # deploy always on claude-code, regardless of role
```

Precedence: `routing.stages > routing.roles > routing.default_host`.

Result: `devteam stage build` produces 4 workstream prompts, one of which (backend) points at `.codex/prompts/roles/backend.md` while the other three point at `.claude/agents/dev-<role>.md`. The merge step is unchanged — gates from different hosts merge through the same JSON seam.

## Headless mode

When you want the orchestrator to drive the host CLI directly:

```bash
devteam stage build --headless
```

For each workstream, the orchestrator spawns the host's headless command (`claude --print` for claude-code, `codex exec` for codex), pipes the rendered prompt to stdin, and waits for exit. Summary line per workstream:

```
[devteam] dispatching backend → codex (headless)
  ✓ backend (codex): exit 0, 73000ms → pipeline/gates/stage-04.backend.json
```

Exits 0 only if every workstream both exit-0'd and wrote its gate. Exits 1 otherwise.

Hosts must declare `capabilities.headless: true` for `--headless` to work. The generic adapter doesn't support headless; trying to use it that way gives a pre-flight refusal:

```
devteam: host "generic" cannot drive workstream "pm" headlessly
(capabilities.headless is false). Either install a different host
for this role or run interactively (omit --headless).
```

**Test the wiring without `claude`/`codex` installed:**

```bash
DEVTEAM_HEADLESS_COMMAND=cat devteam stage requirements --headless
```

`cat` just echoes the prompt; gate won't be written, so the run exits 1. Useful for verifying the spawn+pipe machinery.

## When things go wrong

### "Unknown stage" or "No adapter found"

You typo'd a stage or host name. Use `devteam stages` and `devteam hosts` to see what's known.

### `devteam next` says `fix-and-retry`

A stage gate has `status: FAIL`. The blockers are listed in `devteam next`'s output. Address them, re-run the stage, and let the new gate overwrite the old one.

### `devteam next` says `resolve-escalation`

A stage gate has `status: ESCALATE`. The pipeline cannot advance until the escalation is resolved. Read the gate's `escalation_reason` field, make the call, then either:

- Rewrite the gate to `PASS` (you've resolved the escalation) and re-run `devteam next`.
- Or stop — escalation is the right outcome and the pipeline correctly halted.

### Stoplist blocked my change

```
This change matches the safety stoplist. Use /pipeline instead.
Reasons:
  - authentication: matched "auth" in: add auth middleware
```

You ran a lighter track (`quick`, `nano`, `config-only`, `dep-update`) and the change description matched a stoplist phrase. Two responses:

- **Recommended:** switch to `full` or `hotfix` — the change is consequential enough to warrant the rigor.
- **If false positive:** re-run with `--force` to bypass. Use sparingly.

### `devteam doctor` reports critical failures

Walk down the list. The most common causes:

- `.devteam/config.yml exists` ✗ → run `devteam init --host <name>`
- `host "X" install` ✗ → re-run `devteam init --host X` to re-render the install
- `node_modules/js-yaml present` ✗ → run `npm install` in the framework dir

### Stage gate written but `next` doesn't advance

Run `devteam validate` to see what the validator thinks of your gate. Common causes:

- Missing required field (`orchestrator`, `status`, etc.) → validator exits 1 with the field listed.
- `status: "FAIL"` or `"ESCALATE"` → validator exits 2 or 3; next will report `fix-and-retry` or `resolve-escalation`.
- Bypassed escalation — an older gate has `status: ESCALATE` that's still unresolved → validator exits 3 with `BYPASSED ESCALATION`.

### Hooks didn't fire (Claude Code)

The hooks are wired via `.claude/settings.local.json`. Verify:

```bash
cat .claude/settings.local.json | jq .hooks
```

If the file is missing or doesn't have the expected blocks (Stop, SubagentStop, PostToolUse), re-run `devteam init --host claude-code --force` to overwrite.

### A multi-role stage workstream is stuck

`devteam next` says `continue-stage` with the same role listed in `remaining` over and over. Either:

- The user/subagent hasn't actually run that role's workstream yet — invoke the relevant subagent.
- The workstream wrote its gate to the wrong filename. Expected: `pipeline/gates/<stage>.<role>.json` (dot separator). Check for stray `.<role>-` (hyphen) or absent `.json` extension.

## Customizing for your project

### Routing

Edit `.devteam/config.yml`. Routing precedence is `stages > roles > default_host` — most specific wins.

### Track

Edit `pipeline.default_track` in `.devteam/config.yml`. See [`docs/tracks.md`](tracks.md) for what each track skips.

### Stoplist

`core/guards/stoplist.js` has the patterns. Adding project-specific stoplist phrases isn't yet a first-class config option — the BACKLOG flags this as a follow-up. For now, edit the file directly (changes survive `devteam init` since the file is in the framework, not the target).

### Adding a project-specific role / stage / skill

See [`CONTRIBUTING.md`](../CONTRIBUTING.md) recipes 2–4. These changes go in the framework repo, not the target project.

### Custom deploy adapter

Add `core/deploy/<your-adapter>.md` with the procedure. Reference it from `.devteam/config.yml`:

```yaml
deploy:
  adapter: my-adapter
```

The Platform role at Stage 8 reads `.devteam/config.yml`'s `deploy.adapter` and follows your adapter's procedure.

## Upgrading

ai-dev-team versions are tracked in `package.json#version`. Upgrade by pulling the latest framework and re-running init in each target project:

```bash
cd /path/to/ai-dev-team
git pull && npm install

cd ~/projects/my-app
devteam init --host claude-code --force   # re-render install with new versions
```

The `--force` flag overwrites the installed files. The `.devteam/config.yml` is preserved by default (omit `--force` if you only want to update the agents/rules/skills and keep your config); pass `--force` if you want to regenerate the config too.

Custom edits to the target's installed files (`.claude/agents/`, `.devteam/rules/`, etc.) are lost on re-install — that's by design. **Customize in the framework**, not in target copies. See `CONTRIBUTING.md` for the right place to put each kind of change.

## Things this guide doesn't cover

- The host-adapter contract — [`core/adapters/host-adapter.md`](../core/adapters/host-adapter.md).
- 11 locked design decisions — [`ARCHITECTURE.md`](../ARCHITECTURE.md).
- Backlog of next ideas — [`docs/BACKLOG.md`](BACKLOG.md).
- Test strategy and what's covered — [`docs/TESTING.md`](TESTING.md).
- A stress-test of the multi-workstream contract — [`docs/walkthroughs/stage-04-split-host.md`](walkthroughs/stage-04-split-host.md).
