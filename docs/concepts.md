# Concepts

One-sentence definitions of every primitive in ai-dev-team. The thing you skim before reading anything else.

## Pipeline shape

- **Pipeline** — the ordered sequence of stages that turns a feature request into a deployed, retro'd change.
- **Stage** — one of 11 numbered phases of the pipeline (e.g. `stage-01` requirements, `stage-04` build). Defined in `core/pipeline/stages.js`.
- **Sub-stage** — a stage with a letter suffix (`stage-04a` pre-review, `stage-04b` security review) that runs as part of the same broader phase.
- **Track** — a named subset of stages run for one kind of change (`full`, `quick`, `nano`, `config-only`, `dep-update`, `hotfix`). Tracks shape *which* stages run; they never change *what* a stage does.

## Work assignment

- **Role** — a named seat at the team (`pm`, `principal`, `backend`, `frontend`, `platform`, `qa`, `reviewer`, `security`). A role has a brief in `roles/<role>.md`.
- **Workstream** — one dispatch of a stage to one role. Single-role stages have one workstream; multi-role stages (build, peer-review, sign-off) have several. The workstream is the unit of gate identity.
- **Subagent** — the host-native agent the workstream is dispatched to. Usually `subagent = role` (backend workstream → dev-backend subagent), but stages can override (peer-review's `subagent: "reviewer"` sends all four area workstreams to the reviewer subagent).

## Outputs

- **Artifact** — the markdown deliverable a stage produces (`pipeline/brief.md` for stage-01, `pipeline/design-spec.md` for stage-02, etc.).
- **Gate** — the JSON file that records a stage's outcome. Required base fields: `stage`, `status`, `orchestrator`, `track`, `timestamp`, `blockers`, `warnings`. Workstream gates add `workstream` and `host`. Merged stage gates add a `workstreams[]` array.
- **Gate status** — `PASS`, `WARN`, `FAIL`, or `ESCALATE`. WARN is PASS-with-warnings (non-blocking). ESCALATE halts the pipeline; FAIL retries up to a limit then escalates.

## Routing & dispatch

- **Host** — the AI tool that actually runs the model: `claude-code`, `codex`, or `generic` (no-host CLI mode).
- **Adapter** — the per-host module under `hosts/<host>/` that knows how to install, render prompts for, and (optionally) headlessly drive that host. Implements the contract in `core/adapters/host-adapter.md`.
- **Capability** — a declaration in `capabilities.json` about what the host supports: `hooks`, `subagents`, `slashCommands`, `worktrees`, `headless`, plus an `enforces` map for `allowed_writes` and `stoplist`.
- **Routing config** — `.devteam/config.yml` in the target project. Decides which host runs each workstream. Precedence: `routing.stages[stage] → routing.roles[role] → routing.default_host`.

## Core mechanics

- **Stage descriptor** — what the orchestrator hands to an adapter to render a prompt: stage id, role, workstream id, objective, files-to-read, allowed-writes, artifact path, template name, gate skeleton.
- **renderStagePrompt** — adapter method that returns the text the user (or the headless host CLI) consumes to perform the stage.
- **invoke** — optional adapter method that drives the host CLI non-interactively (`claude --print`, `codex exec`). Only present when `capabilities.headless: true`.
- **Merge** — the orchestrator's post-step on multi-role stages: read all per-workstream gates, aggregate into the stage-level gate. Status follows `ESCALATE > FAIL > WARN > PASS`.

## Guards & hooks

- **Stoplist** — a list of phrases (auth, PII, payments, migrations, …) that block lighter tracks from being used. Forces serious changes onto the full pipeline.
- **Budget gate** — opt-in cap on tokens + wall-clock per pipeline run. On exceed: `escalate` or `warn`.
- **Security heuristic** — file-path patterns (`src/backend/auth*`, `*secret*`, …) that, when matched by a diff, force the conditional `stage-04b` security review.
- **Hook** — a Claude Code event handler (Stop / SubagentStop / PostToolUse) wired to a core script. `Stop` runs `validator.js`; `PostToolUse Write|Edit` runs `approval-derivation.js`.
- **Conditional stage** — a stage that only runs when a prerequisite gate's field has a specific value. Declared via `conditionalOn: { stage, field, equals }` in the stage definition. Currently used by security-review.

## Special mechanisms

- **Approval-derivation** — Stage 5 mechanism: reviewers write per-area `REVIEW: APPROVED` / `REVIEW: CHANGES REQUESTED` markers in `pipeline/code-review/by-<reviewer>.md`; a PostToolUse hook parses them and upserts the per-area workstream gates.
- **Auto-fold (Stage 7)** — when Stage 6 reports `all_acceptance_criteria_met: true` AND a 1:1 criterion-to-test mapping, the orchestrator authors Stage 7 PM sign-off directly with `auto_from_stage_06: true`.
- **Retrospective synthesis** — Stage 9 work: harvest `PATTERN:` lines from Stage 5 reviews, reconcile with the lessons-learned file, promote ≤2 rules per retro, retire stale ones via the auto-age-out rule.

## Tracks at a glance

| Track | Stages |
|---|---|
| `full` | All 11 (requirements → retrospective) |
| `quick` | requirements, build, peer-review, qa, sign-off, deploy, retrospective |
| `nano` | build, qa |
| `config-only` | build, pre-review, security-review, qa, sign-off, deploy |
| `dep-update` | build, peer-review, qa, sign-off, deploy |
| `hotfix` | build, pre-review, security-review, peer-review, qa, sign-off, deploy, retrospective |

## Files at a glance

| File / dir | What lives there |
|---|---|
| `roles/<role>.md` | Single source of truth for what each role does, reads, writes. |
| `rules/<topic>.md` | Pipeline rules — `gates.md`, `pipeline.md`, `escalation.md`, `retrospective.md`, etc. |
| `skills/<skill>/SKILL.md` | Task helpers — `implement`, `review-rubric`, `security-checklist`. |
| `templates/<artifact>-template.md` | Artifact templates (brief, design-spec, runbook, etc.). |
| `.devteam/config.yml` (in target) | Routing config + pipeline defaults for that project. |
| `pipeline/gates/<stage>.json` | The merged stage gate. |
| `pipeline/gates/<stage>.<workstream>.json` | A per-workstream gate for a multi-role stage. |
| `pipeline/context.md` | Append-only running notes across stages. |
