# Stage 4 — Build (3 Devs, parallel via git worktrees)

Each dev works in its own worktree:
  `git worktree add ../dev-team-backend feature/backend`
  `git worktree add ../dev-team-frontend feature/frontend`
  `git worktree add ../dev-team-platform feature/platform`

Invoke in parallel:
  `dev-backend`  → `src/backend/`  → `pipeline/pr-backend.md`
  `dev-frontend` → `src/frontend/` → `pipeline/pr-frontend.md`
  `dev-platform` → `src/infra/`    → `pipeline/pr-platform.md`

Gate file per PR: `pipeline/gates/stage-04-{area}.json`
All three must have `"status": "PASS"` before proceeding.

Pre-review checks (Stage 4.5) run after the three build gates PASS and
before Stage 5 starts. See `stage-04a.md` (lint + type-check + SCA) and
`stage-04b.md` (security review, conditional).
