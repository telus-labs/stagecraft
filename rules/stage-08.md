# Stage 8 — Deploy (Platform Dev)

Invoke: `dev-platform` agent.
Preconditions:
- `pipeline/gates/stage-07.json` has `"pm_signoff": true`
- `pipeline/runbook.md` exists and has `## Rollback` + `## Health signals`
  sections (see `templates/runbook-template.md` for the canonical blank form)
- `.devteam/config.yml` names a valid adapter in `deploy.adapter`

Stage 8 is **adapter-driven**. The dev-platform
agent reads the selected adapter's instructions from
`.devteam/adapters/<adapter>.md` and follows them. Built-in adapters:
`docker-compose` (default), `kubernetes`, `terraform`, `cloud-run`, `gizmos`,
`custom`. See
`.devteam/adapters/README.md` for the contract.

Output:
- `pipeline/deploy-log.md` — human-readable, includes a runbook
  pointer
- `pipeline/gates/stage-08.json` — gate with fields `deploy_adapter`,
  `environment`, `smoke_tests_passed`, `runbook_referenced`,
  `cost_delta_estimated`, `cost_delta_multiplier`, `cost_gate_override`, and
  an adapter-specific `adapter_result` block

On failure: do NOT auto-rollback. The deploy log points to the
runbook's `§Rollback` section; the orchestrator surfaces that
pointer and the user decides.

Post-deploy: invoke `pm` agent to write stakeholder summary.

## Gate

Gate file: `pipeline/gates/stage-08.json`.

```json
{
  "stage": "stage-08",
  "status": "PASS",
  "track": "full",
  "timestamp": "<ISO 8601>",
  "orchestrator": "devteam@<version>",
  "workstream": "platform",
  "host": "claude-code",
  "blockers": [],
  "warnings": [],
  "deploy_completed": true,
  "smoke_tests_passed": true,
  "rollback_executed": false,
  "deploy_adapter": "docker-compose | kubernetes | terraform | cloud-run | gizmos | custom",
  "environment": "<adapter-specific>",
  "runbook_referenced": true,
  "cost_delta_estimated": true,
  "cost_delta_multiplier": 1,
  "cost_gate_override": false,
  "adapter_result": {}
}
```

`deploy_adapter` is the **deploy** adapter (Stage 8 target). The **host** adapter
(which AI tool produced the gate) lives in the top-level `host` field.
The gate passes only when `status: "PASS"` AND `runbook_referenced: true`.

## Cost Gate

Before deploying, estimate the recurring infrastructure/cloud cost delta relative
to the pre-change baseline. Record it in `cost_delta_multiplier`:

- `1` means no meaningful recurring cost change.
- `2.5` means the deploy is estimated to cost 2.5x the previous baseline.
- Values below `1` are allowed for cost reductions.

Set `cost_delta_estimated: true` only after making the estimate. A PASS or WARN
Stage 8 gate without that estimate is invalid. If `cost_delta_multiplier >= 10`
(a 10x-or-greater recurring cost increase), the deploy must not pass unless a
human explicitly approved the increase; set `cost_gate_override: true` and
include `cost_gate_override_reason` naming the approval source. Without that
override, write `status: "FAIL"` with a blocker instead of deploying.
