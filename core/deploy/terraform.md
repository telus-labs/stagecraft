# Adapter: terraform

Deploys infrastructure changes via `terraform` (or `tofu`) against a
declared backend. Best for infra-layer deploys (VPCs, queues,
databases, managed services) where the "deploy" is the IaC apply.

> **Project-specific configuration required.** Fill in
> `TODO(project)` markers before the first Stage 8 run.

## Assumptions

- `terraform` (or `tofu`) on PATH
- A configured Terraform backend (S3+DynamoDB, Terraform Cloud,
  GCS, etc.) with credentials available in the environment
- IaC source under a project-declared directory (default `infra/`)
- The executing principal has permissions the declared resources
  require

## Config (`.devteam/config.yml`)

```yaml
deploy:
  adapter: terraform
  terraform:
    binary: terraform                 # or: tofu
    working_dir: infra                # where the HCL lives
    workspace: prod                    # TODO(project)
    var_files:
      - infra/prod.tfvars              # TODO(project)
    auto_approve: false                # if true, skip plan-inspection halt
    plan_output_path: pipeline/terraform-plan.bin
    # Optional drift check before apply
    drift_check: true
    # Optional post-apply HTTP smoke tests (on outputs)
    smoke_urls:
      # TODO(project): URLs exposed by Terraform outputs
      - output: api_endpoint
        path: /health
```

## Procedure

### 1. Preconditions

- Stage 7 gate check (same as docker-compose §1)
- `pipeline/runbook.md` must exist
- Backend must be initialised: `terraform -chdir=<working_dir> init`
  runs cleanly. Any failure → `status: FAIL` with init output as
  blocker.
- Workspace must exist: `terraform workspace list` includes the
  declared workspace. If missing, `status: ESCALATE` — new
  workspaces require human intent.

### 2. Drift check (optional, enabled by default)

```bash
terraform -chdir=<working_dir> plan -detailed-exitcode \
  -out <plan_output_path> [-var-file=<var_files>...]
```

Exit codes:
- `0` → no changes; proceed but record "no-op deploy" in the log
- `2` → changes planned; proceed to inspection
- any other → `status: FAIL` with plan output as blocker

### 3. Plan inspection

Summarise the plan to `pipeline/deploy-log.md` under `## Plan`:

```bash
terraform -chdir=<working_dir> show -json <plan_output_path> \
  | summarise-changes
```

If `auto_approve: false` (default): **halt with `status: ESCALATE`**
and `decision_needed: "Review plan at <path> before apply"`. The
orchestrator surfaces the plan summary to the user and waits for a
`proceed` or `abort` decision. This is the same pattern as the
human checkpoints — a Terraform apply is too consequential to run
silently.

If `auto_approve: true`: proceed to apply. Projects set this only
when they have compensating controls (e.g. PR-based plan review
upstream of Stage 8).

### 4. Apply

```bash
terraform -chdir=<working_dir> apply <plan_output_path>
```

Non-zero exit: `status: FAIL`, apply output as blocker. Do not
auto-rollback — state is now partially modified. The runbook must
name the recovery path (usually `terraform apply` with the previous
state or a targeted destroy + recreate).

### 5. Smoke tests

For each entry in `smoke_urls`:

```bash
ENDPOINT=$(terraform -chdir=<working_dir> output -raw <output>)
curl -sf --retry 3 --retry-delay 2 "${ENDPOINT}<path>"
```

A 2xx or 3xx passes. Failure captures the curl output + the outputs
block (`terraform output -json`) into the deploy log.

### 6. Write outputs

#### `pipeline/deploy-log.md`

```markdown
# Deploy Log

**Date**: <ISO>
**Method**: terraform
**Workspace**: <workspace>
**Binary**: <binary version>
**Runbook**: pipeline/runbook.md §<section>

## Plan summary
<human-readable summary of resources added/changed/destroyed>

## Apply output
<last 50 lines of terraform apply output>

## Outputs
<terraform output -json>

## Smoke tests
<pass/fail per URL>

## Recovery procedure
See runbook §Rollback.
```

#### `pipeline/gates/stage-08.json`

```json
{
  "stage": "stage-08",
  "status": "PASS",
  "agent": "dev-platform",
  "track": "<track>",
  "timestamp": "<ISO>",
  "adapter": "terraform",
  "environment": "<workspace>",
  "smoke_test_passed": true,
  "runbook_referenced": true,
  "adapter_result": {
    "binary": "terraform",
    "workspace": "<workspace>",
    "resources_added": N,
    "resources_changed": N,
    "resources_destroyed": N
  },
  "blockers": [],
  "warnings": []
}
```

## Runbook hooks

Expects `pipeline/runbook.md` to include:

- **§Rollback** — exact procedure to revert the state. For pure
  additive changes this is often a targeted destroy; for destructive
  changes, specify whether data is recoverable and from where.
- **§Known-good state** — reference to the Terraform state version
  (or commit SHA) to roll back to.
- **§Drift watch** — what to monitor after apply (changed IAM
  policies, security-group rules, DNS propagation).

## Known limitations

- No multi-workspace apply in one run. Deploy to each workspace is a
  separate Stage 8 invocation.
- State locking errors halt with `status: FAIL` — do not force-unlock
  from the adapter. Runbook should name who holds unlock authority.
- Cross-provider race conditions are the user's problem; the adapter
  does not sequence or coordinate with other deploys.
