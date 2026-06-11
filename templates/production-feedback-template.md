# Production Feedback

> Operator-curated. Copy from `templates/production-feedback-template.md` into
> `pipeline/production-feedback.md` at deploy time and fill in each section.
> Sections are keyed by the brief's named metrics and SLOs; add or remove rows
> to match. The retrospective (stage-09) reads this file when present to close
> the brief→production loop.

## SLO / Metric Deltas

| Metric (from brief) | Target | Observed (7-day post-deploy) | Delta | Status |
|---|---|---|---|---|
| example: p99 latency | ≤ 200 ms | 187 ms | −13 ms | ✅ within SLO |
| example: error rate | < 0.1 % | 0.08 % | −0.02 pp | ✅ within SLO |

Replace the example rows with your project's actual brief SLOs. Delete this
table entirely if the brief declared no SLOs.

## Incidents Since Deploy

List production incidents linked to this feature. If none, write "None."

- **<YYYY-MM-DD> <INC-ID>:** one-line description; severity; resolved Y/N.

## Adoption / Usage Signals

Optional. Fill in if the brief stated adoption targets or rollout steps.

- Rollout status: (% of traffic / flag state)
- Observed usage: (e.g. daily active users, call volume)

## Notes for Retrospective

Free text. Anything production surfaced that the pre-ship pipeline missed:
surprising failure modes, performance cliffs, usability gaps, etc. The
principal uses this section when writing the retrospective's "production
deltas" entry.
