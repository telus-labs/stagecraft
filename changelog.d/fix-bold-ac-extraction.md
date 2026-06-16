---
type: fix
---

- `extractAcsFromBrief` now parses AC definitions written in bold markdown format (`**AC-1** — description`) in addition to the existing bare and bullet-prefixed forms.
- Extraction is scoped to the `## [§N ]Acceptance Criteria` section when a heading is present, preventing AC references in other sections (e.g. Observability notes) from being counted as duplicate definitions. Falls back to whole-document scan for headerless briefs.
