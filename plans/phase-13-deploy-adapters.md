# Phase 13 — Deploy Adapters: GCP Cloud Run and Gizmos

**Goal:** add two built-in deploy adapters to `core/deploy/` so projects targeting TELUS's
GCP Cloud Run environment or the Gizmos (Cloudflare Workers) platform can declare them in
`.devteam/config.yml` and have `dev-platform` execute a complete build → push → deploy →
smoke-test → gate sequence.

**No ADR.** This is additive work on an existing, documented extension point
(`core/deploy/README.md` §Writing a new adapter). The config schema recommendation
(Options A vs B discussion) is resolved as Option A + two universal promoted fields —
see §Config schema below.

**Order:** 13.1 → 13.2. Cloud Run first: it's the more complex case and sets the format
conventions that 13.2 follows.

---

## Config schema (binding decision, applies to both adapters)

Universal fields go directly under `deploy:` — they appear in the gate and are
adapter-agnostic. Adapter-specific fields go under a namespaced key.

```yaml
deploy:
  adapter: cloud-run          # or: gizmos, docker-compose, kubernetes, terraform
  environment: production     # UNIVERSAL — gate field, runbook label; default "production"
  smoke_test_path: /healthz   # UNIVERSAL — health probe path; default "/healthz"
  cloud_run:                  # adapter-specific block (underscore, matching docker_compose)
    project: my-gcp-project
    region: us-central1
    service: my-service
    repository: cloud-run     # Artifact Registry repo; default "cloud-run"
    image_tag: ""             # empty → use git short SHA; or set explicitly
    extra_flags: ""           # appended verbatim to gcloud run deploy

deploy:
  adapter: gizmos
  environment: staging
  smoke_test_path: /healthz
  gizmos:
    app: my-app               # must match wrangler.toml `name`
    src: ./src                # directory to push
```

`environment` and `smoke_test_path` are new optional fields at `deploy.*`. Existing
adapters (docker-compose, kubernetes, terraform) continue to work — they ignore these
fields without breaking.

---

## 13.1 GCP Cloud Run adapter

**Deliverables:** `core/deploy/cloud-run.md` + `core/deploy/README.md` update (table row)
+ consistency/tests passing.

**What `core/deploy/cloud-run.md` must contain:**

---
```markdown
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
  "agent": "dev-platform",
  "track": "<track>",
  "timestamp": "<ISO>",
  "deploy_completed": true,
  "smoke_tests_passed": true,
  "rollback_executed": false,
  "deploy_adapter": "cloud-run",
  "environment": "<environment>",
  "runbook_referenced": true,
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
```
---

**`core/deploy/README.md` update:** add to the Built-in adapters table:

```markdown
| `cloud-run`                | `cloud-run.md`     | GCP Cloud Run via Artifact Registry + gcloud |
```

**Tests to write or verify:**

1. `[verify-first]` — Does `tests/deploy-adapters.test.js` (or similar) exist? If so, read
   it and add a test that `core/deploy/cloud-run.md` exists, contains `## Procedure`, and
   contains `## Assumptions`. If no such test file exists, check what test (if any) asserts
   the adapter table in `core/deploy/README.md` matches the files in `core/deploy/` — add
   such a test now; it will catch future adapter drift.

2. Schema conformance: the gate body above uses `deploy_completed`, `smoke_tests_passed`,
   `rollback_executed` — the three fields `stage-08.schema.json` marks as required. Confirm
   `npm run consistency` passes after adding the file (the consistency checker may validate
   intra-doc references).

**Verify:**
```bash
npm test && npx eslint . && npm run consistency
# Manual: confirm the table in core/deploy/README.md lists cloud-run
# Manual: confirm cloud-run.md contains all required sections
```

**Branch:** `feat/deploy-cloud-run`

---

## 13.2 Gizmos adapter

**Deliverables:** `core/deploy/gizmos.md` + `core/deploy/README.md` update.

**What `core/deploy/gizmos.md` must contain:**

---
```markdown
# Adapter: gizmos

Deploys to the Gizmos platform (Cloudflare Workers, `gizmos.run`) via the
`gizmos push` CLI. No Docker image is built — Gizmos bundles source code
at the edge on first request after push.

## Assumptions

- `gizmos` CLI is installed and authenticated (`gizmos whoami` exits 0)
- `wrangler.toml` exists at the project root with a `name` field
- Source code is TypeScript/JavaScript (Hono recommended) or Python
  (FastAPI via Pyodide) — Gizmos does not support arbitrary runtimes
- `deploy.gizmos.app` matches the `name` field in `wrangler.toml`
  exactly — a mismatch deploys to the wrong app

## Config (`.devteam/config.yml`)

```yaml
deploy:
  adapter: gizmos
  environment: production         # gate label; default "production"
  smoke_test_path: /healthz       # health probe path; default "/healthz"
  gizmos:
    app: my-app                   # Gizmos app name (required; must match wrangler.toml)
    src: ./src                    # source directory to push (required)
```

## Procedure

Follow in order. On any step failure: capture the failing command's
output, write `status: FAIL` to `pipeline/gates/stage-08.json` with
the output as a blocker, and halt. **Do not auto-rollback.**

### 1. Preconditions

a. Read `pipeline/gates/stage-07.json`. Confirm `pm_signoff: true`.
   If missing or false: write `status: ESCALATE` with reason
   "PM sign-off missing — cannot deploy" and halt.

b. Confirm `wrangler.toml` exists at the project root.
   If missing: write `status: ESCALATE` with reason
   "wrangler.toml required for Gizmos deploy".

c. Confirm `deploy.gizmos.app` matches the `name` field in
   `wrangler.toml`. If they differ: write `status: ESCALATE` with reason
   "deploy.gizmos.app ('$APP') does not match wrangler.toml name ('$TOML_NAME')
   — fix before deploying to avoid targeting the wrong Gizmos app."

d. Confirm `pipeline/runbook.md` exists and contains a `## Rollback`
   section. If missing: write `status: ESCALATE` with reason "Runbook
   requires a §Rollback section describing how to re-push a prior source
   version".

e. Confirm required config fields are set: `deploy.gizmos.app`,
   `deploy.gizmos.src`. If empty: write `status: ESCALATE` with reason
   "deploy.gizmos.{field} is required".

f. Confirm Gizmos CLI is authenticated:
   ```bash
   gizmos whoami
   ```
   Non-zero: `status: ESCALATE` with reason "gizmos CLI is not
   authenticated — run 'gizmos login' before deploying".

### 2. Resolve config

```
APP=$(config deploy.gizmos.app)
SRC=$(config deploy.gizmos.src)
ENVIRONMENT=$(config deploy.environment || echo "production")
SMOKE_PATH=$(config deploy.smoke_test_path || echo "/healthz")
APP_URL="https://$APP.gizmos.run"
```

### 3. Push to Gizmos

```bash
gizmos push --app "$APP" "$SRC"
```

Non-zero exit: `status: FAIL`, push output as blocker. Include the
hint "Run 'gizmos push --app $APP $SRC --dry-run' to diagnose".

### 4. Smoke test

Wait 5 seconds for the deployment to become reachable. Then:

```bash
curl -sf --retry 3 --retry-delay 3 "$APP_URL$SMOKE_PATH"
```

On failure: write `status: FAIL` with blocker
`"Smoke test failed at $APP_URL$SMOKE_PATH — the app may still be
bundling; wait 30 seconds and re-run devteam stage deploy"`. Do not
auto-rollback.

### 5. Write deploy log

`pipeline/deploy-log.md`:

```markdown
# Deploy Log

**Date**: <ISO timestamp>
**Method**: Gizmos (Cloudflare Workers)
**App**: <app> at <app_url>
**Source**: <src>
**Runbook**: pipeline/runbook.md §Rollback

## Smoke Test

Path: <smoke_path>
Result: PASS

## Recovery procedure

To roll back, re-push a prior version of the source:
  gizmos push --app <app> <path-to-prior-source>

See pipeline/runbook.md §Rollback for the tagged source location.
```

### 6. Write gate

`pipeline/gates/stage-08.json`:

```json
{
  "stage": "stage-08",
  "status": "PASS",
  "agent": "dev-platform",
  "track": "<track>",
  "timestamp": "<ISO>",
  "deploy_completed": true,
  "smoke_tests_passed": true,
  "rollback_executed": false,
  "deploy_adapter": "gizmos",
  "environment": "<environment>",
  "runbook_referenced": true,
  "adapter_result": {
    "app_url": "<app_url>",
    "app_name": "<app>",
    "src": "<src>",
    "deployed_at": "<ISO>"
  },
  "blockers": [],
  "warnings": []
}
```

## Runbook hooks

This adapter expects `pipeline/runbook.md` to include:

- **§Rollback** — Re-push of a prior source version:
  `gizmos push --app <app> <path-to-prior-source>`
  The runbook should identify where prior source is kept (git tag,
  artifact store, or S3/GCS backup) since Gizmos does not retain deploy
  history natively.
- **§Health signals** — URL and path used by the smoke test; expected
  HTTP status code.

## Platform constraints

These are constraints of the Gizmos/Cloudflare Workers runtime, not of
this adapter. Surface them during the Stage 01 (design) phase:

- **Language**: TypeScript/JavaScript (Hono recommended) or Python
  (FastAPI via Pyodide). No other runtimes.
- **State**: No persistent filesystem. Use D1 (SQLite), R2 (objects),
  or KV — declared in `wrangler.toml`. These are auto-provisioned by
  Gizmos on first push.
- **Request model**: Stateless `fetch()` handler. Long-lived connections
  require Durable Objects.
- **CPU time**: ~30s per request (Cloudflare Worker limit).
```
---

**`core/deploy/README.md` update:** add to the Built-in adapters table:

```markdown
| `gizmos`                   | `gizmos.md`        | Gizmos platform (Cloudflare Workers, gizmos.run) |
```

**Tests:** same pattern as 13.1 — add `core/deploy/gizmos.md` to the adapter
existence and section-header test.

**Verify:**
```bash
npm test && npx eslint . && npm run consistency
```

**Branch:** `feat/deploy-gizmos`

---

## Sequencing & exit criteria

13.1 → 13.2. 13.2 is unblocked once 13.1 merges (no shared state, but it follows
the format 13.1 establishes).

**Phase exit:** `core/deploy/cloud-run.md` and `core/deploy/gizmos.md` exist with all
required sections; `core/deploy/README.md` table lists both; tests and consistency pass;
each adapter's gate body matches `stage-08.schema.json` required fields.
