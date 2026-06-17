---
type: fix
---

- Document gizmos secrets limitation in `core/deploy/gizmos.md`: `gizmos push` has no flag for env vars or secrets; add them via the Gizmos hub UI after the first deploy. First-request failure is expected, not a broken deploy.
