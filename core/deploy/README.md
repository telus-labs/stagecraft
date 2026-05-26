# Deployment Adapters

Stage 8 deployment is pluggable. Each adapter provides a concrete
procedure for how `dev-platform` builds, deploys, and smoke-tests a
release. Projects pick one adapter in `.devteam/config.yml`:

```yaml
deploy:
  adapter: docker-compose  # or: kubernetes, terraform, custom
```

## Why adapters

v1–v2.3 hardcoded `docker compose` as the deploy primitive. That's
fine for local demos and toy projects but useless for any real
environment (K8s, serverless, cloud IaC, enterprise CI/CD). Adapters
let a project declare its actual deployment story without rewriting
`dev-platform.md`.

## Contract

Every adapter must:

1. Read `pipeline/gates/stage-07.json` and confirm `"pm_signoff": true`
   before doing anything that touches infrastructure.
2. Perform the adapter-specific build and deploy steps in order, each
   wrapped so that a non-zero exit code halts the stage with a
   specific blocker written to `pipeline/gates/stage-08.json`.
3. Run smoke tests — what counts as a smoke test is adapter-specific
   (HTTP `/health`, a `kubectl rollout status`, a Terraform output
   diff, etc.) — and report pass/fail per service in
   `pipeline/deploy-log.md`.
4. Write `pipeline/gates/stage-08.json` with required baseline fields
   plus `adapter: "<name>"`, `environment: "<env>"`,
   `smoke_test_passed: true | false`, and an adapter-specific extras
   block under `adapter_result`.
5. Require `pipeline/runbook.md` to exist before the gate passes.
   Rationale: every deploy needs a named rollback/recovery procedure.
   See `docs/runbook-template.md`.
6. On failure: do NOT auto-rollback. Leave the environment in its
   failed state so the user can inspect, and write clear instructions
   in the deploy log pointing to the runbook's recovery section.

## Built-in adapters

| Adapter | File | Suits |
|---|---|---|
| `docker-compose` (default) | `docker-compose.md` | Local dev, demo, single-host deploy |
| `kubernetes`               | `kubernetes.md`    | K8s clusters via `kubectl` / Helm  |
| `terraform`                | `terraform.md`     | IaC-managed infra on any cloud     |
| `custom`                   | `custom.md`        | Project-specific script (escape hatch) |

## Writing a new adapter

To add a new adapter (e.g. `nomad`, `ecs`, `cloudfoundry`):

1. Create `.devteam/adapters/<name>.md` following the structure of the
   built-in adapters. Include:
   - An "Assumptions" section naming what the adapter expects to find
     in the project (CLI tools on PATH, config file names, env vars)
   - A numbered procedure for the Stage 8 run
   - A "Gate body" section showing the `adapter_result` block shape
   - A "Runbook hooks" section stating what runbook sections this
     adapter depends on
2. Document your adapter's name and suitability in the table above.
3. Test by running a pipeline end-to-end against a representative
   target environment.

Adapters are markdown instructions, not code. The `dev-platform`
agent reads the selected adapter's markdown and follows it. This
keeps the surface easy to extend and review — adding an adapter is
writing down what you'd do by hand, not shipping Go/Node modules.

## Selecting an adapter

The default is `docker-compose`. To change:

1. Edit `.devteam/config.yml`:
   ```yaml
   deploy:
     adapter: kubernetes
   ```
2. Adjust adapter-specific config in the same file — each adapter's
   documentation lists what it reads.
3. Run `/pipeline` or `/hotfix` as normal; `dev-platform` picks up the
   new adapter automatically.

`.devteam/config.yml` is gitignored from the user's project by default
(since it may carry environment-specific credentials or paths). Check
the adapter's own doc for exactly which fields are safe to commit
versus which should live in `.devteam/config.local.yml`.
