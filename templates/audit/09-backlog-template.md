# 09 — Backlog

> Phase 3.1 output. Read every prior `docs/audit/` file first. Synthesize into 3–5 systemic themes, then build the prioritized backlog.

## Summary

One paragraph: the shape of the work this audit surfaced. How urgent? How big? Where does the pain concentrate?

## Themes

3–5 systemic themes — patterns recurring across multiple findings in §03–§08. Themes are higher-level than individual findings; they tell a story.

### Theme 1: <name>

<2–3 sentences describing the theme and where it appears across the codebase.>

### Theme 2: …

…

## Rating scales

- **Effort:** XS (<1 day) / S (1–3 days) / M (week) / L (2 weeks) / XL (1 month+)
- **Risk of change:** low / medium / high — the chance this change introduces a regression
- **Risk of NOT changing:** low / medium / high — the cost of leaving it alone
- **Confidence:** HIGH / MEDIUM / LOW

## P0 — Fix now

Critical security, broken builds, data-corruption potential. Land within days.

### P0-1: <title — action-oriented>

- **Theme:** <which theme>
- **Description:** <2-3 sentences>
- **Affected components:** <list>
- **Effort:** XS / S / M / L / XL
- **Risk of change:** low / medium / high
- **Risk of NOT changing:** low / medium / high
- **Dependencies:** <items that must land first, or "none">
- **Confidence:** HIGH / MEDIUM / LOW
- **Sources:** <which findings from §03–§08 surfaced this>

## P1 — Quick wins

Low effort, high impact. Land in weeks 1–2.

### P1-1: <title>

…

## P2 — Targeted improvements

Real value but bigger lift. Weeks 3–6.

### P2-1: <title>

…

## P3 — Strategic investments

Long-term, paired with mini-proposals. Month 2+.

### P3-1: <title>

…

## Parked

Findings that don't justify work right now. Include the reasoning so the next audit doesn't re-flag them.

### Parked-1: <title>

- **Reason for parking:** <why not now>
- **What would change this:** <what trigger would move it to P0/P1/P2>

## Project-Specific

> *(Appended by extensions if applicable.)*
