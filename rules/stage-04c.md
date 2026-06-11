# Stage 4c — Red-team (tracks: full, hotfix)

Invoke: `red-team` agent.
Input: `pipeline/brief.md`, `pipeline/design-spec.md`, `pipeline/pr-*.md`,
`pipeline/pre-review.md`, `pipeline/security-review.md` (if stage-04b ran).
Output: `pipeline/red-team-report.md`.
Gate file: `pipeline/gates/stage-04c.json`. Required keys:
- `surfaces_walked`: list of attack-surface names covered
- `surfaces_skipped`: list of `{ surface, reason }` objects for skipped surfaces
- `findings_count`: total finding count
- `severity_breakdown`: `{ critical, high, medium, low }`
- `must_address_before_peer_review`: list of `{ id, workstream, file, severity, scenario }` objects
- `noted_for_followup`: non-blocking findings as structured objects (schema in `gates.md`)

`surfaces_walked` and `surfaces_skipped` together must account for all 10 canonical
attack surfaces: `input_boundaries`, `state_boundaries`, `sequence_boundaries`,
`integration_boundaries`, `auth_edges`, `resource_exhaustion`, `failure_modes`,
`abuse_cases`, `downstream_effects`, `observability_gaps`.

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
