# Stage 4a — Pre-review gate (lint + dep review + SCA)

Invoke: `dev-platform` agent.
Scope: lint, dependency vulnerability scan, license
allowlist check, security and migration-safety trigger heuristics.
Output: `pipeline/gates/stage-04a.json`.
Gate key: `"status": "PASS"` with `"lint_passed": true`,
`"tests_passed": true`, and no `high`/`critical` SCA findings.

See `roles/platform.md` §"On a Pre-Review Task" for the
exact commands. On failure, the owning dev (identified from the failing
check) is re-invoked to fix. Stage 5 does not start until this gate
passes.
