# Audit output

This directory holds the **current** audit output (files `00-project-context.md` through `10-roadmap.md` plus `status.json`). See [`status.json`](status.json) for the run's date, version, and phase-completion state.

Past audits are preserved under [`../audit-archive/`](../audit-archive/) — see [`../audit-archive/HISTORY.md`](../audit-archive/HISTORY.md) for the index of completed audits and their headline findings.

When a new audit starts, `skills/audit/SKILL.md` step 0.0 archives the prior `docs/audit/` contents into `../audit-archive/<date>-<version>-<context>/` before the new audit writes its output here. You don't need to archive manually — the audit skill handles it. The convention was first exercised in PR #28 (manual move of the 2026-05-28 audit); the next full audit run will exercise Step 0.0 end-to-end.
