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
   (loop for 15 more stages on the full track)

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
9. [Multi-model peer review](#multi-model-peer-review)
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
│   └── rules/                  ← 10 top-level rule docs + per-stage stage-NN.md files
├── .claude/                    ← (or .codex/, .gemini/, depending on host)
│   ├── agents/                 ← 12 role subagents
│   ├── skills/                 ← 13 task helpers (implement, review-rubric, …)
│   ├── commands/               ← /devteam, /audit, /audit-quick (claude-code only)
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

### What is a gate?

A **gate** is a JSON file the model writes to `pipeline/gates/` at the end of each stage. It's the contract between stages: the orchestrator reads it to decide whether the pipeline can advance, and the validator checks it for correctness. Required fields on every gate:

```json
{
  "stage": "stage-01",
  "workstream": "pm",
  "status": "PASS",
  "track": "full",
  "timestamp": "2026-05-01T12:00:00Z",
  "orchestrator": "devteam@0.4.0",
  "host": "claude-code",
  "blockers": [],
  "warnings": []
}
```

`orchestrator` and `host` are auto-injected by the validator — the model doesn't need to write them. Stage-specific fields (like `acceptance_criteria_count` or `security_approved`) are documented in each stage's schema under `core/gates/schemas/`.

**Gate statuses:**
- **PASS** — stage complete; pipeline advances.
- **WARN** — stage complete with concerns; pipeline advances but the warning is preserved in the merged gate.
- **FAIL** — stage did not meet its criteria; `devteam next` returns `fix-and-retry`. The `blockers[]` array explains what must be fixed. Re-run the stage; the new gate overwrites the old one.
- **ESCALATE** — a human decision is required before the pipeline can advance (e.g. the model isn't confident enough to PASS or FAIL; the change scope grew; a security finding is ambiguous). The pipeline halts until you resolve it — see [resolve-escalation](#devteam-next-says-resolve-escalation).

You can hand-edit a gate file if the model got something wrong. Just keep the required fields and write valid JSON — the validator will tell you what's missing.

### `devteam next` actions explained

After every stage's gate is written, `devteam next` inspects `pipeline/gates/` and returns one of:

| Action | Meaning | What to do |
|---|---|---|
| `run-stage` | Stage not started | `devteam stage <name> [--headless]` |
| `continue-stage` | Multi-role stage partly done — some workstreams still pending | Run the remaining role's workstream |
| `merge` | All workstreams of a multi-role stage done, no merged gate yet | `devteam merge <stage>` |
| `fix-and-retry` | Merged gate (or single-role gate) has `status: FAIL` | Address the blockers, re-run the stage |
| `resolve-escalation` | Gate has `status: ESCALATE` | Read `escalation_reason`, make the call, rewrite the gate |
| `pipeline-complete` | All stages in the track have PASS or WARN | Done |

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

### Conditional stages

Some stages only run when a preceding stage's gate sets a specific flag. The orchestrator checks these automatically — `devteam next` silently skips a conditional stage whose condition isn't met and moves on.

| Stage | Condition |
|---|---|
| 4b — Security review | `stage-04a.security_review_required: true` (set by pre-review heuristic when auth/crypto/PII/secret/infra patterns are found) |
| 4d — Migration safety | `stage-04a.migration_safety_required: true` (set when the diff touches schema files, migration directories, or DDL fragments) |

All other stages run unconditionally on their track. If you want to verify whether a conditional stage will run for your current diff, inspect the pre-review (stage-04a) gate after it's written.

### Per-stage details

- **Stage 1 — Requirements (PM).** PM writes `pipeline/brief.md` from `templates/brief-template.md`. Gate carries `acceptance_criteria_count`, `out_of_scope_items`, `required_sections_complete`.

- **Stage 2 — Design (Principal).** Principal writes `pipeline/design-spec.md` and any ADRs under `pipeline/adr/`. Gate carries `arch_approved`, `pm_approved`, `adr_count`.

- **Stage 3 — Clarification (PM).** Resolves any open questions from design before build starts. Skipped on `quick` and `nano` tracks.

- **Stage 3b — Executable spec (PM, G2).** Runs on `full` + `quick` after clarification. PM translates each numbered `AC-N` in `pipeline/brief.md` into one Gherkin scenario in `pipeline/spec.feature`, tagged `@AC-N`. Use `devteam spec generate` to scaffold the file from the brief (one tagged Scenario per AC with TODO Given/When/Then placeholders) and `devteam spec verify` to drift-check brief.md ↔ spec.feature ↔ test-report.md. Gate carries `criteria_count`, `scenarios_count`, the full `criteria_to_scenario_mapping` array, `all_criteria_mapped`, and `drift`. PASS requires `drift: false` AND `all_criteria_mapped: true`. The .feature file becomes the canonical contract that QA's tests must map to in stage-06.

- **Stage 4 — Build (4 workstreams).** Backend / Frontend / Platform / QA each write to their owned source dir and produce a PR summary. **Each workstream sees a narrower `allowedWrites`** — backend cannot write `src/frontend/`. Per-workstream gates at `pipeline/gates/stage-04.<role>.json`; `devteam merge build` aggregates.

- **Stage 4a — Pre-review (Platform).** Lint, type-check, dep review, security heuristic. Gate carries `lint_passed`, `tests_passed`, `dependency_review_passed`, `security_review_required`. The last flag conditionally triggers Stage 4b.

- **Stage 4b — Security review (Security, conditional).** Runs only when `stage-04a.security_review_required` is `true`. Gate carries `security_approved`, `veto`, `triggering_conditions`. **A `veto: true` halts the pipeline regardless of any subsequent approvals.**

- **Stage 4c — Red team (Red Team, always-on for full + hotfix).** Adversarial-by-design review of the build. Walks 10 attack surfaces (input boundaries / state / sequence / integrations / auth edges / resource exhaustion / failure modes / abuse cases / downstream effects / observability gaps) and produces concrete reproducers. Triages each by severity × likelihood × scope. Gate carries `surfaces_walked`, `findings_count`, `severity_breakdown`, `must_address_before_peer_review`, `noted_for_followup`. Non-empty `must_address_before_peer_review` → FAIL; implementer addresses, re-runs build, red-team re-runs, eventually PASS. **Route red-team to a DIFFERENT host than your build agents** (`routing.roles.red-team` in `.devteam/config.yml`) — adversarial review is most valuable when the reviewer has different blind spots than the builder. Distinct from Stage 4b (narrower remit, conditional, veto) and Stage 5 (general code review).

- **Stage 4d — Migration safety (Migrations role, conditional, has veto).** Runs only when `stage-04a.migration_safety_required` is `true` — the pre-review heuristic in `core/guards/migration-heuristic.js` fires on schema files, migration directories, or files containing DDL fragments (ALTER/CREATE/DROP TABLE). Reviewer answers six questions about the migration: what it does, breaking-change classification, backfill strategy (when required), dual-write strategy (when required), rollback plan, and whether the rollback was tested. Gate carries those plus `migration_files`, `migration_approved`, `veto`. **Veto criteria (auto-set when met)**: empty `rollback_plan`, untested rollback on a `breaking_change`, missing `backfill_strategy` when `backfill_required`. Peer-review approvals CANNOT override a veto — the migrations role must personally re-review the fix. Route to a different host than the build agents.

- **Stage 5 — Peer review (4 area workstreams via reviewer subagent).** All 4 workstreams (one per area being reviewed) dispatch to the *same* reviewer subagent. Reviewers write per-area sections in `pipeline/code-review/by-<reviewer>.md`. The PostToolUse hook (`approval-derivation.js`) parses `REVIEW: APPROVED` / `REVIEW: CHANGES REQUESTED` markers and upserts the per-area gates. **Don't write the gates manually** — let the hook do it.

- **Stage 6 — Tests (QA).** QA runs the test suite, writes `pipeline/test-report.md`. Gate carries `all_acceptance_criteria_met`, `tests_total/passed/failed`, `criterion_to_test_mapping_is_one_to_one`. The last flag enables Stage 7 auto-fold.

- **Stage 6b — Accessibility audit (QA).** WCAG audit on UI changes via axe-core / pa11y / Lighthouse / manual. Gate carries `audit_method`, `wcag_level`, `violations` (critical / serious / moderate / minor), `components_audited`. PASS requires 0 critical AND 0 serious. Skip with `audit_skipped_reason` for backend-only changes.

- **Stage 6c — Observability gate (Platform).** Verifies that every metric / log / trace promised by brief §9 is actually emitted in the shipped code. Gate carries `metrics` / `logs` / `traces` each with `{required[], verified[], gap[]}`. PASS requires every `gap` empty. Weak verification methods (`code-grep` only) PASS with WARN; the gold standard is `runtime-probe`.

- **Stage 6d — Verification beyond tests (Verifier, full-only, G7).** Runs AFTER stage-06 (qa) PASS. New `verifier` role applies property-based testing (fast-check / hypothesis / proptest), mutation testing (stryker / mutmut / mull), and/or formal verification (TLA+ / Alloy / Lean) to the changed code. Read-only on production code; writes property tests under `src/tests/property/` and formal specs under `pipeline/formal/`. Gate carries `methods_attempted[]`, `methods_skipped[{method, reason}]`, `candidates_inventoried`, per-method stats (`property_based` / `mutation` / `formal`), `findings_count`, `blocking_findings[]`. **A surviving mutant on a critical path, a property counterexample to a stated invariant, or a formal counterexample to a safety property → FAIL.** Tooling not installed → method is `attempted_but_blocked:<method>` (recorded honestly, surfaces a warning). Track inclusion: `full` only — the heavy stuff opted into rigour-over-speed; other tracks rely on stage-06 example tests as their verification floor. See `skills/verification-beyond-tests/SKILL.md` for the five-phase procedure and `roles/verifier.md` for the role contract.

- **Stage 7 — Sign-off (PM + Platform).** PM signs off on QA results; Platform prepares `pipeline/runbook.md`. **Auto-fold:** if Stage 6 reports `all_acceptance_criteria_met: true` AND `criterion_to_test_mapping_is_one_to_one: true`, the orchestrator writes Stage 7's gate automatically with `auto_from_stage_06: true` — you don't run Stage 7 manually. This is intentional: if QA proved every criterion was met with a 1:1 test, sign-off is automatic. If you run Stage 6 and then see Stage 7 already has a gate, that's why.

- **Stage 8 — Deploy (Platform, adapter-driven).** Platform reads `.devteam/config.yml`'s `deploy.adapter` setting, follows `core/deploy/<adapter>.md`. **Do not auto-rollback on FAIL** — the runbook names the rollback procedure; a human decides whether to roll back or investigate.

- **Stage 9 — Retrospective (Principal).** Principal harvests `PATTERN:` lines from Stage 5 reviews, promotes ≤2 rules into `pipeline/lessons-learned.md`, ages out rules that haven't been reinforced in 10 runs.

## Multi-host setups

### What "host" means

A *host* is the AI coding CLI that Stagecraft hands work to: Claude Code (`claude`), Codex CLI (`codex`), or Gemini CLI (`gemini`). Stagecraft never calls a model API directly. It renders a stage prompt and pipes it to the host, which manages the model invocation, tool permissions, and output capture itself.

**Host and model are two different things.** Which host you route to determines which CLI runs. Which model *that CLI uses* is configured inside the host — not in Stagecraft. For Claude Code, the `model:` field in each agent file (`.claude/agents/<role>.md`) controls this. For Codex and Gemini, it's their own settings.

This distinction matters when you're optimizing cost or comparing model quality: you can run Opus for some roles and Sonnet for others without changing hosts at all, purely by editing the agent frontmatter. You only need multiple hosts when you want to mix CLIs — Claude Code for some roles, Codex for others.

### Why use multiple hosts?

**Cost.** Opus-class models cost roughly 5× more per token than Sonnet. Multi-host lets you route expensive models only to the roles that justify the price — typically Principal, Security, and Red-team for their reasoning demands — and cheaper models for the bulk of implementation work. Net cost on a full pipeline run typically drops 30–50%.

**Model diversity.** Different models have different blind spots. A bug Claude rationalizes as acceptable, Codex or Gemini might flag. Routing specific roles to specific models captures independent opinions without manual effort. The formalized version of this — where every code-review area runs on all configured hosts in parallel — is [multi-model peer review](#multi-model-peer-review). Neither of these happens automatically: red-team routes to `default_host` unless you add a `roles: red-team:` override, and multi-model peer review is off unless you set `review_fanout`.

**Tool fit.** Claude Code is strong on design, complex review, and reasoning about architecture. Codex CLI is fast at backend implementation. Gemini CLI is inexpensive for pattern-matching tasks like QA. Use the right tool for the job.

### Setting up multiple hosts

Install both adapters in one command:

```bash
devteam init --host claude-code,codex
```

What this does, in sequence, for each host:
- Lays down its role prompt files (`.claude/agents/` for claude-code, `.codex/prompts/roles/` for codex)
- Installs slash commands, hooks, rules, and skills where the host supports them
- Skips files already written by an earlier host in the list (rules in `.devteam/rules/` are shared between hosts and only written once)

The config file (`.devteam/config.yml`) is written once, with the first host as the default:

```yaml
routing:
  default_host: claude-code
```

**Installing both hosts does not automatically split work between them.** Until you edit the config, every stage routes to `default_host` — in this case, claude-code. Codex's installed files sit on disk unused. The pipeline behaves identically to `devteam init --host claude-code` until you add `roles:` or `stages:` overrides.

### Configuring routing

Edit `.devteam/config.yml` to override the default for specific roles or stages:

```yaml
routing:
  default_host: claude-code        # fallback for anything not matched below

  roles:
    backend: codex                 # backend workstream → Codex CLI
    frontend: codex
    platform: codex
    qa: codex
    # principal, security, pm, red-team, migrations → claude-code (inherits default)

  stages:
    stage-08: claude-code          # deploy always on claude-code, regardless of role
```

Routing precedence: **`stages` → `roles` → `default_host`**. The stage-level override is useful for stages where a specific host is required regardless of which role is dispatched there — for example, always running deploy on the host whose agent has deployment credentials.

When a stage with multiple workstreams runs, each workstream is independently routed. `devteam stage build` (four workstreams: backend, frontend, platform, QA) with the config above routes all four to Codex. `devteam stage design` (Principal role) routes to Claude Code. The gate merge is host-agnostic — the orchestrator reads JSON files, and the merged gate's `workstreams[]` array records `"host"` per row so you can see which CLI handled what.

### Choosing models within a single host

If you're using only Claude Code and want different models per role, you don't need multi-host at all. The installed agent files already have model tiers set:

```yaml
# .claude/agents/principal.md  (written by devteam init)
---
name: principal
model: opus          # claude-opus — architecture rulings, design sign-off
---
```

```yaml
# .claude/agents/dev-backend.md
---
name: dev-backend
model: sonnet        # claude-sonnet — implementation
---
```

To change a model for a specific role, edit that agent file directly. Re-running `devteam init --host claude-code --force` regenerates all agent files from the framework defaults, so keep custom model overrides in mind if you re-init.

For Codex and Gemini, model selection is handled in those tools' own configuration files, outside Stagecraft.

### Common configurations

**Cost-optimized: Opus for reasoning, Codex for implementation**

This is the most common split. Claude Code runs the roles that require sustained reasoning (Principal, Security, Red-team, PM). Codex runs the high-volume implementation and QA workstreams.

```yaml
routing:
  default_host: claude-code     # principal, security, pm, red-team, migrations
  roles:
    backend: codex
    frontend: codex
    platform: codex
    qa: codex
```

**Locked deploy: implementation on one host, deploy always on another**

Useful when your deploy host needs specific credentials or tool permissions that other workstreams shouldn't have.

```yaml
routing:
  default_host: codex
  stages:
    stage-08: claude-code       # deploy on claude-code; everything else on codex
```

**Adversarial peer review: run every review area on multiple models simultaneously**

`review_fanout` defaults to an empty list — Stage 5 runs as a single-host review on `default_host` unless you opt in:

```yaml
routing:
  default_host: claude-code
  review_fanout: [claude-code, codex, gemini-cli]
```

With three hosts and four review areas, Stage 5 produces 12 parallel workstreams. Any FAIL from any model on any area blocks the stage. See [Multi-model peer review](#multi-model-peer-review) for the full picture.

### Multi-host in headless mode

Headless mode (`--headless`) works normally in multi-host setups. Each workstream spawns its own host CLI process; they run concurrently within a stage. Every host you route work to must support headless (all three shipped adapters do). In an unattended pipeline loop, mixed-host stages produce gates through the same seam and advance the pipeline normally.

### When single-host is the right call

- **Your team only has one CLI installed.** Multi-host requires authenticating each CLI separately. If everyone uses Claude Code, there's no upside.
- **Debugging costs.** When a multi-host stage fails, the first question is "which model caused this?" That's an extra diagnostic step. Single-host failures are easier to attribute.
- **Spend visibility.** Two CLIs mean two billing accounts. Per-stage cost attribution across hosts requires correlating two dashboards.

Default to single-host. Add a second host when you have a specific cost, diversity, or tool-fit reason that justifies the extra setup.

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

### Running the full pipeline unattended

Loop `devteam next --json` to advance through stages automatically. The loop halts on FAIL, ESCALATE, or anything that needs a human decision:

```bash
while true; do
  read -r action name < <(devteam next --json | jq -r '[.action, .name // ""] | @tsv')
  case "$action" in
    run-stage)        devteam stage "$name" --headless ;;
    pipeline-complete) echo "Pipeline complete"; break ;;
    *)                echo "Needs human: $action${name:+ ($name)}"; break ;;
  esac
done
```

`devteam next --json` returns `action: "fix-and-retry"` on FAIL and `action: "resolve-escalation"` on ESCALATE — both fall through to the `*)` branch and halt the loop. MERGE stages (`action: "merge"`) also halt; run `devteam merge <stage>` and re-enter the loop.

To handle merge automatically:

```bash
while true; do
  read -r action name < <(devteam next --json | jq -r '[.action, .name // ""] | @tsv')
  case "$action" in
    run-stage)         devteam stage "$name" --headless ;;
    merge)             devteam merge "$name" ;;
    pipeline-complete) echo "Pipeline complete"; break ;;
    *)                 echo "Needs human: $action${name:+ ($name)}"; break ;;
  esac
done
```

### Scoped re-runs after red-team FAIL (--patch)

When red-team FAILs, running a full build re-run risks touching unrelated code and introducing new findings. `--patch` scopes build agents to only the items in the failed stage's `must_address_before_peer_review` list:

```bash
devteam stage build --patch --from red-team --headless
```

The flag reads `pipeline/gates/stage-04c.json`, extracts the blockers, and injects a **PATCH MODE** section at the top of the prompt — before the objective — so agents see exactly what to fix and are instructed not to touch anything else.

`--from` defaults to `red-team` and accepts any stage name. The gate for that stage must already exist in `pipeline/gates/`.

Note: when red-team writes a FAIL gate, the validator automatically writes the blockers into `pipeline/context.md` (between `<!-- devteam:red-team-blockers:begin -->` markers) so they persist across re-runs. `--patch` reads from the gate itself and is additive — you get both the context.md signal and the explicit prompt scope.

After the patch build, continue the usual chain:

```bash
devteam stage pre-review --headless
devteam stage security-review --headless   # if still required
devteam stage red-team --headless          # verifies fixes
```

### Fixing QA failures within build

When QA's workstream gate within Stage 4 is FAIL, the bugs belong to the other build roles — typically backend or platform. The validator automatically writes the QA blockers into `pipeline/context.md` (between `<!-- devteam:qa-build-blockers -->` markers) so implementation agents see them on the next re-run.

**Step 1 — Delete the affected gates.** Leave passing workstreams' gates on disk; `--skip-completed` will skip those automatically.

```bash
rm pipeline/gates/stage-04.backend.json   # owns the express.static bug
rm pipeline/gates/stage-04.platform.json  # owns the Dockerfile bug
rm pipeline/gates/stage-04.qa.json        # QA must re-verify after fixes
rm pipeline/gates/stage-04.json           # merged gate must be rebuilt
```

**Step 2 — Re-run with `--patch` and `--skip-completed`.**

```bash
devteam stage build --patch --from stage-04.qa --skip-completed --headless
devteam merge build
devteam next
```

`--patch --from stage-04.qa` reads the QA gate's `blockers[]` and injects a **PATCH MODE** section at the top of each dispatched prompt, telling agents to fix only the listed items. `--skip-completed` skips dispatching any workstream whose gate file already exists — so frontend, which passed, never gets re-run.

The agents see: the QA blockers already in `context.md` (written by the validator when QA's gate was first validated), plus the explicit PATCH MODE list in the prompt. Both signals reinforce the same fix targets.

**Manual alternative.** If you need to direct the bugs more explicitly than the auto-injected blockers allow, edit `pipeline/context.md` before re-running to add role-specific instructions:

```markdown
## QA findings — build re-run required

**dev-backend** must fix:
- `express.static` points to `public/` which doesn't exist; frontend is at `src/frontend/`

**dev-platform** must fix:
- Dockerfile CMD references `src/server.js`; server is at `src/backend/server.js`
```

Then re-run as above. The manual additions and the auto-injected blocker block coexist in `context.md`.

### Headless timeout

The default headless timeout is 10 minutes per workstream. Slow stages (red-team, verification-beyond-tests) can exceed this. Pass `--timeout-ms` to override:

```bash
devteam stage red-team --headless --timeout-ms 1800000   # 30 min
devteam stage red-team --headless --timeout-ms 0          # no cap
```

The timeout is per workstream, not per stage — a multi-role stage with three parallel workstreams gets 3 × N ms total wall-clock.

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

## Multi-model peer review

Opt-in: have Stage 5 (peer-review) run across multiple hosts simultaneously. Each area gets reviewed by every configured host; the merged gate is pessimistic. The reviewers all apply the same four-principles rubric — the cross-model signal comes from training-data diversity, not from giving different reviewers different methods. (For *method* diversity — a different role applying a different methodology — see Stage 4c red-team.)

```yaml
# .devteam/config.yml
routing:
  default_host: claude-code
  review_fanout: [claude-code, codex, gemini-cli]
```

With three hosts and four review areas, you get 4×3 = 12 parallel reviews. The approval-derivation hook recognizes host-based filenames (`pipeline/code-review/by-<host>.md`) and writes gates to a three-segment path (`pipeline/gates/stage-05.<area>.<host>.json`). The merge reads all expected fanout gates and aggregates pessimistically — any FAIL anywhere → merged FAIL.

Default is empty list (off). Opt in via config. The cost is N× peer-review time and N× peer-review LLM cost. The benefit: different models have different blind spots; a bug one model rationalizes, another flags.

## Auditing a codebase

The audit feature is separate from the 17-stage pipeline. Stages *build* features; the audit *analyzes* an existing codebase and produces a prioritized improvement roadmap. Read-only by design.

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

### What the output actually looks like

Stagecraft was audited with this feature against its own codebase on **2026-05-28** as a dogfood run. The 11 phase output files (plus `status.json`) are committed at [`docs/audit/`](audit/) in this repo — read them to see what `/audit` produces, not a synthetic example. Highlights:

- **[`docs/audit/00-project-context.md`](audit/00-project-context.md)** — what Stagecraft is, ~150 lines.
- **[`docs/audit/01-architecture.md`](audit/01-architecture.md)** — component inventory, dependency graph, data flow, configuration surface. ~330 lines, the longest output.
- **[`docs/audit/06-security.md`](audit/06-security.md)** — security findings. Includes a real "verify before promoting" lesson: a Finding S5 was initially promoted to "medium severity / needs fix" based on the route signature, then **retracted** when a live curl exploit attempt returned HTTP 404. The verification + retraction is preserved in the file — this is the discipline the audit skill now codifies (see `skills/audit/SKILL.md` § Process discipline).
- **[`docs/audit/10-roadmap.md`](audit/10-roadmap.md)** — sequenced batches with effort estimates. The self-audit identified 0 P0 items, 5 P1 quick wins, 5 P2 targeted items, 1 P3 strategic item.

Every finding in those files cites file paths and line numbers; severity / effort / confidence ratings are concrete; the verification trace for retracted findings is preserved. That's the standard the skill demands of the output — Stagecraft's own audit met it.

### What the audit does NOT do

- It does not modify source code. Findings live in `docs/audit/`; fixing them is the `implement` skill or a `devteam stage` invocation.
- It does not audit Stagecraft itself unless you explicitly ask. The audit targets the project Stagecraft was installed into.
- It does not skip phases without a documented reason in `status.json`.

## When things go wrong

### "Unknown stage" or "No adapter found"

You typo'd a stage or host name. Use `devteam stages` and `devteam hosts` to see what's known.

### `devteam next` says `fix-and-retry`

A stage gate has `status: FAIL`. The blockers are listed in `devteam next`'s output. Address them, re-run the stage, let the new gate overwrite the old one.

If you re-run the same stage more than once without resolution, the model should increment `retry_number` and fill `this_attempt_differs_by` — a non-empty string describing what changed between this attempt and the last. The validator enforces this: a gate with `retry_number >= 1` and an empty or missing `this_attempt_differs_by` is rejected. This prevents silent retry loops where the model just writes the same failing gate again.

If you've retried several times without progress, consider writing a gate with `status: ESCALATE` — it means "a human decision is needed" rather than "fix the code and retry."

### `devteam next` says `resolve-escalation`

A stage gate has `status: ESCALATE`. Use escalation when:
- The model can't determine PASS or FAIL without human input (e.g. an ambiguous security finding)
- The change scope has grown beyond what the brief covers and a human must decide whether to re-scope or proceed
- A veto-capable stage (security review, migration safety) found a concern that needs human judgement

The pipeline cannot advance until you resolve it. The summary is: read the gate's `escalation_reason` and `decision_needed`, make the call, then either rewrite the gate to `PASS`/`WARN`/`FAIL` or use `devteam restart <stage>` to clear it and re-run the originating stage.

For the full procedure — what to read in what order, how to invoke the Principal role for a binding ruling, how to encode must-fix vs defer decisions, common gotchas — see **[`docs/runbooks/escalation.md`](runbooks/escalation.md)**. That's the operational playbook; this section is the one-paragraph version.

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

### Skipping specific stages

If a stage is consistently slow, not relevant to your project type, or you want to defer it, add it to `pipeline.skip_stages` in `.devteam/config.yml`:

```yaml
pipeline:
  default_track: full
  skip_stages:
    - red-team
```

Skipped stages are silently passed over by `devteam next` and shown as `skipped (pipeline.skip_stages)` in `devteam summary`. No gate file is required. The skip applies to all runs in the project — use `--track` for per-run exclusions instead.

Note that `skip_stages` accepts stage names (e.g. `red-team`, `verification-beyond-tests`), not stage IDs (e.g. `stage-04c`). Run `devteam stages` to see valid names.

### Controlling token cost

Each stage prompt is sized mainly by three things you control:

**1. `pipeline/context.md` size.** This file is in the `readFirst` list for almost every stage. Every question, answer, and concern you append accumulates. On a long project it can exceed 200 lines and add thousands of tokens across a full run. Prune it between features — keep the last few decisions and trim history that's already reflected in the code.

**2. Role routing.** Opus costs ~5× more per token than Sonnet, and Sonnet costs more than Haiku. Assign expensive models only to the roles that need them: Principal and Security for architecture rulings, Sonnet or cheaper for build workstreams. See [Multi-host setups](#multi-host-setups).

**3. Stage selection.** Stages like `verification-beyond-tests` and `red-team` spawn long-running Opus agents. Use `skip_stages` or `--track quick` to skip them on incremental changes where the risk profile is low.

```yaml
# .devteam/config.yml
pipeline:
  skip_stages:
    - verification-beyond-tests  # skip on UI-only changes
```

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
- A full 17-stage showcase (SOC 2 evidence collector) — [`docs/walkthroughs/soc2-evidence-collector.md`](walkthroughs/soc2-evidence-collector.md).
- The pitch deck — [`docs/presentation-notes.md`](presentation-notes.md).
- Adoption case + objections — [`docs/adoption-guide.md`](adoption-guide.md).
- Common operational questions — [`docs/faq.md`](faq.md).
