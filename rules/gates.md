# Gate Schema

Every stage writes a JSON gate file to `pipeline/gates/`.
The orchestrator reads JSON, not prose. Gates are machine-readable.

## Required Fields (all gates)

```json
{
  "stage": "string",
  "status": "PASS | WARN | FAIL | ESCALATE",
  "orchestrator": "devteam@<version>",
  "track": "full | quick | nano | config-only | dep-update | hotfix",
  "timestamp": "ISO 8601",
  "blockers": [],
  "warnings": []
}
```

### `affected_workstreams[]` — required on FAIL gates

When `status` is `FAIL`, gates must include an `affected_workstreams` array
naming the Stage 4 build workstreams that own the reported defects. This is
the single field stage managers use to decide which gates to clear and which agents
to re-run — the answer to "who needs to fix this?" in one `jq` call:

```bash
jq .affected_workstreams pipeline/gates/<stage>.json
# → ["backend"]          re-run only backend
# → ["backend", "platform"]  re-run both
```

How each gate type derives the value:

| Gate | Source | Derivation |
|------|--------|------------|
| `stage-04c` (red-team) | `findings[].file` × each workstream's `files_written[]` in their build gate | Red-team agent cross-references before writing gate |
| `stage-04.qa` (QA-within-build) | `failing_tests[].assigned_to` | QA agent deduplicates into the array |
| `stage-06` (test execution) | `failing_tests[].assigned_to` | QA agent deduplicates into the array |
| `stage-06c` (observability) | `gap[].assigned_to` across metrics, logs, traces | Platform agent deduplicates across all three `gap[]` arrays |
| `stage-05` merged (peer-review) | Area gates where `changes_requested` is non-empty | `devteam merge peer-review` derives at merge time |

`stage-05` per-area gates do not need this field — the area name *is* the
attribution (a `stage-05-backend.json` FAIL means the backend workstream must
fix). The merged gate's `affected_workstreams[]` covers the stage manager need for
that stage.

Omitting `affected_workstreams` on a FAIL gate is not a validator hard-stop
(existing gates without it remain valid), but newly written FAIL gates should
include it. The validator emits an advisory when it is absent on a FAIL gate.

### `noted_for_followup[]` — structured objects, not plain strings

Gates that produce non-blocking observations (red-team, QA) emit them in
`noted_for_followup` as objects, not plain strings. Each entry must carry:

| Field | Required | Notes |
|-------|----------|-------|
| `id` | yes | Stable identifier within the gate, e.g. `RT-06`, `QA-02` |
| `text` | yes | One-sentence description of the observation |
| `track_for` | yes | Where this should land — see values below |
| `file` | no | Source file (with optional `:line`), when applicable |
| `effort` | no | `XS / S / M / L / XL` — rough fix cost |

**`track_for` values:**

| Value | Meaning |
|-------|---------|
| `ticket` | Needs a tracked work item — surfaces in stage-07 `open_followups[]` and stage-09 gate |
| `lessons-learned` | Strong candidate for promotion to `pipeline/lessons-learned.md` in the retrospective |
| `adr-amendment` | An existing ADR should be updated to capture this decision or constraint |
| `brief-amendment` | A future brief's acceptance criteria should include this |
| `deploy-note` | Should be documented in the deploy runbook before this goes to production |

Example:

```json
"noted_for_followup": [
  {
    "id": "RT-06",
    "text": "--cloudtrail-days 0 silently falls back to 90 due to falsy guard; user intent is ignored.",
    "track_for": "ticket",
    "file": "src/cli.js:127",
    "effort": "XS"
  },
  {
    "id": "RT-08",
    "text": "No retry logic for transient AWS errors; design-spec §9 requires exponential backoff.",
    "track_for": "ticket",
    "file": "src/backend/collectors/aws-cloudtrail.js",
    "effort": "S"
  },
  {
    "id": "RT-12",
    "text": "Same evidence_hash across records for multi-control artifacts — by design per OQ-5.",
    "track_for": "adr-amendment",
    "effort": "XS"
  }
]
```

Plain-string `noted_for_followup` entries are still accepted by the validator
(backwards compatibility), but newly written gates should use the object form.
The retrospective step and stage-07 PM sign-off only process object-form entries.

Items with `track_for: "ticket"` surface in `open_followups[]` in the stage-07
and stage-09 gates. To extract those as ticket-ready stubs, see
[`docs/runbooks/open-followups.md`](../docs/runbooks/open-followups.md).

The legacy `agent` field has been removed. The orchestrator adds `orchestrator` automatically — the role writing the gate does not provide it.

## Workstream vs. stage gates

Stages with a single role (PM brief, Principal design, QA tests, etc.) write **one stage gate** at `pipeline/gates/<stage>.json`.

Stages with multiple roles (`stage-04` build → backend / frontend / platform / qa; `stage-05` review → per area) write **one workstream gate per role**, and the orchestrator merges them into the stage gate.

Workstream gates carry two additional identity fields:

```json
{
  "workstream": "backend",
  "host": "claude-code"
}
```

`workstream` is the role; `host` is the adapter that produced the gate (e.g. `claude-code`, `codex`, `generic`). The role writes `workstream`; the orchestrator fills `host` at validation time.

Workstream gate path: `pipeline/gates/<stage>.<workstream>.json` (e.g. `pipeline/gates/stage-04.backend.json`).

Merged stage gate adds a `workstreams[]` array:

```json
{
  "stage": "stage-04",
  "status": "PASS",
  "orchestrator": "devteam@1.0",
  "workstreams": [
    { "workstream": "backend",  "host": "codex",       "status": "PASS" },
    { "workstream": "frontend", "host": "claude-code", "status": "PASS" }
  ]
}
```

Aggregate status: `ESCALATE` wins over `FAIL` wins over `WARN` wins over `PASS`.

## Stage-Specific Extra Fields

### Stage 01 (PM brief)
```json
{
  "acceptance_criteria_count": 5,
  "out_of_scope_items": [],
  "required_sections_complete": true
}
```

`required_sections_complete` must be `true` when the brief
contains all sections required for its track. Required sections:

- Every track: §1–§5 (Problem, Stories, Acceptance Criteria, Out of
  Scope, Open Questions)
- `full` and `hotfix`: also §6–§11 (Rollback, Feature Flag, Data
  Migration, Observability, SLO, Cost)
- `quick`, `config-only`, `dep-update`: §1–§5 plus either §6–§11 or a
  single `## Risk notes` line when the change is trivial on all six
  dimensions

See `docs/brief-template.md` for the canonical shape.

### Stage 02 (Design)
```json
{ "arch_approved": true, "pm_approved": true, "adr_count": 2 }
```

### Stage 04 (Build, per area)
```json
{ "area": "backend | frontend | platform", "files_changed": [] }
```

### Stage 04a (Pre-review automated checks)
```json
{
  "stage": "stage-04a",
  "workstream": "platform",
  "status": "PASS | FAIL",
  "lint_passed": true,
  "type_check_passed": true,
  "sca_findings": { "high": 0, "critical": 0 },
  "dependency_review_passed": true,
  "license_check_passed": true,
  "license_findings": [
    { "package": "some-gpl-pkg@1.2.0", "license": "GPL-3.0", "policy": "denied" },
    { "package": "mystery-pkg@0.1.0",  "license": "UNLICENSED", "policy": "warned", "note": "internal package, no license file" }
  ],
  "security_review_required": false,
  "migration_safety_required": false
}
```

`license_check_passed` is `false` when any `license_findings` entry has
`policy: "denied"` (strong copyleft). `policy: "warned"` entries do not
block the gate — they appear as `warnings[]` for human review.
`license_findings` only includes non-allowed packages; packages on the
default permissive list (MIT, Apache-2.0, BSD-*, ISC, CC0, Unlicense) are
not recorded.

Runs after all Stage 4 area gates pass and before Stage 5 peer review
starts. See `roles/platform.md` §"On a Pre-Review Task".

### Stage 04a-security (Security review, conditional)
```json
{
  "stage": "stage-04a-security",
  "workstream": "security",
  "status": "PASS | FAIL",
  "security_approved": true | false,
  "veto": true | false,
  "triggering_conditions": ["path:auth", "dep:upgrade"]
}
```

Written only when the heuristic in `.devteam/rules/pipeline.md` Stage
4.5b fires. A `veto: true` gate halts the pipeline regardless of other
gates — the security-engineer must personally re-review the fix and
flip the flag. Peer-review approvals cannot override a veto.

When the heuristic does not fire, no gate file is written. The
orchestrator records the skip decision in `pipeline/context.md` under
`## Brief Changes` as `SECURITY-SKIP: <reason>`.

### Stage 04c (Red-team)

```json
{
  "stage": "stage-04c",
  "workstream": "red-team",
  "status": "PASS | WARN | FAIL",
  "surfaces_walked": ["input_boundaries", "state_boundaries", "sequence_boundaries"],
  "surfaces_skipped": [
    { "surface": "auth_edges", "reason": "auth path unchanged — change adds no new authz checks" },
    { "surface": "resource_exhaustion", "reason": "no unbounded loops; only reads from a fixed-size config map" }
  ],
  "findings_count": 3,
  "severity_breakdown": { "critical": 0, "high": 1, "medium": 1, "low": 1 },
  "affected_workstreams": ["backend"],
  "must_address_before_peer_review": [
    { "id": "RT-01", "workstream": "backend", "file": "src/backend/controls/mapping.js", "severity": "high", "scenario": "..." }
  ],
  "noted_for_followup": [
    { "id": "RT-06", "text": "...", "track_for": "ticket", "file": "src/cli.js:127", "effort": "XS" }
  ]
}
```

`surfaces_walked` and `surfaces_skipped` together must account for all 10 attack surfaces (input_boundaries, state_boundaries, sequence_boundaries, integration_boundaries, auth_edges, resource_exhaustion, failure_modes, abuse_cases, downstream_effects, observability_gaps). A gate where the two arrays don't cover all 10 surfaces is incomplete — the validator will emit an advisory.

`surfaces_skipped` entries carry the surface name (matching the canonical snake_case names above) and a one-line reason. This makes a fast PASS trustworthy: stage managers can verify "I skipped auth_edges because X" rather than inferring that the agent missed it.

### Stage 05 (Code review, per area)
```json
{
  "area": "backend | frontend | platform | qa",
  "review_shape": "scoped | matrix",
  "required_approvals": 1 | 2,
  "approvals": ["dev-frontend", "security-engineer"],
  "changes_requested": [
    { "reviewer": "dev-backend", "timestamp": "<ISO>" }
  ],
  "escalated_to_principal": false
}
```

**Authorship.** The `approvals` and `changes_requested`
arrays are written by the `approval-derivation.js` hook, not by the
reviewer agent. The hook parses per-area sections in
`pipeline/code-review/by-<reviewer>.md` for `REVIEW: APPROVED` or
`REVIEW: CHANGES REQUESTED` markers and reconciles the gate. Agents
that write `approvals` directly will have their writes overwritten on
the next reviewer file save — the hook is authoritative.

**Review shape.** The orchestrator picks shape before Stage
5 begins:
- `scoped` — diff is area-contained; `required_approvals: 1`. One
  reviewer from a different area suffices.
- `matrix` — diff crosses areas; `required_approvals: 2`. The original
  v1 matrix applies (each dev reviews the other two).

**Status resolution.** `status: "PASS"` when
`approvals.length >= required_approvals` AND `changes_requested` is
empty. Otherwise `status: "FAIL"`.

**Validity rule (still honour-system, enforcement deferred).** The
READ-ONLY Reviewer Rule in `pipeline.md` forbids fix-forward patches.
Automated detection (checking git status against reviewer activity)
requires agent-identity tracking the current hook surface doesn't
expose reliably. For now, any gate whose named approver modified
`src/` in the same invocation is logically invalid even if it passes
JSON validation — reviewers should self-enforce.

### Stage 06 (Tests)
```json
{
  "all_acceptance_criteria_met": true,
  "tests_total": 0,
  "tests_passed": 0,
  "tests_failed": 0,
  "failing_tests": [],
  "assigned_retry_to": null,
  "criterion_to_test_mapping_is_one_to_one": true
}
```

Authored by `dev-qa`.

`criterion_to_test_mapping_is_one_to_one` is required for the
Stage 7 auto-fold. Set `true` only if every acceptance criterion has a
dedicated test and no test covers multiple criteria with distinct
verify conditions. When in doubt, set `false` and let the PM perform
a manual sign-off.

### Stage 07 (PM sign-off)
```json
{ "pm_signoff": true, "delta_items": [] }
```

Auto-fold from Stage 6: when Stage 6 has `"all_acceptance_criteria_met":
true` and a 1:1 criterion-to-test mapping, the orchestrator writes Stage
7 directly with:

```json
{
  "pm_signoff": true,
  "auto_from_stage_06": true,
  "delta_items": []
}
```

The `auto_from_stage_06` flag is the discriminator. On the auto-fold path the orchestrator authors the gate directly, so `workstream` is `"orchestrator"` rather than `"pm"` — downstream tooling that filters gates by workstream should allow both values for stage-07. See `.devteam/rules/pipeline.md` Stage 7 for the skip conditions.

### Stage 08 (Deploy, adapter-driven)
```json
{
  "stage": "stage-08",
  "workstream": "platform",
  "status": "PASS",
  "track": "<track>",
  "timestamp": "<ISO>",
  "deploy_adapter": "docker-compose | kubernetes | terraform | custom",
  "environment": "<adapter-specific>",
  "smoke_test_passed": true,
  "runbook_referenced": true,
  "adapter_result": { "<adapter-specific fields>": "..." },
  "blockers": [],
  "warnings": []
}
```

Note: `deploy_adapter` is the **deploy** adapter (Stage 8 target — docker-compose / kubernetes / terraform / custom). The **host** adapter (which AI tool produced the gate) lives in the top-level `host` field.

The gate passes only when `status: "PASS"` AND `runbook_referenced:
true`. The runbook check confirms that `pipeline/runbook.md` exists
and contains at minimum `## Rollback` and `## Health signals`
sections — a missing runbook causes `status: "ESCALATE"` at the
start of Stage 8, not a FAIL later.

The `adapter` field identifies which adapter ran. The
`adapter_result` block carries fields specific to that adapter — see
`.devteam/adapters/<adapter>.md` for the per-adapter shape. Tooling
that reads stage-08 gates should branch on `adapter` before reading
`adapter_result`.

### Stage 09 (Retrospective)
Informational gate — status is PASS unless synthesis itself failed.
```json
{
  "severity": "green | yellow | red",
  "lessons_promoted": ["L007 — clarify notify channel in brief"],
  "lessons_retired": ["L002 — prefer offset pagination"],
  "aged_out": ["L019 — avoid trailing slash in URLs"],
  "patterns_harvested": 3,
  "contributions_written": [
    "pm", "principal",
    "dev-backend", "dev-frontend", "dev-platform", "dev-qa"
  ]
}
```

**Field semantics**:
- `aged_out` — rules retired via the age-out rule (not reinforced in
  10 runs + current `Reinforced` is 0). Distinct from `lessons_retired`,
  which is for rules explicitly proven wrong or internalised.
- `patterns_harvested` — count of `PATTERN:` entries the Principal
  pulled from Stage 5 review files during synthesis, before
  selection for promotion.
- `contributions_written` — typically includes all dev roles; the
  security-engineer contributes when Stage 4b fired.

## Retry Protocol

On FAIL gates with retries, include:
```json
{
  "retry_number": 1,
  "previous_failure_reason": "string",
  "this_attempt_differs_by": "string — required, must be non-empty"
}
```

If `retry_number` >= 2 AND `failing_tests` matches previous FAIL gate exactly:
set `"status": "ESCALATE"` and halt. Same failure twice = escalate, don't retry.

**Enforced**: the validator exits 1 on any gate where
`retry_number >= 1` but `this_attempt_differs_by` is missing or empty. The
fix is to state the delta explicitly before re-writing the gate.

---

## Failure classification (`next()` `failure_class`)

`devteam next` tags every non-pass action with a `failure_class` so the reader
(a human stage manager, or an autonomous driver later) reacts correctly instead
of treating every failure as a generic "retry." The class is derived from gate
state, not written into the gate. Classes (ADR-003):

| `failure_class` | When | What it means for you |
|---|---|---|
| `state-corruption` | gate file unreadable / malformed JSON | Re-running the stage **won't** help — repair or rewrite the gate file. |
| `judgment-gate` | gate `status: ESCALATE` | Needs a ruling (`devteam ruling`), not a retry. |
| `external-blocked` | `status: FAIL` and every computed fix step is human/external action with no command | A person must act (e.g. obtain sign-off); the pipeline can't self-advance. |
| `code-defect` | `status: FAIL` with executable fix steps (or no recipe) | The implementing agent must change code; re-dispatch the workstream. |
| `convergence-exhausted` | `status: FAIL` and `retry_number >= autonomy.max_retries` | Retry budget spent; `next()` returns `resolve-escalation` instead of another fix-and-retry. |

`convergence-exhausted` is the orchestrator-side backstop for the Retry Protocol
above: agents are expected to self-escalate when the same failure repeats, and
`next()` independently escalates once the count-based ceiling
(`autonomy.max_retries` in `.devteam/config.yml`, default **2**) is reached.
Progress-based detection (escalating when blocker counts stop decreasing) is a
follow-up — it requires archiving prior attempts, which this layer does not add.

`failure_class` is additive metadata on the existing `fix-and-retry` /
`resolve-escalation` actions; the action vocabulary is unchanged. It appears in
`devteam next --json` (alongside a `schema_version` field) and as a `[tag]` in
the human-readable output.

---

## Track field

Every gate should carry a `"track"` field identifying which pipeline
track the gate belongs to. Valid values: `full`, `quick`, `config-only`,
`dep-update`, `hotfix`.

```json
{ "track": "full" }
```

The validator emits an advisory (non-blocking) when the field is missing
or carries an unrecognised value. Downstream tooling that branches on
track should treat "missing" as "full" for compatibility.

---

## What the validator enforces

The `gate-validator.js` hook runs after every subagent stop. It performs these checks in order:

1. **Bypassed-escalation sweep.** Across all gate files, if any gate has
   `"status": "ESCALATE"` but is not the most recently modified, the
   pipeline has written a later gate without resolving the earlier
   escalation. The validator exits 3 and reports which gate was bypassed.
2. **Most-recent-gate status.** The primary exit code still reflects the
   most recently modified gate: 0 on PASS, 2 on FAIL, 3 on ESCALATE.
3. **Required-field presence.** Exits 1 on gates missing any of `stage`,
   `status`, `orchestrator`, `timestamp`, `blockers`, `warnings`. Workstream gates additionally require `workstream` and `host`.
4. **Retry integrity.** Exits 1 when `retry_number >= 1` without a
   non-empty `this_attempt_differs_by` string (see above).
5. **Advisory: track field.** Warns without halting when `track` is
   missing or unrecognised.
6. **Advisory: lessons-learned format.** Scans `pipeline/lessons-learned.md`
   for malformed `**Reinforced:**` lines. Only two forms are valid:
   - `**Reinforced:** 0` (no suffix; lesson has never been reinforced)
   - `**Reinforced:** <N> (last: YYYY-MM-DD)` where N ≥ 1

Unexpected internal errors in the validator itself are downgraded to a
WARN and exit 0 so a bug in the hook never halts a live pipeline. The
test suite at `tests/gate-validator.test.js` is the authoritative check
for correct validator behaviour.
