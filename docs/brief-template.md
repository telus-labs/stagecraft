# Brief — how to fill it out

The brief is the artifact stage-01 (requirements, PM role) produces. It lives at `pipeline/brief.md`. Every downstream stage reads it — the Principal designs from it, the developers build from it, the QA tests against it, the retrospective references it.

This page is the section-by-section "what to write, why, and what to skip" guide. The blank template lives at [`templates/brief-template.md`](../templates/brief-template.md); this doc explains *how* to fill it.

> **One-paragraph mental model.** The brief turns a feature request ("Add SMS opt-in") into a contract: what we'll build (acceptance criteria), what we won't (out of scope), what we don't yet know (open questions), and what could go wrong (risk notes). Everything downstream points at this file.

---

## Section: Problem

**What to write.** The user-facing problem this change solves, in 1–3 sentences. Not the solution — the problem.

**Why it matters.** Half of bad feature briefs solve the wrong problem. Forcing yourself to write the problem first surfaces the case where the team is solving for "we have a deadline" instead of "users can't do X." If you can't write the problem in 3 sentences, you don't understand it yet — go back and figure it out before the brief.

**Good:** *"Users currently can't opt out of marketing emails without contacting support. This drives ~40 support tickets/week. The proposal: a self-serve preferences page."*

**Bad:** *"Build a notification preferences page."* (That's a solution, not a problem.)

**When to skip.** Never. If you don't have a problem statement, the brief shouldn't be written yet.

---

## Section: User stories

**What to write.** One or more "As an X, I want Y, so that Z" statements. Be specific about the user role (logged-in customer, admin, anonymous visitor — they have different needs).

**Why it matters.** User stories anchor the acceptance criteria to a user-facing outcome. Without them, acceptance criteria drift into "the API returns 200" instead of "the user sees their preference saved." For implementation-heavy roles (Backend, Platform), the user story is the only thing keeping the work honest about what the user actually experiences.

**Good:**
```
- As a logged-in customer, I want to disable marketing emails from my preferences page, so I stop receiving them within 5 minutes.
- As a logged-in customer, I want to re-enable marketing emails after disabling, so I can recover from accidentally opting out.
```

**Bad:** *"Users want notification preferences"* (no role, no outcome, no done-ness).

**When to skip.** When the change is genuinely user-invisible (a pure refactor, a dep bump, an internal API rename). Even then, write one story for the *engineer* who maintains the code if there's no user-visible outcome.

---

## Section: Acceptance criteria

**What to write.** Numbered, testable conditions. Each criterion is something QA can verify objectively — pass or fail, not "kind of."

**Why it matters.** Stage-06 (QA tests) requires a **1:1 mapping** between acceptance criteria and tests. If your criteria are vague ("the feature works well"), you can't write tests against them, and Stage 6 will fail validation. The 1:1 mapping is what enables Stage 7 auto-fold — if every criterion has a test, the orchestrator writes Stage 7 sign-off automatically.

The number of criteria is also the gate's `acceptance_criteria_count` field. Single-digit counts (3–7) are typical; >10 usually means the brief is doing too much.

**Good:**
```
1. Logged-in customer can navigate to /settings/notifications.
2. The page displays the customer's current email opt-in status.
3. Toggling the switch persists to the backend within 500ms.
4. After disabling, new marketing emails to that customer fail to enqueue within 5 minutes.
5. Toggling the switch back to enabled resumes marketing emails on the next campaign.
```

**Bad:**
```
1. Users can manage notifications.
2. The feature works on mobile.
3. It's accessible.
```

(All of these are gestures, not testable conditions.)

**When to skip.** Never. Acceptance criteria are the contract.

---

## Section: Out of scope

**What to write.** Bullet list of things explicitly NOT part of this change, even though they're closely related.

**Why it matters.** Scope creep is the #1 way a "small feature" turns into a 600-line change. Writing "out of scope" forces you to think about adjacent work you might be tempted to do "while you're in there." It also gives reviewers (Stage 5) a concrete list to push back against: "this PR adds X but X is in the brief's out-of-scope — file a separate change."

This list is the gate's `out_of_scope_items` field — count and content both matter for downstream audit.

**Good:**
```
- Push notification opt-in (separate channel, separate brief).
- Admin override to disable opt-out for compliance reasons (legal hasn't decided yet).
- Migration of existing opted-in users to the new schema (handled by a separate migration script).
- Localization of the preferences page (English-only for v1).
```

**When to skip.** Never (write at least one item, even if it's "nothing — this change is fully self-contained").

---

## Section: Open questions

**What to write.** Specific questions you don't have an answer to yet, with proposed resolvers.

**Why it matters.** Open questions in the brief route to Stage 3 (Clarification, PM role) for resolution before build starts. If you skip this section and just barrel into design, you'll discover the open questions at Stage 4 (build), at which point fixing them costs 10× more.

The gate's `required_sections_complete` field is FALSE if any open question is unresolved. Stage 3 either resolves them all (and flips the field to TRUE) or escalates.

**Good:**
```
- Should we batch the opt-out propagation (5 min lag) or apply immediately (sub-second)? Resolver: Platform lead. Default if no answer by EOD: batch.
- Does opt-out affect transactional emails (receipts, password resets)? Resolver: Product + Legal. Default: no (transactional is separate).
- What's the rollback if we discover a bug post-deploy? Resolver: Principal at Stage 2.
```

**When to skip.** When there genuinely are no open questions. Rare for non-trivial features.

---

## Section: Risk notes

**What to write.** Six sub-fields covering deployment safety:

- **Rollback:** how to revert this change if it breaks in production.
- **Feature flag:** are we gating this behind a flag? What's the flag name?
- **Data migration:** does this require a schema change or backfill? If yes, what's the migration plan?
- **Observability:** what new metrics / logs / traces does this introduce? (See Stage 6c — these get verified against the shipped code.)
- **SLO:** what's the latency / availability target for the new functionality?
- **Cost:** what's the per-unit cost (API calls, storage, etc.) and the expected volume?

**Why it matters.** Stage 6c (observability gate) reads the "Observability" sub-field and verifies every promised signal is actually emitted in the shipped code. Stage 8 (deploy) consults the rollback plan. Stage 2 (design) often refers back to the SLO and cost notes to inform architectural decisions.

Sloppy risk notes here cascade: "feature flag: ?" at Stage 1 becomes a 4 a.m. wake-up call when something breaks at Stage 8 deploy.

**Good:**
```
- Rollback: feature flag NOTIFICATIONS_OPT_IN_V2 = false reverts to old preferences UI. No data rollback needed.
- Feature flag: NOTIFICATIONS_OPT_IN_V2 (default false; enable in a follow-up release).
- Data migration: adds notifications_opt_in column to users table (default true for back-compat). Backfill script in db/migrations/2026-05-28-notif-opt-in.sql.
- Observability: emit notification.opt_out_set and notification.opt_out_cleared counter metrics with customer_id label; log preference changes with INFO level.
- SLO: 99.9% availability on /api/preferences; <500ms p95 latency.
- Cost: 1 row write per opt-out event. Estimated 5k writes/day. <$1/month additional Postgres cost.
```

**When to skip.** Cost can be omitted for trivial changes. Rollback and feature flag should always be filled — even for changes you think can't go wrong.

---

## What the brief gate looks like

After stage-01 finishes:

```json
{
  "stage": "stage-01",
  "workstream": "pm",
  "host": "claude-code",
  "status": "PASS",
  "orchestrator": "devteam@0.4.0",
  "track": "full",
  "timestamp": "2026-05-28T14:32:11Z",
  "blockers": [],
  "warnings": [],
  "acceptance_criteria_count": 5,
  "out_of_scope_items": [
    "Push notification opt-in",
    "Admin override",
    "Existing-user migration",
    "Localization"
  ],
  "required_sections_complete": true
}
```

If `required_sections_complete: false`, the validator accepts the gate but Stage 3 (Clarification) MUST run before Stage 4 (Build). The orchestrator enforces this via stage ordering.

## Common review feedback

When Stage 5 reviewers critique the brief (yes, briefs get reviewed too), the most frequent comments:

- **"Acceptance criteria aren't testable."** Rewrite each criterion as something QA can pass/fail.
- **"Out of scope is empty."** Even small features have adjacent work that's NOT in scope. Write at least one item.
- **"Open questions list contains decisions, not questions."** A question has a "?" and a resolver. "We should use Postgres" is a decision, not an open question — move it to the design.
- **"Risk notes don't address rollback."** Rollback is the single most-omitted field and the one that bites hardest in production.

## See also

- [`templates/brief-template.md`](../templates/brief-template.md) — the blank template the PM fills in.
- [`roles/pm.md`](../roles/pm.md) — the PM's role brief (what the PM agent is told to do).
- [`docs/design-spec-template.md`](design-spec-template.md) — what Stage 2 (design) produces from this brief.
- [`docs/runbook-template.md`](runbook-template.md) — what Stage 7 / Stage 8 produces, referencing the brief's risk notes.
