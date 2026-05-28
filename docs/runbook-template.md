# Runbook — how to fill it out

The runbook is the artifact stage-07 (sign-off, Platform role) produces. It lives at `pipeline/runbook.md`. Stage 8 (deploy) reads it; the on-call engineer reads it when something breaks in production at 4 a.m.

This page is the section-by-section "what to write, why, and what to skip" guide. The blank template lives at [`templates/runbook-template.md`](../templates/runbook-template.md); this doc explains *how* to fill it.

> **One-paragraph mental model.** Briefs and design specs are about *intent*. The runbook is about *what to do under pressure*. Every sentence should be actionable by a tired engineer who didn't write the code. Be specific. Be concrete. Skip nuance for clarity.

---

## Section: Rollback

**What to write.** The exact, step-by-step procedure to revert this change. Three substructures:

- **How to revert this release:** commands, in order, with what they do.
- **Data rollback, if any:** the data side of the revert — drop a column, restore from backup, reverse a migration.
- **Owner:** who to call if rollback doesn't work. Name + Slack handle + escalation path.

**Why it matters.** This is the section the on-call engineer reads at 4 a.m. It's the most critical section in the document. Vague rollback notes have killed companies.

The brief's "Risk Notes — Rollback" field and the design spec's "Rollback" section feed into this. Reconcile any inconsistencies — the runbook is the final word.

**Good:**
```
How to revert this release:
  1. Set NOTIFICATIONS_OPT_IN_V2 = false in LaunchDarkly (no deploy required).
     - Verify: hit /settings/notifications and confirm the old UI renders.
     - This is the first thing to try. Takes <30 seconds.
  2. If the flag flip doesn't recover, revert the deploy:
     - `kubectl rollout undo deployment/api-server -n production`
     - `kubectl rollout undo deployment/marketing-worker -n production`
     - Verify: `kubectl rollout status deployment/api-server -n production`
     - Takes 2-3 minutes.
  3. If reverting the deploy doesn't recover, page the on-call.

Data rollback, if any:
  - None needed in normal cases. The notifications_opt_in column has a DEFAULT of true,
    so existing rows are unaffected.
  - Worst case (column corruption preventing reads): drop the column.
    `ALTER TABLE users DROP COLUMN notifications_opt_in;`
    Marketing worker falls back to sending all users (the pre-change behavior).
    This is destructive — confirm with the Principal before running.

Owner:
  - Primary: @platform-team-oncall (Slack #incidents, PagerDuty: Platform team)
  - Secondary: @principal-engineer (Slack DM if oncall doesn't respond in 5 min)
  - Escalation: @vp-engineering (Slack DM after 15 min)
```

**Bad:**
```
How to revert this release:
  - Revert the PR.

Data rollback, if any:
  - n/a

Owner:
  - The team.
```

(All of these are abstractions. Useless under pressure.)

**When to skip.** Never. Even a trivial change has a rollback story (often "just revert the PR; data is forward-compatible") — write it explicitly.

---

## Section: Health signals

**What to write.** What the on-call engineer monitors to know if the change is healthy or broken. Three substructures:

- **Primary smoke test:** the single most informative test to run after deploy.
- **Logs/metrics to watch:** specific queries, metric names, dashboard URLs.
- **Alert or dashboard links:** clickable URLs to the relevant dashboards and alerts.

**Why it matters.** Post-deploy monitoring is the difference between catching a bug in 5 minutes and catching it 5 hours later. The smoke test specifically is critical — when deploy completes, what's the first thing you run?

The design spec's "Observability" section feeds into this. Every metric / log / trace the design promised should appear here as something the runbook says to watch.

**Good:**
```
Primary smoke test:
  curl -X PATCH https://api.prod.example.com/preferences \
    -H "Authorization: Bearer $TEST_USER_TOKEN" \
    -d '{"notifications_opt_in": false}' \
    | jq .notifications_opt_in
  # Expect: false. If you get a 5xx or wrong value, the deploy didn't work — roll back.

Logs/metrics to watch (first 15 minutes post-deploy):
  - Datadog: notification.opt_out_set counter — should start incrementing.
    https://app.datadoghq.com/dashboard/abc-123/notifications
  - Logs (Datadog Logs): service:api-server "Preference changed" — should appear
    within 1 minute of the smoke test.
  - Error rate: should remain <0.1% on /api/preferences (existing SLO).
    Alert link: https://app.datadoghq.com/monitors/12345

Alert or dashboard links:
  - Primary dashboard: https://app.datadoghq.com/dashboard/abc-123/notifications
  - On-call alert (auto-pages): https://app.datadoghq.com/monitors/12345 ("Preferences API error rate >1%")
  - Slack channel for issues: #api-team-oncall
```

**Bad:**
```
Primary smoke test:
  - Hit the endpoint and check it works.

Logs/metrics to watch:
  - The usual ones.

Alert or dashboard links:
  - See Datadog.
```

**When to skip.** Never. Even a doc change has a smoke test ("verify the docs site renders the new page"). Write something concrete.

---

## Section: Notes

**What to write.** Known risks and follow-up checks that aren't critical enough for the main sections but matter to whoever inherits this.

- **Known risks:** edge cases you didn't fully handle, performance characteristics you're uncertain about, third-party dependencies that could behave unexpectedly.
- **Follow-up checks:** things to verify in the days after deploy, not just at deploy time.

**Why it matters.** This is where institutional knowledge lives. "We deployed feature X but didn't load-test the marketing worker under N writes/sec — verify when the next campaign sends" is the kind of note that prevents 4 a.m. surprises *two weeks* after deploy.

It's also where you flag work you punted: "the queue-time vs send-time tradeoff means a 5-min lag; if users complain about delays, we should revisit and move to send-time."

**Good:**
```
Known risks:
  - Marketing worker reads notifications_opt_in at enqueue time, not send time.
    Implication: if a user opts out, they may still receive emails enqueued in the
    prior 5 minutes. Acceptable for v1; revisit if customers complain.
  - We did NOT load-test the marketing worker under campaign-send load (100k+ writes/sec).
    Verify when the next Tuesday campaign sends (~10:00 UTC).
  - The preference_audit table has no retention policy yet. Will grow ~5k rows/day.
    Add a retention job before the table exceeds 10M rows (~6 years out, but track it).

Follow-up checks:
  - Day 1 post-deploy: confirm opt-out count growing at expected rate
    (estimated 50-100 opt-outs in first day; 200-500/day at steady state).
  - Day 7: confirm marketing campaign sends respected the new flag.
    Pull the email queue logs and verify opted-out users were filtered.
  - Day 30: review preference_audit table size; plan retention if growing faster than expected.
```

**When to skip.** Trivial changes with no nuance. Most changes have at least one follow-up check worth noting.

---

## What the runbook gate (stage-07) looks like

After stage-07 finishes:

```json
{
  "stage": "stage-07",
  "status": "PASS",
  "orchestrator": "devteam@0.2.0",
  "track": "full",
  "timestamp": "2026-05-28T16:42:18Z",
  "blockers": [],
  "warnings": [],
  "pm_signoff": "approved",
  "platform_signoff": "approved",
  "runbook_complete": true,
  "auto_from_stage_06": false
}
```

If `auto_from_stage_06: true`, the orchestrator auto-folded stage-07 (Stage 6 reported `all_acceptance_criteria_met: true` AND a 1:1 mapping). The runbook still gets written — Platform writes it as part of the auto-fold — but the human sign-off step is skipped.

If `runbook_complete: false`, the runbook has missing sections and Stage 8 (deploy) cannot proceed.

## Stage 8 reads this

Stage 8 (deploy, Platform role) doesn't write the runbook; it follows it. The deploy gate carries:

- `runbook_referenced: true` — confirms the deployer read the runbook before deploying.
- `smoke_test_passed: true` — confirms the smoke test from the runbook actually ran and passed.
- `deploy_adapter: "kubernetes"` (or whatever) — names the deploy adapter used.
- `rollback_executed: false` — confirms no rollback was needed (or `true` if it was, with details).

A `rollback_executed: true` deploy gate is still a PASS if the rollback succeeded — but it's a clear signal for the retrospective (Stage 9) that something went sideways.

## Common review feedback

When the on-call engineer (or a Stage 5 reviewer reviewing the runbook) critiques it:

- **"Rollback step 1 isn't specific."** "Set the feature flag to false" isn't enough — what's the flag name, where is it set, how do you verify?
- **"Smoke test would take 10 minutes to figure out at 4 a.m."** The smoke test should be a single command you can copy-paste. Pre-fill the URLs, the headers, the expected response.
- **"Owner: 'the team' / 'oncall'."** Names. Specific handles. Specific escalation order with timeouts.
- **"No alert links."** If something can break, there should be a dashboard or alert that catches it. Link to it.
- **"Follow-up checks are aspirational."** "Monitor and verify" isn't actionable. "Pull logs at Day 7, count opted-out emails in queue, confirm 0" is.

## Patterns to steal from past runbooks

For longer-running production systems, your `pipeline/lessons-learned.md` will accumulate runbook patterns. Some worth borrowing:

- **Feature flags first, code revert second, data rollback last.** Flags are seconds; code reverts are minutes; data rollbacks are hours and risky.
- **Smoke tests should test the change, not the system.** Don't include a 30-step verification — that's a full test plan. The smoke test answers "did the thing I changed actually change?"
- **Cite specific log queries, not log dashboards.** A query you can copy-paste beats a dashboard URL that requires navigating filters.
- **Owner timeouts.** "Primary @x; secondary @y if x doesn't respond in 5 min" is better than just "Primary @x." Pages get missed.

## See also

- [`templates/runbook-template.md`](../templates/runbook-template.md) — the blank template Platform fills in.
- [`roles/platform.md`](../roles/platform.md) — the Platform role's brief.
- [`docs/brief-template.md`](brief-template.md) — the brief's risk notes feed into this runbook.
- [`docs/design-spec-template.md`](design-spec-template.md) — the design spec's rollback and observability sections feed into this runbook.
- [`core/deploy/`](../core/deploy/) — deploy adapter procedures referenced from this runbook at Stage 8.
