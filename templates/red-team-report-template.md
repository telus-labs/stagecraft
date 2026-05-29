# Red Team Report — <feature title>

## Summary

<1–3 sentences: what was reviewed, what was found in headline form. E.g. "Reviewed the SMS-opt-in change across backend, frontend, and platform PRs. Found 2 must-fix items (concurrency + IDOR), 4 should-fix warnings, and 3 noted-for-followup edge cases.">

## Surfaces walked

| # | Surface | Findings |
|---|---|---:|
| 1 | Input boundaries | N |
| 2 | State boundaries | N |
| 3 | Sequence boundaries | N |
| 4 | Integration boundaries | N |
| 5 | Auth / authz edges | N |
| 6 | Resource exhaustion | N |
| 7 | Failure modes mid-operation | N |
| 8 | Abuse cases | N |
| 9 | Downstream effects | N |
| 10 | Observability gaps | N |

Total findings: **N**

## Findings — must-fix (block Stage 5)

These items severity ≥ high AND likelihood ≥ plausible. Each cites the exact reproducer.

### RT-1 — <one-line title>

- **Surface:** <input boundaries / state / …>
- **Severity:** critical | high
- **Likelihood:** expected | plausible
- **Effort to fix:** XS | S | M | L
- **Where:** `src/path/to/file.ext:NN`
- **Reproducer:**
  ```
  <exact input, sequence, or state that reproduces the failure>
  ```
- **Resulting failure:** <what specifically breaks>
- **Suggested fix:** <approach>

### RT-2 — <…>

…

## Findings — should-fix (warnings)

Severity high/medium with likelihood plausible/theoretical, OR severity critical with likelihood theoretical. The implementer should consider but isn't blocked.

### RT-3 — <…>

- **Surface:** <…>
- **Severity / Likelihood / Effort:** medium / plausible / S
- **Where:** `src/…`
- **Reproducer:** <…>
- **Suggested fix:** <…>

…

## Findings — noted for followup

Out of scope for this PR but worth tracking. The team can promote any of these to follow-up tickets via the normal process.

### RT-N — <…>

- **Surface:** <…>
- **Severity:** <…>
- **Summary:** <one-line; details in the linked file/line>
- **Why parked:** <e.g. "outside the brief's scope" / "depends on B5 migration safety stage" / "team decided in Stage 2 design review">

## Surfaces with no findings

Explicit list of surfaces I considered and didn't find anything actionable in. The next red-team pass starts from here — these surfaces are auditable and "I looked, found nothing" is a real outcome on small or well-tested changes.

- **State boundaries:** considered concurrency, time, cache, memory; no scenarios applied to this change.
- **Resource exhaustion:** considered quadratic algorithms, unbounded queues, leaked connections; none observed in the diff.
- …

## Process notes (optional)

What I read, in what order. Surfaces I skipped (and why). Models I used for adversarial reasoning. Anything the next red-team should know.

---

*Gate written to `pipeline/gates/stage-04c.json`. Implementer addresses `must-fix` items by re-running stage-04 (build); red-team re-runs and the gate flips to PASS when the must-fix list is empty.*
