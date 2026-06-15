# Adaptive Routing Evidence Review

**Date:** 2026-06-14
**Branch:** docs/adaptive-routing-evidence
**Plan item:** 9.4 (phase-9-evidence-gated-capabilities.md)
**Reviewer:** Claude Sonnet 4.6 via Stagecraft automated session

---

## Question

Does `devteam routing:suggest` on the accumulated real-run telemetry produce recommendations
a human agrees with in hindsight — or is the sample still noise?

---

## Method

`routing:suggest` was run against every available source of pipeline gate data:

1. **Repo root** (`npm run routing:suggest`, default `--from .`): the script reports a
   warning (`no pipeline/gates/ under /…/stagecraft`) and returns an empty recommendations
   array. Stagecraft itself has never been run through its own pipeline.

2. **The only gate data on disk** (`--from examples/sms-opt-in`): the hand-authored
   demonstration fixture shipped in v0.7.0. Thirteen gate files cover stages 01–05 for the
   fictional SMS opt-in project.

Both commands were run with `--json` and in human-readable form. The full output is quoted
in the Findings section. No `--min-dispatches` or `--min-delta` overrides were used;
defaults apply (MIN_DISPATCHES=5, MIN_PASS_RATE_DELTA=10 pp).

The `performance` aggregator was also run against the same data to produce the raw
per-(role, host) table that feeds routing:suggest.

---

## Per-(role, host) sample counts

Derived from `node scripts/performance.js --from examples/sms-opt-in`.

The merged stage gate (`stage-04.json`) expands into per-workstream rows alongside the
individual workstream gate files (`stage-04.backend.json`, etc.), so each appears twice
in the aggregation. That double-counting is intentional — see `performance.js:expandToWorkstreams`.

| Role | Host | Dispatches | First-try pass | Source gate files |
|------|------|---:|---:|---|
| backend | codex | 2 | 100% | stage-04.json(expanded) + stage-04.backend.json |
| backend | claude-code | 1 | 0% | stage-05.backend.json (FAIL) |
| frontend | claude-code | 3 | 67% | stage-04.json(expanded) + stage-04.frontend.json + stage-05.frontend.json (FAIL) |
| platform | claude-code | 4 | 75% | stage-04.json(expanded) + stage-04.platform.json + stage-04a.json + stage-05.platform.json (FAIL) |
| pm | claude-code | 2 | 100% | stage-01.json + stage-03.json |
| principal | claude-code | 1 | 100% | stage-02.json |
| qa | claude-code | 2 | 100% | stage-04.json(expanded) + stage-04.qa.json |

**Total:** 15 dispatch records across 6 roles and 2 hosts. Maximum per (role, host) pair: 4.
The MIN_DISPATCHES threshold of 5 is not met by any pair.

### Notable: zero cost data

No gate file contains `tokens_in`, `tokens_out`, `cost_usd`, or `model` fields. All
cost/duration columns in the performance table are `—`. The D6 cost-telemetry requirement
(docs/cost.md) was never exercised against real runs. The tiebreaker in routing:suggest
(`cost_per_pass_usd`) cannot be evaluated.

---

## routing:suggest output

```
# devteam routing suggest
Generated: 2026-06-15T04:54:00Z

## No changes recommended

6 role(s) already routed to their best-performing host.
6 role(s) have insufficient data.

## Insufficient data (6)

- pm:        insufficient data — no host has ≥5 dispatches for role "pm"
- principal: insufficient data — no host has ≥5 dispatches for role "principal"
- backend:   insufficient data — no host has ≥5 dispatches for role "backend"
- frontend:  insufficient data — no host has ≥5 dispatches for role "frontend"
- platform:  insufficient data — no host has ≥5 dispatches for role "platform"
- qa:        insufficient data — no host has ≥5 dispatches for role "qa"
```

*(The human-readable renderer also prints these under "Already optimal" — a rendering
bug: when both `current_host` and `suggested_host` are null, the filter `r.suggested_host
=== r.current_host` is true (null === null), landing the row in both buckets. The JSON
output is correct. Out-of-scope finding — not fixed here.)*

---

## Does the tool agree with human hindsight?

**Yes — on the only possible conclusion: there is no signal.**

Manually inspecting the gate files confirms the tool's diagnosis. The backend pair
(codex: 2 dispatches, 100%) vs (claude-code: 1 dispatch, 0%) is the most dramatic
apparent difference in the data — but both numbers come from a single-run hand-authored
fixture. Stage-05 FAILs are scaffolded (the fixture is frozen mid-pipeline deliberately);
they are not real dispatch outcomes. A human reviewing the same data would say "codex
looks better for backend in this one example, but I wouldn't route production traffic on
2 vs 1 fixture records."

The tool's MIN_DISPATCHES guard fires exactly where human judgment would: before making any
recommendation. In this respect the tool and human agree perfectly — but that agreement
isn't evidence that the tool works well on real data. It is evidence that the guard is
calibrated appropriately and that the fixture is too thin to trigger it.

The framework's own stated uncertainty — "converges with small samples or just chases
noise" — cannot be evaluated at all. We do not have a sample; we have a demonstration fixture.
There is no hindsight to compare against because no routing decision was ever live.

---

## Root cause: no real runs

The H3 ground truth review (plans/h3-ground-truth.md, 2026-06-14) established the same
finding for recipes: zero `run-log.jsonl` files, zero gate archives, one project (Stagecraft
itself), and zero autonomous runs against a real user project. That finding applies here
unchanged:

- `routing:suggest` reads `pipeline/gates/` from user projects, not from Stagecraft itself.
- The only user-project gate data on disk is `examples/sms-opt-in/`, which is intentionally
  hand-authored and frozen mid-pipeline.
- ADR-007 (liveness/heartbeat) is Proposed but not yet implemented. The plan item 9.4
  required ADR-007 to be implemented before this evidence review (routing experiments
  need trustworthy run telemetry). That precondition has not been met.

In short: the sample is not noise. It is the absence of a sample.

---

## Verdict

**Continuous adaptive routing STAYS GATED.**

The D5 bet remains a BACKLOG item. Its gate condition — "enough real runs for per-(role,
host) pass-rate data to be signal rather than noise" — has not been approached.

### Data threshold that would change the verdict

The gate opens when **all four** of the following hold:

1. **Real run telemetry:** `pipeline/gates/` directories exist from ≥2 distinct user
   projects (not Stagecraft development artifacts, not the sms-opt-in fixture), each
   accumulated from live `devteam run` invocations.

2. **Per-(role, host) volume:** at least one `(role, host)` pair reaches ≥5 dispatches,
   AND at least one other host for the same role also reaches ≥5 dispatches — so there
   is a comparison to make. With only one host per role, the tool cannot recommend a
   change regardless of sample size.

3. **Cost data:** at least one host carries `tokens_in`/`tokens_out`/`model` in its gate
   files, so the `cost_per_pass` tiebreaker is available. Without cost signal the tool
   ranks on pass rate alone, which is insufficient for the "pass-rate-per-dollar"
   objective the D5 design specifies.

4. **ADR-007 implemented:** heartbeat and stall detection are operational so telemetry
   represents trustworthy run outcomes, not artifact artifacts from invisible hangs.

Until all four hold, repeat this evidence review — it is a one-session read and costs
nothing. Do not promote to an ADR until the review finds signal.

### If the threshold is met

At that point re-run this analysis. If routing:suggest makes at least one actionable
recommendation AND a human reviewer would have made the same call looking at the data,
then the question the ADR must answer is narrow: what is the right operator-trust contract
for --apply? (Manual review is already the default; the ADR decides whether --apply can
ever be automated and under what conditions.) The tool design, thresholds, and cost-
tiebreaker logic have already been reviewed and are sound.

---

*Written by Claude Sonnet 4.6 for Stagecraft item 9.4. No code was changed.*
