---
description: >
  Run a structured codebase audit. Maps the architecture, assesses health
  (compliance, tests, docs), performs deep analysis (security, performance,
  code quality), and synthesizes a prioritized roadmap. Outputs land under
  docs/audit/ in this project. Phases 0-3 with human checkpoints between
  each phase. Use /audit-quick for a faster Phase 0-1 scan.
---

# /audit

You are running a full codebase audit on this project.

**Read `.claude/skills/audit/SKILL.md` before doing anything else.** That file defines what each phase does, what each phase produces, and what inputs to gather before starting.

## Input

The text after `/audit` is an optional scope constraint.

- `/audit` — audit the entire codebase.
- `/audit src/backend/` — focus the audit on one subtree.
- `/audit --resume` — read `docs/audit/status.json` and continue from the last completed phase.

## Startup

Before any phase work:

1. Read `.claude/skills/audit/SKILL.md` (the phase definitions — the brain of this command).
2. Read `CLAUDE.md` if it exists (project-specific instructions).
3. Read `AGENTS.md` if it exists.
4. Create `docs/audit/` if it doesn't exist.
5. Check for `docs/audit-extensions.md` — note whether it exists; if it does, you'll read it at the start of each phase and append findings under a `## Project-Specific` heading in the phase's output file.
6. Check for `docs/audit/status.json` — if resuming, load state. Otherwise write a fresh status file:

```json
{
  "started": "<ISO 8601 timestamp>",
  "scope": "full" | "scoped to <subtree>",
  "phases": {
    "phase-0": "pending",
    "phase-1": "pending",
    "phase-2": "pending",
    "phase-3": "pending"
  },
  "current_phase": "phase-0",
  "audited_by": "claude-code"
}
```

## Execution

Run each phase as defined in `.claude/skills/audit/SKILL.md`. Read each phase's template (`.claude/skills/audit/../templates/audit/<NN>-*.md` — or copy the structure if your tools don't reach that path) before writing the output file.

### Phase 0 — Bootstrap

Run steps 0.1, 0.2, 0.3 from the skill. Write each output file.
If `docs/audit-extensions.md` declares Phase 0 extensions, run them and append results under `## Project-Specific` in each phase-0 file.
Update `status.json`: `"phase-0": "complete"`.

Print summary:

```
[Phase 0 — Bootstrap] ✅ Complete
  • Project: <language / framework>
  • Size: <N files, M modules/services>
  • Key finding: <one-sentence highlight>
```

**✋ Checkpoint A.** Tell the user:

> "I've mapped the project architecture. Review `docs/audit/00-project-context.md` and `docs/audit/01-architecture.md`. Type `proceed` to continue to the health assessment, or give feedback to adjust."

Wait for `proceed` before continuing.

### Phase 1 — Health Assessment

Run steps 1.1, 1.2, 1.3. Write each output file. Run Phase 1 extensions if any.
Update `status.json`: `"phase-1": "complete"`.

Print summary:

```
[Phase 1 — Health Assessment] ✅ Complete
  • Convention violations: <N findings, M high-confidence>
  • Test coverage: <brief summary>
  • Documentation: <brief summary>
```

**✋ Checkpoint B.** Tell the user:

> "Health assessment complete. Review `docs/audit/03-compliance.md`, `04-tests.md`, and `05-documentation.md`. Type `proceed` to continue to deep analysis, or give feedback."

Wait for `proceed`.

### Phase 2 — Deep Analysis

Run steps 2.1, 2.2, 2.3. Write each output file. Run Phase 2 extensions if any.
Update `status.json`: `"phase-2": "complete"`.

Print summary:

```
[Phase 2 — Deep Analysis] ✅ Complete
  • Security: <N findings, M critical/high>
  • Performance: <N findings>
  • Code quality: <N findings>
```

**✋ Checkpoint C.** Tell the user:

> "Deep analysis complete. Review `docs/audit/06-security.md`, `07-performance.md`, and `08-code-quality.md`. Type `proceed` to generate the roadmap, or give feedback."

Wait for `proceed`.

### Phase 3 — Roadmap

Run steps 3.1, 3.2. Write each output file. Run Phase 3 extensions if any.
Update `status.json`: `"phase-3": "complete"`.

## End of audit

Print the final dashboard:

```
Codebase Audit Complete
═══════════════════════════════════════════════════
Phase                    Status     Files
─────────────────────────────────────────────────
0  Bootstrap             ✅         00, 01, 02
1  Health Assessment     ✅         03, 04, 05
2  Deep Analysis         ✅         06, 07, 08
3  Roadmap               ✅         09, 10
─────────────────────────────────────────────────

Themes: <list 3-5 themes from §09>

Roadmap summary:
  P0 (fix now):           <N items>
  P1 (quick wins):        <N items>
  P2 (targeted):          <N items>
  P3 (strategic):         <N items>
  Parked:                 <N items>

Next step: use the implement skill to start on roadmap items, or
read docs/audit/10-roadmap.md for the full sequenced plan.
```

## Monorepo handling

If Phase 0 reveals this is a monorepo with multiple apps / services:

1. Complete Phase 0 for the whole repo.
2. Ask the user: "This is a monorepo with <N> services. Run Phases 1–2 across everything, or focus on a specific subsystem?"
3. If focused: run Phases 1–2 on the chosen subsystem only, then ask about the next.
4. Run Phase 3 across all collected findings regardless of subsystem.

Per-subsystem outputs go under `docs/audit/<service-name>/`.

## What this command does NOT do

- It does not modify source code. Findings live in `docs/audit/`; fixing them is the `implement` skill or a `devteam stage` invocation.
- It does not audit Stagecraft itself unless the user explicitly asks for that.
- It does not skip phases without a documented reason in `status.json`.
