# User guide

How to use Stagecraft day to day. Companion to:

- [`README.md`](../README.md) — what it is + the First 30 minutes path.
- [`EXAMPLE.md`](../EXAMPLE.md) — one full pipeline traced end to end.
- [`docs/concepts.md`](concepts.md) — the six primitives in a table.
- [`docs/tracks.md`](tracks.md) — which track to pick for which kind of change.

If you've never used Stagecraft before, read EXAMPLE first. This page is a reference you reach for during real work.

---

## The shape of one run

Before the procedural reference, the mental model. One pipeline run looks like this:

```
   you                                                          you
    │                                                            │
    │  "Add SMS opt-in"                                          │  reviews, decides, signs off
    ▼                                                            │
  devteam stage requirements ──► host ──► model writes brief.md  │
                                          + gate stage-01.json   │
                                                  │              │
                                                  ▼              │
                                            devteam next ────────┘
                                                  │
                                                  ▼
  devteam stage design ──► host ──► model writes design-spec.md
                                     + gate stage-02.json
                                              │
                                              ▼
                                       devteam next
                                              │
                                              ▼
   (loop for 11 more stages)

  Multi-role stages (build, peer-review) decompose into per-workstream
  dispatches that each write their own gate. devteam merge <stage>
  aggregates them.

  Conditional stages (security-review) fire only when a prior gate's
  field has a specific value.
```

You're the loop's start, end, and decision-maker. The framework does the bookkeeping — which stage's next, what to dispatch, where the gate goes, whether it's valid, whether the pipeline can advance.

## Your three moments of control

If you remember nothing else from this guide, remember these:

1. **At the start.** You pick the track and write the feature brief in one paragraph. Everything downstream flows from this.
   ```bash
   devteam stage requirements --feature "Add SMS notification opt-in to user settings"
   ```

2. **At every gate.** You read the gate (or skim `devteam next`'s summary) and decide: advance, fix and retry, or stop.
   ```bash
   devteam next                  # what's next?
   devteam summary               # one-screen view of everything
   devteam ui --open             # web UI with live updates
   ```

3. **At escalations.** When the pipeline halts (`status: ESCALATE` or `veto: true`), you make a binding call. Resolve the gate to PASS or stop the pipeline. Nobody else can decide for you.

Everything else — which subagent to invoke, which file to write, what schema the gate has, how to aggregate workstreams — is the framework's job, not yours.

---

## Table of contents

1. [Install + first run](#install--first-run)
2. [Daily loop](#daily-loop)
3. [Running each stage](#running-each-stage)
4. [Multi-host setups](#multi-host-setups)
5. [Headless mode](#headless-mode)
6. [The web UI](#the-web-ui)
7. [Persistent memory](#persistent-memory)
8. [Observability (OpenTelemetry)](#observability-opentelemetry)
9. [Multi-model adversarial peer review](#multi-model-adversarial-peer-review)
10. [Auditing a codebase](#auditing-a-codebase)
11. [When things go wrong](#when-things-go-wrong)
11. [Customizing for your project](#customizing-for-your-project)
12. [Upgrading](#upgrading)
13. [What's not covered here](#whats-not-covered-here)

---

## Install + first run

```bash
# 1. Get the framework (one time, anywhere)
git clone <repo> /path/to/stagecraft
cd /path/to/stagecraft
npm install

# 2. Make the CLI available globally (optional, recommended)
npm link

# 3. In your target project
cd ~/projects/my-app
devteam init --host claude-code        # or codex / gemini-cli / claude-code,codex
```

`devteam init` lays down:

```
my-app/
├── .devteam/
│   ├── config.yml              ← routing + track defaults
│   └── rules/                  ← 10 rule docs (pipeline, gates, escalation, …)
├── .claude/                    ← (or .codex/, .gemini/, depending on host)
│   ├── agents/                 ← 8 role subagents
│   ├── skills/                 ← task helpers (implement, review-rubric, …)
│   ├── commands/devteam.md     ← /devteam slash command (claude-code only)
│   └── settings.local.json     ← Stop / SubagentStop / PostToolUse / PreToolUse hooks
└── pipeline/
    └── gates/                  ← empty; gates land here as stages run
```

Verify with:

```bash
devteam doctor
```

A green doctor means the framework, the adapter install, and (if applicable) the host CLI on PATH are all wired. Read `cat .devteam/config.yml` to see/edit the routing.

## Daily loop

Two commands cover 80% of usage:

```bash
devteam next            # "what's next?"
devteam stage <name>    # "run that stage"
```

After every stage's gate is written (by the LLM, via the host's hooks, or manually), `devteam next` tells you what comes next: `run-stage`, `continue-stage` (multi-role partial), `merge`, `fix-and-retry`, `resolve-escalation`, or `pipeline-complete`.

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

For a live view, use `devteam ui --open` — see [the web UI](#the-web-ui).

## Running each stage

The CLI emits a prompt aimed at the routed host. You consume the prompt by invoking the named subagent in your AI tool — typically via a slash command or natural language.

```bash
devteam stage requirements --feature "Add SMS notification opt-in"
```

When run user-driven (the default), the output is framed with a preamble explaining what to do with the prompt and a postamble pointing at the next action:

```
═══════════════════════════════════════════════════════════════════════
  Stage stage-01 (requirements) — 1 workstream to dispatch
═══════════════════════════════════════════════════════════════════════

  The block(s) below are prompts to feed to your model. devteam does
  NOT call a model — it renders the prompt and validates the gate JSON
  the model writes back.

  To run this stage, pick one:
    1. Inside Claude Code: paste the prompt, OR type
         /devteam stage requirements --feature "Add SMS notification opt-in"
    2. Headless from terminal:
         devteam stage requirements --feature "Add SMS notification opt-in" --headless

  When done, each workstream writes pipeline/gates/stage-01*.json.
  Then run `devteam next` to see what to do next.
═══════════════════════════════════════════════════════════════════════

────────  workstream: pm  (host: claude-code)  ────────

[the actual prompt for the model]
```

Inside Claude Code: paste the prompt, or type `/devteam stage requirements --feature "..."`. The PM subagent reads its brief (`.claude/agents/pm.md`), produces `pipeline/brief.md` and the stage-01 gate.

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

- **Stage 5 — Peer review (4 area workstreams via reviewer subagent).** All 4 workstreams (one per area being reviewed) dispatch to the *same* reviewer subagent. Reviewers write per-area sections in `pipeline/code-review/by-<reviewer>.md`. The PostToolUse hook (`approval-derivation.js`) parses `REVIEW: APPROVED` / `REVIEW: CHANGES REQUESTED` markers and upserts the per-area gates. **Don't write the gates manually** — let the hook do it.

- **Stage 6 — Tests (QA).** QA runs the test suite, writes `pipeline/test-report.md`. Gate carries `all_acceptance_criteria_met`, `tests_total/passed/failed`, `criterion_to_test_mapping_is_one_to_one`. The last flag enables Stage 7 auto-fold.

- **Stage 6b — Accessibility audit (QA).** WCAG audit on UI changes via axe-core / pa11y / Lighthouse / manual. Gate carries `audit_method`, `wcag_level`, `violations` (critical / serious / moderate / minor), `components_audited`. PASS requires 0 critical AND 0 serious. Skip with `audit_skipped_reason` for backend-only changes.

- **Stage 6c — Observability gate (Platform).** Verifies that every metric / log / trace promised by brief §9 is actually emitted in the shipped code. Gate carries `metrics` / `logs` / `traces` each with `{required[], verified[], gap[]}`. PASS requires every `gap` empty. Weak verification methods (`code-grep` only) PASS with WARN; the gold standard is `runtime-probe`.

- **Stage 7 — Sign-off (PM + Platform).** PM signs off on QA results; Platform prepares `pipeline/runbook.md`. **Auto-fold:** if Stage 6 reports `all_acceptance_criteria_met: true` AND a 1:1 mapping, the orchestrator writes Stage 7 directly with `auto_from_stage_06: true`.

- **Stage 8 — Deploy (Platform, adapter-driven).** Platform reads `.devteam/config.yml`'s `deploy.adapter` setting, follows `core/deploy/<adapter>.md`. **Do not auto-rollback on FAIL** — the runbook names the rollback procedure; a human decides whether to roll back or investigate.

- **Stage 9 — Retrospective (Principal).** Principal harvests `PATTERN:` lines from Stage 5 reviews, promotes ≤2 rules into `pipeline/lessons-learned.md`, ages out rules that haven't been reinforced in 10 runs.

## Multi-host setups

Install multiple hosts side-by-side:

```bash
devteam init --host claude-code,codex
```

Both adapters install their surfaces; rules (under `.devteam/rules/`) are shared (the second adapter sees them already on disk and skips). Then edit `.devteam/config.yml`:

```yaml
routing:
  default_host: claude-code      # everything routes here unless overridden
  roles:
    backend: codex                # backend goes to Codex
  stages:
    stage-08: claude-code         # deploy always on claude-code, regardless of role
```

Precedence: `routing.stages > routing.roles > routing.default_host`.

Result: `devteam stage build` produces 4 workstream prompts, one of which (backend) points at `.codex/prompts/roles/backend.md` while the other three point at `.claude/agents/dev-<role>.md`. The merge step is unchanged — gates from different hosts merge through the same JSON seam. The merged stage gate's `workstreams[]` array preserves the `host` field per row.

### Why split hosts?

Three reasons people do this in practice:

1. **Cost.** Route the bulk of work (backend, frontend, QA) to a cheaper model and reserve the expensive one (Opus) for Principal + Security. Net cost typically drops 30–50%.
2. **Specialization.** Claude is usually best at design + review; Codex is fast at backend implementation; Gemini is cheap at QA pattern-matching. Pick the right model per role.
3. **Independence.** A bug Claude rationalizes as fine, Codex might catch. Diverse models = diverse blind spots. Multi-host adversarial review (see below) is the formalized version of this.

### Why NOT split hosts?

- **Setup overhead.** Each host CLI must be installed and authenticated. If your team has only Claude Code, multi-host adds friction with no value.
- **Debugging.** When a stage fails, "which model's fault" is a question you have to answer.
- **Cost telemetry.** Tracking spend across two billing dashboards is harder than one. (BACKLOG D6 will add per-stage cost telemetry; until then, it's manual.)

Default to single-host. Reach for multi-host when you have a specific reason.

## Headless mode

When you want the orchestrator to drive the host CLI directly:

```bash
devteam stage build --headless
```

For each workstream, the orchestrator spawns the host's headless command (`claude --print` for claude-code, `codex exec` for codex, `gemini` for gemini-cli), pipes the rendered prompt to stdin, and waits for exit. Summary line per workstream:

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

### Headless vs user-driven — when to pick which

- **User-driven (default).** Best for: first runs, debugging a stage, anything where you want to see what the model is doing. Most onboarding flows live here.
- **Headless.** Best for: CI pipelines, scripted runs, regression testing, batch processing. The prompt goes to the host CLI's stdin; the model runs unattended; you get the gate back.

You can mix: `devteam stage requirements` user-driven, then `devteam stage build --headless` once you trust the build stage to run unattended.

### Stubbing for tests

Set `DEVTEAM_HEADLESS_COMMAND=cat` to bypass the real host CLI:

```bash
DEVTEAM_HEADLESS_COMMAND=cat devteam stage requirements --headless
```

`cat` just echoes the prompt; the gate won't be written, so the run exits 1. Useful for verifying the spawn + pipe machinery without `claude` / `codex` installed.

## The web UI

```bash
devteam ui --open
```

Boots a local HTTP server (default `http://127.0.0.1:3737/`) and opens it in your browser. The UI shows:

- **Top bar:** active track, configured hosts.
- **Stage rows:** one per stage in the active track. Status icon + color. Multi-role stages expand to show per-workstream rows.
- **Click a row:** opens the gate detail panel — identity fields, blockers, warnings, workstreams table, raw JSON.
- **Click a role chip:** opens that role's brief inline.

Live updates: the UI watches `pipeline/gates/` via `fs.watch` and pushes changes over Server-Sent Events. Run a stage in another terminal; rows light up in the browser as gates land. No refresh needed.

### Flags

```bash
devteam ui                        # 127.0.0.1:3737, no browser
devteam ui --port 8080            # different port
devteam ui --open                 # auto-open browser
devteam ui --cwd /path/to/proj    # view another project's pipeline
```

### Security

Loopback bind only by default. If you need to expose the UI on your LAN (the UI has no auth — anyone who can connect can see all pipeline state):

```bash
STAGECRAFT_UI_ALLOW_REMOTE=1 devteam ui --port 8080
```

A loud warning prints on startup. Don't use this in any context where untrusted users can reach the port.

## Persistent memory

Stagecraft indexes pipeline artifacts (briefs, design specs, ADRs, retros, lessons) into a per-project semantic memory:

```bash
devteam memory ingest                                 # index everything under pipeline/
devteam memory query "user notification opt-in"        # semantic search
devteam memory query "schema migrations" --kind design-spec
devteam memory stats                                   # what's indexed
devteam memory clear                                   # wipe
devteam memory reindex                                 # re-embed (after embedder change)
```

The local-default embedder (`Xenova/bge-small-en-v1.5` via `@huggingface/transformers`) is ~33MB, lazy-downloaded to `~/.cache/huggingface/`, and runs entirely offline after the first ingest. JSON-backed storage under `.devteam/memory/` — git-friendly, but **add `.devteam/memory/` to your `.gitignore`** unless you have a deliberate sharing strategy (the store contains plaintext copies of brief / design content).

Opt out per artifact by including the marker `stagecraft-no-memory` anywhere in the file (a comment line works). Stagecraft skips that artifact at ingest.

For the full reference: [`docs/memory.md`](memory.md).

## Observability (OpenTelemetry)

Stagecraft emits OTel spans for every pipeline operation. Opt in via the standard env var:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
devteam stage build
# spans now ship via OTLP/HTTP to your collector
```

Spans emitted: `pipeline.stage`, `pipeline.workstream`, `pipeline.stage.headless`, `pipeline.merge`, `pipeline.next`, `adapter.renderStagePrompt`, `adapter.invoke`. Attributes include stage, workstream id, role, host, and status.

Works with Jaeger / Tempo / Honeycomb / Datadog Agent — anything that speaks OTLP/HTTP. For setup cookbooks: [`docs/observability.md`](observability.md).

Tracing is no-op (zero overhead) when no endpoint is configured. To force-disable even when an endpoint is set (useful in tests that import core modules): `DEVTEAM_OTEL_DISABLE=1`.

## Multi-model adversarial peer review

Opt-in: have Stage 5 (peer-review) run across multiple hosts simultaneously. Each area gets reviewed by every configured host; the merged gate is pessimistic.

```yaml
# .devteam/config.yml
routing:
  default_host: claude-code
  review_fanout: [claude-code, codex, gemini-cli]
```

With three hosts and four review areas, you get 4×3 = 12 parallel reviews. The approval-derivation hook recognizes host-based filenames (`pipeline/code-review/by-<host>.md`) and writes gates to a three-segment path (`pipeline/gates/stage-05.<area>.<host>.json`). The merge reads all expected fanout gates and aggregates pessimistically — any FAIL anywhere → merged FAIL.

Default is empty list (off). Opt in via config. The cost is N× peer-review time and N× peer-review LLM cost. The benefit: different models have different blind spots; a bug one model rationalizes, another flags.

## Auditing a codebase

The audit feature is separate from the 13-stage pipeline. Stages *build* features; the audit *analyzes* an existing codebase and produces a prioritized improvement roadmap. Read-only by design.

### When to use it

- **Onboarding to a new project.** `/audit-quick` in ~10 minutes gets you a project-context doc, architecture map, and git-history picture — enough to start working.
- **Before a refactor.** Full `/audit` produces a roadmap of what to fix in what order. The `implement` skill consumes `docs/audit/10-roadmap.md` directly.
- **Before a security review.** Phase 2.1 specifically catches secrets hygiene, injection risks, auth gaps, dependency CVEs.
- **Periodic health check.** Quarterly or after major changes — re-running `/audit` against an audited project shows what got fixed and what new findings have accumulated.

### How to invoke it

Inside Claude Code (after `devteam init --host claude-code`):

```
/audit                  # full audit, Phases 0-3, ~30-60 minutes, 11 output files
/audit-quick            # Phases 0-1 only, ~5-15 minutes, 6 output files
/audit src/backend/     # scope to a subtree
/audit --resume         # continue from the last completed phase (uses docs/audit/status.json)
```

On Codex / Gemini CLI / generic hosts, invoke the `auditor` role with the `audit` skill:

```
You are the auditor. Read .codex/skills/audit/SKILL.md and run a full audit.
```

Output lands under `docs/audit/` in your project. Eleven files (00 through 10) plus `status.json`.

### Phases

- **Phase 0 — Bootstrap.** What this project is, architecture map, git history.
- **Phase 1 — Health assessment.** Convention compliance, test health, documentation gaps.
- **Phase 2 — Deep analysis.** Security, performance & reliability, code quality.
- **Phase 3 — Roadmap.** Prioritized backlog (P0/P1/P2/P3/Parked) + sequenced batches.

`/audit` includes human checkpoints between each phase so you can correct course before the deep analysis runs. `/audit-quick` skips Phases 2 and 3 — you can run `/audit --resume` later to complete them.

### Extending an audit

Drop `docs/audit-extensions.md` in your project to add project-specific checks. The audit reads it at the start of each phase and appends extension findings to the relevant phase's output file under a `## Project-Specific` heading. Example use cases: PCI / HIPAA / SOC 2 compliance checks, team-specific naming conventions, custom security policies.

### What the audit does NOT do

- It does not modify source code. Findings live in `docs/audit/`; fixing them is the `implement` skill or a `devteam stage` invocation.
- It does not audit Stagecraft itself unless you explicitly ask. The audit targets the project Stagecraft was installed into.
- It does not skip phases without a documented reason in `status.json`.

## When things go wrong

### "Unknown stage" or "No adapter found"

You typo'd a stage or host name. Use `devteam stages` and `devteam hosts` to see what's known.

### `devteam next` says `fix-and-retry`

A stage gate has `status: FAIL`. The blockers are listed in `devteam next`'s output. Address them, re-run the stage, let the new gate overwrite the old one. The orchestrator counts retries via the `retry_number` field; after a few rounds of retry without resolution, the gate should be escalated.

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
- `claude on PATH` ✗ → install Claude Code, or use `--host generic` instead

### Stage gate written but `next` doesn't advance

Run `devteam validate` to see what the validator thinks of your gate. Common causes:

- Missing required field (`orchestrator`, `status`, etc.) → validator exits 1 with the field listed.
- `status: "FAIL"` or `"ESCALATE"` → validator exits 2 or 3; `next` reports `fix-and-retry` or `resolve-escalation`.
- Bypassed escalation — an older gate has `status: ESCALATE` that's still unresolved → validator exits 3 with `BYPASSED ESCALATION`.

### Hooks didn't fire (Claude Code)

The hooks are wired via `.claude/settings.local.json`. Verify:

```bash
cat .claude/settings.local.json | jq .hooks
```

If the file is missing or doesn't have the expected blocks (Stop, SubagentStop, PostToolUse, PreToolUse), re-run `devteam init --host claude-code --force` to overwrite.

### A multi-role stage workstream is stuck

`devteam next` says `continue-stage` with the same role listed in `remaining` over and over. Either:

- The user / subagent hasn't actually run that role's workstream yet — invoke the relevant subagent.
- The workstream wrote its gate to the wrong filename. Expected: `pipeline/gates/<stage>.<role>.json` (dot separator). Check for stray `.<role>-` (hyphen) or absent `.json` extension.

### Secret scanner blocked my write

```
[secret-scan] BLOCKED — found AWS access key in src/lib/aws-client.js
  Suggestion: remove the literal, read from process.env, or .env (gitignored)
```

The PreToolUse hook caught a credential pattern. Three responses:

- **Recommended:** remove the literal, source from env. The scanner exists because credentials in code have bitten teams hard.
- **False positive on a test fixture:** add the marker `devteam-allow-secret: <reason>` on the line above. The hook respects this magic comment.
- **The file lives in a known-safe path** (e.g. `.env.example`, `docs/`, `examples/`, tests): the path allowlist should already cover this. If not, add to `DEVTEAM_SECRET_SCAN_ALLOW` env var.

### Memory commands say "embedder not installed"

```
@huggingface/transformers not installed.
```

Run `npm install` in the Stagecraft framework directory. If you're on CI or in a constrained environment, set `DEVTEAM_EMBEDDING_PROVIDER=stub` to bypass the local model (stub vectors are useless for real retrieval but unblock tests).

### UI won't start — `EADDRINUSE`

Another process is holding the port (likely a previous `devteam ui` invocation you forgot to close). Either kill the old process or pass `--port <something-else>`.

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

Stagecraft versions are tracked in `package.json#version`. Upgrade by pulling the latest framework and re-running init in each target project:

```bash
cd /path/to/stagecraft
git pull && npm install

cd ~/projects/my-app
devteam init --host claude-code --force   # re-render install with new versions
```

The `--force` flag overwrites the installed files. The `.devteam/config.yml` is preserved by default (omit `--force` if you only want to update the agents / rules / skills and keep your config); pass `--force` if you want to regenerate the config too.

Custom edits to the target's installed files (`.claude/agents/`, `.devteam/rules/`, etc.) are lost on re-install — that's by design. **Customize in the framework**, not in target copies. See `CONTRIBUTING.md` for the right place to put each kind of change.

## What's not covered here

- The host-adapter contract — [`core/adapters/host-adapter.md`](../core/adapters/host-adapter.md).
- 11 locked design decisions — [`ARCHITECTURE.md`](../ARCHITECTURE.md).
- Backlog of next ideas — [`docs/BACKLOG.md`](BACKLOG.md).
- Test strategy and what's covered — [`docs/TESTING.md`](TESTING.md).
- A stress-test of the multi-workstream contract — [`docs/walkthroughs/stage-04-split-host.md`](walkthroughs/stage-04-split-host.md).
- The pitch deck — [`docs/presentation-notes.md`](presentation-notes.md).
- Adoption case + objections — [`docs/adoption-guide.md`](adoption-guide.md).
- Common operational questions — [`docs/faq.md`](faq.md).
