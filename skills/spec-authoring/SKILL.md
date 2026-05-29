---
name: spec-authoring
description: G2 — translate a numbered acceptance-criteria list (AC-1, AC-2, ...) from pipeline/brief.md into Gherkin scenarios in pipeline/spec.feature. One Scenario per AC, tagged @AC-N. Drives stage-03b (executable-spec) and enables zero-drift mapping through QA.
---

# Spec authoring — closed-loop AC → Scenario → Test

The brief is in prose. Tests are in code. The gap between them is where
regression hides. The **executable spec** (Gherkin) is the bridge — every
brief AC becomes one Scenario, every Scenario must have at least one test.
`devteam spec verify` catches drift; the stage-03b gate records the mapping.

## When to use

You're authoring stage-03b. The orchestrator has just finished clarification
and your task is to translate the brief's `AC-N` lines into Gherkin scenarios
in `pipeline/spec.feature`. Tracks: `full`, `quick`.

## Phase 1 — Load context

Read in order:
1. `pipeline/brief.md` — extract every `AC-N` line. These are your inputs.
2. `pipeline/clarification-log.md` (if present) — answers may have refined ACs.
3. `pipeline/design-spec.md` (if present) — design hints the Given/When/Then.

Confirm the brief has at least one `AC-N` line. If it doesn't, stop — go back
to PM and tighten the brief first. Don't try to invent ACs from prose.

## Phase 2 — Scaffold

```
devteam spec generate
```

This writes `pipeline/spec.feature` with one `@AC-N` + `Scenario:` block per
AC found in brief.md. The Given/When/Then lines are TODO placeholders. The
scaffold makes it harder to forget an AC than to remember it.

If the file already exists, the command refuses to overwrite. Edit by hand
or pass `--force` (rare — usually you've drifted and want `verify` to tell
you exactly what's off).

## Phase 3 — Fill in steps

For each scenario:

- **Given** — the precondition. State of the system before the user acts.
  Concrete: "Given a user with email alice@test.io exists" — NOT "Given a
  user".
- **When** — the action. The thing that triggers the behaviour. One verb,
  one object: "When the user submits the sign-in form" — NOT "When the user
  signs in successfully" (don't smuggle the outcome into the action).
- **Then** — the observable outcome. From the outside of the system. "Then
  a session cookie is set with HttpOnly + SameSite=Strict" — NOT "Then the
  internal SessionService is called" (internals aren't observable).

Use `And` / `But` sparingly. If you need more than three Thens, the scenario
is probably covering two ACs — split it.

### Mapping rules

- **1 AC → 1 Scenario** is the target. If a criterion legitimately has two
  paths (happy + failure), prefer splitting the AC in brief.md into AC-1a
  and AC-1b first, then map each to its own Scenario.
- **Tag preferred over name embedding**: `@AC-3` on its own line above the
  Scenario is the canonical form. Verification also accepts the AC ID inside
  the Scenario name (`Scenario: AC-3 — user can sign in`) but the explicit
  tag scans better.
- **Don't tag a Scenario with multiple AC-Ns** — the mapping is ambiguous.
  If two ACs genuinely share the same observable behaviour, the second AC is
  redundant; remove it from the brief.

## Phase 4 — Verify

```
devteam spec verify
```

The verifier reads brief.md + spec.feature + (optionally) test-report.md and
prints a drift report. Exit code 0 means clean; non-zero means drift. The
report's `drift` field is the single boolean the stage-03b gate uses.

Common drift causes and fixes:

| Drift type            | Cause                                  | Fix                          |
|-----------------------|----------------------------------------|------------------------------|
| `orphan_criteria`     | AC-N in brief has no scenario          | Add a `@AC-N` Scenario, OR remove the AC |
| `orphan_scenarios`    | Scenario doesn't reference any AC      | Add `@AC-N`, or remove the scenario |
| `duplicate_criteria`  | AC-3 appears twice in brief.md         | Renumber one to AC-3a/3b     |
| `unknown_in_tests`    | test-report references AC not in brief | Fix the test-report row      |
| `orphan_in_tests`     | AC in brief has no test in report      | QA needs a test for this AC  |

## Phase 5 — Write the gate

Write `pipeline/gates/stage-03b.json`:

```json
{
  "stage": "stage-03b",
  "status": "PASS",
  "workstream": "pm",
  "track": "full",
  "timestamp": "<ISO>",
  "criteria_count": <int>,
  "scenarios_count": <int>,
  "criteria_to_scenario_mapping": [
    { "criterion_id": "AC-1", "scenarios": ["AC-1 — user signs in"] },
    { "criterion_id": "AC-2", "scenarios": ["AC-2 — password reset"] }
  ],
  "all_criteria_mapped": true,
  "orphan_scenarios": [],
  "orphan_criteria": [],
  "drift": false,
  "blockers": [],
  "warnings": []
}
```

`status: PASS` requires `drift: false` AND `all_criteria_mapped: true`. Any
other state is FAIL.

## What this skill does NOT do

- **Doesn't execute Gherkin.** The scenarios are spec, not runtime. QA writes
  the tests separately in stage-06; the mapping rule is what enforces 1:1.
- **Doesn't invent ACs.** If the brief is unclear, kick back to PM. Inventing
  ACs in the spec is exactly the drift this stage is designed to prevent.
- **Doesn't add Examples tables** for parametric tests. Out of scope for v1;
  if you need them, split the AC into multiple AC-Ns or document the
  variants inline.
