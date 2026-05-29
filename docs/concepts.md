# Concepts

Six primitives make up Stagecraft. Skim this page before reading anything else — every other doc assumes you know these words.

| Concept | Lives in | Set by | What it is |
|---|---|---|---|
| **Stage** | `core/pipeline/stages.js` | The framework | A numbered phase of work (e.g. `stage-01` requirements, `stage-04` build, `stage-09` retrospective). 14 stages total (including sub-stages 4a/4b/4c, 6b, 6c). |
| **Role** | `roles/<role>.md` | The framework + your customizations | A named seat at the team — `pm`, `principal`, `backend`, `frontend`, `platform`, `qa`, `reviewer`, `security`. A role's brief is the source of truth for what it does, reads, and writes. |
| **Workstream** | derived at dispatch time | The orchestrator | One dispatch of a stage to one role. Single-role stages have one workstream; multi-role stages (build, peer-review) have several. **The workstream is the unit of gate identity.** |
| **Host** | `hosts/<host>/` | You choose at `devteam init` | The AI tool that actually runs the model: `claude-code`, `codex`, `gemini-cli`, or `generic` (no host). |
| **Gate** | `pipeline/gates/<stage>*.json` | The model writes it; the validator enforces it | A JSON record of one workstream's (or stage's) outcome. **The stable seam between stages.** Required fields: `stage`, `status`, `orchestrator`, `track`, `timestamp`, `blockers`, `warnings`. |
| **Track** | `core/pipeline/stages.js` | Your `.devteam/config.yml` (`pipeline.default_track`) | Which stages run for this kind of change. Six tracks: `full`, `quick`, `nano`, `config-only`, `dep-update`, `hotfix`. Tracks shape *which* stages run; never *what* a stage does. |

That's the load-bearing vocabulary. The rest of this page builds on it.

---

## How they compose

A typical `full`-track run touches every primitive:

1. You type **`devteam stage requirements --feature "Add SMS opt-in"`**.
2. The orchestrator decomposes **stage-01** into **one workstream** (single-role) for **role: pm**, looks up the **host** for that workstream in `.devteam/config.yml` (default `claude-code`), and asks the host adapter to render a prompt.
3. The model writes `pipeline/brief.md` (the artifact) and `pipeline/gates/stage-01.json` (the **gate**) with `status: "PASS"`.
4. You run **`devteam next`**. It reads the gate, sees PASS, and reports `▶️ run-stage — design (stage-02)`.
5. Two stages later you hit **stage-04 build**: 4 workstreams (backend / frontend / platform / qa), each potentially dispatched to a different host depending on routing. Each writes its own per-workstream gate (`pipeline/gates/stage-04.backend.json` etc.). `devteam merge build` aggregates them into the stage gate.
6. The **track** you picked (`full`) is what put all 14 stages on the menu. Picking `nano` would skip everything except build + qa.

The whole pipeline is reconstructable from `pipeline/gates/`. The orchestrator never holds state outside of those files.

## Rules of thumb

- **Adding a new specialist seat at the team?** Add a **role** under `roles/<name>.md`.
- **Adding a new phase of work?** Add a **stage** to `core/pipeline/stages.js`, with a matching schema under `core/gates/schemas/`.
- **Plugging in a new AI tool?** Add a **host adapter** under `hosts/<name>/`. The contract is in `core/adapters/host-adapter.md`.
- **Routing a specific role to a specific host?** Edit `routing` in `.devteam/config.yml` (`stages > roles > default_host` — most specific wins).
- **Want a subset of stages for a particular change size?** Pick a **track**, or define a new one in `STAGES_BY_TRACK`.
- **Need to record a non-standard outcome?** Add a field to the stage's schema. The validator enforces required fields; everything else is free-form.

---

## Secondary vocabulary

These come up frequently but build on the primitives above:

### Status & state

- **Gate status** — `PASS`, `WARN`, `FAIL`, or `ESCALATE`. WARN is PASS-with-warnings (non-blocking). ESCALATE halts the pipeline; FAIL retries up to a limit then escalates.
- **Merge** — the orchestrator's post-step on multi-role stages: read all per-workstream gates, aggregate into a stage-level gate. Aggregate status follows `ESCALATE > FAIL > WARN > PASS` (pessimistic).
- **Artifact** — the markdown deliverable a stage produces (`pipeline/brief.md` for stage-01, `pipeline/design-spec.md` for stage-02, …). Distinct from the gate.

### Routing & dispatch

- **Adapter** — the per-host module under `hosts/<host>/`. Implements install, renderStagePrompt, status, uninstall, and (optionally) invoke. The orchestrator never knows host-specific details; the adapter is the only layer that does.
- **Capability** — a flag in `hosts/<host>/capabilities.json` declaring what the host supports: `hooks`, `subagents`, `slashCommands`, `worktrees`, `headless`, plus an `enforces` map saying where each core rule is enforced (`tool-call-time`, `post-hoc-audit`, `prompt-only`).
- **Subagent** — the host-native agent the workstream is dispatched to. Usually `subagent = role` (the backend workstream → the `dev-backend` subagent). Stages can override this (peer-review's `subagent: "reviewer"` sends all four area workstreams to the same reviewer subagent).
- **Stage descriptor** — what the orchestrator hands to an adapter to render a prompt: stage id, role, workstream id, objective, files-to-read, allowed-writes, artifact path, template name, gate skeleton.

### Guards & hooks

- **Stoplist** — phrases (`auth`, `payments`, `migrations`, …) that block lighter tracks from running. Forces serious changes onto `full` or `hotfix`. Bypass with `--force`.
- **Security heuristic** — file-path patterns (`src/backend/auth*`, `*secret*`, `*crypto*`, …) that, when matched, set `security_review_required: true` in pre-review's gate. That value triggers the conditional `stage-04b` security review.
- **Hook** — a Claude Code event handler (`Stop`, `SubagentStop`, `PostToolUse`, `PreToolUse`) wired to a core script. `Stop` runs the validator; `PostToolUse Write|Edit` runs approval-derivation; `PreToolUse Write|Edit` runs secret-scan.
- **Conditional stage** — a stage that only runs when a prerequisite gate's field has a specific value. Declared via `conditionalOn: { stage, field, equals }` in the stage definition. Currently used by security-review (`stage-04b`).

### Special mechanisms

- **Approval-derivation** — Stage 5's mechanism. Reviewers write per-area `REVIEW: APPROVED` / `REVIEW: CHANGES REQUESTED` markers in `pipeline/code-review/by-<reviewer>.md`; a PostToolUse hook parses them and upserts the per-area workstream gates. You never write Stage 5 gates by hand.
- **Auto-fold (Stage 7)** — when Stage 6 reports `all_acceptance_criteria_met: true` AND a 1:1 criterion-to-test mapping, the orchestrator authors Stage 7 sign-off directly with `auto_from_stage_06: true`. No human action.
- **Retrospective synthesis (Stage 9)** — Principal harvests `PATTERN:` lines from Stage 5 reviews, reconciles with `pipeline/lessons-learned.md`, promotes ≤2 rules per retro, retires stale ones via the auto-age-out rule.
- **Multi-model adversarial peer review** — opt-in fanout (`routing.review_fanout: [host, host, host]` in config). Stage-05's 4 area workstreams duplicate across N hosts → 4×N parallel reviews; pessimistic merge across all of them.
- **Red team (stage-04c)** — adversarial-by-design role between build (Stage 4) and peer review (Stage 5). Always-on for `full` + `hotfix` tracks. Walks 10 attack surfaces (input boundaries, state, sequence, integrations, auth edges, resource exhaustion, failure modes, abuse cases, downstream effects, observability gaps) and produces concrete reproducers. `must_address_before_peer_review` items block Stage 5 until the implementer addresses them. Distinct from security-engineer (narrower remit, conditional, has veto) and reviewer (general code review). Diversity matters — route to a different host than the build agents. See `skills/red-team/SKILL.md` for methodology.
- **Persistent memory** — `devteam memory ingest|query` builds a per-project semantic index of briefs, design specs, ADRs, retros, and lessons. Local embedder by default; offline after first download.

---

## Tracks at a glance

| Track | Stages | When to pick |
|---|---|---|
| `full` | All 13 (requirements → retrospective) | Multi-area features, anything touching auth / PII / payments / migrations. |
| `quick` | requirements, build, peer-review, qa, accessibility-audit, sign-off, deploy, retrospective | Single-area changes with non-trivial scope but no design complexity. |
| `nano` | build, qa | Typo fixes, comment changes, one-line tweaks. |
| `config-only` | build, pre-review, security-review, qa, sign-off, deploy | Config / infrastructure changes with no application code. |
| `dep-update` | build, peer-review, qa, sign-off, deploy | Dependency bumps. Security-review fires if the diff touches sensitive paths. |
| `hotfix` | build, pre-review, security-review, red-team, peer-review, qa, accessibility-audit, observability-gate, sign-off, deploy, retrospective | Production outages. Skips requirements / design / clarification — you already know what's broken — but keeps all the safety stages. |

See [`docs/tracks.md`](tracks.md) for full per-track stage lists and the safety logic behind track gating.

## Files at a glance

| Path | What lives there |
|---|---|
| `roles/<role>.md` | Single source of truth for what each role does, reads, writes. |
| `rules/<topic>.md` | Pipeline rules — `gates.md`, `pipeline.md`, `escalation.md`, `retrospective.md`, etc. |
| `skills/<skill>/SKILL.md` | Task helpers — `implement`, `review-rubric`, `security-checklist`, `accessibility-audit`, `observability-verification`. |
| `templates/<artifact>-template.md` | Artifact templates (brief, design-spec, runbook, retrospective, etc.). See also: per-template *annotation guides* (the "why each section matters" docs) at `docs/brief-template.md`, `docs/design-spec-template.md`, `docs/runbook-template.md` — but **only for the three load-bearing artifacts a human actually reads end-to-end**. The other 9 templates (build, clarification, pr-summary, pre-review, retrospective, review, test-report, adr, audit/) are agent-facing and don't have separate annotation guides; the role brief that produces each template carries the context. This asymmetry is deliberate — annotating every template would produce ~500 lines of mostly-redundant content nobody reads. |
| `hosts/<host>/` | Per-host adapter: `adapter.js`, `capabilities.json`, `install/` payload. |
| `.devteam/config.yml` (in target project) | Routing config + pipeline defaults for that project. |
| `pipeline/gates/<stage>.json` | The merged stage gate. |
| `pipeline/gates/<stage>.<workstream>.json` | A per-workstream gate for a multi-role stage. |
| `pipeline/context.md` | Append-only running notes across stages. |
| `.devteam/memory/` (in target project) | Semantic memory store (opt-in; built by `devteam memory ingest`). |

## Two distinct workflows

Stagecraft does two different kinds of work, with different vocabularies:

1. **Pipeline** — *building* features through 13 staged production steps. The vocabulary above (stage, role, workstream, host, gate, track) applies. Outputs go in `pipeline/`.
2. **Audit** — *analyzing* an existing codebase, read-only, to produce a prioritized improvement roadmap. Different vocabulary (phases, findings, severity, themes, batches). Outputs go in `docs/audit/`.

The pipeline produces new code. The audit produces analysis of code that exists. Don't confuse them. The same role briefs are NOT used — the auditor role exists separately from the pipeline roles.

When the user says "audit the codebase" → `/audit` or `/audit-quick` (see [`user-guide.md` §Auditing a codebase](user-guide.md#auditing-a-codebase)).
When the user says "build feature X" → `devteam stage requirements --feature "X"` (see [`EXAMPLE.md`](../EXAMPLE.md)).

## What you can stop reading now

If you can describe what a **workstream**, **gate**, and **track** are, you have enough to use the pipeline. If you know `/audit` produces a `docs/audit/10-roadmap.md` you can act on, you have enough to use the audit. Everything else is detail that surfaces when you need it — chase the cross-references when they come up.
