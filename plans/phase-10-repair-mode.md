# Phase 10 — Repair Mode (`devteam run --repair`)

**Goal:** implement the bug-fix intent decided in
[ADR-009](../docs/adr/009-repair-mode.md) (Accepted 2026-06-15). `--repair` is an intent
flag orthogonal to `--track`, implemented as fix-aware artifacts on existing stages —
**zero new stages, zero parallel pipeline** — reusing PATCH MODE and the spec→stamp chain.

**Naming note (read before touching anything):** the flag is `--repair`, never `--fix`.
"Fix" already means *internal self-correction* in this codebase (`fix-and-retry`,
`fix-recipes.js`, `fix_steps`, `advise --apply`). A `--repair` run will itself emit
`fix-retry` events in its `run-log.jsonl` — that coexistence is expected and the two words
stay distinct. The vocabulary map (ADR-009 §Decision.8) ships in item 10.4.

**Phase-number mapping** (the ADR's internal "Phase 1/2/3" vs this roadmap's Phase 10):
ADR Phase 1 → item **10.1**, ADR Phase 2 → item **10.2**, ADR Phase 3 → item **10.3**,
plus **10.4** (vocabulary docs) and the cross-cutting instrumentation that ships *inside*
10.1. Do not introduce a `track-fix.json` or any new stage; ADR-009 §Alternatives rejected
both.

Order: **10.1 → 10.2 → 10.3 → 10.4**. The hard rule from the ADR: **10.1 must not ship
without 10.2** — without the diagnosis's affected-files contract, 10.1's minimality gate is
a reviewer's vibe.

All anchors verified at the round-2 review baseline; locate by search, not line number.

---

## 10.1 `--repair` flag + PATCH-MODE-scoped build + structural scope gate + intent tag

**Maps to ADR Phase 1.** Smallest item — most of it is wiring existing machinery.

**Change:**
1. **The flag.** Add `--repair "<symptom>"` to `core/cli/commands/run.js`, parallel to the
   existing `--feature` string flag. It is an **intent**, orthogonal to `--track`: it sets a
   `hotfix`-like default track when `--track` is unset, but `--repair --track full` is valid
   and overrides. The stoplist continues to govern depth unchanged (an auth/payments/
   migration symptom still gets forced onto a heavier track). `--repair` and `--feature` are
   mutually exclusive — error clearly if both are passed.
2. **Intent tag (cross-cutting — must ship here, ADR §Decision.7).** Write
   `intent: "repair" | "feature"` onto the run record beside the `track` field the driver
   already bakes into `run-state.json` at run start, and onto the `run-log.jsonl` `base`
   object. This is the perishable baseline — without it from day one, repair runs are
   indistinguishable from features in history. Also add a re-run correlation id linking a
   re-classified re-run to its predecessor (smallest viable: carry the prior run's id when a
   run is started with `--resume`/re-dispatch — [verify-first] read how run-state identifies
   a run today and extend that).
3. **PATCH-MODE-scoped build.** In repair mode the build stage runs with `patchItems`
   populated (from the user symptom directly until 10.2 supplies a diagnosis). Reuse
   `renderPatchBlock` (`core/adapters/render-helpers.js`) — do NOT author a new
   minimal-change prompt; the PATCH MODE block is it. [verify-first] confirm how `cmdStage`
   populates `patchItems` from `--patch --from` and mirror that path for `--repair`.
4. **`changeIdFromFeature` parity (ADR §Consequences).** Bounded-isolation derives the
   changeId from the feature string; add the symptom-string equivalent so a `--repair` run
   can be isolated. [verify-first] read `changeIdFromFeature` and the B9 wiring first.
5. **Structural scope gate (becomes enforceable only with 10.2's affected-files list).**
   Add the gate that FAILs a build touching files outside the diagnosed set. In 10.1, with
   no diagnosis yet, the gate is inert (no affected-files contract to check against) — wire
   the mechanism and the FAIL path now, behind the presence of an affected-files list, so
   10.2 activates it. Peer-review criteria gain "could this be smaller?" as a judgment on
   top of the mechanical boundary.

**Tests:** `--repair`/`--feature` mutual exclusion; `--repair` defaults to hotfix depth,
`--repair --track full` overrides; an auth-symptom `--repair` is still upgraded by the
stoplist; the `intent` tag appears in `run-state.json` and run-log; a repair build renders
the PATCH MODE block (reuse the adapter-contract pattern); the scope gate FAILs a build that
writes outside a supplied affected-files list (use a synthetic list — full diagnosis is
10.2). Subprocess tests mirror CI env (`CI=true DEVTEAM_HEADLESS_COMMAND=cat`).

**Verify:** `npm test`, `npx eslint .`, `npm run consistency` green; manual smoke of
`devteam run --repair "<symptom>" --track nano --max-iterations 1` in a temp project.

---

## 10.2 Diagnosis as fix-aware stage-01, escalation-gated

**Maps to ADR Phase 2.** Highest-leverage item; activates 10.1's scope gate.

**Change:**
1. **Stage-01 produces a diagnosis in repair mode.** When `intent === "repair"`, the
   requirements stage's role brief and artifact change: it produces a diagnosis document
   (traced root cause, proposed fix, **affected-files list**, regression criterion) instead
   of a feature brief. Same stage, same gate, same approval semantics — fix-aware artifact,
   not a new stage. [verify-first] read how stage-01's artifact/role is selected and the
   smallest change that swaps it on intent.
2. **The affected-files list is the scope contract.** It populates 10.1's structural gate
   and the build's `patchItems`. A build touching files outside it FAILs; the build may
   *amend* the list with a recorded justification that peer review scrutinizes (ADR
   §Consequences — a default to push against, not a cage).
3. **Escalation-gated, not `--allow-stage`.** The diagnosis gate is a judgment gate.
   Interactive: a normal gate the human reads before `devteam next`. Autonomous: an
   unapproved diagnosis is a `judgment-gate` halt (the existing typed class) that proceeds
   only under `--auto-rule diagnosis-approved` or a standing grant (ADR-005, deferred). Do
   NOT route it through the consequence ceiling (`--allow-stage`) — that is reserved for
   non-idempotent stages. [verify-first] read the typed escalation contract and the
   `--auto-rule` class plumbing; add `diagnosis-approved` as a grantable class.
4. **Input-UX:** `devteam run --repair "<raw symptoms>"` is now sufficient — the diagnosis
   stage does the locating. An escape hatch for users who know the fix
   (`--repair --repair-at <file>:<line>` or similar) skips diagnosis by seeding the
   affected-files list directly; [verify-first] decide the flag shape against the existing
   `--from`/`--patch` conventions.

**Tests:** repair-intent stage-01 emits a diagnosis gate with an affected-files list; the
structural scope gate (10.1) now activates and FAILs an out-of-scope build (this is the
test that **fails on main** before 10.2); interactive diagnosis is a readable gate;
autonomous unapproved diagnosis halts as `judgment-gate`; `--auto-rule diagnosis-approved`
proceeds; the escape hatch seeds the list and skips diagnosis.

**Verify:** `npm test`, `npx eslint .`, `npm run consistency` green.

---

## 10.3 Failing-first reproduction via stage-03b + stamp, tri-state honest skip

**Maps to ADR Phase 3.** The mitigation for 10.2's knowledge-gate limit — schedule
immediately after 10.2, do not defer.

**Change:**
1. **Stage-03b runs failing-first in repair mode.** The regression criterion becomes an
   executable-spec scenario authored so its test is **red before the fix**; the build makes
   it **green**. Reuse the existing AC→Gherkin→test (G2) machinery and `core/verify/stamp.js`
   — the stamp layer already re-runs tests and records claimed-vs-observed; it verifies red→
   green. [verify-first] read how stage-03b is gated and how stamp records results; the build
   stage in repair mode writes the failing test first, then the fix.
2. **Tri-state honest skip.** When a bug cannot be expressed as a runnable test (external
   API, nondeterminism, data dependency), stamp the gate field
   `reproduced: true | false | "unverifiable: <reason>"` — copy the convention from the
   license gate's `"unverified-by-orchestrator"` and the production-feedback gate's
   `true|false|"absent"`. It must skip **loudly**, never silently pass. Update the stage-03b
   gate schema and `rules/stage-03b.md` (or wherever the spec stage's gate fields live) for
   the tri-state.
3. **Note the `hotfix` track skips stage-03b today** — so repair-on-hotfix gains reproduction
   discipline it otherwise lacks. Confirm the repair intent pulls stage-03b into the active
   stage list even on hotfix depth ([verify-first] how the stage list is composed from track
   + intent).

**Tests:** a repair run produces a red-before / green-after reproduction verified by the
stamp (not asserted by the agent); an unverifiable bug stamps the tri-state and the run
proceeds with a loud WARN, never a silent pass; schema test for the new field; repair-on-
hotfix includes stage-03b.

**Verify:** `npm test`, `npx eslint .`, `npm run consistency` green.

---

## 10.4 Vocabulary map + docs + metrics surface

**Maps to ADR §Decision.8 + §Decision.7 deferred metrics.** Ships last.

**Change:**
1. **Vocabulary map** (ADR-009's table) into `docs/conventions.md` and a one-line pointer in
   the relevant runbook, distinguishing `--repair` (intent) / `hotfix` (depth) /
   `fix-and-retry` + `fix_steps` (internal). This is the residual "teaching" cost ADR
   §Consequences named.
2. **Runbook + reference:** a `docs/runbooks/` entry for the repair flow (diagnosis gate,
   scope-gate FAIL recovery, tri-state reproduction), a `docs/runbooks/README.md` index row,
   the `--repair` flag in the generated CLI reference (it regenerates from the flag schema —
   confirm `npm run docs:generate` picks it up), and a `docs/FEATURES.md` row.
3. **Metrics surface (deferred per ADR — advisory only).** Extend the existing telemetry
   consumers (`scripts/dashboard.js` / `routing-suggest.js` / `budget.js`, which already
   slice by `(role, host)`) with `intent` as a new slice. The headline metric is **scope
   adherence** (did the build stay within the diagnosed files), not diff size (confounded —
   ADR §Alternatives). Report cost inversion as an **estimate with exposed inputs**
   (`savings ≈ diagnosis_rejection_rate × avg_full_build_cost − diagnosis_cost`), never a
   measured figure. Non-blocking, like the coverage and prompt-budget signals.
4. **examples/sms-opt-in** is feature-intent and stays the feature reference; if a repair
   example is wanted, add a separate minimal one rather than mutating the canonical feature
   example.

**Tests:** consistency green (vocabulary refs resolve; CLI reference regenerates with
`--repair`); a metrics meta-test that the `intent` slice computes on fixture telemetry.

**Verify:** `npm run docs:generate` idempotent; `npm test` / `npm run consistency` green.

---

## Sequencing & exit criteria

10.1 → 10.2 → 10.3 → 10.4. The must-fail-on-main test for the bet lives in 10.2 (the scope
gate FAILing an out-of-scope build). After 10.3, the evidence loop ADR §Consequences
described is live: the `intent` tag accumulates, and once enough repair runs exist, the
`diagnosis-approved` auto-rule / standing-grant question (ADR-005) becomes answerable from
the rejection rate.

**Phase exit:** `devteam run --repair "<symptom>"` runs diagnosis → PATCH-MODE-scoped build
→ failing-first reproduction; out-of-scope builds FAIL structurally; reproduction skips
loudly when unverifiable; runs are intent-tagged from 10.1; the vocabulary map and runbook
ship. When done, update ADR-009's status note is not required (it stays Accepted), but mark
Phase 10 complete in `plans/prompts/ALL-PROMPTS.md` and the plans index.
