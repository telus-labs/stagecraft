---
name: migration-safety
description: "Review the migration-safety story for a data-layer change at stage-04d. Use this skill when the user says 'review this migration', 'is this rollback plan solid', '/migration-safety', or when the orchestrator invokes the migrations role for stage-04d. The skill walks schema delta → breaking-change classification → backfill strategy → dual-write strategy → rollback plan → rollback test → gate write. Has veto power on unsafe migrations."
---

# Review a Migration

A structured safety review for changes that touch persistent state (schema files, migration directories, ALTER/CREATE/DROP TABLE DDL, ORM migration files). Runs as `stage-04d`, conditional on `stage-04a`'s heuristic firing.

The pipeline guarantees you have a tested rollback before peer review sees the change. That's the whole point of this stage.

## When to use this

- Orchestrator invokes the `migrations` role for stage-04d (the normal path).
- User explicitly asks "is this migration safe?" or "review this rollback plan."

When **not** to use this:
- General code review of business logic — that's `reviewer` at stage-05.
- Security-sensitive paths (auth / crypto / PII storage) — that's `security-engineer` at stage-04b. The two stages cover different concerns; both may fire on the same migration.
- Performance characteristics — that's red-team (stage-04c) or general review.
- A non-data-layer change: this skill exits cleanly and the stage skips.

## Phase 1 — Load context

Read, in order:

1. `pipeline/brief.md` — does the brief mention the data change? Was it scoped intentionally, or is it a side effect?
2. `pipeline/design-spec.md` — §Data model and §Rollback. The design's rollback section feeds this review; you're verifying the implementation against the plan.
3. `pipeline/pre-review.md` — `triggering_conditions` lists the files that triggered the heuristic. Read all of them.
4. Each migration file. Read the actual SQL or ORM migration code, not just the diff.
5. Currently-deployed code's expectations. Grep for SELECT/INSERT against the affected tables — what does running code assume?

## Phase 2 — Walk the six questions

For every distinct migration in the diff, work through:

### Q1 — What does this migration actually do?

One paragraph, plain English. If you can't summarize the migration in one paragraph, it's doing too much. Split it.

### Q2 — Is it a breaking change?

Breaking iff currently-running code can't handle the new schema. Common breaking patterns:

| Change | Breaking? | Why |
|---|---|---|
| `ADD COLUMN x NULL` | No | Existing code ignores unknown columns |
| `ADD COLUMN x NOT NULL DEFAULT y` | No | Default backfills existing rows |
| `ADD COLUMN x NOT NULL` (no default) | **Yes** | Existing rows have no value |
| `DROP COLUMN x` | **Yes** | If code SELECTs x or INSERTs into x |
| `ALTER COLUMN x TYPE narrower` | **Yes** | Existing values may not fit |
| `ALTER COLUMN x TYPE wider` | No | Existing values still fit |
| `RENAME COLUMN x TO y` | **Yes** | Without a view alias for x |
| `RENAME TABLE x TO y` | **Yes** | Without a view alias for x |
| `CREATE TABLE` | No | New surface, no existing dependency |
| `DROP TABLE` | **Yes** | If anywhere reads from it |
| `CREATE INDEX` | No (usually) | Background-create on most engines |
| `DROP INDEX` | Maybe | If query planner depends on it |
| `ADD CONSTRAINT` already satisfied | No | All existing rows pass |
| `ADD CONSTRAINT` not satisfied by all | **Yes** | Existing violators block creation |

### Q3 — Does it require a backfill?

Backfill required iff existing rows need to be modified to fit the new schema, OR a new field's value derives from existing data.

If required, the strategy must specify:

- **Method.** Inline migration (blocks until complete; ok for small tables), batched job (preferred; runs concurrently with traffic), or offline (downtime window; rare in modern systems).
- **Batch size + rate.** "10,000 rows per batch, 1 batch/sec → 600,000 rows/min" — both numbers explicit.
- **Idempotency.** Re-running the backfill must be safe. Mechanism: conditional UPDATE (`WHERE x IS NULL`), UNIQUE constraint preventing dup inserts, or a marker column.
- **Verification.** A SQL query that returns 0 when the backfill is complete. `SELECT COUNT(*) FROM users WHERE notifications_opt_in IS NULL`.
- **Recovery.** If the backfill dies mid-run, how does it resume? The marker column + idempotency makes most backfills naturally resumable; spell it out anyway.

### Q4 — Does it require dual-write?

Dual-write required iff there's a transition window where writes need to go to BOTH old and new schemas:

- Rename old → new where existing code still reads from old.
- Move data to new table where existing reads are still hitting the old one.
- Sharding from monolithic table to per-shard tables.

If required:

- **Window length.** "Dual-write for 7 days, then cutover; old table dropped after 30 days." Both numbers explicit.
- **Conflict resolution.** Which write wins? Usually new — old is the rollback safety net.
- **Switchover step.** How is the cutover actually performed? A feature flag, a code deploy, both.
- **Verification gate.** What query confirms the new path is consistent before cutover?

### Q5 — What's the rollback plan?

**The single most-important question.** Auto-veto if empty or hand-wavy.

Acceptable answers:
- **Written inverse migration**: `db/migrations/0042_rollback.sql` is the gold standard. Reviewed alongside the forward migration. Best case.
- **Forward-compatible deploy**: "The new column is nullable, the new code handles both, so rolling back the code is safe and the schema can be left alone (drop the column in a follow-up if unused)." Acceptable for non-breaking migrations.
- **Backup restoration**: "Restore `users` from the snapshot taken at $deploy_time. Acceptable data loss: any writes during the rollback window. Notify CX team." Acceptable for irreversible migrations IF the acceptable data-loss window is explicit AND the snapshot's existence is verified.

Auto-veto answers:
- "Revert the PR" alone. (The column may already be dropped.)
- "We have backups" without specifics.
- "Rollback won't be needed."
- Empty / missing.

### Q6 — Was the rollback tested?

Documented vs. verified. The difference matters when 3 AM happens.

Acceptable proofs:
- Ran the rollback against staging with production-shaped data. Capture timing + verification query result.
- Ran against a throwaway local DB with seeded data covering the migration's edge cases.
- For backup-based: ran a restore drill within the last 90 days; the team practices this.

If untested AND breaking: auto-veto. Run the test, then re-review. The cost of testing rollback is cheap; the cost of discovering it doesn't work at deploy time is everything.

## Phase 3 — Write the report

Use `templates/migration-safety-template.md`. Structure:

1. **Summary** — 1 paragraph: what migration(s), breaking?, your verdict in headline form.
2. **Migration files** — list each path the heuristic flagged. The auditable trace.
3. **Per-migration analysis** — for each migration: Q1 through Q6, with concrete answers.
4. **Coordination requirements** — if breaking: how the deploy coordinates with currently-running code (feature flag, blue/green, etc.).
5. **Blockers / Warnings** — promoted findings.
6. **Approval line** — explicit PASS / FAIL / VETO with rationale.

## Phase 4 — Write the gate

`pipeline/gates/stage-04d.json`. The schema requires:

```json
{
  "stage": "stage-04d",
  "status": "PASS|WARN|FAIL|ESCALATE",
  "orchestrator": "<filled by orchestrator>",
  "host": "<filled by orchestrator>",
  "workstream": "migrations",
  "track": "<full|hotfix|config-only>",
  "timestamp": "<ISO-8601>",
  "blockers": [],
  "warnings": [],
  "migration_files": ["db/migrations/0042_add_notifications_opt_in.sql"],
  "schema_changes_summary": "Add nullable BOOLEAN column...",
  "breaking_change": false,
  "backfill_required": false,
  "backfill_strategy": "",
  "dual_write_required": false,
  "dual_write_strategy": "",
  "rollback_plan": "DROP COLUMN notifications_opt_in; documented as db/migrations/0042_rollback.sql",
  "rollback_tested": true,
  "migration_approved": true,
  "veto": false,
  "triggering_conditions": ["path:db/migrations/0042_add_notifications_opt_in.sql"]
}
```

### Status logic

- **PASS** = `migration_approved: true` AND `veto: false` AND non-empty `rollback_plan` AND (`rollback_tested: true` OR `breaking_change: false`)
- **WARN** = `migration_approved: true` AND non-breaking AND documented-but-untested rollback. Captured in `warnings[]`.
- **FAIL** = missing strategy on something required (backfill / dual-write / rollback). `blockers[]` lists what's missing.
- **VETO** = `veto: true` — irreversible structural problem. Empty `rollback_plan` on any migration is an auto-veto. Untested rollback on a breaking change is an auto-veto.

The orchestrator halts the pipeline on VETO regardless of subsequent approvals. Peer-review CANNOT override; the migrations role must personally re-review the fix.

## A note on diversity

Like other safety roles (security-engineer, red-team), migrations is most valuable when routed to a **different model** than the build agents. Different blind spots catch different things. Config:

```yaml
routing:
  default_host: claude-code
  roles:
    backend: codex
    migrations: claude-code   # explicitly different from backend
```

## What this skill is NOT

- Not a code review of business logic — that's stage-05.
- Not a security review of auth/PII/crypto — that's stage-04b (same conditional pattern, different concerns; both can fire on a single migration).
- Not a performance review — that's red-team (stage-04c) or general.
- Not a test plan — QA at stage-06 writes and runs tests; this skill verifies the data layer can be rolled back if those tests fail in production.

## Where the report goes

`pipeline/migration-safety.md`. Sits next to `pipeline/security-review.md` and `pipeline/red-team-report.md` as one of the safety-stage outputs. Read by Stage 5 reviewers as context, by Stage 7 sign-off as deploy-readiness evidence, by Stage 9 retrospective synthesis for pattern-spotting ("we keep ending up with breaking migrations — promote a lesson about coordination").
