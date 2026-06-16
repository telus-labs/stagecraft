## `devteam run --auto-commit` (Phase 12.3)

**New flag:** `--auto-commit` on `devteam run`

When passed, the driver automatically commits pipeline artifacts after a clean
halt — using the same algorithm as `devteam commit`, with no interactive
confirmation prompt.

**"Clean halt"** is defined as `halt_action` in `{"ceiling", "until", "budget"}`:
the halts where the driver stopped by design, not because something broke.
Non-clean halts (`fix-and-retry`, `resolve-escalation`, `structural-input`,
etc.) do **not** trigger auto-commit.

**Behaviour:**
- Calls `runCommit(cwd)` (the programmatic export of `devteam commit`) after
  the driver returns. Prints the list of committed files to stderr.
- If there is nothing to commit (cursor already current), logs
  `{"event":"auto-commit-skipped","reason":"nothing-to-commit"}` and moves on.
- On commit success, logs `{"event":"auto-commit","staged_files":[…],"commit_hash":"…"}`.
- On commit failure, logs `{"event":"auto-commit-failed","reason":"…"}` and
  emits a loud stderr warning. The run's exit code is **not** changed — a git
  failure does not retroactively change the pipeline halt semantics.

**New export:** `runCommit(cwd)` from `core/cli/commands/commit.js` — the
programmatic interface for unattended commits (no prompt, returns a result
object rather than calling `process.exit`).

**Honest scope note:** auto-commit operates in in-place mode (changeId null),
consistent with Phase 12.2. Bounded-workspace support is a follow-on item.
