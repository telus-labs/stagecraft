# Stage 6 — Test & CI (QA Dev)

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

