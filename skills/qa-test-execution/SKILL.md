---
name: qa-test-execution
description: "QA Developer: Stage 6 test-execution phase. Run the full test suite, produce pipeline/test-report.md, and write pipeline/gates/stage-06.json. Use after test authoring (skills/qa-test-authoring/SKILL.md)."
---

# QA Test-Execution Task (Stage 6 run phase)

Use this skill when you are the QA Developer running the test suite during
the Stage 6 execution phase. Test authoring is a separate step; see
`skills/qa-test-authoring/SKILL.md`.

## Procedure

1. Run the full test suite via the project's standard command
   (`npm test`, `pytest`, etc.).
2. Produce `pipeline/test-report.md` with this shape:

   ```markdown
   # Test Report — <feature>

   **Run**: <ISO timestamp>
   **Total**: <n> tests — <p> passed / <f> failed

   ## Acceptance Criteria Coverage

   | # | Criterion | Test(s) | Result |
   |---|-----------|---------|--------|
   | 1 | <text>    | `unit/ac1.test.ts::happy-path` | PASS |
   | 2 | <text>    | `integration/ac2.test.ts` | FAIL |

   ## Failing Tests

   ### `integration/ac2.test.ts::…`
   ```
   <error output>
   ```
   Assigned to: <backend|frontend|platform>
   ```

3. Write `pipeline/gates/stage-06.json`. Required fields:

   ```json
   {
     "stage": "stage-06",
     "status": "PASS" | "FAIL" | "ESCALATE",
     "workstream": "qa",
     "track": "<track>",
     "timestamp": "<ISO>",
     "all_acceptance_criteria_met": true | false,
     "tests_total": 0,
     "tests_passed": 0,
     "tests_failed": 0,
     "failing_tests": [],
     "assigned_retry_to": null,
     "affected_workstreams": [],
     "criterion_to_test_mapping_is_one_to_one": true | false
   }
   ```

   Set `criterion_to_test_mapping_is_one_to_one` to `true` only if every
   acceptance criterion has a dedicated test and no test covers multiple
   criteria with distinct verify conditions. When in doubt, set `false`.

   **`noted_for_followup[]` (non-blocking observations).** When you observe
   something worth tracking that isn't a test failure — a coverage gap, a
   testability concern, a missing edge-case scenario the brief didn't require
   — emit it in `noted_for_followup` as a structured object rather than a
   `warnings[]` string. Use `warnings[]` for transient issues (e.g. test
   suite configuration problems); use `noted_for_followup` for durable work
   items that should survive the pipeline run. Schema and `track_for` values
   are in `.devteam/rules/gates-core.md §noted_for_followup[]`.

   ```json
   "noted_for_followup": [
     {
       "id": "QA-01",
       "text": "No test covers the case where --output-dir is not writable; silent failure risk.",
       "track_for": "ticket",
       "file": "src/cli.js",
       "effort": "S"
     },
     {
       "id": "QA-02",
       "text": "AC-8 integration test mocks the credential check; a real expired-credential path test would be more reliable.",
       "track_for": "brief-amendment",
       "effort": "M"
     }
   ]
   ```

   **`affected_workstreams` (required on FAIL).** When `status` is `FAIL`,
   set `affected_workstreams` to the deduplicated, sorted list of
   `assigned_to` values from `failing_tests`. This tells stage managers which
   build workstreams to re-run without reading every test entry:

   ```json
   "failing_tests": [
     { "file": "src/tests/integration/ac01.test.js", "assigned_to": "backend", ... },
     { "file": "src/tests/integration/ac07.test.js", "assigned_to": "backend", ... }
   ],
   "assigned_retry_to": "backend",
   "affected_workstreams": ["backend"]
   ```

   When multiple workstreams are implicated, list all of them:

   ```json
   "affected_workstreams": ["backend", "platform"]
   ```

   `assigned_retry_to` becomes the **primary** workstream (the one with
   the most failures or the most severe); `affected_workstreams` is the
   complete list. Leave `affected_workstreams: []` and
   `assigned_retry_to: null` when `status` is `PASS`.

   **Orchestrator-stamped fields.** After you write this gate, the
   orchestrator runs the configured test command itself and parses
   `pipeline/test-report.md` to cross-check that every `AC-N` from
   `pipeline/brief.md` is mapped to at least one test row. If the
   test command exits non-zero, or any AC is unmapped, the orchestrator
   overrides `all_acceptance_criteria_met` to `false`, adds a structured
   blocker, and flips the gate's status to FAIL. The override is
   recorded in `_orchestrator_stamped`. Be honest in your initial
   write — `devteam verify stage-06` will catch a discrepancy and the
   audit trail will record both your claim and the orchestrator's
   observation.

4. On failure: identify the owning dev from the failing-test path and set
   `"assigned_retry_to"` accordingly. The orchestrator re-invokes that dev.

Retry limit: 3 cycles. On the 3rd identical failure, auto-escalate to
Principal per `.devteam/rules/gates-core.md` §Retry Protocol.
