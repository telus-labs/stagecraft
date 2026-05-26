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

1. Stop the pipeline immediately
2. Print the `escalation_reason` and `decision_needed` to the user
3. Show `options` as choices
4. Wait for explicit user response
5. Record the user's decision in `pipeline/context.md` under `## User Decisions`
6. Resume the pipeline at `pipeline_halted_at`

## What is NOT an Escalation

- A FAIL gate with a clear fix → retry with the owning agent
- A reviewer suggestion (not blocker) → record as warning, proceed
- An ambiguous requirement that was already answered in `pipeline/context.md`
