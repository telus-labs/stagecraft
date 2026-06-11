# Stage 4d — Migration safety (conditional; tracks: full, config-only, hotfix)

Invoke: `migrations` agent — **only when** stage-04a's gate has
`migration_safety_required: true`. The heuristic fires on data-layer changes:
schema files, migration directories, ALTER/CREATE/DROP TABLE DDL, ORM
migration files.

Input: `pipeline/brief.md`, `pipeline/design-spec.md`, `pipeline/pre-review.md`,
`pipeline/pr-*.md`.
Output: `pipeline/migration-safety.md`.
## Gate

Gate file: `pipeline/gates/stage-04d.json`. Written only when the heuristic fires.

```json
{
  "stage": "stage-04d",
  "status": "PASS | FAIL",
  "track": "full",
  "timestamp": "<ISO 8601>",
  "orchestrator": "devteam@<version>",
  "workstream": "migrations",
  "host": "claude-code",
  "blockers": [],
  "warnings": [],
  "migration_files": ["db/migrate/20240101_add_users.sql"],
  "schema_changes_summary": "Adds users.email column (NOT NULL, no default).",
  "breaking_change": false,
  "backfill_required": true,
  "backfill_strategy": "Populate from auth.email before applying NOT NULL constraint.",
  "dual_write_required": false,
  "dual_write_strategy": "",
  "rollback_plan": "DROP COLUMN users.email; revert application code.",
  "rollback_tested": true,
  "migration_approved": true,
  "veto": false,
  "triggering_conditions": ["schema-file", "migration-dir"]
}
```

**Veto power.** A migration without a tested rollback halts the pipeline regardless
of other approvals. `veto: true` also sets `status: FAIL`. The migrations agent must
personally re-review after the fix and flip the flag.

When the heuristic does not fire, no gate file is written. The orchestrator records
the skip in `pipeline/context.md` as `MIGRATION-SKIP: <reason>`.

See `skills/migration-safety/SKILL.md` for the full review rubric: schema-diff
analysis, dual-write pattern guidance, rollback verification steps, and blast-radius
assessment for breaking changes.
