# Stage 4.5a — Pre-review gate (lint + type-check + SCA)

Invoke: `dev-platform` agent.
Scope: lint, type-check, dependency vulnerability scan, license
allowlist check.
Output: `pipeline/gates/stage-04-pre-review.json`.
Gate key: `"status": "PASS"` with `"lint_passed": true`,
`"type_check_passed": true`, and no `high`/`critical` SCA findings.

See `roles/dev-platform.md` §"On a Pre-Review Task" for the
exact commands. On failure, the owning dev (identified from the failing
check) is re-invoked to fix. Stage 5 does not start until this gate
passes.
