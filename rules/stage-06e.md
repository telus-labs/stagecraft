# Stage 6e — Performance budget (tracks: full, quick, hotfix)

Invoke: `qa` agent. Runs AFTER stage-06 (QA) PASS.
Input: `pipeline/brief.md`, `pipeline/design-spec.md`, `pipeline/test-report.md`.
Output: `pipeline/performance-report.md`.
Gate file: `pipeline/gates/stage-06e.json`. Required keys:
- `checks_performed`: list of check names run
- `lighthouse`: Lighthouse result object or `null`
- `bundle`: bundle-size delta result object or `null`
- `load_test`: k6/load-test result object or `null`
- `budget_exceeded`: boolean — `true` if any configured budget was exceeded
- `skipped_reason`: string or `null` — set when the change has no performance surface

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
