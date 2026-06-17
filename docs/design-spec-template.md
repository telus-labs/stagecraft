# Design spec — how to fill it out

The design spec is the artifact stage-02 (design, Principal role) produces. It lives at `pipeline/design-spec.md`. Stage 3 (Clarification) reads it to surface open questions; Stage 4 (Build) workstreams read it to know what to build.

This page is the section-by-section "what to write, why, and what to skip" guide. The blank template lives at [`templates/design-spec-template.md`](../templates/design-spec-template.md); this doc explains *how* to fill it.

> **One-paragraph mental model.** The brief said *what* and *why*. The design spec says *how*. It's the bridge between PM intent and developer implementation. It also commits the team to specific technical decisions that the retrospective can later evaluate.

---

## Section: Summary

**What to write.** 2–4 sentences that summarize the approach in plain language. A reader who only reads this section should understand the shape of the change.

**Why it matters.** Half the design spec readers (busy stakeholders, future-you, the audit reviewer in 6 months) only read the summary. If the rest of the doc explains *how* and the summary doesn't say *what shape*, you've failed the most important reader.

**Good:** *"Add a `notifications_opt_in` column to the users table (default true), expose a `PATCH /api/preferences` endpoint that flips it, and have the marketing-email worker filter on the column when enqueueing. Feature-flagged via `NOTIFICATIONS_OPT_IN_V2`; rollout in two stages (10% canary, then 100%)."*

**Bad:** *"This document describes the design for the notifications opt-in feature."* (Tells you nothing.)

---

## Section: Requirements trace

**What to write.** A mapping from each acceptance criterion in the brief to where it's addressed in this design. Format: `AC-1 → §Architecture (preferences endpoint), §Data Model (column).`

**Why it matters.** This is the single most powerful tool for catching missed requirements. If an acceptance criterion has nothing on the right-hand side, the design hasn't addressed it. Stage 6 will fail because there's no test to map to.

It also enables the Stage 2 gate's `pm_approved` field — the PM at Stage 2 review reads the trace and confirms every brief AC is addressed.

**Good:**
```
- AC-1 (navigate to /settings/notifications) → §Architecture (route), §UX Notes
- AC-2 (display current status)               → §API (GET /api/preferences), §UX Notes
- AC-3 (toggle persists within 500ms)         → §API (PATCH /api/preferences), §Performance budget
- AC-4 (new emails fail within 5 min)         → §Architecture (filter in worker), §Observability (lag metric)
- AC-5 (re-enable resumes on next campaign)   → §Architecture (filter is dynamic, not snapshot)
```

**When to skip.** Never. If the brief has acceptance criteria, the design has a trace.

---

## Section: Architecture

**What to write.** The component-level view of the change. New components, modified components, data flow. A diagram (Mermaid, ASCII, or words) is usually worth the words it replaces.

**Why it matters.** This is the layer where the design becomes constraining for the developer workstreams. Backend reads §Architecture and builds against it; if the architecture is vague, four developers will produce four divergent implementations.

The Principal also decides here whether the change needs an ADR (architecture decision record) — anything non-reversible, anything that locks in a tradeoff for future work, anything that two reasonable engineers might disagree on.

**Good:**
```
Browser → Preferences Page (React, /settings/notifications)
            │
            ▼
   PATCH /api/preferences
            │ (Express, src/backend/api/preferences.ts)
            ▼
   PreferencesService.setOptIn(userId, value)
            │
            ▼
   Postgres: UPDATE users SET notifications_opt_in = $2 WHERE id = $1
            │
            ▼
   Domain event published: PreferencesChanged(userId, opt_in)

   Marketing worker (src/backend/workers/marketing-email.ts)
            │ reads notifications_opt_in column at enqueue time
            │ skips opted-out users
            ▼
   Email queue → SES
```

**When to skip.** Trivial changes (typo fix, dep bump) — say "no architectural change" and move on. Don't fabricate sections just to fill the template.

---

## Section: Data model

**What to write.** New tables, new columns, indexes, constraints. Schema diffs in SQL form are clearest.

**Why it matters.** Data model changes are the hardest to revert. Stage 5 reviewers will read this section carefully; if you're adding a NOT NULL column to a populated table without a backfill plan, expect a `REVIEW: CHANGES REQUESTED`.

Cross-references the brief's risk notes (data migration) — if the brief said "no migration needed" but the design adds a column, you've got a mismatch that Clarification (Stage 3) will surface.

**Good:**
```
ALTER TABLE users
  ADD COLUMN notifications_opt_in BOOLEAN NOT NULL DEFAULT true;
-- Backfill: not needed (DEFAULT covers existing rows).
-- Index: not needed (always queried with id, which is the PK).

ALTER TABLE preference_audit
  ADD COLUMN field TEXT NOT NULL,
  ADD COLUMN old_value TEXT,
  ADD COLUMN new_value TEXT;
-- For audit trail of preference changes.
```

**When to skip.** When there's genuinely no data change. (Frontend-only changes, infrastructure changes, etc.)

---

## Section: API / interfaces

**What to write.** New endpoints, modified endpoints, breaking changes. For each: method + path, request body shape, response body shape, error cases.

**Why it matters.** APIs are contracts. If Backend builds a different API than Frontend expects, you find out at Stage 6 (QA) at the earliest, often Stage 7 (sign-off). Specifying the API in the design spec is the cheapest place to catch the mismatch.

For external APIs (third-party integrations): include the relevant docs link and the rate limit / authentication story.

**Good:**
```
PATCH /api/preferences
  Auth: required (Bearer token; resolves to current user)
  Request:
    { "notifications_opt_in": boolean }
  Response (200):
    { "notifications_opt_in": boolean, "updated_at": ISO-8601 timestamp }
  Errors:
    401 — unauthenticated
    400 — body schema mismatch
    422 — value not a boolean

GET /api/preferences
  Auth: required
  Response (200):
    { "notifications_opt_in": boolean }
```

**When to skip.** Backend-only changes with no public API surface (worker tweaks, internal service calls).

---

## Section: UX notes

**What to write.** How users interact with the change. Screenshots, wireframes, or words describing the interaction. Edge cases (what does the toggle look like during the 500ms save? what does it show after a 401?).

**Why it matters.** Frontend builds from this. If §UX Notes says "show a spinner during save" and the frontend doesn't, Stage 5 will flag it. Stage 6b (accessibility audit) reads this to know what UI components to audit.

For backend-only changes: write "no UX changes" and the accessibility audit will skip-with-reason.

**Good:**
```
Preferences page (/settings/notifications):
  Layout: existing settings sidebar + new "Notifications" tab.
  Content: single toggle, "Marketing emails", with status text "On" / "Off" beside it.
  Interaction:
    - Click toggle → optimistic UI flip + spinner.
    - On 200 response: toast "Preference saved" (auto-dismiss 3s).
    - On 4xx/5xx: revert toggle, toast "Couldn't save — try again" (manual dismiss).
  Accessibility:
    - Toggle is a native <input type="checkbox"> with associated <label>.
    - Status text is announced to screen readers via aria-live="polite".
    - Spinner has aria-busy on the form.
```

---

## Section: Security considerations

**What to write.** What sensitive data the change touches, what auth/authz the change requires, what could be abused.

**Why it matters.** Stage 4b (security review, conditional) fires when pre-review's heuristic flags sensitive paths. The Security role reads this section first. If you've thought about the threat model here, security review is fast; if you haven't, expect blockers.

Even if security review doesn't fire (pre-review's heuristic returns `security_review_required: false`), this section is read by reviewers at Stage 5.

**Good:**
```
- Data sensitivity: notifications_opt_in is PII-adjacent (it's a user preference) but not regulated.
- Auth: PATCH and GET require Bearer token; route resolves to current user (no admin-on-behalf-of path).
- IDOR: not possible — route always operates on req.user.id, never accepts a user_id parameter.
- Audit: every change writes to preference_audit table for compliance trail.
- Rate limit: existing per-user rate limit (60 reqs/min) is sufficient.
- No new credentials, secrets, or external service integrations.
```

**When to skip.** Never write "no security considerations" — every change has some. The right answer for trivial changes is "auth unchanged; no new attack surface; ..." — explicit, not implicit.

---

## Section: Observability

**What to write.** New metrics, new logs, new traces. Names, labels, levels, expected volumes.

**Why it matters.** Stage 6c (observability gate, Platform role) verifies that every signal promised in this section is actually emitted in the shipped code. Vague promises ("we'll add metrics") fail at Stage 6c because there's nothing to grep for.

Cross-references the brief's "Observability" risk note — should match.

**Good:**
```
Metrics (Prometheus / OTel):
  notification.opt_out_set       counter, label: customer_id_hash
  notification.opt_out_cleared   counter, label: customer_id_hash
  notification.preferences_api_duration_ms   histogram, label: endpoint, status

Logs (INFO):
  "Preference changed" with fields { user_id, field, old_value, new_value, request_id }

Traces:
  preferences-api span (existing, no changes; just inherits the new endpoint).

Dashboards:
  Add "Notifications opt-in" panel to existing preferences dashboard.
  Link to dashboard in runbook.
```

**When to skip.** When the change genuinely emits nothing new (a comment fix, a doc change). Write "no new observability" and Stage 6c will pass with that as the verified-empty state.

---

## Section: Rollback

**What to write.** Concrete, executable rollback procedure. Feature flag flip, code revert, data rollback if applicable.

**Why it matters.** Stage 8 (deploy) consults this. If something breaks in production, the on-call engineer reads this section, not the brief or the code. It needs to be self-contained and actionable.

This is also the most-skipped section, and the one that bites hardest when it's missing.

**Good:**
```
1. Set feature flag NOTIFICATIONS_OPT_IN_V2 = false (immediate; no deploy required).
   - Old preferences UI re-renders.
   - PATCH /api/preferences still works but is hidden from users.
2. If the flag flip doesn't recover, revert the PR:
   - git revert <commit-sha>; deploy as a hotfix.
   - Data is forward-compatible — no data rollback needed.
3. Worst case (column corruption): drop the column.
   - ALTER TABLE users DROP COLUMN notifications_opt_in;
   - Marketing worker falls back to sending all users (existing default behavior).
```

**When to skip.** Never. Even "nothing to roll back" is an answer (for doc changes, etc.) — but make it explicit.

---

## Section: Open technical questions

**What to write.** Architectural questions that didn't get answered in design. Cross-reference open questions from the brief; surface new ones the design uncovered.

**Why it matters.** These route to Stage 3 (Clarification, PM + Principal). If you skip them, they become Stage 4 surprises. The `arch_approved` gate field is FALSE if open technical questions remain.

**Good:**
```
- Should opt-out be permanent until re-enabled, or auto-re-enable after 12 months of inactivity?
  - Brief doesn't say; legal preferred opt-out be respected indefinitely.
  - Resolver: Product. Defaulting to permanent for v1.
- Should the worker re-check the opt-out flag at SEND time, or trust the queue-time check?
  - Tradeoff: 5-min lag (queue-time only) vs extra DB query per send (send-time check).
  - Resolver: Platform. Going with queue-time for v1 to keep send-path fast.
```

**When to skip.** When there are genuinely none. Rare for non-trivial designs.

---

## Section: ADRs

**What to write.** Title + 1-paragraph summary for each ADR this change requires. Full ADRs live at `pipeline/adr/<number>-<slug>.md`.

**Why it matters.** ADRs are the long-term audit trail of architectural decisions. The retrospective (Stage 9) consults them; future designs reference them to understand "why did we do it this way?"

The gate's `adr_count` field is the count of ADRs this design produced. Most designs produce 0–2; >3 usually means the change is too big.

**Good:**
```
- ADR-005: Opt-out is queue-time, not send-time. (Tradeoff: 5-min lag vs DB load. See pipeline/adr/005-opt-out-queue-time.md.)
- ADR-006: Preference changes write to preference_audit synchronously. (Compliance requirement; tolerates ~10ms latency cost on the PATCH endpoint. See pipeline/adr/006-preference-audit-sync.md.)
```

**When to skip.** Trivial changes (no ADR needed). Most changes don't need ADRs.

---

## What the design-spec gate looks like

After stage-02 finishes:

```json
{
  "stage": "stage-02",
  "workstream": "principal",
  "host": "claude-code",
  "status": "PASS",
  "orchestrator": "devteam@0.4.0",
  "track": "full",
  "timestamp": "2026-05-28T15:14:02Z",
  "blockers": [],
  "warnings": [],
  "arch_approved": true,
  "pm_approved": true,
  "adr_count": 2,
  "file_ownership": {
    "src/backend/**": "backend",
    "src/frontend/**": "frontend",
    "tests/**": "qa",
    "Dockerfile": "platform",
    "package.json": "platform"
  }
}
```

If `arch_approved: false`, the Principal has open architectural questions that need resolution. If `pm_approved: false`, the PM hasn't confirmed the design addresses every brief AC. Either flag halts the pipeline pending Stage 3.

`file_ownership` is the gate's machine-readable copy of the design spec's
`## File Ownership` table. It gives later orchestration code a stable way to
route blocker-named files back to the Stage 4 workstream that owns them.

## Common review feedback

When Stage 5 reviewers critique the design spec:

- **"Requirements trace is missing or partial."** Every brief AC needs to map somewhere. Reviewers will spot a missing AC immediately.
- **"Rollback section is hand-wavy."** Specific commands, specific feature flag names. "Revert the PR" alone isn't enough — *what's the procedure to revert*?
- **"Observability promises without grep-able names."** Stage 6c will fail if the signal names aren't specific enough to grep for in code.
- **"Security considerations: 'none'."** Every change has *some* security consideration. The answer for a trivial change is "auth unchanged; existing rate limits sufficient; no new attack surface" — not "none."
- **"ADR for X is missing."** If a non-reversible decision wasn't recorded, it's lost. Reviewers will flag this.

## See also

- [`templates/design-spec-template.md`](../templates/design-spec-template.md) — the blank template the Principal fills in.
- [`templates/adr-template.md`](../templates/adr-template.md) — the ADR template.
- [`roles/principal.md`](../roles/principal.md) — the Principal's role brief.
- [`docs/brief-template.md`](brief-template.md) — what Stage 1 produces; the input to this design.
- [`docs/runbook-template.md`](runbook-template.md) — Stage 7/8 reads this design's rollback section.
