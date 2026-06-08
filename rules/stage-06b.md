# Stage 6b — Accessibility audit (conditional on UI changes; tracks: full, quick, hotfix)

Invoke: `dev-qa` agent.
Input: `pipeline/brief.md`, `pipeline/design-spec.md`, `pipeline/test-report.md`, frontend PR summaries.
Output: `pipeline/accessibility-report.md`.
Gate file: `pipeline/gates/stage-06b.json`. Required keys:
- `audit_method`: `axe-core | pa11y | lighthouse | manual`
- `wcag_level`: `A | AA | AAA` (default AA)
- `violations`: `{ critical, serious, moderate, minor }`
- `components_audited`: array of routes/components/pages audited
- `audit_skipped_reason`: when set, audit was intentionally skipped (backend-only change, doc-only change, etc.); status should be PASS

PASS requires `violations.critical === 0 AND violations.serious === 0`. Moderate/minor findings flow through as warnings, not blockers. See `skills/accessibility-audit/SKILL.md` for tool choice, procedure, triage, and gotchas.

Moderate and minor violations that the stage manager should track belong in `noted_for_followup[]` as structured objects (not prose warnings) so `devteam advise` can surface them:

```json
{
  "id": "A11Y-01",
  "text": "Button lacks visible focus ring on keyboard nav (WCAG 2.4.7 AA moderate).",
  "track_for": "ticket",
  "severity": "medium",
  "assigned_to": "frontend"
}
```

