# Review by frontend

## Review of backend

API surface is clean. POST /api/v2/notification-preferences accepts the per-event-type toggle map; response shape matches what the toggle component expects. Validation logic is symmetrical with the frontend's. Audit-log write happens before the response is returned, so we can rely on the audit being durable.

One concern noted in the QA notes — see below.

REVIEW: APPROVED

## Review of platform

Smoke-test in pipeline/runbook.md mentions the wrong endpoint — it lists POST /api/sms but the actual route is POST /api/v2/sms. This will produce a false-positive PASS on the post-deploy check.

BLOCKER: pipeline/runbook.md §Smoke test references /api/sms; actual endpoint is /api/v2/sms. Update the runbook.

REVIEW: CHANGES REQUESTED
