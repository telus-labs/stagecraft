## fix(6.2): orchestrator stamps stage-03b — pm brief no longer needs Bash

**Scope**: Phase 6.2 — Promise Integrity: PM role/shell contradiction.

### What was broken

`roles/pm.md` stage-03b procedure instructed the pm to run `devteam spec generate`
and `devteam spec verify` (shell commands), but pm's declared tool budget is
`Read, Write, Glob` — no Bash. Under claude-code's native tool-budget enforcement
the pm subagent cannot execute its own brief: the instructions are unreachable.

Additionally, no mechanical check existed to catch future budget/brief contradictions
of the same kind.

### What changed

#### `core/verify/stamp.js` — `stampStage03b()`

New stamping function added to the orchestrator layer. After the pm agent writes
`pipeline/gates/stage-03b.json`, the orchestrator now:

1. Generates `pipeline/spec.feature` via `generateScaffold()` (from `core/spec/verify.js`)
   if the file is absent — one scaffold scenario per AC in `brief.md`.
2. Runs `verify()` (pure Node.js, same function `devteam spec verify` uses) to detect
   drift between `brief.md` acceptance criteria and `spec.feature` scenarios.
3. Stamps all seven spec-related gate fields with model-said vs orchestrator-observed:

| Field | Stamped value |
|-------|---------------|
| `criteria_count` | AC count from `brief.md` |
| `scenarios_count` | scenario count from `spec.feature` |
| `criteria_to_scenario_mapping` | per-criterion scenario names |
| `all_criteria_mapped` | true iff no orphan criteria or duplicates |
| `orphan_scenarios` | scenario names with no matching AC |
| `orphan_criteria` | AC IDs with no matching scenario |
| `drift` | true iff any orphan or duplicate found |

If `drift` is true or `all_criteria_mapped` is false, a blocker is appended and
the gate status flips to FAIL — same `finalizeStamp` pattern as stage-04a/06.

`"stage-03b"` added to `STAMPABLE_STAGES`.

#### `roles/pm.md` — stage-03b procedure rewritten

The pm's stage-03b procedure now:
- Reads `brief.md` for acceptance criteria (source of truth).
- Reads or writes `spec.feature` directly via the Write tool — one scenario per AC,
  each tagged `@AC-N`, with concrete Given/When/Then steps.
- Writes `pipeline/gates/stage-03b.json` with its self-assessment.
- No shell commands appear anywhere in the procedure.

A note clarifies that `devteam spec generate` and `devteam spec verify` are pipeline
shell commands the orchestrator runs on the pm's behalf after dispatch.

Rejected alternative — grant pm Bash: verification belongs to the orchestrator, not
to an agent self-certifying what the orchestrator should verify.

#### `scripts/consistency.js` — new check class `role-budget-brief`

`checkRoleBriefToolBudgetCompatibility()` scans `roles/*.md`. For each role whose
`toolBudgetFor()` result does not include Bash, any line matching
`` Run `devteam <subcommand>` `` is flagged as a violation. The check distinguishes
imperative instructions ("Run `devteam …`") from informational references
(`` `devteam …` `` without the leading "Run"), so descriptions of what the pipeline
does are not penalised. The real `roles/` tree produces zero violations after the
`pm.md` rewrite.

### Tests added

**`tests/verify-stamp.test.js`** — 6 new tests for `stampStage03b`:
- Happy path: all 7 gate fields stamped correctly, `drift=false`, status PASS.
- Drift detected: status flips to FAIL, `model_said` recorded, blocker appended.
- Scaffold generated when `spec.feature` is absent.
- Graceful skip when `brief.md` is absent (track without requirements stage).
- `model_said` vs orchestrator captured on count mismatch.
- `stamp()` dispatch round-trip for `"stage-03b"`.

**`tests/consistency-meta.test.js`** — 4 new tests for `role-budget-brief`:
- `"Run \`devteam spec generate\`"` in a no-Bash role → violation detected (exit 1).
- Same command in a role with Bash (e.g. qa) → no violation (exit 0).
- Informational reference `` `devteam spec generate` `` without "Run" → no violation.
- Real `roles/` regression guard → 0 violations after `pm.md` rewrite (exit 0).
