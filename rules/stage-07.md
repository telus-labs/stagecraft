# Stage 7 — PM Sign-off

Invoke: `pm` agent
Input: `pipeline/test-report.md` + `pipeline/brief.md`
Output: sign-off appended to `pipeline/gates/stage-07.json`
Gate key: `"pm_signoff": true`

On NO: PM writes delta list. Return to Stage 4 with delta items only.
Delta items must not trigger a full pipeline rerun — scope them explicitly.

### Auto-fold from Stage 6

When Stage 6 maps every acceptance criterion 1:1 to a passing test and
sets `"all_acceptance_criteria_met": true`, the orchestrator auto-writes
Stage 7 without invoking the PM:

```json
{
  "stage": "stage-07",
  "status": "PASS",
  "pm_signoff": true,
  "auto_from_stage_06": true,
  "track": "<track>",
  "agent": "orchestrator",
  "timestamp": "<ISO>",
  "blockers": [],
  "warnings": []
}
```

The auto-fold is skipped (and the PM agent invoked normally) when:

- `"all_acceptance_criteria_met"` is not `true` in Stage 6
- The Stage 6 test report does not have a 1:1 criterion-to-test mapping
  (one test covers multiple criteria, or one criterion has no test)
- The user explicitly requested a manual sign-off
- The track is `/hotfix` (hotfixes always require PM sign-off)

Rationale: when criteria are clean, Stage 7 re-derives the same verdict
the platform dev already wrote at Stage 6. PM judgment adds value on
delta items and edge cases, not on rubber-stamping a clean sheet.

