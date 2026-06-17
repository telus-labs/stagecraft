---
type: fix
---
- `stampStage03b` no longer runs the test-report alignment check (that belongs to stage-06). A stale `pipeline/test-report.md` from a prior feature run no longer causes `drift: true` in the spec-authoring gate.
- `stamp.runs.spec_verify` now records `orphan_in_tests_count` and `unknown_in_tests_count` so drift is never opaque.
