# Stage 5 — Peer Code Review (Agent Teams preferred, sequential fallback)

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

Used when the diff touches more than one area. Each reviewer writes
exactly two `## Review of <area>` sections — never their own workstream.

| Role (file)       | Writes sections for     |
|-------------------|-------------------------|
| `dev-backend`     | `platform` + `qa`       |
| `dev-frontend`    | `backend` + `qa`        |
| `dev-platform`    | `backend` + `frontend`  |
| `dev-qa`          | `frontend` + `platform` |

Coverage: every workstream receives exactly 2 approvals from distinct reviewers:
- `backend`:  dev-frontend + dev-platform
- `frontend`: dev-platform + dev-qa
- `platform`: dev-backend + dev-qa
- `qa`:       dev-backend + dev-frontend

**Self-review is invalid.** A reviewer MUST NOT write a `## Review of <area>`
section for the workstream they own. The `approval-derivation.js` hook
skips and warns on self-reviews; the gate will not count them.

Each area's stage-05 gate accumulates two approvals from reviewers
whose own area is different.

**Stage manager guidance — FAIL with no `changes_requested`.** When a gate shows
`status: "FAIL"` and `changes_requested` is empty, it means quorum has not
been reached — no one has blocked the change. Steps:

1. Run `devteam derive-approvals` first. The hook processes all existing
   `by-*.md` files; approvals written in a prior session are not automatically
   re-derived on session start.
2. If still FAIL after re-derive, read the gate's `action_required` field —
   it lists how many more approvals are needed and which reviewers are eligible.
3. Have an eligible reviewer add the missing `## Review of <area>` section to
   their `pipeline/code-review/by-<role>.md`, then run `devteam derive-approvals`
   and `devteam merge peer-review`.

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

**`blockers[]` extraction (hook-written).** When parsing a section that
ends with `REVIEW: CHANGES REQUESTED`, the hook also extracts every
`BLOCKER: <text>` line from that section and writes them into the
per-area gate as a `blockers` array. This lets stage managers read blocker
text directly from the gate without grepping review files:

```json
{
  "stage": "stage-05", "workstream": "backend",
  "status": "FAIL",
  "changes_requested": [{ "reviewer": "dev-platform", "timestamp": "…" }],
  "blockers": [
    { "reviewer": "dev-platform", "text": "Missing pagination on ListUsersCommand — truncates at 100" },
    { "reviewer": "dev-platform", "text": "iam_admin_users stub unconditionally emits PASS — remove or mark always_insufficient" }
  ]
}
```

Each entry carries `reviewer` (who wrote it) and `text` (the raw
`BLOCKER:` line with the prefix stripped). `blockers` is reset on each
hook run for that area so re-review that flips to `REVIEW: APPROVED`
clears the array.

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

**`affected_workstreams[]` on the merged gate.** When `devteam merge
peer-review` writes `pipeline/gates/stage-05.json`, it derives
`affected_workstreams` from the per-area gates: any area whose gate has
`changes_requested` non-empty contributes its area name. Since area names
map 1:1 to build workstreams (`backend` → `dev-backend`, etc.), this tells
stage managers exactly which agents to re-run:

```json
{
  "stage": "stage-05", "status": "FAIL",
  "affected_workstreams": ["backend"],
  "workstreams": [
    { "workstream": "backend",  "status": "FAIL" },
    { "workstream": "frontend", "status": "PASS" },
    { "workstream": "platform", "status": "PASS" }
  ]
}
```

Per-area gates do not carry `affected_workstreams` — the area name itself
is the attribution. Use the merged gate for the stage-manager-facing query.

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

