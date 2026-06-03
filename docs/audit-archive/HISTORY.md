# Audit history

Index of completed Stagecraft self-audits. The current audit lives at [`../audit/`](../audit/); past audits are preserved here, one directory per audit, named `<date>-<version>-<context>/`.

When a new audit starts, the audit skill's step 0.0 archives the prior `docs/audit/` into this tree automatically (`skills/audit/SKILL.md` § Phase 0 step 0.0) and appends a row to the table below.

| Date | Version | Context | Phases completed | Headline |
|------|---------|---------|------------------|----------|
| 2026-05-28 | v0.4.0 | Initial self-audit (dogfood) | 0–3 (all 4) | 0 P0 · 5 P1 quick wins · 5 P2 targeted · 1 P3 strategic. ~5 days total effort to land everything except Parked items. Most value in Batch 1 (XS-effort hygiene). See [`2026-05-28-v0.4.0-initial-dogfood/10-roadmap.md`](2026-05-28-v0.4.0-initial-dogfood/10-roadmap.md). |

## Diffing two audits

To compare the current audit against the most recent archived one:

```bash
# Find the most recent archive
ls -1d docs/audit-archive/*/ | sort | tail -1

# Diff the roadmap files
diff -u docs/audit-archive/<latest>/10-roadmap.md docs/audit/10-roadmap.md

# Or, for a file-by-file side-by-side overview
git diff --no-index docs/audit-archive/<latest>/ docs/audit/
```

Open items from a prior audit that haven't been addressed should be carried forward — the new roadmap should either close them out (with a citation explaining why) or re-prioritize them alongside the new findings.
