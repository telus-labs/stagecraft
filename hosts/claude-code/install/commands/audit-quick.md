---
description: >
  Run a quick codebase orientation scan — Phases 0 and 1 only (architecture
  map + health assessment). Skips deep analysis (security, performance, code
  quality) and the roadmap. Good for onboarding onto a new project or a fast
  pre-review checkup. Run /audit --resume later to continue with the deep
  phases.
---

# /audit-quick

You are running a quick audit — Phases 0 and 1 only.

**Read `.claude/skills/audit/SKILL.md` before doing anything else.** That file defines what each phase does and what to produce.

## Input

The text after `/audit-quick` is an optional scope constraint. If provided (e.g. `/audit-quick src/backend/`), focus on that area only.

## Startup

1. Read `.claude/skills/audit/SKILL.md`.
2. Read `CLAUDE.md` if it exists.
3. Read `AGENTS.md` if it exists.
4. Create `docs/audit/` if it doesn't exist.
5. Check for `docs/audit-extensions.md`.

## Execution

Run Phase 0 (steps 0.1, 0.2, 0.3) and Phase 1 (steps 1.1, 1.2, 1.3) from the skill. Write all six output files. Run extensions for Phases 0 and 1 if any are declared.

Write `docs/audit/status.json` with phases 0 and 1 complete, phases 2 and 3 pending:

```json
{
  "started": "<ISO 8601>",
  "scope": "full" | "scoped to <subtree>",
  "phases": {
    "phase-0": "complete",
    "phase-1": "complete",
    "phase-2": "pending",
    "phase-3": "pending"
  },
  "current_phase": "phase-1",
  "audited_by": "claude-code"
}
```

## End

Print summary:

```
Quick Audit Complete
═══════════════════════════════════════════════════
Phase                    Status     Files
─────────────────────────────────────────────────
0  Bootstrap             ✅         00, 01, 02
1  Health Assessment     ✅         03, 04, 05
2  Deep Analysis         ⏭️  Skipped
3  Roadmap               ⏭️  Skipped
─────────────────────────────────────────────────

Project: <language / framework>, <N modules/services>
Convention issues: <N findings>
Test health: <brief summary>
Doc gaps: <brief summary>

To continue with deep analysis and roadmap: /audit --resume
```

## What this command does NOT do

- Phase 2 (security / performance / code quality) — use `/audit` for those.
- Phase 3 (roadmap synthesis) — use `/audit` after the deep phases.
- Source code modifications. Audit is read-only.
