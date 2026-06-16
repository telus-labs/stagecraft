---
type: feat
---

- Add `gizmos` deploy adapter (`core/deploy/gizmos.md`): pushes source to the Gizmos platform (Cloudflare Workers, gizmos.run) via `gizmos push`, smoke-tests the live URL, and writes a compliant stage-08 gate with `deploy_completed`, `smoke_tests_passed`, and `rollback_executed` fields.
