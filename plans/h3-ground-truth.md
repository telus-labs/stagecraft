# H3 Ground Truth — Recipe Factory Evidence Review

**Date:** 2026-06-14
**Branch:** docs/h3-ground-truth
**Plan item:** 9.2a (phase-9-evidence-gated-capabilities.md)
**Reviewer:** Claude Sonnet 4.6 via Stagecraft automated session

---

## Corpus inventory

### Run-logs

**Result: none.**

`run-log.jsonl` is written by `devteam run` to the project root during an autonomous run
(`core/driver.js:logEvent`). A search across the entire repo tree returns zero files. No
autonomous run has ever been executed against a real project; the driver shipped in v0.7.0
but the only pipeline artifacts on disk are the `examples/sms-opt-in/` fixture, which is
a hand-authored demonstration tree, not a run artifact.

### Gate archives

**Result: none.**

`pipeline/gates/archive/` is created by `core/gates/archive.js` at fix-and-retry time.
A search across the repo tree returns no `archive/` directories and no
`*.attempt-N.json` files outside test fixtures. No real fix-and-retry cycle has
accumulated archived attempt data.

### Fix-commit corpus (sole available evidence)

The only empirical evidence is the git history of Stagecraft's own development — fix PRs
authored while writing and exercising the framework against itself and the
`examples/sms-opt-in` fixture. These are listed exhaustively below.

| PR | Commit | Failure class | What broke |
|----|--------|---------------|------------|
| #81 | `cd3746a` | stage-06d / no-dispatch | When `_wsFromText` matched nothing, the `else` branch emitted an empty commands list. Driver cleared the gate and immediately re-ran the verifier on unchanged code; both retry slots burned without a patch attempt. Ended in `convergence-exhausted`. |
| ~#86/refactor | `b8b7e54` | stage-06d / missing `--patch` | The `ws.length` branch dispatched `devteam stage build --workstream X --headless` without `--patch`, so the build agent ran in verify mode instead of patch mode. Same blockers returned; operator would have hit the retry ceiling. |
| #91 | `b8b7e54` | stage-06d / missing `--patch` (same) | PR that landed the fix above. |
| ~pre-#106 | `f0533da`, `879266b`, `83aa40d`, `99100ec` | stage-06b / A11Y routing | Multiple iterations: wrong advise IDs (from `blockers` instead of `noted_for_followup`), description-only step implying manual action, no fix steps surfaced at all. |
| #106 | `56ddb6a` | (a) stale archives on restart; (b) stage-06b A11Y self-scan | (a) `devteam restart` left archive files on disk; `detectNoProgress` compared new attempt against an old archive and fired a false convergence-exhausted halt before any recipe could run. (b) Stage-06b recipe scanned `stage-06b.json` itself for `noted_for_followup` A11Y IDs — cosmetic advisory IDs matched the A11Y regex, generating an `advise --apply` call that never touched the actual CSS color-contrast blockers. |
| #94 | `9315d80` | stale-log / prior-run artifacts | `devteam log --follow` surfaced first-feature artifacts at the head of a second feature's timeline when `devteam restart design --cascade` cleared gates but left artifact files on disk. Not a recipe failure — a display bug. |
| #108/#109 | `6a922c0` | stage-04a bypass on build retry | `buildGatePaths()` omitted `stage-04a.json`; six recipes shared this helper. Lint errors introduced by a re-dispatched build agent bypassed pre-review silently and surfaced only at deploy time. |
| Phase 5.1 | `3a7c94e` | DAG invalidation (#109 class, generalized) | Even after fixing `stage-04a`, stage-05 and stage-06 PASS gates remained standing when a recipe cleared stage-04 and re-dispatched. Rewritten code re-entered verification without passing peer-review or QA again. `invalidation.js:derivedClearGates()` was built to close the class entirely. |
| Phase 6.4 | `7ffc7e0` | stage-06b / workstream routing | Recipe used regex heuristic (`_wsFromText`) instead of provenance (`assigned_to`/`workstream` on blocker objects) to route the fix. Wrong workstream got dispatched when blocker file paths didn't match patterns. |

---

## Failure classes and recurrence

The commits above cluster into five distinct failure classes:

### FC-1: Gate-clear set incomplete (3 fix cycles, ongoing refinements)

The recipe cleared the failing stage's gate but not upstream or downstream attestation gates,
leaving stale PASS tokens that the driver trusted. Three independent manifestations:

- stage-04a missing from `buildGatePaths()` (#108/#109) — one stage, one fix
- stage-05 and stage-06 not cleared when stage-04 was root (#109 class, Phase 5.1) — generalized fix
- stage-06b audit gate not always included in path-2 clear set (#106 partial)

**Recurrence count:** 3 discrete bugs with the same root cause (hand-listed gate sets are
inherently incomplete; the correct approach is DAG derivation). Addressed in full by
`invalidation.js` (Phase 5.1). No further recurrences possible unless a new recipe
hand-lists gates again.

### FC-2: Wrong dispatch command in recipe step (2 fix cycles)

The recipe emitted a command that ran in the wrong mode:

- stage-06d `else` branch: empty commands → no dispatch (#81)
- stage-06d `ws.length` branch: missing `--patch` → verify mode not patch (#91/b8b7e54)

**Recurrence count:** 2 (same stage, sequential bugs found during development of the
same recipe). Both resolved by PRs #81 and #91. The recipe code at HEAD is correct.

### FC-3: Wrong advise ID source in stage-06b (4 fix cycles)

The stage-06b A11Y recipe was re-written four times across separate commits:
`83aa40d` (no fix steps), `f0533da` (wrong ID source), `879266b` (right source,
wrong gate excluded), `56ddb6a` (#106, final form with `stage-06b.json` excluded).

**Recurrence count:** 4 fix cycles against one recipe for one stage. Resolved in #106.
The final implementation is structurally correct.

### FC-4: Stale archives causing false convergence halt (1 instance)

`devteam restart` did not prune archive files; `detectNoProgress` compared a current
attempt against a prior-run archive and tripped the breaker prematurely (#106).

**Recurrence count:** 1 observed. Fixed in #106 (`restart.js` now deletes matching archives).
A defense-in-depth guard (`_currentSequenceArchives` in `convergence.js`) was also added.

### FC-5: Stale prior-run artifacts in `devteam log` (1 instance, not a recipe failure)

`devteam log --follow` showed first-feature artifacts during a second feature run after
`devteam restart design --cascade` (#94). This is a display/journal bug, not a recipe or
fix-and-retry failure. **Out of scope for H3 recipe factory.**

---

## Recipe coverage today

### What the driver handles automatically (no human halt)

`core/driver.js` advances autonomously through `fix-and-retry` / `code-defect` actions
by invoking the recipe, clearing the declared `clear_gates`, writing fix context to
`context.md`, and re-dispatching:

| Recipe | Automation boundary |
|--------|-------------------|
| stage-04 (build, merged gate) | Clears workstream gates, re-dispatches in `--patch` mode |
| stage-04a (pre-review) | Clears build + lint gates, re-dispatches with pre-review context |
| stage-04c (red-team) | Clears build + red-team gate, re-dispatches |
| stage-05 / code-changes path | Clears build + review gates, re-dispatches build then review |
| stage-05 / incomplete matrix | Clears per-area gates, re-dispatches missing reviewers |
| stage-06 (QA) | Clears build + QA + intermediate attestation gates, re-dispatches |
| stage-06b / path-1 (A11Y with prior IDs) | `devteam advise --apply` — single command, no gate clear |
| stage-06b / path-2 (A11Y, no prior IDs) | Clears build + attestation + audit gates, re-dispatches build |
| stage-06d / ws-identified | Clears build gates, re-dispatches with `--patch --from verification-beyond-tests` |
| stage-06d / ws-unknown | Clears all build gates, global dispatch |
| stage-07 (sign-off) | Halts — step requires human PM action |

### What halts for a human

1. **Convergence exhausted** (`halt_action: resolve-escalation`, `failure_class: convergence-exhausted`): blocker fingerprints identical across two consecutive archives, or source files unchanged after a fix-dispatch, or retry budget exhausted (driver-side ceiling).
2. **Budget exceeded** (`halt_action: budget`): cost would breach `--budget-usd` cap.
3. **Stoplist match** (`halt_action: stoplist`): track matches a prohibited pattern.
4. **Escalation** (`halt_action: resolve-escalation`): any `fix-and-retry` action whose `failure_class` is not `code-defect`, or `resolve-escalation` actions that lack `autoRule` clearance.
5. **Stage-07 and stage-08** (`halt_action: resolve-escalation`): permanent ceiling; no autonomous advance into sign-off or deploy regardless of Principal confidence.
6. **stage-06b / path-3** (no A11Y blockers): `devteam advise` panel — operator confirms selections.
7. **Recipe clears nothing**: if a recipe returns `clear_gates: []` and the driver would loop on the same action, it halts immediately rather than burning retries.

---

## Verdict: gate opens or stays shut

**H3 STAYS GATED.**

### The honest answer: one project, too few runs

The ADR-003 gate condition is "evidence of recurring-failure volume." The evidence
available on 2026-06-14 is:

- **Zero run-log.jsonl files** — no autonomous run has been executed against a real
  project. The driver shipped in v0.7.0 but has not accumulated telemetry.
- **Zero gate-archive files** — no real fix-and-retry cycle has generated archived
  attempt data that an H3 recipe miner could process.
- **One project** (Stagecraft itself) — the fix commits above are development artifacts
  from writing the framework, not operator-observed failure recurrences across independent
  user projects.
- **Five distinct failure classes** — but each manifested 1–4 times, exclusively during
  framework development, and all five are now fixed in HEAD. There is no recurring
  *unresolved* failure class remaining for H3 to learn.

The fix-commit corpus shows that the framework's recipes were **incomplete at ship time**,
not that operators are hitting the same failure class repeatedly in production. Those are
different problems. The former is a development-quality gap (addressed). The latter is
what H3 needs to see before it can be built safely.

### What would change the verdict

The gate opens when **all three** of the following hold:

1. **Volume:** `run-log.jsonl` files exist from ≥2 distinct projects, each with ≥5 autonomous
   runs reaching the fix-and-retry path. The absolute minimum is 10 independent run-log
   corpora; below that, pattern counts are noise.

2. **Recurrence:** at least one failure class (identified by `failure_class` + gate schema
   fingerprint) appears in ≥3 independent runs at ≥2 distinct projects, with an associated
   resolution that was accepted (human confirmed the fix worked).

3. **Derivability:** ≥80% of those recurring instances have `clear_gates` that were
   deterministically computable from gate data alone (no judgment required beyond what the
   recipe already encodes). The remainder — those needing a human ruling — validate that the
   BACKLOG caveat is real and that H3's suggestion-only shape (9.2b) is the right boundary.

### The BACKLOG caveat stands

> "A learned recipe is a cached judgment… or it amplifies stale judgment."
> — docs/BACKLOG.md, H3 entry

With no accumulated run data, there is no empirical basis to evaluate decay risk, false
positive rate, or drift sensitivity. Re-escalate this review after the framework has been
used on ≥2 real projects and the run-log corpus exists to mine.

---

*Written by Claude Sonnet 4.6 for Stagecraft item 9.2a. No code was changed.*
