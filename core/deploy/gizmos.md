# Adapter: gizmos

Deploys to the Gizmos platform (Cloudflare Workers, `gizmos.run`) via the
`gizmos push` CLI. No Docker image is built — Gizmos bundles source code
at the edge on first request after push.

## Assumptions

- `gizmos` CLI is installed and `GIZMOS_API_KEY` is set in the environment
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

f. Confirm `GIZMOS_API_KEY` is set in the environment. If empty or unset:
   write `status: ESCALATE` with reason "GIZMOS_API_KEY is not set —
   export it before deploying (export GIZMOS_API_KEY=gzm_...)". Halt.

   ```bash
   [ -z "${GIZMOS_API_KEY:-}" ] && echo "GIZMOS_API_KEY not set" && exit 1
   ```

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
  "track": "<track>",
  "timestamp": "<ISO>",
  "orchestrator": "devteam@<version>",
  "workstream": "platform",
  "host": "<host>",
  "deploy_completed": true,
  "smoke_tests_passed": true,
  "rollback_executed": false,
  "deploy_adapter": "gizmos",
  "environment": "<environment>",
  "runbook_referenced": true,
  "cost_delta_estimated": true,
  "cost_delta_multiplier": 1,
  "cost_gate_override": false,
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
- **Secrets**: `gizmos push` has no flag to set environment variables or
  secrets. After the first deploy, go to the Gizmos hub UI → your app →
  Settings → Secrets and add them there. The app will fail on the very
  first request if it depends on secrets at startup — this is expected;
  add secrets, then retry.
