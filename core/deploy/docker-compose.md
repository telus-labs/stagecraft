# Adapter: docker-compose (default)

Deploys via `docker compose` against a local or remote host. This is
the adapter used in v1–v2.3 and remains the default in v2.4.

## Assumptions

- `docker` and `docker compose` are on PATH
- A `docker-compose.yml` exists at the project root (or
  `docker-compose.yaml`)
- Every HTTP service in the compose file has a `healthcheck:` block
  so `docker compose up --wait` can verify readiness
- `.env` carries any secrets the compose file references

## Config (`.devteam/config.yml`)

```yaml
deploy:
  adapter: docker-compose
  docker_compose:
    compose_file: docker-compose.yml   # or docker-compose.yaml
    build_no_cache: true                # force rebuild on deploy
    smoke_test_timeout_s: 30
```

## Procedure

Follow in order. On any failure: capture the failing command's
output, write `status: FAIL` to `pipeline/gates/stage-08.json` with
the output as a blocker, and halt. Do not auto-rollback.

### 1. Preconditions

- Read `pipeline/gates/stage-07.json`. Confirm `pm_signoff: true`.
  If missing or false: write `status: ESCALATE` with reason
  "PM sign-off missing — cannot deploy" and halt.
- Confirm the compose file named in config exists. If missing: write
  `status: ESCALATE` with reason "No docker-compose.yml found".
- Confirm `pipeline/runbook.md` exists. If missing: write
  `status: ESCALATE` with reason "Runbook required for Stage 8
  (v2.4+)". See `templates/runbook-template.md` for the canonical blank form; `docs/runbook-template.md` is the section-by-section annotation guide.

### 2. Validate compose config

```bash
docker compose -f <compose_file> config --quiet
```

Non-zero exit: write `status: FAIL` with the error as blocker. Halt.

### 3. Pull upstream base images

```bash
docker compose -f <compose_file> pull --ignore-pull-failures
```

Non-fatal. Log any warnings; continue.

### 4. Build images

```bash
docker compose -f <compose_file> build <--no-cache if configured>
```

Non-zero exit: `status: FAIL`, build output as blocker. Halt.

### 5. Stop existing containers gracefully

```bash
docker compose -f <compose_file> down --remove-orphans --timeout 30
```

Drains existing containers before starting new ones.

### 6. Start services

```bash
docker compose -f <compose_file> up -d --wait
```

`--wait` blocks until all services with healthchecks report healthy.
A service with no healthcheck returns immediately — relying on the
smoke-test phase to catch silent failures.

### 7. Smoke tests

Wait 5 seconds after `up` returns. Then for each service in the
compose file:

**HTTP service** (has `ports:` mapping to 80/443/3000/8000/8080/etc.):
```bash
curl -sf --retry 3 --retry-delay 2 http://localhost:<PORT>/health \
  || curl -sf --retry 3 --retry-delay 2 http://localhost:<PORT>/
```
A 2xx or 3xx response passes.

**Non-HTTP service** (database, queue, worker):
```bash
docker compose -f <compose_file> ps --format json \
  | grep -q '"Status":"running"'
```

On smoke-test failure:
```bash
docker compose -f <compose_file> logs --tail=50
```
Capture logs, write `status: FAIL` with logs as blocker, halt.

### 8. Record container state

```bash
docker compose -f <compose_file> ps
docker compose -f <compose_file> images
```
Both outputs go into `pipeline/deploy-log.md`.

### 9. Write outputs

#### `pipeline/deploy-log.md`

```markdown
# Deploy Log

**Date**: <ISO timestamp>
**Method**: docker compose (local)
**Runbook**: pipeline/runbook.md §<recovery-section-name>

## Services Started
<output of docker compose ps>

## Images
<output of docker compose images>

## Smoke Test Results
<pass/fail per service with endpoint or check used>

## Known Limitations
<any warnings from earlier steps>

## Recovery procedure
<one-line pointer to runbook — orchestrator does NOT auto-rollback>
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
  "deploy_adapter": "docker-compose",
  "environment": "local",
  "runbook_referenced": true,
  "cost_delta_estimated": true,
  "cost_delta_multiplier": 1,
  "cost_gate_override": false,
  "adapter_result": {
    "compose_file": "docker-compose.yml",
    "services_started": ["<list>"]
  },
  "blockers": [],
  "warnings": []
}
```

## Runbook hooks

This adapter expects `pipeline/runbook.md` to include:

- **§Recovery** — how to roll the deploy back. Minimum answer:
  `docker compose -f <file> down && docker compose -f <file> up -d --wait`
  against the prior image tag.
- **§Health signals** — which smoke test confirms the deploy is
  healthy post-recovery.

See `docs/runbook-template.md` for the full section list.
