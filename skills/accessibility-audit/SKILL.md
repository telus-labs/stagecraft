---
name: accessibility-audit
description: "Run a WCAG accessibility audit on UI changes at Stage 6b. Uses axe-core, pa11y, or Lighthouse to check affected pages and components. Produces pipeline/accessibility-report.md and writes the stage-06b gate. Use when a change touched frontend UI. Skip (with audit_skipped_reason) for backend-only or doc-only changes."
---

# Accessibility audit

Use this skill at Stage 6b (after QA) when the change touched UI. Audits the affected pages/components for WCAG violations using axe-core, pa11y, or Lighthouse. Produces `pipeline/accessibility-report.md` and writes `pipeline/gates/stage-06b.json`.

## When to use

- Frontend changes shipped at Stage 4 (new component, modified flow, redesigned page).
- Updates to forms, inputs, dialogs, navigation, or anything keyboard/screen-reader-relevant.
- New routes/pages added to the app.

## When to skip (with `audit_skipped_reason` set)

- Backend-only changes (no UI surface).
- Doc-only changes.
- Internal tools with no public/customer surface AND no a11y commitment in the brief.

## Procedure

### 1. Identify what to audit

Read `pipeline/brief.md` and `pipeline/design-spec.md` for the scope. Cross-reference with the Stage 4 PR summaries (`pipeline/pr-frontend.md`) to find:
- Specific routes / page URLs.
- Specific React/Vue/Svelte components.
- Any flows the brief flagged as keyboard-only or screen-reader-critical.

If the change has no UI surface, write the gate with `audit_skipped_reason: "<reason>"`, `status: "PASS"`, all violations zero, and move on.

### 2. Pick a method

| Tool | Best for | Output shape |
|---|---|---|
| **axe-core** (via `@axe-core/cli` or programmatic) | Most thorough; integrates with Playwright/Cypress | JSON with violations grouped by impact |
| **pa11y** | Quick CLI sweep of URLs | HTML/JSON report per page |
| **Lighthouse** (a11y audit) | Holistic page score (covers perf + a11y) | JSON with `categories.accessibility.audits` |
| Manual (screen reader walkthrough) | Custom interactions Playwright/cypress-axe miss | Notes in the report |

In order of recommendation: **axe-core programmatic** (deepest) → **Lighthouse CI** (CI-friendly) → **pa11y** (simplest standalone) → manual (only when automated tools can't reach the flow).

### 3. Run the audit

**axe-core via @axe-core/cli**:
```bash
npx @axe-core/cli https://localhost:3000/account/notifications \
  --tags wcag2a,wcag2aa --save axe-report.json
```

**pa11y**:
```bash
pa11y --standard WCAG2AA https://localhost:3000/account/notifications \
  --reporter json > pa11y-report.json
```

**Lighthouse**:
```bash
npx lighthouse https://localhost:3000/account/notifications \
  --only-categories=accessibility --output=json > lh.json
```

If the app has a Storybook, audit there first — covers components in isolation including states (loading/error/empty) that are easy to miss in route-level audits.

### 4. Triage the findings

Group by impact:
- **Critical**: breaks access entirely (missing alt text on actionable images, form inputs with no label, keyboard traps).
- **Serious**: severely impairs access (color-contrast violations, missing ARIA roles on custom controls, focus order broken).
- **Moderate**: impairs but workarounds exist (low-contrast borders, decorative icons not hidden from screen readers).
- **Minor**: friction (duplicate IDs, redundant ARIA attributes).

**Critical** and **serious** findings must be fixed before sign-off. Push back to the frontend dev as a FAIL with the specific finding listed in `blockers[]`.

**Moderate** and **minor** can ship — record as WARN in the gate so they're tracked for follow-up.

### 5. Write the report and gate

`pipeline/accessibility-report.md`:

```markdown
# Accessibility Audit — <feature title>

## Audit method: axe-core (via @axe-core/cli)
## WCAG level: AA

## Components/routes audited
- /account/notifications
- /account/notifications/sms-verify
- <NotificationToggle> (Storybook)

## Findings

### Critical (0)
None.

### Serious (1)
- **Color contrast** on `<NotificationToggle>` off-state (3.8:1, requires 4.5:1)
  - Fix: bump off-state border color from #aaa to #767676.

### Moderate (1)
- **Form label association** on the phone-number input — implicit label via wrapping `<label>` works but explicit `for` is recommended.

### Minor (0)
None.

## Reproducer
Raw findings: `<path or URL to axe-report.json>`
```

`pipeline/gates/stage-06b.json`:

```json
{
  "stage": "stage-06b",
  "workstream": "qa",
  "status": "FAIL",
  "track": "<track>",
  "timestamp": "<ISO-8601>",
  "blockers": ["Color contrast violation on <NotificationToggle> off-state"],
  "warnings": [],
  "audit_method": "axe-core",
  "wcag_level": "AA",
  "violations": { "critical": 0, "serious": 1, "moderate": 1, "minor": 0 },
  "components_audited": ["/account/notifications", "<NotificationToggle>"],
  "audit_skipped_reason": null,
  "wcag_findings_url": "pipeline/axe-report.json"
}
```

### 6. PASS / WARN / FAIL decision

| Critical | Serious | Moderate | Minor | Status |
|---|---|---|---|---|
| 0 | 0 | 0 | 0 | PASS |
| 0 | 0 | ≥1 | ≥0 | WARN (or PASS — your call; record in warnings[]) |
| ≥1 | * | * | * | FAIL |
| * | ≥1 | * | * | FAIL |

When status is FAIL, name the specific frontend dev who needs to fix in `assigned_retry_to` if your project tracks that.

## Gotchas

- **Storybook in isolation passes but the route fails.** Components-in-isolation don't always carry the right ARIA context. Always audit BOTH the component and the route that contains it.
- **Color-contrast checks need real colors.** Computed CSS in tests may differ from production (different theme, dynamic states). If you're auditing component snapshots, use Playwright with a real browser, not jsdom.
- **Manual audits miss state.** Hover, focus, disabled, loading, and error states all have a11y requirements. Walk through each.
- **A "PASS" doesn't mean "accessible."** It means "no automated violations." Real accessibility requires user testing with assistive tech users — out of scope here, but flag in the report if the feature warrants it.
