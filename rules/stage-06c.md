# Stage 6c — Observability gate (tracks: full, hotfix)

Invoke: `dev-platform` agent.
Input: `pipeline/brief.md` §9 (Observability requirements), `pipeline/design-spec.md`, shipped code.
Output: `pipeline/observability-report.md`.
Gate file: `pipeline/gates/stage-06c.json`. Required keys:
- `metrics`: `{ required[], verified[], gap[] }`
- `logs`: same shape
- `traces`: same shape
- `verification_method`: `code-grep | static-analysis | staging-run | runtime-probe | dashboard-query | manual`

PASS requires every category's `gap` to be empty. Weak verification methods (`code-grep`, `static-analysis`, `manual`) PASS with a WARN ("recommend runtime-probe post-deploy"). Non-empty gap → FAIL with the missing signals as blockers, assigned to the dev who owned the relevant area.

**`assigned_to` on gap items.** Each entry in a `gap[]` array must carry an
`assigned_to` field naming the build workstream responsible for adding the
missing instrumentation. Use the same workstream names as the build gates
(`backend`, `frontend`, `platform`, `qa`). Match the missing signal against
the area of code that should emit it — a missing HTTP request metric belongs to
`backend` if the route handler lives there; a missing deploy health signal
belongs to `platform`.

**`affected_workstreams[]` on the gate.** Derive this as the deduplicated,
sorted list of all `assigned_to` values across all `gap[]` arrays (metrics,
logs, traces). This is the field stage managers query to know which build agents to
re-run:

```json
{
  "stage": "stage-06c", "status": "FAIL",
  "affected_workstreams": ["backend", "platform"],
  "metrics": {
    "required": ["http_requests_total", "deploy_health"],
    "verified": ["http_requests_total"],
    "gap": [
      { "signal": "deploy_health", "assigned_to": "platform", "note": "§9 requires this but src/infra/ has no emit" }
    ]
  },
  "logs": { "required": [], "verified": [], "gap": [] },
  "traces": {
    "required": ["db_query_duration"],
    "verified": [],
    "gap": [
      { "signal": "db_query_duration", "assigned_to": "backend", "note": "No span instrumentation on any query path" }
    ]
  }
}
```

See `skills/observability-verification/SKILL.md` for procedure, naming
conventions to match, and decision matrix.

This stage closes the "designs claim instrumentation that never lands" gap: it's where promised observability becomes contractual.

