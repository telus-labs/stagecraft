# 10 — Sequenced roadmap

> Phase 3.2 output. Read `09-backlog.md` first. Sequence items into batches with dependencies and parallelism made explicit.

## Summary

One paragraph: the shape of the roadmap. How many batches? Estimated total effort? Where's the riskiest sequencing decision?

## Batch 1 — Immediate (P0)

All P0 items in priority order. No parallel work unless items are genuinely independent — P0s are critical enough that focus beats fan-out.

| # | Item | Effort | Verification |
|---|---|---|---|
| 1 | <P0-N title> | XS / S / M / L / XL | <how you know it's done> |

**Parallelize:** <items that can run in parallel, if any>
**Total estimated effort:** <sum>
**Infrastructure changes needed:** <e.g. add CI step, new env var, new IAM role, …>

## Batch 2 — Weeks 1–2 (P1 quick wins)

Group P1 items into logical PRs — don't ship 12 tiny PRs when 3 grouped ones tell a coherent story.

### PR 2.1 — <theme name>

| # | Item | Effort | Verification |
|---|---|---|---|
| 1 | | | |
| 2 | | | |

### PR 2.2 — <theme name>

…

**Parallelize:** <which PRs can run in parallel>
**Total estimated effort:** <sum>

## Batch 3 — Weeks 3–6 (P2 targeted)

P2 items ordered by dependency and risk. Higher-risk items go later so earlier items can validate the approach.

| # | Item | Effort | Risk | Verification | Depends on |
|---|---|---|---|---|---|
| 1 | | | low / med / high | | <prior item or "none"> |

**Parallelize:** <which items can run in parallel>
**Total estimated effort:** <sum>

## Batch 4 — Month 2+ (P3 strategic)

P3 investments with mini-proposals. For each, what's the proposal and what's the validation criterion?

### P3-1: <title>

- **Mini-proposal:** <2–3 sentences>
- **Validation criterion:** <how you know the investment paid off>
- **Estimated effort:** L / XL
- **Risk:** <low / med / high>

…

## Roadmap risks

What could go wrong with this sequence? What would trigger re-sequencing?

- <risk>
- <risk>

## Recommended cadence

When should the next audit run? Triggers that should re-prioritize:

- <e.g. after batch 2 lands, re-audit security findings>
- <e.g. on major dependency upgrade>
- <e.g. quarterly>

## Project-Specific

> *(Appended by extensions if applicable.)*
