# ADR 009 — Repair mode: `devteam run --repair` for bug fixes

**Status:** Accepted
**Date:** 2026-06-15
**Authors:** Mumit Khan

## Context

Stagecraft's pipeline is built around `--feature`: build agents are instructed to implement
requirements *fully*. That is correct for additive work and wrong for bug fixes, and once a
project is in production the maintenance loop (find bug, reproduce, fix minimally, verify) is
at least as common as the build loop. Using `--feature` for bug fixes has two concrete failure
modes:

1. **Scope creep.** "Implement fully" tells the build agent to refactor adjacent code, extract
   helpers, and clean up inconsistencies it notices. For a 3-line guard clause this inflates the
   diff, makes peer review harder, and raises regression risk. It is baked into the role
   instructions, not a prompt-discipline problem.
2. **No reproduction verification.** Nothing in the pipeline checks that the stated symptom was
   present before the fix and absent after. A fix that suppresses a symptom — early return,
   swallowed exception, lowered log level — passes every gate. This is the most dangerous gap.

The central finding of the design review behind this ADR is that **most of the machinery to
close these gaps already exists**, so repair mode should reuse it rather than build a parallel
system:

- **Tracks already decide which stages run.** The `hotfix` track already encodes a position on
  bug fixes — drop the upfront planning stages (requirements, design, clarification,
  executable-spec), keep *every* safety and review stage. Repair mode builds on that position;
  it does not relitigate it.
- **PATCH MODE already enforces minimal change.** `devteam stage build --patch --from <stage>`
  injects a `## ⚠️ PATCH MODE — targeted fix only` block and constrains build agents to a
  specific item list (`docs/runbooks/fix-and-retry.md`, `renderPatchBlock` in
  `core/adapters/render-helpers.js`, cross-host since the Phase-1 PATCH-MODE work). The
  "make the minimal correct change, do not refactor" instruction is the prompt that already
  ships; repair mode only changes where the patch items come from.
- **The reproduction harness already exists as the spec→stamp chain.** Stage-03b
  (`executable-spec`) maps acceptance criteria → Gherkin → tests (the G2 contract), and
  `core/verify/stamp.js` re-runs tests and records claimed-vs-observed. A bug's "reproduction"
  is an acceptance criterion phrased failing-first.
- **"Fix" is already an overloaded word.** `fix-and-retry` (the driver self-correcting a failed
  gate), `fix-recipes.js` / `fix_steps` (the per-stage recipe registry), and `advise --apply`
  (the applicator) all exist. A `--fix` flag would emit `outcome: "fix-retry"` events in its own
  `run-log.jsonl` — an operator-facing collision.

## Decision

**Add `--repair "<symptom>"` as an intent flag, implemented as fix-aware artifacts on existing
stages — zero new stages, zero parallel pipeline.** Concretely:

1. **`--repair` is an intent flag orthogonal to `--track`,** parallel to the existing
   `--feature` intent surface. It defaults to a `hotfix`-like verification depth;
   `--repair --track full` gives deep repair (e.g. of auth code). The stoplist continues to
   govern *depth* (forcing auth/payments/migration changes onto a heavier track) while
   preserving *intent*.

2. **In repair mode, two existing stages produce fix-aware artifacts:**
   - **Stage-01 (requirements) produces a diagnosis** instead of a feature brief: traced root
     cause, proposed fix, an **affected-files list**, and a regression criterion. A bug's
     requirements *are* its diagnosis. This reuses the requirements gate's approval semantics.
   - **Stage-03b (executable-spec) produces a failing-first scenario:** the regression criterion
     phrased so its test is red before the fix and green after.
   - **The build stage runs in PATCH MODE,** scoped to the diagnosis's affected-files list.

3. **Minimality is structural, not a judgment.** A build that touches files outside the
   diagnosis's affected-files set is a FAIL by diff, not by reviewer opinion. Peer review still
   asks "could this be smaller?" as a judgment on top of the mechanical boundary. This applies
   the project's "derive, don't assert" discipline to scope.

4. **The diagnosis gate uses the typed escalation contract, not a bespoke approval flag.** In
   interactive mode the diagnosis is a normal gate the human reads before `devteam next`. In
   autonomous mode an unapproved diagnosis is a `judgment-gate` halt that proceeds only under
   `--auto-rule diagnosis-approved` or a standing grant (ADR-005). Using `--allow-stage` (the
   consequence ceiling, reserved for non-idempotent stages like sign-off/deploy) would conflate
   "worth a look" with "dangerous and irreversible."

5. **Reproduction is a failing-first run of stage-03b verified by the stamp layer,** with a
   tri-state honest skip when a bug cannot be expressed as a runnable test (external API calls,
   nondeterminism, data dependencies): `reproduced: true | false | "unverifiable: <reason>"`.
   It must skip loudly, never silently pass — matching the license gate's
   `"unverified-by-orchestrator"` and the production-feedback gate's `true|false|"absent"`.

6. **Phased rollout:**

   | Phase | What | Mechanism | Effort |
   |---|---|---|---|
   | 1 | PATCH-MODE scoping for `--repair` + structural affected-files scope gate | Reuse `renderPatchBlock`; new diff-scope gate; peer-review criteria | Small |
   | 2 | Diagnosis as fix-aware stage-01, gated via typed escalation + `--auto-rule` | Reuse requirements stage + escalation machinery | Medium |
   | 3 | Failing-first reproduction (red→green) | Reuse stage-03b + `verify/stamp` + tri-state skip | Medium |

   Phase 3 is the mitigation for Phase 2's knowledge-gate limit (a non-expert can trust a fix
   whose root cause they cannot evaluate when a reproduction goes red→green), so it is scheduled
   immediately after 1–2, not deferred indefinitely. **Phase 1 must not ship without Phase 2:**
   without the diagnosis's affected-files contract, Phase 1's minimality gate is a reviewer's
   vibe and `--repair` is `--feature` with PATCH MODE and a different flag name.

7. **Instrumentation: ship the tag with Phase 1; defer the metrics surface.** An
   `intent: repair | feature` field on the run record (beside the `track` field the driver
   already writes to `run-state.json`) plus a correlation id linking a re-classified re-run to
   its predecessor must ship with Phase 1 — without it the feature-vs-repair baseline cannot be
   reconstructed. Metrics extend the existing telemetry consumers (`scripts/dashboard.js`,
   `routing-suggest.js`, `budget.js` already slice by `(role, host)`; `intent` is a new slice),
   advisory-only. The headline metric is **scope adherence** (did the build stay within the
   diagnosed files), not diff size — features are inherently bigger than bug fixes, so a raw
   size comparison is confounded; an advisory-only holdout gives the clean A/B. Cost inversion is
   a counterfactual, reported as an estimate with exposed inputs
   (`savings ≈ diagnosis_rejection_rate × avg_full_build_cost − diagnosis_cost`), never as a
   measured figure.

8. **Naming and vocabulary.** The flag is `--repair`, not `--fix` (which collides with
   `fix-and-retry`). The new thing is renamed, not the old: freeing up "fix" by renaming
   `fix_steps` / `fix-recipes` / `fix-and-retry` would touch a gate-schema field, the runbook,
   run-log event names, and the consistency checker. A vocabulary map ships in
   `docs/conventions.md` and a runbook line:

   | Term | Axis | Meaning |
   |---|---|---|
   | `--repair "<symptom>"` | intent | user-initiated bug fix: diagnosis + minimal change + reproduction |
   | `--feature "<description>"` | intent | additive work, implemented fully |
   | `hotfix` (a `--track` value) | depth | skip planning, keep verification — orthogonal to intent |
   | `fix-and-retry` | internal | the driver self-correcting a failed gate mid-run |
   | `fix-recipes.js` / `fix_steps` | internal | the per-stage mechanism that produces the retry |
   | `advise --apply` | internal | applies those fix steps |
   | PATCH MODE (`--patch --from`) | mechanism | the build-scoping constraint `--repair` reuses |

## Consequences

- **What now needs to be true:** `changeIdFromFeature(opts.feature)` (bounded-isolation id
  derivation) needs a symptom-string equivalent, or B9 mode cannot isolate a repair run. The
  `intent` tag must land in `run-state.json` and the run-log `base` object in Phase 1.
- **Cost inversion is real and counterintuitive.** Diagnosis adds a dispatch before build, so a
  repair run with diagnosis can cost *more* than a feature run for the same change, but saves a
  full build budget when it catches a wrong root cause early. Users see the added cost, not the
  saved cost; communicate it, and report the estimate honestly.
- **Classification friction is bounded, not eliminated.** Mis-marking a feature as `--repair`
  produces a constrained build that peer review's completeness tension surfaces; mis-marking a
  dangerous change as trivial is caught by the stoplist forcing depth up. Misclassification
  degrades a run; it does not corrupt one. This is a documentation task, not a design risk.
- **The knowledge-gate limit is the honest boundary.** For complex bugs (race conditions,
  environment-specific failures) the diagnosis may be speculative, and a human can approve it
  only if they understand the code well enough to judge it — exactly when they needed the tool
  least. Phase 3's red→green reproduction is the mitigation; repair mode is still not a
  substitute for deep debugging of systemic issues.
- **Bootstrap/recursion:** a bug in repair-mode's own diagnosis stage cannot be fixed with
  repair mode; fall back to `--feature` or manual, the same convention dogfooding already uses.
- **Structural-minimality false negatives:** the affected-files gate will sometimes be wrong (a
  correct fix needs an unanticipated file). The gate must allow the build to amend the diagnosis
  scope with a recorded justification that peer review scrutinizes — a default to push against,
  not a cage.
- **Feeds a future evidence gate.** The `intent` tag is the input that decides whether diagnosis
  approval can become `--auto-rule`-able or a standing grant (ADR-005): auto-approve only if the
  human-rejection rate proves low. Same discipline as the H3 recipe-factory gate and the
  adaptive-routing review.
- **Residual naming cost is teaching, not confusion.** The vocabulary map must reach operators
  (a runbook entry + a `docs/conventions.md` line), or `--repair`, `hotfix`, and `fix-retry`
  will still be conflated.

## Alternatives considered

- **A full `--repair` pipeline / parallel `track-fix.json`.** Rejected: doubles the maintenance
  surface; any change to gate format, role instructions, or merge logic must be applied twice.
- **A stripped-down pipeline that skips stages for speed.** Rejected: the stages that look
  irrelevant to bug fixes (accessibility, observability) are the ones that catch regressions
  *introduced* by bug fixes. The `hotfix` track already shows the correct trim (drop planning,
  keep verification).
- **A `repair` track instead of an intent flag.** Rejected: tracks bundle intent with depth, and
  a single repair track can express only one verification depth. Deep repair of auth/payments/
  migration code — the stoplist categories — needs full depth *and* repair intent. Intent and
  depth are orthogonal; a flag keeps them so.
- **Keeping the `--fix` name with a vocabulary map only.** Rejected in favor of renaming *and* a
  map: the collision with `fix-retry` is operator-facing, and a map alone does not remove it.
- **Renaming the internal `fix-and-retry` / `fix_steps` vocabulary to free up "fix."** Rejected:
  the tail wagging the dog — a gate-schema-field-level change across the runbook, run-log, and
  consistency checker to make room for one new flag.
- **A reproduction gate on day one.** Rejected as the *first* move (its prerequisites — runnable
  harness, expressible-as-a-failing-test, runnable in-environment — are demanding) but kept as
  Phase 3 rather than dropped, because it is what makes the diagnosis trustworthy for the user
  who needs it most. Critically, it is cheaper than a from-scratch harness: it extends stage-03b
  and the stamp layer.
- **Diff size as the success metric.** Rejected: confounded by features being inherently larger
  than bug fixes. Scope adherence against the diagnosed files, with an advisory-only holdout, is
  the metric that isolates PATCH MODE's effect.

---

*This ADR is the in-repo decision record for repair mode. Tracking issue: telus-labs/stagecraft#135.
Accepted 2026-06-15; execution plan: [`plans/phase-10-repair-mode.md`](../../plans/phase-10-repair-mode.md),
spawned the way ADR-003 spawned the Phase 1–4 plans.*
