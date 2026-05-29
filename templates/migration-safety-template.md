# Migration Safety Review — <feature title>

## Summary

<1–3 sentences: which migration(s), breaking or not, your verdict. E.g. "Reviewed migration 0042_add_notifications_opt_in.sql. Non-breaking (nullable BOOLEAN with default). Rollback documented as 0042_rollback.sql AND tested against staging. **PASS** with no blockers.">

## Migration files

The pre-review heuristic flagged these paths (auditable list):

- `<path>` — <one-line: schema file / migration / DDL fragment in this file>
- `<path>` — ...

## Per-migration analysis

For each distinct migration, work through Q1–Q6.

### Migration 1: <short name / file>

**Q1 — What does this migration do?**

<One paragraph in plain English. If you can't summarize this migration in one paragraph, it's doing too much.>

**Q2 — Is it a breaking change?** `yes` / `no`

<Why: cite the specific change kind (add nullable / drop column / narrow type / rename / etc.) and confirm against currently-deployed code's read/write expectations.>

**Q3 — Does it require a backfill?** `yes` / `no`

If yes:
- **Method:** inline / batched job / offline
- **Batch size + rate:** <e.g. 10k rows/batch, 1 batch/sec → 600k/min>
- **Idempotency:** <conditional UPDATE / UNIQUE constraint / marker column — pick one and describe>
- **Verification query:** <SQL that returns 0 when complete>
- **Recovery on partial failure:** <how does it resume?>

If no: leave the strategy fields empty in the gate.

**Q4 — Does it require dual-write?** `yes` / `no`

If yes:
- **Window length:** <e.g. 7 days dual-write, cutover at day 8>
- **Conflict resolution:** <which write wins — usually new>
- **Switchover step:** <feature flag + code deploy / blue-green / etc.>
- **Verification gate:** <query confirming consistency before cutover>

If no: leave the strategy field empty.

**Q5 — Rollback plan**

> *Auto-veto if this section is empty or hand-wavy.*

<Concrete steps. Examples:
- "Run db/migrations/0042_rollback.sql. Reviewed alongside this PR. Idempotent."
- "Forward-compatible: new code handles both old and new schema. Roll back the code; leave the column. Drop in a follow-up if unused after 30 days."
- "Restore users table from snapshot at $deploy_time. Acceptable data loss: writes during the rollback window. CX team notified.">

**Q6 — Was the rollback tested?** `yes` / `no`

If yes: <staging or local? when? verification query result? attach screenshots / log if available>

If no AND breaking: this is a VETO. Run the test, re-review.
If no AND non-breaking: WARN — documented but untested.

### Migration 2: <...>

…

## Coordination requirements

If any migration is breaking, the deploy requires coordination with currently-running code. Describe:

- **Deploy strategy:** feature flag rollout / blue-green / canary / ...
- **Code-version compatibility window:** <both old and new code versions can handle the schema during the window>
- **Cutover trigger:** <flag flip / code deploy + DB migration sequence>

If no migrations are breaking, this section can read: "Non-breaking migrations only; no special deploy coordination required beyond the standard runbook."

## Blockers

Items that auto-FAIL or VETO. Each cites the specific concern.

- **BLOCKER:** <e.g. "Migration 0042 drops `users.legacy_email` column; current production code at sha:abc123 still SELECTs it. Coordination plan missing. Deploy would 500 on every login.">
- **BLOCKER:** ...

## Warnings

Items that don't block but should be tracked.

- **WARN:** <e.g. "Rollback documented but not exercised. Non-breaking change, so accepting the risk; recommend exercise on next breaking migration.">

## Approval line

<One sentence with the explicit verdict.>

- ✅ **APPROVED** — `migration_approved: true`, `veto: false`. Pipeline proceeds to Stage 5.
- ⚠️ **APPROVED WITH WARNINGS** — `migration_approved: true`, `veto: false`. Warnings recorded but no blockers.
- ❌ **CHANGES REQUESTED** — `migration_approved: false`, `veto: false`. Implementer addresses blockers and re-runs.
- 🛑 **VETO** — `veto: true`. Pipeline halts regardless of any other approval. Migration role must personally re-review the fix.

---

*Gate written to `pipeline/gates/stage-04d.json`. Peer review (Stage 5) cannot start until this gate is PASS (or WARN). A VETO halts the pipeline entirely — no peer-review approval can override it.*
