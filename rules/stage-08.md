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

Gate key: `"status": "PASS"` AND `"runbook_referenced": true`.

On failure: do NOT auto-rollback. The deploy log points to the
runbook's `§Rollback` section; the orchestrator surfaces that
pointer and the user decides.

Post-deploy: invoke `pm` agent to write stakeholder summary.
