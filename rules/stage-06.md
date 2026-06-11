# Stage 6 — Test & CI (QA Dev)

Invoke: `dev-qa` agent.
Input: `src/` + `pipeline/brief.md` (acceptance criteria).
Output: `pipeline/test-report.md`.

**Coverage scope.** Every `AC-N` in `pipeline/brief.md` must be exercised by at least one test. AC coverage is the floor, not the ceiling. Two additional categories always require explicit tests regardless of whether they appear in the ACs:

1. **Custom structured logging/observability formatters.** If the service implements a custom log formatter, encoder, or structured log schema, include at least one test that calls the formatter directly with edge-case inputs (empty string, embedded quotes, backslash, control characters) and asserts the output is parseable by the target consumer (e.g., `json.loads` for JSON-structured logs). Reason: logging frameworks — Python's `logging.Handler.emit()`, Go's `slog`, Java's `Appender.append()` — catch formatter exceptions internally and write to stderr. A broken formatter is completely invisible to HTTP-response tests; the service continues serving correct responses while silently dropping every log line.

2. **Input validation boundaries.** Each validation rule that rejects input (empty text, unrecognised model, oversized payload) needs both the rejection test and at least one test at the exact acceptance boundary, not just a value well inside the valid range.

On failure: identify owning dev from the failing test's path (dev-qa
writes `"assigned_retry_to"` in the gate), invoke that dev with the
failure context. Retry limit: 3 cycles. On 3rd identical failure,
auto-escalate to `principal`.

## Gate

Gate file: `pipeline/gates/stage-06.json`.

```json
{
  "stage": "stage-06",
  "status": "PASS | FAIL",
  "track": "full",
  "timestamp": "<ISO 8601>",
  "orchestrator": "devteam@<version>",
  "blockers": [],
  "warnings": [],
  "all_acceptance_criteria_met": true,
  "tests_total": 42,
  "tests_passed": 42,
  "tests_failed": 0,
  "failing_tests": [],
  "assigned_retry_to": null,
  "criterion_to_test_mapping_is_one_to_one": true,
  "scenarios_total": 5,
  "scenarios_covered": 5,
  "all_scenarios_have_tests": true,
  "noted_for_followup": []
}
```

`criterion_to_test_mapping_is_one_to_one` drives the Stage 7 auto-fold.
Set `true` only when every AC has a dedicated test and no test covers multiple
criteria with distinct verify conditions. When in doubt, set `false`.

After gate passes → HUMAN CHECKPOINT C.

