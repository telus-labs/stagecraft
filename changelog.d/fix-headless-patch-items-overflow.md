### Fixed

- **Structural-input halt when patchItems push headless prompt over Claude Code's 4000-char goal-condition limit**: `runHeadless()` now detects prompts that exceed the limit and re-renders without `patchItems` before spawning the agent. A warning is emitted to stderr. The agent reads `pipeline/context.md` for blocker guidance instead of the inline patch block — the auto-fix mechanism already writes blockers there before dispatch, so no information is lost. Closes #277.
