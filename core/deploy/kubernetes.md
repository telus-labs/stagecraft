# Adapter: kubernetes

Deploys via `kubectl` (optionally through Helm) against a Kubernetes
cluster. The adapter supports plain manifests and Helm charts.

> **Project-specific configuration required.** This adapter ships as a
> skeleton — every project's K8s layout differs. Fill in the
> `TODO(project)` markers below before the first Stage 8 run.

## Assumptions

- `kubectl` on PATH, pointed at the target cluster via
  `$KUBECONFIG` or the in-cluster service account
- Manifests live under a project-declared directory (default
  `k8s/manifests/`) or a Helm chart at a project-declared path
  (default `k8s/chart/`)
- An image registry the cluster can pull from, with the image already
  pushed to it before Stage 8 starts (usually via CI — see §Prebuild)

## Config (`.devteam/config.yml`)

```yaml
deploy:
  adapter: kubernetes
  kubernetes:
    # TODO(project): choose one strategy
    strategy: manifests         # or: helm
    namespace: my-app-prod       # TODO(project)
    context: prod-cluster        # must match a kubectl context

    # Manifest strategy
    manifests_dir: k8s/manifests
    kustomize_overlay: null      # e.g. k8s/overlays/prod — optional

    # Helm strategy
    chart_dir: k8s/chart
    release_name: my-app         # TODO(project)
    values_files:
      - k8s/values.prod.yaml     # TODO(project)

    # Prebuild
    image_repository: registry.example.com/my-app  # TODO(project)
    image_tag_from: git_sha       # or: env:IMAGE_TAG, or: fixed

    # Rollout verification
    rollout_timeout_s: 300
    smoke_services:
      # TODO(project): list Services/Deployments + health endpoints
      - name: api
        url: https://api.example.com/health
      - name: worker
        check: kubectl_rollout     # no HTTP endpoint — just rollout success
```

## Procedure

### 1. Preconditions

Same as docker-compose adapter §1: check Stage 7 gate, check runbook
exists.

Additionally:
- `kubectl config current-context` must match the configured context.
  If not, `status: ESCALATE` with reason "kubectl context mismatch —
  refusing to deploy to unexpected cluster".
- `kubectl auth can-i` for each resource type the manifest/chart
  creates in the target namespace. Lack of permission: `status: FAIL`
  with the missing permission as the blocker.

### 2. Prebuild (optional, usually CI does this)

If `image_tag_from` is `git_sha`, capture the tag:
```bash
IMAGE_TAG=$(git rev-parse --short HEAD)
```

If the project builds the image locally instead of CI:
```bash
docker build -t <image_repository>:${IMAGE_TAG} .
docker push <image_repository>:${IMAGE_TAG}
```

### 3. Render manifests (strategy: manifests)

```bash
# Plain manifests
kubectl --context=<context> --namespace=<namespace> apply \
  --dry-run=server -f <manifests_dir>
```

Dry-run failure: `status: FAIL`, error as blocker.

If `kustomize_overlay` is set:
```bash
kubectl --context=<context> --namespace=<namespace> apply \
  --dry-run=server -k <kustomize_overlay>
```

### 3. Render manifests (strategy: helm)

```bash
helm --kube-context=<context> upgrade --install <release_name> <chart_dir> \
  --namespace <namespace> \
  --values <values_files...> \
  --set image.tag=${IMAGE_TAG} \
  --dry-run --debug
```

### 4. Apply

Plain:
```bash
kubectl --context=<context> --namespace=<namespace> apply \
  [-f <manifests_dir> | -k <kustomize_overlay>]
```

Helm:
```bash
helm --kube-context=<context> upgrade --install <release_name> <chart_dir> \
  --namespace <namespace> \
  --values <values_files...> \
  --set image.tag=${IMAGE_TAG} \
  --wait --timeout ${rollout_timeout_s}s
```

### 5. Rollout verification

For each Deployment / StatefulSet in the applied manifests:
```bash
kubectl --context=<context> --namespace=<namespace> rollout status \
  deployment/<name> --timeout=${rollout_timeout_s}s
```

Any `rollout status` timeout: `status: FAIL`, capture
`kubectl describe` output + last 50 lines of pod logs as blocker.

### 6. Smoke tests

For each entry in `smoke_services`:

- `url` entries: same curl as docker-compose adapter §7.
- `check: kubectl_rollout`: verify `kubectl rollout status` already
  passed in §5 (no additional action).

### 7. Capture deploy log and gate

#### `pipeline/deploy-log.md`

```markdown
# Deploy Log

**Date**: <ISO>
**Method**: kubernetes via <strategy>
**Context**: <context>
**Namespace**: <namespace>
**Image tag**: <IMAGE_TAG>
**Runbook**: pipeline/runbook.md §<recovery-section>

## Applied resources
<output of `kubectl get all -n <namespace>`>

## Rollout results
<per-deployment PASS/FAIL>

## Smoke test results
<per-service>

## Recovery procedure
See runbook §Rollback.
```

#### `pipeline/gates/stage-08.json`

```json
{
  "stage": "stage-08",
  "status": "PASS",
  "track": "<track>",
  "timestamp": "<ISO>",
  "orchestrator": "devteam@<version>",
  "workstream": "platform",
  "host": "<host>",
  "deploy_completed": true,
  "smoke_tests_passed": true,
  "rollback_executed": false,
  "deploy_adapter": "kubernetes",
  "environment": "<namespace>",
  "runbook_referenced": true,
  "cost_delta_estimated": true,
  "cost_delta_multiplier": 1,
  "cost_gate_override": false,
  "adapter_result": {
    "strategy": "manifests | helm",
    "context": "<context>",
    "namespace": "<namespace>",
    "image_tag": "<tag>",
    "deployments_rolled_out": ["api", "worker"]
  },
  "blockers": [],
  "warnings": []
}
```

## Runbook hooks

This adapter expects `pipeline/runbook.md` to include:

- **§Rollback** — must name the prior image tag and a `helm rollback`
  or `kubectl rollout undo` command. Minimum answer:
  `kubectl rollout undo deployment/<name> -n <namespace>`.
- **§Health signals** — which metrics/dashboards confirm the deploy
  is healthy post-recovery (should match brief §9 observability).
- **§Escalation** — on-call name / paging channel if the rollback
  itself fails.

## Known limitations

- No blue/green or canary support in the skeleton. Projects with
  those patterns should write a `custom` adapter that invokes
  Argo Rollouts, Flagger, or similar.
- No cross-namespace deploys. One adapter invocation = one namespace.
- Secrets are assumed to exist in the cluster already (via ESO,
  Vault, Sealed Secrets, etc.). The adapter does NOT create secrets.
