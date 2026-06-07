# Stage 6 — Test & CI (QA Dev)

Invoke: `dev-qa` agent.
Input: `src/` + `pipeline/brief.md` (acceptance criteria).
Output: `pipeline/test-report.md`.

**Coverage scope.** Every `AC-N` in `pipeline/brief.md` must be exercised by at least one test. AC coverage is the floor, not the ceiling. Two additional categories always require explicit tests regardless of whether they appear in the ACs:

1. **Custom structured logging/observability formatters.** If the service implements a custom log formatter, encoder, or structured log schema, include at least one test that calls the formatter directly with edge-case inputs (empty string, embedded quotes, backslash, control characters) and asserts the output is parseable by the target consumer (e.g., `json.loads` for JSON-structured logs). Reason: logging frameworks — Python's `logging.Handler.emit()`, Go's `slog`, Java's `Appender.append()` — catch formatter exceptions internally and write to stderr. A broken formatter is completely invisible to HTTP-response tests; the service continues serving correct responses while silently dropping every log line.

2. **Input validation boundaries.** Each validation rule that rejects input (empty text, unrecognised model, oversized payload) needs both the rejection test and at least one test at the exact acceptance boundary, not just a value well inside the valid range.

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

