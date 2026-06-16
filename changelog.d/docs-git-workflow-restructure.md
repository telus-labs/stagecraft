## `docs/git-workflow.md` restructure + repair-mode commit guidance (Phase 12.4)

**`docs/git-workflow.md`** restructured into a 7-section outline covering both operator
modes: §1 Overview (interactive vs. autonomous; what lives in git), §2 What to commit vs.
ignore (reference `devteam init` gitignore block; include/exclude table), §3 Interactive
mode (`devteam commit` as primary interface; per-stage-group commit cadence; Stage 04
worktrees), §4 Autonomous mode (new: `halt_action` table identifying `ceiling`/`until`/
`budget` as clean commit signals; `devteam commit` after a halt; `--auto-commit` opt-in
semantics), §5 Repair mode (new: three natural commit points; note that source file staging
is the operator's responsibility), §6 PR timing, §7 CI integration.

**`docs/runbooks/repair-flow.md`** — added "When to commit in repair mode" section: three
commit points (after diagnosis gate approval, after failing-first test, after build + scope
gate PASS). Notes that `devteam commit` handles gate files automatically; application source
files require explicit `git add` by the operator.

**Phase 12 complete.** All four items shipped: managed gitignore (PR #154), `devteam commit`
(PR #155), `--auto-commit` (PR #156), docs restructure (PR #157).
