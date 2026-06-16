---
type: feat
---

- `devteam advise` now renders follow-up items grouped by risk tier (QA BLOCKER → PEER-REVIEW RISK → QA NOISE → INFO) with item counts; tiers with zero items are omitted.
- ADDRESSED items collapse to a single summary line (`✓ N addressed: id1, id2, ...`) instead of printing a full block per item.
- Scaffold follow-up commands are surfaced inline in read mode, not only after `--apply`.
- `runAdvise` result and `--json` output now include a `by_tier` object pre-grouping items by classification for machine consumers.
