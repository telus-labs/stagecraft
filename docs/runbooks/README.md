# Runbooks — troubleshooting index

Find your symptom below and jump to the section that covers it. Each row links to the exact runbook section; you do not need to read the whole runbook.

| Symptom / what `devteam next` says | Runbook | Section |
|---|---|---|
| `devteam next` says `resolve-escalation` | [escalation.md](escalation.md) | [§ 0 — What you're looking at](escalation.md#0-what-youre-looking-at) |
| Escalation — Principal ruling needed | [escalation.md](escalation.md) | [§ 3 — Get a Principal ruling](escalation.md#3-get-a-principal-ruling-when-applicable) |
| Escalation — retry loop exhaustion | [escalation.md](escalation.md) | [§ 4c — Retry loop exhaustion](escalation.md#4c-retry-loop-exhaustion--a-distinct-escalation-shape) |
| Two-round peer review exhaustion | [escalation.md](escalation.md) | [§ 7b — Two-round peer review exhaustion](escalation.md#7b-two-round-peer-review-exhaustion) |
| `devteam next` says `fix-and-retry` (general) | [fix-and-retry.md](fix-and-retry.md) | [§ The general pattern](fix-and-retry.md#the-general-pattern) |
| Red-team gate FAIL (`must_address_before_peer_review` non-empty) | [fix-and-retry.md](fix-and-retry.md) | [Case 1](fix-and-retry.md#case-1-red-team-fail--must_address_before_peer_review-non-empty) |
| QA gate FAIL inside build (stage-04.qa.json) | [fix-and-retry.md](fix-and-retry.md) | [Case 2](fix-and-retry.md#case-2-qa-within-build-fail) |
| Pre-review (stage-04a) FAIL — lint or test failure | [fix-and-retry.md](fix-and-retry.md) | [Case 3](fix-and-retry.md#case-3-pre-review-stage-04a-fail--lint-or-test-failure) |
| Peer-review (stage-05) CHANGES\_REQUESTED | [fix-and-retry.md](fix-and-retry.md) | [Case 4](fix-and-retry.md#case-4-peer-review-stage-05-changes_requested--fail) |
| Peer-review (stage-05) FAIL — quorum miss, no objections | [fix-and-retry.md](fix-and-retry.md) | [Case 5](fix-and-retry.md#case-5-peer-review-stage-05-fail-with-no-objections--quorum-miss) |
| PM sign-off (stage-07) FAIL — `delta_items` non-empty | [fix-and-retry.md](fix-and-retry.md) | [Case 6](fix-and-retry.md#case-6-pm-sign-off-stage-07-fail--delta_items-non-empty) |
| Accessibility audit (stage-06b) FAIL — `blockers[]` non-empty | [fix-and-retry.md](fix-and-retry.md) | [Case 7](fix-and-retry.md#case-7-accessibility-audit-stage-06b-fail--blockers-non-empty) |
| `devteam consistency analyze` exits non-zero | [fix-and-retry.md](fix-and-retry.md) | [Case 8](fix-and-retry.md#case-8-consistency-drift--devteam-consistency-analyze-exits-non-zero) |
| Verification-beyond-tests (stage-06d) FAIL | [fix-and-retry.md](fix-and-retry.md) | [Case 9](fix-and-retry.md#case-9-verification-beyond-tests-stage-06d-fail--blocking_findings-non-empty) |
| Preflight (stage-04e) FAIL — committed ignored files or broken import path | [fix-and-retry.md](fix-and-retry.md) | [Case 10](fix-and-retry.md#case-10-preflight-stage-04e-fail--committed-ignored-files-or-broken-import-path) |
| Unresolved `noted_for_followup[]` items before peer-review | [fix-and-retry.md](fix-and-retry.md) | [Case 11](fix-and-retry.md#case-11-advise-workflow--triage-follow-up-items-before-downstream-stages) |
| License-gate (stage-04a) FAIL — `license_check_passed: false` | [fix-and-retry.md](fix-and-retry.md) | [Case 12](fix-and-retry.md#case-12-license-gate-stage-04a-fail--license_check_passed-false) |
| Tool-budget denial — native refusal or advisory non-compliance | [fix-and-retry.md](fix-and-retry.md) | [Case 13](fix-and-retry.md#case-13-tool-budget-denial) |
| Stage 8 deploy FAIL — read and classify | [deploy-failure.md](deploy-failure.md) | [§ Step 1 — Read the failure](deploy-failure.md#step-1--read-the-failure) |
| Stage 8 deploy FAIL — classify the failure shape | [deploy-failure.md](deploy-failure.md) | [§ Step 2 — Classify the failure](deploy-failure.md#step-2--classify-the-failure) |
| Deploy FAIL — need to rollback | [deploy-failure.md](deploy-failure.md) | [§ Rollback path](deploy-failure.md#rollback-path) |
| Deploy FAIL — retry after fix | [deploy-failure.md](deploy-failure.md) | [§ Retry after fix](deploy-failure.md#retry-after-fix) |
| Extract tickets from `open_followups[]` after pipeline completes | [open-followups.md](open-followups.md) | [§ Step 2 — Print ticket stubs](open-followups.md#step-2--print-ticket-stubs) |
| Production feedback via G3 seam | [open-followups.md](open-followups.md) | [§ Production feedback](open-followups.md#production-feedback-g3-seam) |
| `devteam run` halted unexpectedly | [autonomous-run.md](autonomous-run.md) | [§ Why it halted — and what to do](autonomous-run.md#why-it-halted--and-what-to-do) |
| `devteam run` exited with code 2 (locked) | [autonomous-run.md](autonomous-run.md) | [§ Exit codes](autonomous-run.md#exit-codes) |

## Runbooks in this directory

- [escalation.md](escalation.md) — what to read, how to decide, and how to encode the result when `devteam next` says `resolve-escalation`
- [fix-and-retry.md](fix-and-retry.md) — 13 fix-and-retry cases: red-team, QA, pre-review, peer-review (both failure shapes), PM sign-off, accessibility (three-path recipe), consistency, verification, preflight, advise, license-gate, tool-budget denial
- [open-followups.md](open-followups.md) — extract ticket stubs from `open_followups[]`; field mapping to JIRA, Linear, GitHub Issues; production feedback seam
- [deploy-failure.md](deploy-failure.md) — Stage 8 failure: classify the shape, adapter-specific diagnostics, rollback, retry
- [autonomous-run.md](autonomous-run.md) — `devteam run` reference: autonomous escalation resolution, launch, exit codes, halts, consequence ceiling, honest limitations
