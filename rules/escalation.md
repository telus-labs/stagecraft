# Escalation Rules

Any agent may write `"status": "ESCALATE"` to their gate file.

## When to Escalate

- An agent cannot proceed without information only the user can provide
- A reviewer finds an issue that contradicts the approved design spec
- Two reviewers disagree and neither will yield
- The same test fails on retry 2 with the same root cause as retry 1
- A deploy fails in a way that requires infrastructure changes outside the pipeline
- The PM's sign-off delta list would require re-architecting (not just fixing)

## Escalation Format

In the gate file:
```json
{
  "status": "ESCALATE",
  "escalated_by": "agent-name",
  "escalation_reason": "clear one-sentence description",
  "decision_needed": "specific question the user must answer",
  "options": ["option A", "option B"],
  "pipeline_halted_at": "stage-XX"
}
```

## Orchestrator Behaviour on ESCALATE

1. Stop the pipeline immediately.
2. `devteam next` returns `resolve-escalation` with the gate path, `escalation_reason`, and `decision_needed`.
3. The stage manager invokes `devteam ruling [--target-gate <path>] [--headless]`.
   `--topic` is optional — when omitted, it is auto-derived from `escalation_reason` + `decision_needed` in the gate.
4. The Principal subagent writes a `PRINCIPAL-RULING: <topic> → <decision>` line into `pipeline/context.md § Principal Rulings`.
5. The stage manager runs `devteam fix-escalation [--headless]`, which reads the `PRINCIPAL-RULING:` entries and dispatches an applicator agent that clears the right gates and re-runs the indicated stages automatically.
6. The pipeline resumes at `pipeline_halted_at` once the escalating gate no longer reports `ESCALATE`.

For the full resolution procedure — including the defer path (no fix needed, just a ticket) and the two-round peer-review exhaustion shape — see `docs/runbooks/escalation.md`.

## What is NOT an Escalation

- A FAIL gate with a clear fix → retry with the owning agent
- A reviewer suggestion (not blocker) → record as warning, proceed
- An ambiguous requirement that was already answered in `pipeline/context.md`
