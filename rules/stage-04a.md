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

## Gate

Gate file: `pipeline/gates/stage-04a.json`.

```json
{
  "stage": "stage-04a",
  "status": "PASS | FAIL",
  "track": "full",
  "timestamp": "<ISO 8601>",
  "orchestrator": "devteam@<version>",
  "workstream": "platform",
  "host": "claude-code",
  "blockers": [],
  "warnings": [],
  "lint_passed": true,
  "type_check_passed": true,
  "tests_passed": true,
  "sca_findings": { "high": 0, "critical": 0 },
  "dependency_review_passed": true,
  "license_check_passed": true,
  "license_findings": [],
  "security_review_required": false,
  "migration_safety_required": false
}
```

`license_check_passed` is `false` when any `license_findings` entry has
`policy: "denied"` (strong copyleft). `policy: "warned"` entries do not block —
they appear as `warnings[]`. `license_findings` only includes non-allowed packages;
packages on the default permissive list (MIT, Apache-2.0, BSD-*, ISC, CC0,
Unlicense) are not recorded.
