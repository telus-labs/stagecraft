## `devteam commit` command (Phase 12.2)

**New command:** `devteam commit [options]`

Stages exactly the right pipeline artifacts for each completed stage and
generates a meaningful commit message — without any `git add` decisions from
the operator. Uses an idempotency cursor (`last_committed_stage_index`) so
calling it repeatedly is safe.

**Flags:**
- `--all` — stage all gate-bearing stages regardless of the cursor
- `--dry-run` — print what would be staged without committing
- `--message <msg>` — override the generated commit message
- `--json` — machine-readable output

**Stage artifact registry** (`core/pipeline/artifacts.js`): maps every stage ID
to its named output files. Gate files are added automatically for PASS/WARN
stages. Volatile runtime files (from the `devteam init` gitignore block) are
excluded unconditionally.

**Schema bump:** `run-state.json` now carries `stages_advanced` (list of stage
IDs in pipeline order) and `last_committed_stage_index` (commit cursor, `null`
if nothing has been committed). Both fields are migrated on read from pre-12.2
run states. `RUN_SCHEMA_VERSION` bumped to 1.2.

**Honest scope note:** Phase 12.2 supports in-place pipeline mode (changeId
null). Bounded-workspace (B9) support for `devteam commit` is a follow-on item.
