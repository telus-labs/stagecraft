# Runbook: Deploy Failure (Stage 8)

`devteam next` reports `fix-and-retry` with `stage: "stage-08"`, or the Stage 8 gate shows `status: "FAIL"`. This runbook covers how to diagnose the failure, decide between investigating and rolling back, and proceed in either direction.

Stage 8 is **adapter-driven**. The exact failure signals differ between `docker-compose`, `kubernetes`, `terraform`, and `custom` adapters. The diagnostic steps below apply to all; adapter-specific details follow.

> **Do not auto-rollback.** The rules explicitly prohibit it. A deploy failure is not necessarily a broken deploy — smoke tests can fail for reasons unrelated to the application (network timing, seed data). Diagnose before acting.

---

## Step 1 — Read the failure

Three sources, read in order:

```bash
# (a) Gate: what the agent reported
cat pipeline/gates/stage-08.json | jq '{status, smoke_test_passed, adapter_result, blockers}'

# (b) Deploy log: human-readable narrative
cat pipeline/deploy-log.md

# (c) Health signals: what to look for in prod/staging
grep -A 20 "## Health signals" pipeline/runbook.md
```

Key fields in the gate:

| Field | What it tells you |
|-------|------------------|
| `smoke_test_passed` | `false` → app is reachable but a specific probe failed; `true` → smoke passed but something else blocked the gate |
| `adapter_result` | Adapter-specific output — container exit codes, pod status, plan diff, etc. |
| `blockers[]` | Structured list of what specifically failed, in agent's own words |
| `runbook_referenced` | If `false`, the gate failed before the runbook check — check `pipeline/runbook.md` exists and has `## Rollback` + `## Health signals` |

---

## Step 2 — Classify the failure

Most deploy failures fall into one of four shapes:

**Shape A — Smoke test failed, app is broken.**
The adapter deployed successfully but the app is not healthy. `smoke_test_passed:
false`, `adapter_result` shows a non-200 response or a container that exited
non-zero. This is the highest-severity case.

→ Go to [Rollback path](#rollback-path) unless you can diagnose and hot-fix
faster than a rollback restores service.

**Shape B — Smoke test failed, infrastructure problem.**
The adapter deployed but the probe couldn't reach the app — connection refused,
DNS failure, timeout. The app itself may be fine. Check whether the healthcheck
target, port, or route changed in this release.

→ Investigate before rolling back. A misconfigured healthcheck target or a
missing port-forward is a 30-second fix. Check `pipeline/deploy-log.md` for the
exact probe command and response.

**Shape C — Adapter step failed before smoke test.**
`adapter_result` shows a failure during the deploy steps themselves — image pull
failed, manifest rejected, plan apply errored. The app was never reached.

→ Investigate. The previous version is still running (no traffic interrupted).
Fix the adapter configuration and retry.

**Shape D — Gate precondition not met.**
`status: "ESCALATE"` (not FAIL) with a reason like "PM sign-off missing" or
"Runbook required". The adapter never ran.

→ This is not a deploy failure — it's a pipeline configuration issue. Follow the
[escalation runbook](escalation.md) to resolve the precondition, then re-run Stage 8.

---

## Investigate path

Use when you believe the failure is an infrastructure or configuration issue,
not a broken application (Shape B or C).

```bash
# 1. Read the health signals section of the runbook
grep -A 30 "## Health signals" pipeline/runbook.md

# 2. Probe manually using the adapter-specific commands below

# 3. If you identify and fix a configuration issue (wrong port, missing env var,
#    etc.), re-run Stage 8 directly — no need to go back through build:
devteam stage deploy --headless

# 4. Confirm gate flipped to PASS
cat pipeline/gates/stage-08.json | jq '{status, smoke_test_passed}'
```

### Adapter-specific diagnostics

**docker-compose:**
```bash
docker compose ps                          # container states
docker compose logs --tail=50 <service>    # recent application logs
docker compose exec <service> curl -s localhost:<port>/health  # direct probe
```

**kubernetes:**
```bash
kubectl get pods -n <namespace>            # pod states
kubectl describe pod <pod-name> -n <namespace>   # events + resource limits
kubectl logs <pod-name> -n <namespace> --tail=50
kubectl get events -n <namespace> --sort-by='.lastTimestamp'
```

**terraform:**
```bash
# Check plan output in pipeline/deploy-log.md for the failing resource
# Confirm state is consistent:
terraform show    # (from infra directory)
```

---

## Rollback path

Use when the app is broken in production/staging (Shape A) or when
investigation has stalled and you need to restore service first.

```bash
# 1. Read the rollback procedure
grep -A 40 "## Rollback" pipeline/runbook.md
```

Follow that procedure exactly. It was written for this specific deploy by `dev-platform` at Stage 8. The commands in `§Rollback` are the authoritative rollback for this release.

After rollback:

```bash
# 2. Confirm service is restored using the health signals
grep -A 20 "## Health signals" pipeline/runbook.md

# 3. Record the rollback in pipeline/context.md
cat >> pipeline/context.md << 'EOF'

## Deploy Rollback — <ISO timestamp>

Stage 8 failed with: <one-line description from gate blockers[]>
Rolled back to previous version via pipeline/runbook.md §Rollback.
Root cause under investigation. Do not re-deploy until root cause is identified.
EOF

# 4. File a follow-up ticket using the gate's blocker content
cat pipeline/gates/stage-08.json | jq '.blockers[]'
```

---

## Retry after fix

Once the root cause is identified and fixed (either a code fix or an
infrastructure configuration fix):

**Code fix needed** — the failure is a bug that slipped past tests:

```bash
# Clear the deploy gate, then patch-build only the owning workstream.
node -e "require('node:fs').rmSync(process.argv[1], { force: true })" pipeline/gates/stage-08.json
devteam stage build --patch --from stage-08 --workstream <workstream> --headless
devteam merge build
devteam stage pre-review --headless
devteam stage red-team --headless      # if full track
devteam stage peer-review --headless
devteam stage qa --headless
devteam stage sign-off --headless
devteam stage deploy --headless
```

**Infrastructure fix only** — the app code is correct, only config/infra changed:

```bash
# Clear just the deploy gate; everything upstream is still valid.
node -e "require('node:fs').rmSync(process.argv[1], { force: true })" pipeline/gates/stage-08.json
devteam stage deploy --headless
```

---

## Common gotchas

- **`runbook_referenced: false` on a PASS gate** — impossible by design; the gate
  validates this. If you see it, the gate was hand-edited. Re-run
  `devteam verify stage-08` to re-stamp.
- **Retrying without a root cause** — a second identical deploy failure produces `retry_number: 2` and eventually auto-escalates. Do not retry until the root cause is identified.
- **Rollback doesn't clear the gate** — after a successful rollback, the gate
  still shows FAIL. That's correct — the audit trail should reflect the failed
  deploy. Don't hand-edit it to PASS. The next successful deploy will write a new
  PASS gate.
- **Smoke test target changed** — if this release changed the healthcheck route,
  port, or auth requirement, the smoke test will fail even if the app is healthy.
  Update the probe configuration in the adapter or runbook, not the app.

---

## See also

- `pipeline/runbook.md` — deploy-specific rollback and health signal procedures
- [`escalation.md`](escalation.md) — if the failure requires a Principal ruling
- [`fix-and-retry.md`](fix-and-retry.md) — if the root cause traces back to a build-stage defect
