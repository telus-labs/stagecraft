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

`required_sections_complete` (v2.2+) must be `true` when the brief
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
  "license_check_passed": true
}
```

Runs after all three Stage 4 area gates pass and before Stage 5 peer
review starts. See `.devteam/rules/pipeline.md` Stage 4.5 and
`roles/dev-platform.md` §"On a Pre-Review Task".

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

### Stage 05 (Code review, per area, v2.3.1+)
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

**Authorship (v2.3.1+).** The `approvals` and `changes_requested`
arrays are written by the `approval-derivation.js` hook, not by the
reviewer agent. The hook parses per-area sections in
`pipeline/code-review/by-<reviewer>.md` for `REVIEW: APPROVED` or
`REVIEW: CHANGES REQUESTED` markers and reconciles the gate. Agents
that write `approvals` directly will have their writes overwritten on
the next reviewer file save — the hook is authoritative.

**Review shape (v2.3.1+).** The orchestrator picks shape before Stage
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

Authored by `dev-qa` from v2.3 forward (`dev-platform` in v1–v2.2).

`criterion_to_test_mapping_is_one_to_one` (v2.3+) is required for the
Stage 7 auto-fold. Set `true` only if every acceptance criterion has a
dedicated test and no test covers multiple criteria with distinct
verify conditions. When in doubt, set `false` and let the PM perform
a manual sign-off.

### Stage 07 (PM sign-off)
```json
{ "pm_signoff": true, "delta_items": [] }
```

Auto-fold from Stage 6 (v2.2+): when Stage 6 has `"all_acceptance_criteria_met":
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

**v2.5+ fields**:
- `aged_out` — rules retired via the age-out rule (not reinforced in
  10 runs + current `Reinforced` is 0). Distinct from `lessons_retired`,
  which is for rules explicitly proven wrong or internalised.
- `patterns_harvested` — count of `PATTERN:` entries the Principal
  pulled from Stage 5 review files during synthesis, before
  selection for promotion.
- `contributions_written` — dev-qa was added in v2.3;
  security-engineer contributes when Stage 4.5b fired.

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

**Enforced since v2.1**: the validator exits 1 on any gate where
`retry_number >= 1` but `this_attempt_differs_by` is missing or empty. The
fix is to state the delta explicitly before re-writing the gate.

---

## Track field (v2.0+)

Every gate should carry a `"track"` field identifying which pipeline
track the gate belongs to. Valid values: `full`, `quick`, `config-only`,
`dep-update`, `hotfix`.

```json
{ "track": "full" }
```

The validator emits an advisory (non-blocking) when the field is missing
or carries an unrecognised value. Legacy gates written before v2.0 don't
carry the field — they still pass, but downstream tooling that branches on
track should treat "missing" as "full" for backward compatibility.

---

## What the validator enforces (v2.1)

The `gate-validator.js` hook runs after every subagent stop. As of v2.1
it performs these checks in order:

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
