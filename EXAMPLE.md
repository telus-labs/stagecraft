# EXAMPLE — One pipeline run, end to end

Walks one feature ("Add SMS notification opt-in to user settings") through the full Stagecraft pipeline. Every command in this doc is real and every output is captured from an actual run.

If you read one doc to learn Stagecraft, read this one.

## Setup

Initialize a target project. We're using a temp dir; in real life this is your project root.

```bash
TARGET=$(mktemp -d)
devteam init --host claude-code --cwd "$TARGET"
```

```
Initializing devteam in: /tmp/example-target
Host(s): claude-code
  ✓ wrote .devteam/config.yml
  ✓ created pipeline/
  ✓ created pipeline/gates/

Installing host adapter: claude-code
  written: 26, skipped: 0

Next: edit .devteam/config.yml if you need custom routing, then `devteam stage requirements --feature "..."`.
```

26 files landed:
- 8 role subagents in `.claude/agents/`
- 1 slash command in `.claude/commands/devteam.md`
- 10 rules docs in `.devteam/rules/`
- 6 task skills in `.claude/skills/`
- 1 `settings.local.json` wiring the hooks

Check what to do next:

```
$ devteam next --cwd "$TARGET"
▶️ run-stage — requirements (stage-01)
   stage not started
   → devteam stage requirements
```

## Stage 1 — PM writes the brief

```bash
devteam stage requirements --cwd "$TARGET" --feature "Add SMS notification opt-in to user settings"
```

The CLI emits a prompt aimed at Claude Code:

```
────────  workstream: pm  (host: claude-code)  ────────

# Stage stage-01 — requirements
Workstream: stage-01 (role: pm, host: claude-code)
Track: full
Feature: Add SMS notification opt-in to user settings

Use the **pm** subagent (`.claude/agents/pm.md`) for this workstream.

## Objective
Turn the feature request into requirements, acceptance criteria, and scope boundaries.

## Read first
- AGENTS.md
- .devteam/rules/pipeline.md
- .devteam/rules/gates.md
- pipeline/context.md

## Allowed writes (enforced by Claude Code hooks at tool-call time)
- pipeline/brief.md
- pipeline/gates/stage-01.json
- pipeline/context.md

## Artifact
Produce `pipeline/brief.md` using `templates/brief-template.md`.

## Gate to write
Write to `pipeline/gates/stage-01.json`. You provide:
```json
{
  "stage": "stage-01",
  "workstream": "pm",
  "status": "PASS|WARN|FAIL|ESCALATE",
  ...
  "acceptance_criteria_count": 0,
  "out_of_scope_items": [],
  "required_sections_complete": false
}
```
The orchestrator adds `"orchestrator": "devteam@0.1.0"` and `"host": "claude-code"` at validation time.
```

Inside Claude Code, the PM subagent reads the brief template, drafts `pipeline/brief.md`, and writes the gate. The Stop hook fires the validator. PASS:

```
[gate-validator] ✅ GATE PASS — stage-01/pm (claude-code)
```

`devteam next` advances:

```
$ devteam next --cwd "$TARGET"
▶️ run-stage — design (stage-02)
   stage not started
   → devteam stage design
```

## Stages 2 and 3 — Design and clarification

Same shape: Principal drafts `pipeline/design-spec.md` and any ADRs; PM resolves any clarification questions. Each writes its gate; the validator hook accepts each; `next` walks forward.

```
$ devteam next --cwd "$TARGET"
▶️ run-stage — build (stage-04)
   multi-role stage not started
   → devteam stage build
```

## Stage 4 — Build (multi-role: 4 workstreams)

This is where the multi-workstream contract pays off. `stage-04` has four roles: `backend, frontend, platform, qa`. The orchestrator decomposes into one prompt per role.

```bash
devteam stage build --cwd "$TARGET" --feature "Add SMS notification opt-in"
```

Four sections come out, each pointing at a different subagent. Excerpt of the backend workstream:

```
────────  workstream: backend  (host: claude-code)  ────────

# Stage stage-04 — build
Workstream: stage-04.backend (role: backend, host: claude-code)
Track: full
Feature: Add SMS notification opt-in

Use the **dev-backend** subagent (`.claude/agents/dev-backend.md`) for this workstream.

## Allowed writes (enforced by Claude Code hooks at tool-call time)
- src/backend/
- src/tests/
- pipeline/pr-backend.md
- pipeline/build-plan.md
- pipeline/gates/stage-04.backend.json
- pipeline/context.md

## Gate to write
Write to `pipeline/gates/stage-04.backend.json`.
```

Note the per-role `allowedWrites` — backend can write `src/backend/` and `src/tests/` but **not** `src/frontend/`. Frontend's workstream gets the symmetric narrow set. The Claude Code hooks enforce this at tool-call time, not just in the prompt.

Each dev workstream produces:
- A PR summary (`pipeline/pr-<role>.md`)
- Their own workstream gate at `pipeline/gates/stage-04.<role>.json`

After all four workstreams finish, `devteam next` reports:

```
$ devteam next --cwd "$TARGET"
🔀 merge — build (stage-04)
   all workstreams complete; merge to produce stage gate
   → devteam merge build
```

`devteam merge build` aggregates them:

```
$ devteam merge build --cwd "$TARGET"
Merged → /tmp/.../pipeline/gates/stage-04.json (status: PASS)
```

The merged stage gate carries the contributing workstreams:

```json
{
  "stage": "stage-04",
  "status": "PASS",
  "orchestrator": "devteam@0.1.0",
  "track": "full",
  "timestamp": "2026-05-26T20:00:00Z",
  "blockers": [],
  "warnings": [],
  "workstreams": [
    { "workstream": "backend",  "host": "claude-code", "status": "PASS" },
    { "workstream": "frontend", "host": "claude-code", "status": "PASS" },
    { "workstream": "platform", "host": "claude-code", "status": "PASS" },
    { "workstream": "qa",       "host": "claude-code", "status": "PASS" }
  ]
}
```

Aggregate status follows `ESCALATE > FAIL > WARN > PASS`. If any workstream had FAILed, the stage gate would be FAIL.

## Stage 4a — Pre-review (Platform)

Platform runs lint, tests, dependency review, and the security-trigger heuristic. The gate carries `security_review_required: true | false`.

```json
{
  "stage": "stage-04a",
  "workstream": "platform",
  "host": "claude-code",
  ...
  "lint_passed": true,
  "tests_passed": true,
  "dependency_review_passed": true,
  "security_review_required": true
}
```

For an SMS opt-in feature that touches auth and PII paths, the heuristic fires. `next` routes to the conditional security review:

```
$ devteam next --cwd "$TARGET"
▶️ run-stage — security-review (stage-04b)
   stage not started
   → devteam stage security-review
```

(If the heuristic had not fired — `security_review_required: false` — `next` would silently skip stage-04b and advance to peer-review.)

## Stage 4b — Conditional security review

Conditional dispatch via the `conditionalOn: { stage: "stage-04a", field: "security_review_required", equals: true }` declaration on the stage.

The security subagent reviews; gate carries `security_approved` and `veto` flags. `veto: true` halts the pipeline regardless of any subsequent stage's approvals.

## Stage 5 — Peer review (4 area workstreams, derived from review files)

Peer-review has the same multi-workstream shape as build, but the **workstreams are areas being reviewed** (backend / frontend / platform / qa). All four dispatch to the same `reviewer` subagent (via `subagent: "reviewer"` on the stage).

Reviewers write per-area sections in their review files. The PostToolUse hook (`approval-derivation.js`) fires on every save, parses the file, and upserts the per-area workstream gates.

```bash
# Reviewer A writes pipeline/code-review/by-backend.md:
```

```markdown
# Review by backend

## Review of frontend
Form layout looks good, ARIA labels present, error states clear.
REVIEW: APPROVED

## Review of platform
Deploy steps documented in runbook.
REVIEW: APPROVED
```

```bash
# Reviewer B writes pipeline/code-review/by-frontend.md:
```

```markdown
# Review by frontend

## Review of backend
API surface clean. Validation symmetrical with the frontend.
REVIEW: APPROVED

## Review of platform
Smoke-test runbook references the wrong endpoint.
REVIEW: CHANGES REQUESTED
BLOCKER: pipeline/runbook.md §Smoke test mentions /api/sms but endpoint is /api/v2/sms
```

The hook runs on each write and reports:

```
[approval-derivation] dev-backend → APPROVED on frontend (approvals: 1/2, status: FAIL)
[approval-derivation] dev-backend → APPROVED on platform (approvals: 1/2, status: FAIL)
[approval-derivation] dev-frontend → APPROVED on backend (approvals: 1/2, status: FAIL)
[approval-derivation] dev-frontend → CHANGES_REQUESTED on platform (approvals: 1/2, status: FAIL)
```

Three area gates exist (`stage-05.frontend.json`, `stage-05.platform.json`, `stage-05.backend.json`); the qa area has no review yet, and the platform area has a blocker. `next` reflects state:

```
$ devteam next --cwd "$TARGET"
⏳ continue-stage — peer-review (stage-05)
   3/4 workstreams complete
   completed: frontend, platform, backend
   remaining: qa
   → devteam stage peer-review  # roles still pending: qa
```

After a fourth reviewer covers qa and the platform blocker is addressed (a second reviewer flips it from CHANGES_REQUESTED to APPROVED, bumping each area to 2/2 approvals), the area gates all PASS. `devteam merge peer-review` produces the stage-05 gate.

## Stages 6, 7, 8, 9 — Tests, sign-off, deploy, retrospective

Same shape as the others; nothing structurally new.

- **Stage 6 (QA)** writes `pipeline/test-report.md` and a gate carrying `all_acceptance_criteria_met` and the 1:1 criterion-to-test mapping.
- **Stage 7 (PM + Platform)** is the sign-off stage. The orchestrator can auto-fold this gate when Stage 6 reports `all_acceptance_criteria_met: true` AND a 1:1 mapping — see `rules/gates.md` §Stage 07.
- **Stage 8 (Platform)** runs the deploy adapter. The adapter (`core/deploy/<name>.md`) names the deploy procedure; gate carries `deploy_adapter`, `smoke_test_passed`, `runbook_referenced`. Do **not** auto-rollback on FAIL — the runbook names the rollback and a human decides.
- **Stage 9 (Principal)** synthesizes the retrospective. Harvests `PATTERN:` lines from Stage 5 reviews; promotes ≤2 rules into `pipeline/lessons-learned.md`; auto-ages out rules that haven't been reinforced in 10 runs.

When all stages PASS:

```
$ devteam next --cwd "$TARGET"
🎉 pipeline-complete
   all stages PASS or WARN (track: full)
```

## What the gates look like, end-to-end

After a successful full-track run, `pipeline/gates/` contains:

```
pipeline/gates/
├── stage-01.json              # PM brief
├── stage-02.json              # Principal design
├── stage-03.json              # PM clarification
├── stage-04.json              # merged build (4 workstreams)
├── stage-04.backend.json
├── stage-04.frontend.json
├── stage-04.platform.json
├── stage-04.qa.json
├── stage-04a.json             # Platform pre-review
├── stage-04b.json             # (only if security_review_required)
├── stage-05.json              # merged peer-review (4 area workstreams)
├── stage-05.backend.json
├── stage-05.frontend.json
├── stage-05.platform.json
├── stage-05.qa.json
├── stage-06.json              # QA test report
├── stage-07.json              # sign-off
├── stage-08.json              # deploy
└── stage-09.json              # retrospective
```

Every gate carries the contract F identity fields. Every multi-role stage has a workstream gate per area plus the merged stage gate. The whole pipeline is auditable from these files alone — the orchestrator never holds state outside of them.

## What this example didn't show

- **Multi-host routing.** This example installed only `claude-code`. To run backend on Codex and the rest on Claude Code, install both (`devteam init --host claude-code,codex`) and edit `.devteam/config.yml`:
  ```yaml
  routing:
    default_host: claude-code
    roles:
      backend: codex
  ```
  Then `devteam stage build` produces 4 prompts, with the backend workstream pointing at `.codex/prompts/roles/backend.md` and the rest pointing at `.claude/agents/dev-*.md`.

- **Headless invocation.** `devteam stage build --headless` would drive each workstream's host CLI non-interactively (`claude --print` for claude-code workstreams, `codex exec` for codex). Per-workstream exit codes + gate paths get reported in the summary.

- **Track shortcuts.** `devteam init` defaults `pipeline.default_track: full`. For a config-only change, edit that to `config-only` and `devteam next` walks a different stage list.

- **FAIL / ESCALATE branches.** A FAIL gate gives `❌ fix-and-retry` with blockers listed; an ESCALATE gate gives `🚨 resolve-escalation` with the reason. Both halt `next` until the situation is resolved.

## Where to go next

- [`README.md`](README.md) — CLI surface, install layout.
- [`docs/concepts.md`](docs/concepts.md) — vocabulary.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — design model + the 11 locked decisions.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — extension recipes (adapter, stage, role, skill).
- [`docs/walkthroughs/stage-04-split-host.md`](docs/walkthroughs/stage-04-split-host.md) — the stress-test trace that locked the multi-workstream contract.
