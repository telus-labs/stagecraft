# Stage 4d — Migration safety (conditional; tracks: full, config-only, hotfix)

Invoke: `migrations` agent — **only when** stage-04a's gate has
`migration_safety_required: true`. The heuristic fires on data-layer changes:
schema files, migration directories, ALTER/CREATE/DROP TABLE DDL, ORM
migration files.

Input: `pipeline/brief.md`, `pipeline/design-spec.md`, `pipeline/pre-review.md`,
`pipeline/pr-*.md`.
Output: `pipeline/migration-safety.md`.
Gate file: `pipeline/gates/stage-04d.json`. Required keys:
- `migration_files`: list of changed migration/schema file paths
- `schema_changes_summary`: one-paragraph description of the schema delta
- `breaking_change`: boolean — does the change break existing consumers?
- `backfill_required`: boolean
- `backfill_strategy`: string (empty when not required)
- `dual_write_required`: boolean
- `dual_write_strategy`: string (empty when not required)
- `rollback_plan`: string — the tested rollback procedure
- `rollback_tested`: boolean — was the rollback actually verified?
- `migration_approved`: boolean
- `veto`: boolean — set to `true` if rollback is untested or blast radius is unbounded
- `triggering_conditions`: list of matching heuristic conditions

**Veto power.** A migration without a tested rollback halts the pipeline regardless
of other approvals. `veto: true` also sets `status: FAIL`. The migrations agent must
personally re-review after the fix and flip the flag.

When the heuristic does not fire, no gate file is written. The orchestrator records
the skip in `pipeline/context.md` as `MIGRATION-SKIP: <reason>`.

See `skills/migration-safety/SKILL.md` for the full review rubric: schema-diff
analysis, dual-write pattern guidance, rollback verification steps, and blast-radius
assessment for breaking changes.
