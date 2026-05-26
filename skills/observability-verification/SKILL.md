# Observability verification

Use this skill at Stage 6c (observability gate) to verify that every metric, log, and trace the design-spec promised is actually emitted by the shipped code. The most common failure mode this catches: a design says "we'll emit a counter `feature_x_changes_total`" and the code never adds it.

## When to use

- Stage 6c runs on `full` and `hotfix` tracks. Those are the tracks where the brief's §9 "Observability requirements" is mandatory.
- The platform role owns this stage; consult Backend/Frontend on what they actually added.

## When to skip

This stage is **not in `nano`, `config-only`, `dep-update`, `quick`** tracks. If you're on one of those, this skill doesn't apply. If you're on `full` / `hotfix` and the brief genuinely has no observability requirements (rare), set every `required` array to `[]` and PASS the gate.

## Procedure

### 1. Extract the required signals

Read `pipeline/brief.md` §9 "Observability requirements" and `pipeline/design-spec.md` for any expansion. Categorize each requirement:

- **Metrics**: counters / gauges / histograms with specific names. Look for prose like "counter X with labels Y, Z" or explicit metric-name lists.
- **Logs**: log statements with specific event types. Either named events (e.g. "log every opt-in change at INFO") or substring-matchable phrases.
- **Traces**: span names. Many briefs don't require traces explicitly — check the design-spec for §Tracing or §Distributed-tracing sections.

Make three lists. Empty is fine for any category the brief doesn't require.

### 2. Verify each signal in the code

For each required signal, find concrete evidence in the shipped code:

**Metrics** — typical patterns to grep for:
- Prometheus / OpenTelemetry: `counter.add(...)`, `Counter("name", ...)`, `prometheus_client.Counter("name")`, `metrics.counter("name")`
- StatsD: `statsd.increment("name.path")`, `dogstatsd.gauge`
- Build a regex: `grep -rE "name|MetricName.replace(/_/g, '[._]')"` — many libs normalize separators

```bash
# Example: looking for `notifications_opt_in_changes_total`
git -C <repo> grep -nE 'notifications[._-]opt[._-]in[._-]changes[._-]total' -- 'src/**'
```

**Logs** — look for the event identifier:
- Structured: `logger.info({ event: "opt_in.changed", ... })` or `log.info("opt_in.changed", { user_id, ... })`
- Unstructured: `console.log("Opt-in changed for ${userId}")` (find by substring; brittle but common)

```bash
git -C <repo> grep -nE 'opt[._-]?in[._-]?changed' -- 'src/**'
```

**Traces** — span names:
- OpenTelemetry: `tracer.startSpan("name")`, `tracer.startActiveSpan("name", ...)`, `withSpan("name", ...)`
- Application code path: `@trace("name")`, decorators

```bash
git -C <repo> grep -nE 'startSpan\(["'\''](notification\.opt_in\.change|sms\.send)' -- 'src/**'
```

### 3. Compute the gap

For each category: `gap = required - verified`. Anything in `gap` is a BLOCKER — the code promised something it doesn't deliver.

If the gap is non-empty, the gate is FAIL. Specifically name the missing signals in `blockers[]`. The owning dev (Backend for service metrics, Frontend for client telemetry, Platform for infra metrics) gets the fix-and-retry.

### 4. Choose the verification method

Rate how strong your verification was:

| Method | Confidence | When to use |
|---|---|---|
| `code-grep` | low — the name exists in code but you didn't observe it firing | Default; fastest |
| `static-analysis` | medium — typed signal definitions (e.g. OTel `Counter<...>`) | When the codebase uses typed observability APIs |
| `staging-run` | high — triggered the code path in staging and saw the signal in the dev tooling | When you can reach staging |
| `runtime-probe` | highest — same as staging-run, observed in the production-grade backend | When you can reach production tooling pre-deploy |
| `dashboard-query` | high — queried the live observability backend (Prometheus, Honeycomb, Datadog) for the signal name | When pre-deploy dashboards exist |
| `manual` | unknown — you read the code without running it | Last resort |

`code-grep` PASS is acceptable but WARN-flavored — the signal might exist but not fire on the right path. Push for `staging-run` or higher whenever feasible. Record the dashboard URL in `dashboard_url` if you used one.

### 5. Write the report and gate

`pipeline/observability-report.md`:

```markdown
# Observability verification — <feature title>

## Required (from brief §9)

**Metrics:**
- notifications_opt_in_changes_total{channel, event_type, direction}
- sms_sent_total{event_type, outcome}
- sms_verification_attempts_total{outcome}

**Logs:**
- "opt-in changed" at INFO
- "verification SMS sent" at INFO
- "SMS send failed" at WARN

**Traces:**
- (none required)

## Verified

**Metrics** (via code-grep):
- ✓ notifications_opt_in_changes_total → src/backend/services/notifications.ts:42
- ✓ sms_sent_total → src/backend/services/sms.ts:78
- ✓ sms_verification_attempts_total → src/backend/services/sms.ts:104

**Logs** (via code-grep):
- ✓ "opt-in changed" → src/backend/services/notifications.ts:39 (logger.info with event field)
- ✓ "verification SMS sent" → src/backend/services/sms.ts:75
- ✓ "SMS send failed" → src/backend/services/sms.ts:118

**Traces:** N/A

## Gap

None.

## Verification method

`code-grep`. Did not reach staging to confirm signals fire on real traffic — recommended a runtime-probe after deploy.
```

`pipeline/gates/stage-06c.json`:

```json
{
  "stage": "stage-06c",
  "workstream": "platform",
  "status": "PASS",
  "track": "<track>",
  "timestamp": "<ISO-8601>",
  "blockers": [],
  "warnings": ["verified via code-grep only; recommend runtime-probe post-deploy"],
  "metrics": {
    "required": ["notifications_opt_in_changes_total", "sms_sent_total", "sms_verification_attempts_total"],
    "verified": ["notifications_opt_in_changes_total", "sms_sent_total", "sms_verification_attempts_total"],
    "gap": []
  },
  "logs": {
    "required": ["opt-in changed", "verification SMS sent", "SMS send failed"],
    "verified": ["opt-in changed", "verification SMS sent", "SMS send failed"],
    "gap": []
  },
  "traces": { "required": [], "verified": [], "gap": [] },
  "verification_method": "code-grep"
}
```

### 6. PASS / WARN / FAIL decision

| Condition | Status |
|---|---|
| Every category has empty gap, verification_method ≥ `staging-run` | PASS |
| Every category has empty gap, verification_method = `code-grep` / `static-analysis` / `manual` | PASS with warning ("verified via X; recommend runtime probe") |
| Any category has non-empty gap | FAIL with the missing signals in `blockers[]` |

## Gotchas

- **Names with separators.** Metric libraries normalize `_` ↔ `.` ↔ `-`. Grep with a character class: `[._-]`.
- **Cardinality explosions.** A metric named `sms_sent_total{phone_number=...}` has unbounded cardinality (one series per user phone). If the design promised this, push back — fix the design, not the test.
- **Sampled traces.** A trace span existing in code doesn't mean it fires for every request — sampling may drop it. If the design relied on the trace being there for debugging, verify the sampling config too.
- **Log levels.** "logs at INFO" requires both the call AND the configured log level to be INFO or finer. Check the prod log config.
- **PII in observability.** Metrics with high-cardinality labels (user_id, email) and logs that include PII are themselves a security concern. If you find them, escalate — that's a stoplist-class issue.

## When verification fails

If the gap is non-empty:

1. Set `status: "FAIL"`, list specific missing signals in `blockers[]`.
2. The dev who owned the relevant area (`pipeline/pr-backend.md` or pr-frontend.md or pr-platform.md) gets the fix-and-retry.
3. After the dev adds the missing signals, re-run this stage. The gate is overwritten with the new verification result.

## Don't do this

- Don't accept a "we'll add it later" verbal commitment. The gate is the contract; if a signal is required but missing, FAIL the gate.
- Don't FAIL on logs that exist with slightly different wording — match by event name / substring, not literal string equality.
- Don't accept `verification_method: "manual"` as PASS when the same code path is exercised by tests; bump to `code-grep` minimum.
