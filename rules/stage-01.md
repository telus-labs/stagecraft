# Stage 1 — PM Brief (Requirements)

Invoke: `pm` agent.
Input: feature request / ticket description.
Output: `pipeline/brief.md`.

Sections required for all tracks: §1 Problem, §2 Stories, §3 Acceptance Criteria,
§4 Out of Scope, §5 Open Questions. Full and hotfix tracks additionally require
§6–§11 (Rollback, Feature Flag, Data Migration, Observability, SLO, Cost).
Quick, config-only, dep-update tracks: §1–§5 plus either §6–§11 or a single
`## Risk notes` line for trivial changes.

See `templates/brief-template.md` for the canonical blank form;
`docs/brief-template.md` is the section-by-section annotation guide.

## Gate

Gate file: `pipeline/gates/stage-01.json`.

```json
{
  "stage": "stage-01",
  "status": "PASS",
  "track": "full",
  "timestamp": "<ISO 8601>",
  "orchestrator": "devteam@<version>",
  "blockers": [],
  "warnings": [],
  "acceptance_criteria_count": 5,
  "out_of_scope_items": [],
  "required_sections_complete": true
}
```

`required_sections_complete` must be `true` only when the brief contains all
sections required for its track (see track rules above). `acceptance_criteria_count`
is the number of numbered AC items in §3.
