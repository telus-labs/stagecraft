---
type: changed
pr: ~
---

**Execute D5 step 3 — role-brief token trim (8.3)**

Move stage-conditional task sections from `roles/platform.md` (15,617 B →
2,400 B, −85%) and `roles/qa.md` (12,878 B → 2,718 B, −79%) into dedicated
per-stage skill files, leaving role identity + handoff + gate rules in the
briefs.

- **New skills (platform):** `skills/platform-build/SKILL.md`,
  `skills/platform-pre-review/SKILL.md`, `skills/platform-deploy/SKILL.md`.
  Extended: `skills/review-rubric/SKILL.md` (Platform Reviewer Focus section),
  `skills/observability-verification/SKILL.md` (Platform gate detail section).
- **New skills (qa):** `skills/qa-augmentation/SKILL.md`,
  `skills/qa-test-authoring/SKILL.md`, `skills/qa-test-execution/SKILL.md`.
  Extended: `skills/review-rubric/SKILL.md` (QA Reviewer Focus section).
- **`rules/stage-05.md`** trimmed from 9,985 B to 8,177 B (under the 8 KB
  advisory ceiling). The approval-derivation hook contract detail (blockers[]
  schema, gate merge strategy, affected_workstreams derivation) moved to
  `docs/conventions.md §Stage 5 approval-derivation hook contract`.
- **`docs/reference/prompt-budget.md`** regenerated. Platform dispatch:
  27,402 B → 14,185 B (−48%); QA dispatch: 24,663 B → 14,503 B (−41%).
- `npm run consistency` — 314 checks passed, zero advisories (was 1).

Honest scope note: the skill files are loaded on-demand by the model (directed
by the Task Skills table in each role brief), not automatically injected by the
orchestrator per stage identity. Orchestrator-level automatic injection remains
a future architectural improvement; the token reduction is real because the
brief is what the orchestrator includes in every dispatch, and skills are read
only for the current task.
