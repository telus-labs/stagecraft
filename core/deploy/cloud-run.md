# Adapter: cloud-run

Deploys to GCP Cloud Run via Artifact Registry. Builds a Docker image,
pushes it, deploys a new revision, and smoke-tests the live service URL.

## Assumptions

- `docker` and `gcloud` CLIs are on PATH and authenticated
- `Dockerfile` exists at the project root (or at the path given by
  `deploy.cloud_run.dockerfile` if overridden)
- The deploying identity has GCP roles:
  - Artifact Registry Writer (to push the image)
  - Cloud Run Developer (to deploy and describe the service)
- Artifact Registry repository already exists at
  `$REGION-docker.pkg.dev/$PROJECT/$REPOSITORY`
- The target service may not exist yet (first deploy creates it)

## Config (`.devteam/config.yml`)

```yaml
deploy:
  adapter: cloud-run
  environment: production         # gate label; default "production"
  smoke_test_path: /healthz       # health probe path; default "/healthz"
  cloud_run:
    project: my-gcp-project       # GCP project ID (required)
    region: us-central1           # GCP region (required)
    service: my-service           # Cloud Run service name (required)
    repository: cloud-run         # Artifact Registry repo; default "cloud-run"
    image_tag: ""                 # empty → use git short SHA at deploy time
    extra_flags: ""               # appended verbatim to gcloud run deploy
```

## Procedure

Follow in order. On any step failure: capture the failing command's
output, write `status: FAIL` to `pipeline/gates/stage-08.json` with
the output as a blocker, and halt. **Do not auto-rollback.**

### 1. Preconditions

a. Read `pipeline/gates/stage-07.json`. Confirm `pm_signoff: true`.
   If missing or false: write `status: ESCALATE` with reason
   "PM sign-off missing — cannot deploy" and halt.

b. Confirm the Dockerfile exists. If missing: write `status: ESCALATE`
   with reason "No Dockerfile found at project root".

c. Confirm `pipeline/runbook.md` exists and contains a `## Rollback`
   section referencing `gcloud run services update-traffic`. If missing
   or incomplete: write `status: ESCALATE` with reason "Runbook requires
   a §Rollback section with a gcloud traffic rollback command".

d. Confirm required config fields are set:
   `deploy.cloud_run.project`, `deploy.cloud_run.region`,
   `deploy.cloud_run.service`. If any are empty: write `status: ESCALATE`
   with reason "deploy.cloud_run.{field} is required".

### 2. Resolve image tag and registry path

```bash
PROJECT=$(config deploy.cloud_run.project)
REGION=$(config deploy.cloud_run.region)
SERVICE=$(config deploy.cloud_run.service)
REPO=$(config deploy.cloud_run.repository || echo "cloud-run")
TAG=$(config deploy.cloud_run.image_tag)
[ -z "$TAG" ] && TAG=$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)
IMAGE="$REGION-docker.pkg.dev/$PROJECT/$REPO/$SERVICE:$TAG"
ENVIRONMENT=$(config deploy.environment || echo "production")
SMOKE_PATH=$(config deploy.smoke_test_path || echo "/healthz")
```

### 3. Build image

```bash
docker build -t "$IMAGE" .
```

Non-zero exit: `status: FAIL`, build output as blocker. Halt.

### 4. Push to Artifact Registry

```bash
docker push "$IMAGE"
```

Non-zero exit: `status: FAIL`, push output as blocker. Include the hint
"Check Artifact Registry permissions and confirm the repository exists."

### 5. Deploy revision

```bash
gcloud run deploy "$SERVICE" \
  --image "$IMAGE" \
  --region "$REGION" \
  --project "$PROJECT" \
  --platform managed \
  --quiet \
  $(config deploy.cloud_run.extra_flags)
```

Non-zero exit: `status: FAIL`, gcloud output as blocker.

### 6. Retrieve service URL

```bash
SERVICE_URL=$(gcloud run services describe "$SERVICE" \
  --region "$REGION" \
  --project "$PROJECT" \
  --format "value(status.url)")
```

### 7. Smoke test

Wait 10 seconds for the revision to receive traffic. Then:

```bash
curl -sf --retry 3 --retry-delay 5 "$SERVICE_URL$SMOKE_PATH"
```

On failure: write `status: FAIL` with blocker
`"Smoke test failed at $SERVICE_URL$SMOKE_PATH — see pipeline/deploy-log.md"`.
Capture the curl output and HTTP status in the deploy log. Do not
auto-rollback. The runbook §Rollback gives the traffic-shift command to
restore the previous revision.

### 8. Record active revision

```bash
REVISION=$(gcloud run services describe "$SERVICE" \
  --region "$REGION" --project "$PROJECT" \
  --format "value(status.latestReadyRevisionName)")
```

### 9. Write deploy log

`pipeline/deploy-log.md`:

```markdown
# Deploy Log

**Date**: <ISO timestamp>
**Method**: GCP Cloud Run
**Service**: <service> (<region>, project <project>)
**Image**: <image>
**Revision**: <revision>
**Runbook**: pipeline/runbook.md §Rollback

## Smoke Test

Path: <smoke_path>
Result: PASS

## Recovery procedure

To roll back to the previous revision:
  gcloud run services update-traffic <service> \
    --region <region> --project <project> \
    --to-revisions PREVIOUS=100

See pipeline/runbook.md §Rollback for the full procedure.
```

### 10. Write gate

`pipeline/gates/stage-08.json`:

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
  "deploy_adapter": "cloud-run",
  "environment": "<environment>",
  "runbook_referenced": true,
  "cost_delta_estimated": true,
  "cost_delta_multiplier": 1,
  "cost_gate_override": false,
  "adapter_result": {
    "service_url": "<service_url>",
    "image": "<image>",
    "revision": "<revision>",
    "region": "<region>",
    "project": "<project>",
    "deployed_at": "<ISO>"
  },
  "blockers": [],
  "warnings": []
}
```

## Runbook hooks

This adapter expects `pipeline/runbook.md` to include:

- **§Rollback** — Traffic rollback command:
  `gcloud run services update-traffic <service> --region <region> --to-revisions PREVIOUS=100`
- **§Health signals** — URL and path used by the smoke test; expected
  HTTP status code.

See `templates/runbook-template.md` for the full section list.
