# Stage 6c — Observability gate (tracks: full, hotfix)

Invoke: `dev-platform` agent.
Input: `pipeline/brief.md` §9 (Observability requirements), `pipeline/design-spec.md`, shipped code.
Output: `pipeline/observability-report.md`.
Gate file: `pipeline/gates/stage-06c.json`. Required keys:
- `metrics`: `{ required[], verified[], gap[] }`
- `logs`: same shape
- `traces`: same shape
- `verification_method`: `code-grep | static-analysis | staging-run | runtime-probe | dashboard-query | manual`

PASS requires every category's `gap` to be empty. Weak verification methods (`code-grep`, `static-analysis`, `manual`) PASS with a WARN ("recommend runtime-probe post-deploy"). Non-empty gap → FAIL with the missing signals as blockers, assigned to the dev who owned the relevant area. See `skills/observability-verification/SKILL.md` for procedure, naming conventions to match, and decision matrix.

This stage closes the "designs claim instrumentation that never lands" gap: it's where promised observability becomes contractual.

