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
`docker-compose` (default), `kubernetes`, `terraform`, `custom`. See
`.devteam/adapters/README.md` for the contract.

Output:
- `pipeline/deploy-log.md` — human-readable, includes a runbook
  pointer
- `pipeline/gates/stage-08.json` — gate with fields `adapter`,
  `environment`, `smoke_test_passed`, `runbook_referenced`, and an
  adapter-specific `adapter_result` block

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
  "deploy_adapter": "docker-compose | kubernetes | terraform | custom",
  "environment": "<adapter-specific>",
  "runbook_referenced": true,
  "adapter_result": {}
}
```

`deploy_adapter` is the **deploy** adapter (Stage 8 target). The **host** adapter
(which AI tool produced the gate) lives in the top-level `host` field.
The gate passes only when `status: "PASS"` AND `runbook_referenced: true`.
