# Pipeline Build (Stages 4–8)

The implementation half of the pipeline: build, pre-review, peer code
review, test, sign-off, and deploy. Stages 1–3 + 9 + durations live in
`pipeline-core.md`. Track routing and the safety stoplist live in
`pipeline-tracks.md`. The full index is in `pipeline.md`.

## Stage 4 — Build (3 Devs, parallel via git worktrees)

Each dev works in its own worktree:
  `git worktree add ../dev-team-backend feature/backend`
  `git worktree add ../dev-team-frontend feature/frontend`
  `git worktree add ../dev-team-platform feature/platform`

Invoke in parallel:
  `dev-backend`  → `src/backend/`  → `pipeline/pr-backend.md`
  `dev-frontend` → `src/frontend/` → `pipeline/pr-frontend.md`
  `dev-platform` → `src/infra/`    → `pipeline/pr-platform.md`

Gate file per PR: `pipeline/gates/stage-04-{area}.json`
All three must have `"status": "PASS"` before proceeding.

---

## Stage 4.5 — Pre-review checks

Between Stage 4 (build) and Stage 5 (peer code review), two automated
gates must pass. These catch issues the toolchain already knows about
before human (or agent) review tokens are spent on them.

### Stage 4.5a — Pre-review gate (lint + type-check + SCA)

Invoke: `dev-platform` agent.
Scope: lint, type-check, dependency vulnerability scan, license
allowlist check.
Output: `pipeline/gates/stage-04-pre-review.json`.
Gate key: `"status": "PASS"` with `"lint_passed": true`,
`"type_check_passed": true`, and no `high`/`critical` SCA findings.

See `roles/dev-platform.md` §"On a Pre-Review Task" for the
exact commands. On failure, the owning dev (identified from the failing
check) is re-invoked to fix. Stage 5 does not start until this gate
passes.

### Stage 4.5b — Security review (conditional)

Invoke: `security-engineer` agent **only when** the triggering heuristic
fires. The heuristic matches any of:

- Paths: `src/backend/auth*`, `src/backend/crypto*`, `src/backend/payment*`,
  `src/backend/pii*`, `src/backend/session*`, or any file named with
  `*secret*` / `*token*` / `*credential*`
- New or upgraded dependencies in `package.json`, `requirements.txt`,
  `pyproject.toml`, `Gemfile`, `go.mod`, `composer.json`, `Pipfile`
- Changes to `Dockerfile` or `docker-compose*.yml` that add/modify a
  **service image, network, or volume** (environment-value-only changes
  that qualify for `/config-only` do not trigger)
- Files under `src/infra/` that affect **network topology, IAM/RBAC,
  TLS/certificates, secrets management, or CI/CD secret handling** — e.g.
  `**/iam*`, `**/rbac*`, `**/network*`, `**/firewall*`, `**/certs*`,
  `**/secrets*`, or any CI workflow file referencing `${{ secrets.* }}`
  (config-only infra edits such as port numbers or healthcheck intervals
  do **not** trigger)
- New or changed database migrations
- New environment variables or secret references in `.env.example`

If the heuristic does not fire, the security gate is skipped and the
orchestrator records the skip decision in `pipeline/context.md` under
`## Brief Changes` as `SECURITY-SKIP: <reason>`.

Output: `pipeline/gates/stage-04-security.json`.
Gate key: `"status": "PASS"` with `"security_approved": true` and
`"veto": false`.

A `veto: true` gate halts the pipeline. No peer-review approval can
override a veto — the security-engineer must personally re-review the
fix and flip the flag. Rationale: the Stage 5 reviewers are area
specialists, not threat modellers; their "approved" on a
security-relevant diff doesn't speak to the threat model.

Both 4.5a and 4.5b must pass (when applicable) before Stage 5 begins.
`/hotfix` skips 4.5a when the explicit blast-radius constraint in
`pipeline/hotfix-spec.md` already bounds the scope tightly; it does NOT
skip 4.5b when the heuristic fires (hotfixes *often* touch security
surfaces, and that's exactly when review is most needed).

---

## Stage 5 — Peer Code Review (Agent Teams preferred, sequential fallback)

### Review shape — scoped vs matrix

Before Stage 5 begins, the orchestrator inspects the diff and picks one
of two review shapes, then writes the chosen shape into each stage-05
gate's `"review_shape"` and `"required_approvals"` fields.

**Scoped review** — `review_shape: "scoped"`, `required_approvals: 1`.

Used when the diff is **area-contained**: every changed file lives under
one of `src/backend/`, `src/frontend/`, `src/infra/`, or `src/tests/`,
with no cross-area edits. One reviewer from a different area is
sufficient. The pairing uses the same cross-area convention as `/quick`.

**Gate pre-creation (required for scoped reviews).** Before invoking the
reviewer, the orchestrator must write `pipeline/gates/stage-05-{area}.json`
with `"required_approvals": 1` and `"review_shape": "scoped"`. The
`approval-derivation.js` hook defaults newly-created gates to
`required_approvals: 2`. If the gate doesn't pre-exist with the correct
value, the hook creates a matrix gate and a single approval never flips the
status to PASS.

| Owning area    | Default reviewer     |
|----------------|----------------------|
| `src/backend/` | `dev-platform`       |
| `src/frontend/`| `dev-backend`        |
| `src/infra/`   | `dev-backend`        |
| `src/tests/`   | `dev-backend`        |

If Stage 4.5b fired, the `security-engineer` review is a **second signal**
on the same gate — it does not substitute for the cross-area reviewer,
but it does count toward `required_approvals` in scoped mode. The veto
semantics of 4.5b still override: a `veto: true` halts the pipeline
regardless of Stage 5 approvals.

**Matrix review** — `review_shape: "matrix"`, `required_approvals: 2`.

Used when the diff touches more than one area. The original v1 matrix
applies:
  `dev-backend`  reviews: frontend + platform → writes `pipeline/code-review/by-backend.md`
  `dev-frontend` reviews: backend + platform  → writes `pipeline/code-review/by-frontend.md`
  `dev-platform` reviews: backend + frontend  → writes `pipeline/code-review/by-platform.md`

Each area's stage-05 gate accumulates two approvals from reviewers
whose own area is different.

### Review file format

Reviewers now write per-area sections inside their review file, each
ending with a `REVIEW: APPROVED` or `REVIEW: CHANGES REQUESTED` marker
on its own line:

```markdown
# Review by <reviewer-name>

## Review of backend
<comments, BLOCKER/SUGGESTION/QUESTION entries>

REVIEW: APPROVED

## Review of platform
<comments>

REVIEW: CHANGES REQUESTED
BLOCKER: <text>
```

The `approval-derivation.js` hook (registered as PostToolUse on
Write/Edit in `.devteam/settings.json`) parses these sections after the
reviewer writes the file and updates `pipeline/gates/stage-05-<area>.json`
accordingly. **Agents no longer author the `approvals` or
`changes_requested` fields directly** — that path was how v1/v2 let
reviewers effectively approve themselves. The hook is the single
writer.

### READ-ONLY Reviewer Rule (strictly enforced)

During a Stage 5 review invocation, a reviewer agent writes ONLY to:
  - `pipeline/code-review/by-{reviewer}.md` (their review file)
  - `pipeline/gates/stage-05-{area}.json` (append-only approval gate)

A reviewer agent MUST NOT:
  - Use `Write` or `Edit` on any file under `src/`
  - Amend or refactor the author's code, even for a one-line "obvious fix"
  - Add themselves to `approvals` in a stage-05 gate if they modified any
    source file during the same invocation — the gate is then invalid

If the reviewer finds a bug, missing guard, or other BLOCKER: they write
`REVIEW: CHANGES REQUESTED` in their review file, list the blocker, and
halt. The orchestrator re-invokes the owning dev agent to fix it in their
own worktree. **No fix-forward. No exceptions for "small" patches.**

Rationale: silent inline fixes bypass the owning dev, skip re-review of
the patched lines, and leave no audit trail tying the patch to a
CHANGES-REQUESTED → addressed loop. If the one-line patch has a second
bug, no reviewer is assigned to catch it.

### Gate merge strategy (hook-derived)

Each area gate (`pipeline/gates/stage-05-{area}.json`) accumulates
approvals via `approval-derivation.js`, not via agent self-write. The
gate reaches `"status": "PASS"` when:

- `approvals.length >= required_approvals` (1 for scoped, 2 for matrix)
- `changes_requested` is empty

An agent that manually edits the `approvals` array is running around
the integrity model. The hook runs on every Write/Edit and reconciles
the gate to the review file; any direct edit will be overwritten on
the next reviewer's file save. Don't fight it.

Pre-read requirement (pass to each reviewer agent):
  - `pipeline/brief.md`
  - `pipeline/design-spec.md`
  - `pipeline/adr/` (all files)
  - The other reviewer's file if already written (sequential fallback)

On architectural escalation: invoke `principal` agent. Principal ruling is binding.
On deadlock (reviewers disagree, no escalation): invoke `principal` agent to decide.

### Review round limit

To prevent an unbounded review-fix spiral, the orchestrator enforces a
**two-round maximum** per area per pipeline run:

- **Round 1**: reviewer writes `CHANGES REQUESTED` → owning dev fixes →
  reviewer re-reviews.
- **Round 2**: if the same reviewer writes `CHANGES REQUESTED` again on
  the same area, the orchestrator **must not** invoke the dev a third time.
  Instead it invokes the `principal` agent with:
  - The two review files
  - The dev's PR file
  - The brief and design spec
  The Principal makes a binding ruling: either the blocker is resolved
  (dev implements Principal's ruling and the reviewer approves), or the
  pipeline FAILs with an explicit rejection.

The round counter resets if a different reviewer takes over the area.
Record the escalation in `pipeline/context.md` as
`REVIEW-ESCALATED: <area> after 2 rounds — principal ruling requested`.

---

## Stage 6 — Test & CI (QA Dev)

Invoke: `dev-qa` agent.
Input: `src/` + `pipeline/brief.md` (acceptance criteria).
Output: `pipeline/test-report.md`.
Gate file: `pipeline/gates/stage-06.json`.
Gate keys:
- `"status": "PASS"` with `"all_acceptance_criteria_met": true`
- `"criterion_to_test_mapping_is_one_to_one": true | false` — this
  drives the Stage 7 auto-fold

On failure: identify owning dev from the failing test's path (dev-qa
writes `"assigned_retry_to"` in the gate), invoke that dev with the
failure context. Retry limit: 3 cycles. On 3rd identical failure,
auto-escalate to `principal`.

After gate passes → HUMAN CHECKPOINT C.

---

## Stage 6b — Accessibility audit (conditional on UI changes; tracks: full, quick, hotfix)

Invoke: `dev-qa` agent.
Input: `pipeline/brief.md`, `pipeline/design-spec.md`, `pipeline/test-report.md`, frontend PR summaries.
Output: `pipeline/accessibility-report.md`.
Gate file: `pipeline/gates/stage-06b.json`. Required keys:
- `audit_method`: `axe-core | pa11y | lighthouse | manual`
- `wcag_level`: `A | AA | AAA` (default AA)
- `violations`: `{ critical, serious, moderate, minor }`
- `components_audited`: array of routes/components/pages audited
- `audit_skipped_reason`: when set, audit was intentionally skipped (backend-only change, doc-only change, etc.); status should be PASS

PASS requires `violations.critical === 0 AND violations.serious === 0`. Moderate/minor findings flow through as warnings, not blockers. See `skills/accessibility-audit/SKILL.md` for tool choice, procedure, triage, and gotchas.

---

## Stage 6c — Observability gate (tracks: full, hotfix)

Invoke: `dev-platform` agent.
Input: `pipeline/brief.md` §9 (Observability requirements), `pipeline/design-spec.md`, shipped code.
Output: `pipeline/observability-report.md`.
Gate file: `pipeline/gates/stage-06c.json`. Required keys:
- `metrics`: `{ required[], verified[], gap[] }`
- `logs`: same shape
- `traces`: same shape
- `verification_method`: `code-grep | static-analysis | staging-run | runtime-probe | dashboard-query | manual`

PASS requires every category's `gap` to be empty. Weak verification methods (`code-grep`, `static-analysis`, `manual`) PASS with a WARN ("recommend runtime-probe post-deploy"). Non-empty gap → FAIL with the missing signals as blockers, assigned to the dev who owned the relevant area. See `skills/observability-verification/SKILL.md` for procedure, naming conventions to match, and decision matrix.

This stage closes the "designs claim instrumentation that never lands" gap: it's where promised observability becomes contractual.

---

## Stage 7 — PM Sign-off

Invoke: `pm` agent
Input: `pipeline/test-report.md` + `pipeline/brief.md`
Output: sign-off appended to `pipeline/gates/stage-07.json`
Gate key: `"pm_signoff": true`

On NO: PM writes delta list. Return to Stage 4 with delta items only.
Delta items must not trigger a full pipeline rerun — scope them explicitly.

### Auto-fold from Stage 6

When Stage 6 maps every acceptance criterion 1:1 to a passing test and
sets `"all_acceptance_criteria_met": true`, the orchestrator auto-writes
Stage 7 without invoking the PM:

```json
{
  "stage": "stage-07",
  "status": "PASS",
  "pm_signoff": true,
  "auto_from_stage_06": true,
  "track": "<track>",
  "agent": "orchestrator",
  "timestamp": "<ISO>",
  "blockers": [],
  "warnings": []
}
```

The auto-fold is skipped (and the PM agent invoked normally) when:

- `"all_acceptance_criteria_met"` is not `true` in Stage 6
- The Stage 6 test report does not have a 1:1 criterion-to-test mapping
  (one test covers multiple criteria, or one criterion has no test)
- The user explicitly requested a manual sign-off
- The track is `/hotfix` (hotfixes always require PM sign-off)

Rationale: when criteria are clean, Stage 7 re-derives the same verdict
the platform dev already wrote at Stage 6. PM judgment adds value on
delta items and edge cases, not on rubber-stamping a clean sheet.

---

## Stage 8 — Deploy (Platform Dev)

Invoke: `dev-platform` agent.
Preconditions:
- `pipeline/gates/stage-07.json` has `"pm_signoff": true`
- `pipeline/runbook.md` exists and has `## Rollback` + `## Health signals`
  sections (see `docs/runbook-template.md`)
- `.devteam/config.yml` names a valid adapter in `deploy.adapter`

Stage 8 is **adapter-driven**. The dev-platform
agent reads the selected adapter's instructions from
`.devteam/adapters/<adapter>.md` and follows them. Built-in adapters:
`docker-compose` (default), `kubernetes`, `terraform`, `custom`. See
`.devteam/adapters/README.md` for the contract.

Output:
- `pipeline/deploy-log.md` — human-readable, includes a runbook
  pointer
- `pipeline/gates/stage-08.json` — gate with fields `adapter`,
  `environment`, `smoke_test_passed`, `runbook_referenced`, and an
  adapter-specific `adapter_result` block

Gate key: `"status": "PASS"` AND `"runbook_referenced": true`.

On failure: do NOT auto-rollback. The deploy log points to the
runbook's `§Rollback` section; the orchestrator surfaces that
pointer and the user decides.

Post-deploy: invoke `pm` agent to write stakeholder summary.
