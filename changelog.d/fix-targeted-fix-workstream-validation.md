### Fixed

- **Targeted-fix ghost-workstream cycle**: when a post-build stage (accessibility-audit, peer-review, QA) triggers a `fix-and-retry` for a file whose `file_ownership` points to a workstream that stage-04 never dispatched (e.g. `frontend` in a backend-only project), the driver now rejects the inferred workstream and falls back to a regular build dispatch instead of silently cycling until fix-retry budgets are exhausted. Closes #271.
