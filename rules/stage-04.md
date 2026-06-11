# Stage 4 — Build (3 Devs, parallel via git worktrees)

Each dev works in its own worktree:
  `git worktree add ../dev-team-backend feature/backend`
  `git worktree add ../dev-team-frontend feature/frontend`
  `git worktree add ../dev-team-platform feature/platform`

Invoke in parallel:
  `dev-backend`  → `src/backend/`  → `pipeline/pr-backend.md`
  `dev-frontend` → `src/frontend/` → `pipeline/pr-frontend.md`
  `dev-platform` → `src/infra/`    → `pipeline/pr-platform.md`

Gate file per workstream: `pipeline/gates/stage-04.{area}.json`
All three must have `"status": "PASS"` before proceeding.

Pre-review checks (stage-04a) run after the three build gates PASS and
before Stage 5 starts. See `stage-04a.md` (lint + dep review + SCA) and
`stage-04b.md` (security review, conditional).

## Gate

Workstream gate files: `pipeline/gates/stage-04.<area>.json` (one per role).
Merged stage gate: `pipeline/gates/stage-04.json`.

```json
{
  "stage": "stage-04",
  "status": "PASS",
  "track": "full",
  "timestamp": "<ISO 8601>",
  "orchestrator": "devteam@<version>",
  "workstream": "backend | frontend | platform | qa",
  "host": "claude-code",
  "blockers": [],
  "warnings": [],
  "area": "backend | frontend | platform",
  "files_changed": ["src/backend/foo.js"],
  "pr_summaries_written": ["pipeline/pr-backend.md"],
  "local_verification": ["npm test — 42 passed"]
}
```

All workstream gates must have `"status": "PASS"` before Stage 4a begins.
