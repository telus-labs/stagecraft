# Stage 5 — Peer Code Review (Agent Teams preferred, sequential fallback)

### Review shape — scoped vs matrix

Before Stage 5 begins, the orchestrator inspects the diff and picks one
of two review shapes, then writes the chosen shape into each stage-05
gate's `"review_shape"` and `"required_approvals"` fields.

**Scoped review** — `review_shape: "scoped"`, `required_approvals: 1`.

Used when the diff is **area-contained**: every changed file lives under
one of `src/backend/`, `src/frontend/`, `src/infra/`, or `src/tests/`,
with no cross-area edits. One reviewer from a different area is
sufficient. The pairing uses the same cross-area convention as the `quick` track.

Docs-only `loop` uses area `documentation`; reviewer gets
the exact Stage 1 file list; an unapproved file requires scope expansion.

**Gate pre-creation is required.** Before any scoped review, the orchestrator
writes `stage-05.{area}.json` with `required_approvals: 1` and scoped shape;
otherwise the hook defaults to 2 and one approval cannot PASS.

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

Used when the diff touches more than one area. Each reviewer writes
exactly two `## Review of <area>` sections — never their own workstream.

| Role (file)       | Writes sections for     |
|-------------------|-------------------------|
| `dev-backend`     | `platform` + `qa`       |
| `dev-frontend`    | `backend` + `qa`        |
| `dev-platform`    | `backend` + `frontend`  |
| `dev-qa`          | `frontend` + `platform` |

Every workstream thus receives exactly 2 approvals from distinct reviewers.

**Self-review is invalid.** A reviewer MUST NOT write a `## Review of <area>`
section for the workstream they own — the hook skips and warns on self-reviews.

**Stage manager guidance — FAIL with no `changes_requested`** means quorum
not reached, nobody blocked. Run `devteam derive-approvals` (approvals from a
prior session are not re-derived on start). If still FAIL, the gate's
`action_required` says how many approvals are missing and who is eligible:
have one add the `## Review of <area>` section to their `by-<role>.md`, then
`devteam derive-approvals` and `devteam merge peer-review`.

### Review file format

Reviewers write per-area sections inside their review file, each
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

The `approval-derivation.js` hook (PostToolUse on Write/Edit) parses these
sections and updates `pipeline/gates/stage-05.<area>.json` accordingly.
**Do not author `approvals` or `changes_requested` fields directly** — the
hook is the single writer; direct edits are overwritten on the next file save.

Every `BLOCKER: <text>` line in a `CHANGES REQUESTED` section is automatically
extracted by the hook into the gate's `blockers[]` array so stage managers can
read blocker text without grepping review files. The `blockers` array is reset
on each hook run for that area, so a re-review that flips to `APPROVED` clears it.

For the full hook contract (how approval-derivation.js parses sections,
`blockers[]` JSON schema, and `affected_workstreams` derivation on the merged
gate) see `docs/conventions.md §Stage 5 approval-derivation hook contract`.

### READ-ONLY Reviewer Rule (strictly enforced)

During a Stage 5 review invocation, a reviewer agent writes ONLY to:
  - `pipeline/code-review/by-{reviewer}.md` (their review file)
  - `pipeline/gates/stage-05.{area}.json` (approval gate — hook-managed fields only)

A reviewer agent MUST NOT:
  - Use `Write` or `Edit` on any file under `src/`
  - Amend or refactor the author's code, even for a one-line "obvious fix"
  - Add themselves to `approvals` in a stage-05 gate if they modified any
    source file during the same invocation — the gate is then invalid

If the reviewer finds a bug, missing guard, or other BLOCKER: they write
`REVIEW: CHANGES REQUESTED` in their review file, list the blocker, and
halt. The orchestrator re-invokes the owning dev agent to fix it in their
own worktree. **No fix-forward. No exceptions for "small" patches.**

Rationale: an inline fix bypasses the owning dev, is never re-reviewed, and
leaves no CHANGES-REQUESTED → addressed trail.

### Gate merge (hook-derived)

Each area gate accumulates approvals via `approval-derivation.js`. The gate
reaches `"status": "PASS"` when `approvals.length >= required_approvals` AND
`changes_requested` is empty. Do not manually edit the `approvals` array —
the hook reconciles the gate on every reviewer file save and overwrites any
direct edit.

Pre-read requirement (pass to each reviewer agent):
  - `pipeline/brief.md`, then `pipeline/pr-<area>.md` for the area(s) reviewed
  - The changed files named in the dispatch's Changed-file manifest (or
    `git diff`) — not the whole tree
  - Only if they exist: `pipeline/design-spec.md`, `pipeline/adr/`, the other
    reviewer's `by-*.md`. Lean tracks (`loop`/`nano`/`refactor`) have none
    of these; absence is expected and not worth a glob.

### Reviewer efficiency (every track)

Every file opened slows every later turn. Do not re-run lint, tests, or
`npm audit` when the stage-06 (or stage-04) gate carries
`_orchestrator_stamped.runs` with `exit_code: 0` — cite it. Never read
`pipeline/run-*.json`, `run-log.jsonl`, `pipeline/logs/`, or
`.devteam/config.yml` — pipeline state, not the change.

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


## Gate

Workstream gate files: `pipeline/gates/stage-05.<area>.json` (one per area).
Merged stage gate: `pipeline/gates/stage-05.json`.

```json
{
  "stage": "stage-05",
  "status": "PASS | FAIL",
  "track": "full",
  "timestamp": "<ISO 8601>",
  "orchestrator": "devteam@<version>",
  "workstream": "backend | frontend | platform | qa | documentation",
  "host": "claude-code",
  "blockers": [],
  "warnings": [],
  "area": "backend | frontend | platform | qa | documentation",
  "review_shape": "scoped | matrix",
  "required_approvals": 2,
  "approvals": ["dev-frontend", "security-engineer"],
  "changes_requested": [
    { "reviewer": "dev-backend", "timestamp": "<ISO>" }
  ],
  "escalated_to_principal": false
}
```

`approvals` and `changes_requested` are written by the `approval-derivation.js` hook,
not by the reviewer agent. `status: "PASS"` when `approvals.length >= required_approvals`
AND `changes_requested` is empty.
