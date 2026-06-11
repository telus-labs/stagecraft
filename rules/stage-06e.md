# Stage 6e — Performance budget (tracks: full, quick, hotfix)

Invoke: `qa` agent. Runs AFTER stage-06 (QA) PASS.
Input: `pipeline/brief.md`, `pipeline/design-spec.md`, `pipeline/test-report.md`.
Output: `pipeline/performance-report.md`.
## Gate

Gate file: `pipeline/gates/stage-06e.json`.

```json
{
  "stage": "stage-06e",
  "status": "PASS | FAIL",
  "track": "full",
  "timestamp": "<ISO 8601>",
  "orchestrator": "devteam@<version>",
  "blockers": [],
  "warnings": [],
  "checks_performed": ["lighthouse", "bundle", "load_test"],
  "lighthouse": null,
  "bundle": null,
  "load_test": null,
  "budget_exceeded": false,
  "skipped_reason": null
}
```

FAIL if any budget is exceeded. PASS (with `skipped_reason` and `budget_exceeded: false`)
when the change has no performance-relevant surface (backend-only with no load concern,
documentation-only change, etc.).

Budget thresholds come from the project's `performance.budget.json` or the
`performance.budgets` key in `.devteam/config.yml`. When neither exists, the skill
provides sensible defaults. The agent must not invent numbers — use defaults explicitly
rather than silently.

See `skills/performance-budget/SKILL.md` for Lighthouse measurement procedure,
bundle-size delta methodology, k6 load-test script conventions, and the default
budget thresholds the skill provides when no project config exists.
