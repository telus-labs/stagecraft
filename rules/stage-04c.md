# Stage 4c — Red-team (tracks: full, hotfix)

Invoke: `red-team` agent.
Input: `pipeline/brief.md`, `pipeline/design-spec.md`, `pipeline/pr-*.md`,
`pipeline/pre-review.md`, `pipeline/security-review.md` (if stage-04b ran).
Output: `pipeline/red-team-report.md`.
## Gate

Gate file: `pipeline/gates/stage-04c.json`.

```json
{
  "stage": "stage-04c",
  "status": "PASS | WARN | FAIL",
  "track": "full",
  "timestamp": "<ISO 8601>",
  "orchestrator": "devteam@<version>",
  "workstream": "red-team",
  "host": "claude-code",
  "blockers": [],
  "warnings": [],
  "surfaces_walked": ["input_boundaries", "state_boundaries", "sequence_boundaries"],
  "surfaces_skipped": [
    { "surface": "auth_edges", "reason": "auth path unchanged — change adds no new authz checks" }
  ],
  "findings_count": 3,
  "severity_breakdown": { "critical": 0, "high": 1, "medium": 1, "low": 1 },
  "affected_workstreams": ["backend"],
  "must_address_before_peer_review": [
    { "id": "RT-01", "workstream": "backend", "file": "src/backend/controls/mapping.js", "severity": "high", "scenario": "..." }
  ],
  "noted_for_followup": [
    { "id": "RT-06", "text": "...", "track_for": "ticket", "file": "src/cli.js:127", "effort": "XS" }
  ]
}
```

`surfaces_walked` and `surfaces_skipped` together must account for all 10 canonical
attack surfaces: `input_boundaries`, `state_boundaries`, `sequence_boundaries`,
`integration_boundaries`, `auth_edges`, `resource_exhaustion`, `failure_modes`,
`abuse_cases`, `downstream_effects`, `observability_gaps`. The validator emits an
advisory when the two arrays don't cover all 10.

PASS means every `must_address_before_peer_review` item has been addressed;
WARN means findings exist but none require pre-peer-review fixes;
FAIL means blocking findings remain unaddressed.

The orchestrator loops: on FAIL, build agents address `must_address_before_peer_review`
items via `devteam stage build --patch --from red-team`, then red-team re-runs until
the gate reaches PASS or WARN. QA then writes regression tests covering the addressed
items (post-red-team augmentation task, also stage 4c). See `docs/runbooks/fix-and-retry.md`.

**Diversity requirement.** Route red-team to a different host than the builders
(`routing.roles.red-team` in `.devteam/config.yml`). A red team reviewing its own
implementation provides weaker adversarial coverage.

See `skills/red-team/SKILL.md` for the full attack-surface enumeration, finding
severity rubric, and output format.
