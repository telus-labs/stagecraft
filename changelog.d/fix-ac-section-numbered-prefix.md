---
type: fix
---

- `AC_SECTION_RE` in `extractAcsFromBrief` now accepts any single-token section prefix before "Acceptance Criteria" (`§3`, `3.`, `3`, etc.), not just the `§N` style. Briefs using `## 3. Acceptance Criteria` no longer fall through to a whole-document scan that misidentifies cross-section AC references as duplicate definitions.
- The drift blocker message now includes `duplicate_criteria` count and ids when duplicates are the cause, making the failure self-explanatory without requiring a read of the gate file.
