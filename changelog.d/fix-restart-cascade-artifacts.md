---
type: fix
---
- `devteam restart --cascade` now deletes downstream artifact files (e.g. `brief.md`, `spec.feature`, `test-report.md`) in addition to gate files. Previously, stale artifacts from a prior feature run would cause false drift on the next run.
