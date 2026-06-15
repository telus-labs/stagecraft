# ADR 008 — Exit semantics: pipeline-complete with pending advise blockers

**Status:** Proposed
**Date:** 2026-06-14
**Authors:** Mumit Khan (design), drafted with Claude Sonnet 4.6

## Context

`devteam run` exits 0 when the orchestrator returns `pipeline-complete` — meaning every
stage gate in the active track has status `PASS` or `WARN`. This is the right signal for
"the pipeline finished." But finishing the pipeline is not the same as finishing the work.

### What the design doc said vs what shipped

`docs/autonomous-execution-design.md` §4.4 describes a step 9:

> `pipeline-complete` → run a final `advise` sweep (§4.4) and exit.

That sweep was never implemented. On `pipeline-complete`, the driver sets
`summary.completed = true`, logs a `complete` event, and breaks the loop
(`core/driver.js:346–350`). The exit-code logic in `core/cli/commands/run.js:93–96`:

```js
const cleanStop = summary.completed
  || summary.halt_action === "until"
  || summary.halt_action === "ceiling";
process.exit(cleanStop ? 0 : 1);
```

No advise check runs. A run that completed with ten `QA_BLOCKER` items in gate files exits
0 — the same code as a run with no advisory items.

### What advise reports

`devteam advise` reads every `*.json` file under `pipeline/gates/` and collects
`noted_for_followup[]` items from completed gates (`core/advise.js`). Items are classified
into three non-INFO buckets that constitute "blockers" in advisory language:

| Classification | Meaning |
|---|---|
| `QA_BLOCKER` | Item references an AC that is missing from spec.feature or references QA-incomplete work |
| `PEER_REVIEW_RISK` | Item flags something that needs human peer-review sign-off |
| `A11Y_FIX` | Item requires an accessibility fix that the pipeline cannot self-apply |

These are not pipeline gates — they live *inside* passing gates. The gate itself PASS/WARNs;
the advisory item says "but note this." A CI consumer who wants to gate on advisory items
must run `devteam advise --json` separately and parse its output. There is no exit-code
signal from `devteam run` itself.

### Why this is an open question

The design doc (§7, open question 4) poses it directly:

> "Should the driver exit non-zero when `advise` still reports BLOCKER items, even though
> all gates PASS?"

The tension: the gate system and the advisory system have different authorities.
Gates are the authoritative pass/fail verdict per stage; advise items are flagged-for-followup
concerns that a reviewer or CI step is supposed to act on. Collapsing both into the same
exit code simplifies CI pipelines at the cost of blurring that distinction.

### Who actually consumes the exit code (grounded, 2026-06-15)

Stagecraft's own shipped CI template **does not run `devteam run`** — `docs/ci.md` states CI
validates gates, verifies the tamper-evident chain, and posts check runs, but never runs the
LLM pipeline. So the only consumers of `devteam run`'s exit code are **external, operator-
defined** CI wrappers and shell scripts. Two consequences the original options weighed
without stating: (1) there is no first-party consumer to break, so changing the code is
lower-risk than implied — but also (2) there is no first-party *need* driving the change, so
"the design doc specified step 9" is the only pressure, and the design doc is not
dispositive (it specified plenty that was correctly cut). The decision should therefore
optimize for not silently surprising the *external* `if devteam run; then merge` consumer
who checks `== 0` today.

---

## Recommendation (revised 2026-06-15, critical review)

The original draft recommended "evaluate C first." On review, **C-as-default is the wrong
choice**: exit-3-by-default silently flips today's exit-0-on-complete-with-advisories to
nonzero, breaking every lenient external `if devteam run; then merge` wrapper that checks
`== 0` — to serve a narrow consumer that gates on the exit code, won't parse JSON, and wants
advisory-blocking on by default. The same actionable signal is available to *everyone* in one
JSON parse without changing the default contract.

**Recommended decision: A + D, reusing C's exit-3 code under the opt-in.** Concretely:

- **Default stays exit 0** on `pipeline-complete` (Option A — contract unchanged, gate-vs-
  advise authority preserved), **but** the run never lets advisory blockers pass silently:
  - add `advisory_blockers_count` (and a per-class breakdown) to the driver's `--json`
    summary, so a CI consumer gates on advisories in one parse, no second command;
  - print a loud completion line to stderr: `pipeline complete — N advisory blockers remain;
    run \`devteam advise\` to review`.
- **Opt-in hard gate:** a `--fail-on-advisory` flag (Option D) makes the run exit **3**
  (Option C's code, *not* 1 — preserving the failed-vs-advisory distinction) when
  unaddressed blocker-class items remain. Consumers who want a hard stop add the flag
  explicitly in CI; nobody else is surprised.
- **Recommended class threshold for the flag:** `QA_BLOCKER` + `A11Y_FIX` (concrete
  unaddressed work). `PEER_REVIEW_RISK` is opt-in on top (`--fail-on-advisory=all`), because
  "needs a human to peer-review" is near-always true after an autonomous run and would make
  the flag fire constantly.

This is the in-process advise sweep of B/C (so step 9 is honored) without B/C's default
exit-code change. The four options below are retained for the record; the recommendation
selects A's default + D's flag + C's code-under-flag.

## Options considered

### Option A — Status quo: exit 0 always on pipeline-complete

`devteam run` exits 0 whenever all stage gates PASS/WARN. Advisory items are a separate
concern; CI consumers who want to enforce them call `devteam advise --json` and apply their
own threshold.

**For:** clean separation of concerns; advise is advisory by name and design; no new
machinery needed; CI pipelines can opt in to advisory enforcement independently.

**Against:** the design doc's step 9 was written with a reason — a run that exits 0 with
unaddressed `QA_BLOCKER` items looks clean to a CI consumer who doesn't know to run advise
separately. The advisory system exists to surface things the principal must act on; if those
things don't affect the exit code, they may be ignored.

### Option B — Exit 1 when advise reports unaddressed BLOCKER-class items

After `pipeline-complete`, the driver runs an in-process advise sweep; if any unaddressed
`QA_BLOCKER`, `PEER_REVIEW_RISK`, or `A11Y_FIX` items exist, it exits 1 instead of 0.

**For:** single exit code; a CI `if devteam run; then merge; fi` correctly holds when
advisory blockers are present.

**Against:** exit 1 currently means "pipeline halted/failed" — merging advisory-blocked and
pipeline-failed under the same code loses information. A CI consumer trying to distinguish
"blocked on a peer-review request" from "broke the build" must now parse stderr. Also: the
advise sweep adds latency and file-system reads to every `devteam run` invocation, including
runs in tracks with few advisory items.

### Option C — Exit 3 (advisory-complete) for pipeline-complete with BLOCKER-class advise items

Introduce a fourth exit code:

| Code | Meaning |
|---|---|
| 0 | Pipeline complete, no unaddressed BLOCKER-class advisory items |
| 1 | Pipeline halted (fix-and-retry, resolve-escalation, structural, convergence-exhausted) |
| 2 | Lock error (ELOCKED) |
| 3 | Pipeline complete, but unaddressed QA_BLOCKER / PEER_REVIEW_RISK / A11Y_FIX items remain |

CI consumers can choose their own policy:
- Strict: treat exit 3 as failure (`[ $? -ne 0 ]`).
- Lenient: treat exit 3 as success with a warning (`[ $? -eq 0 ] || [ $? -eq 3 ]`).
- Separate: gate advisory on a distinct CI step (`devteam advise --json`).

**For:** preserves exit 1 semantics; CI consumers get actionable signal without losing the
distinction between "something broke" and "something needs review"; composable with an
independent `devteam advise` step.

**Against:** non-standard exit code; tooling that only checks `!= 0` treats advisory-blocked
the same as failed. Requires updating the `devteam run` man-page equivalent, CI examples in
docs, and any existing shell wrappers that hard-code the two-code contract.

### Option D — Status quo now; add a `--fail-on-advisory` flag later

Keep exit 0 for pipeline-complete; add an opt-in `--fail-on-advisory` flag (Option B behind
a flag, not the default) in a follow-up PR. CI pipelines that want the enforcement add the
flag; existing CI is unaffected.

**For:** backwards-compatible; deployment path is incremental; the flag makes the intent
explicit in CI config.

**Against:** defers the decision; the flag can never become the default without the same
debate; the design-doc step 9 is still unimplemented; advisory items remain invisible in
exit code until opt-in.

---

## Implementation sketch (post-decision)

For Options B, C, or D:

1. Add `runAdvise(cwd, { checkOnly: true })` call in `runDriver` after the
   `pipeline-complete` break, before the function returns the summary.
2. Add `advisory_blockers_count` to the driver summary shape.
3. Update `core/cli/commands/run.js` exit logic to test `summary.advisory_blockers_count`.
4. Update JSON output schema (`RUN_SCHEMA_VERSION` bump) to include the new field.
5. Tests: a fixture with a completing pipeline but a gate containing a `QA_BLOCKER`
   `noted_for_followup` entry; assert the expected exit code.

This is a small follow-up PR (the ADR is the decision; the implementation is straightforward).

---

## Consequences (whichever option is chosen)

- **If A:** the design-doc step 9 is officially removed — the gap between the spec and the
  implementation is closed by updating the spec, not the code. The advise system remains a
  voluntary operator step.

- **If B or C:** every `devteam run` acquires a post-completion advise sweep. Cost: one
  synchronous gate-file scan. Benefit: the exit code tells CI what it needs without a
  second command. CI documentation must specify which exit codes are "merge-safe."

- **If D:** flags accumulate; the "right" default is still undecided; this item reopens
  at ADR-009 or sooner.

The gate semantics (`PASS`/`WARN`/`FAIL` on stage gates) are **not** affected by any option.
Advise items live inside passing gates and are correctly described as advisory in all cases.
The only question is whether the exit code surfaces them.

---

## Questions for human ruling

1. **Is the current exit-0-on-complete behavior a bug or a feature?** The design doc's
   step 9 describes a final advise sweep; the code never ran it. Is the intent to implement
   step 9, or to officially retire it as over-engineering?

2. **If an advise sweep runs: which severity threshold gates the exit code?** All three of
   `QA_BLOCKER`, `PEER_REVIEW_RISK`, `A11Y_FIX`? Only `QA_BLOCKER`? The classification
   hierarchy is not formally ordered; a human ruling should establish which classes are
   "blocking enough" to change exit behavior.

3. **Which option?** A, B, C, or D? The revised recommendation (see "Recommendation"
   above) is **A's default + D's opt-in flag + C's exit-3 code under that flag** — keep
   exit 0 as the default contract, surface `advisory_blockers_count` in `--json` and a loud
   completion line, and let `--fail-on-advisory` exit 3 for consumers who opt into a hard
   gate. This supersedes the original "evaluate C first," which would have changed the
   default exit code for external consumers with no first-party benefit. Confirm or override.

   *(Q1 and Q2 are answered by this recommendation: step 9 is implemented as an in-process
   advise sweep but surfaced via the JSON count + opt-in flag rather than the default exit
   code; the flag's default threshold is `QA_BLOCKER` + `A11Y_FIX`, with `PEER_REVIEW_RISK`
   opt-in. Override if you disagree.)*

4. **CI contract documentation:** wherever this decision lands, the `devteam run` exit code
   table (currently implicit in `run.js` comments) needs to be a first-class contract in
   docs. Where does that live — `docs/runbooks/autonomous-run.md`, `FEATURES.md`, a new
   `docs/reference/exit-codes.md`?
