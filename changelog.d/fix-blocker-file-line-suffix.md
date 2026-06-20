### Fixed

- **Targeted-fix false-positive halt when blocker `file` includes a line-number suffix** (`src/backend/server.ts:5`): `blockerFiles()` now strips the `:\d+` suffix before hashing, so a genuine source-file change is correctly detected and the pipeline continues instead of escalating with `convergence-exhausted`. Closes #269.
