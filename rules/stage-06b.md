# Stage 6b — Accessibility audit (conditional on UI changes; tracks: full, quick, hotfix)

Invoke: `dev-qa` agent.
Input: `pipeline/brief.md`, `pipeline/design-spec.md`, `pipeline/test-report.md`, frontend PR summaries.
Output: `pipeline/accessibility-report.md`.
PASS requires `violations.critical === 0 AND violations.serious === 0`. Moderate/minor
findings flow through as warnings, not blockers. See `skills/accessibility-audit/SKILL.md`
for tool choice, procedure, triage, and gotchas.

## Gate

Gate file: `pipeline/gates/stage-06b.json`.

```json
{
  "stage": "stage-06b",
  "status": "PASS | FAIL",
  "track": "full",
  "timestamp": "<ISO 8601>",
  "orchestrator": "devteam@<version>",
  "blockers": [],
  "warnings": [],
  "audit_method": "axe-core | pa11y | lighthouse | manual",
  "wcag_level": "AA",
  "violations": { "critical": 0, "serious": 0, "moderate": 0, "minor": 0 },
  "components_audited": ["routes/dashboard", "components/Button"],
  "audit_skipped_reason": null,
  "noted_for_followup": []
}
```

`audit_skipped_reason`: when set, audit was intentionally skipped (backend-only
change, doc-only change, etc.); status should be PASS.

Moderate and minor violations that the stage manager should track belong in
`noted_for_followup[]` as structured objects so `devteam advise` can surface them.

