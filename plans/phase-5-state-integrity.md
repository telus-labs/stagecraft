# Phase 5 — State Integrity

**Goal:** fix the bug class that real pipeline usage exposed after v0.6.0: state that
outlives its run (archives, gates, artifacts) and upstream re-runs that do not invalidate
downstream attestations. Every recent production fix (#106, #108/#109, stale-artifact log
filtering) is an instance of this class; this phase closes the class, not more instances.

**Why first:** these are correctness holes in the trust model. A pipeline that can skip
re-review after a rebuild, or falsely halt a healthy run on stale archives, undermines the
gate guarantee that is the product.

All findings verified at main `2a1d985` (2026-06-12 round-2 review). Line numbers are
anchors; locate by search.

---

## 5.1 DAG-derived gate invalidation

**Problem (the #109 class, generalized):** recipes hand-list `clear_gates` per stage
(`core/pipeline/fix-recipes.js`). #108/#109 happened because the build-retry path forgot
`stage-04a.json` and lint findings reached deploy. The same hole exists one stage further
and nothing structural prevents the next instance: when the stage-06d recipe clears
stage-04 gates and re-dispatches build, the **stage-05 (peer-review) and stage-06 (QA)
PASS gates are not cleared** — `next()` walks past them, so rewritten code re-enters the
pipeline without re-review or re-QA.

**Change:** compute invalidation instead of hand-listing it.
1. New helper in `core/pipeline/` (e.g. `invalidation.js`): given a stage whose gates a
   recipe clears and the active ordered stage list (track or `custom_stages`), return
   every **existing** downstream stage gate that attested to that stage's output — i.e.
   all gates for stages ordered after the cleared stage, up to and including the failing
   stage that triggered the recipe. [verify-first] Read how `next()` treats a cleared
   mid-pipeline gate with later PASS gates present, and confirm the skip behavior is as
   described before building on it.
2. Recipes declare only the **root** stage(s) they clear; the full `clear_gates` set is
   derived by the helper. Hand-listed downstream entries in existing recipes are deleted
   (the derivation must reproduce them — snapshot-test equivalence for the cases the
   recipes already handle, including the #109 stage-04a case).
3. Conditional stages (04a/04b/04c/04d/04e, 06b–06e) that never ran (no gate on disk)
   are naturally excluded since the helper only returns existing gates.
4. Chain interplay: clearing downstream gates legitimately breaks the C6 chain until
   re-stamped. [verify-first] confirm how the existing flow handles chain state after
   recipe-driven clears (the driver re-runs and re-stamps); document the invariant in the
   helper header.

**Tests:** the generalized scenario — full-track pipeline with PASS gates through
stage-06, stage-06d FAILs, recipe fires → derived `clear_gates` includes stage-04 AND
stage-04a AND stage-05 AND stage-06 gates; after the rebuild, `next()` demands re-review
and re-QA, not sign-off. Equivalence snapshots for every existing recipe's current
correct behavior. A registry test asserting no recipe carries a hand-listed downstream
gate.

**Verify:** `npm test`; the #109 regression test still passes; new scenario test fails on
main, passes with the change.

---

## 5.2 Archive lifecycle owner

**Problem:** per-attempt gate archives (`pipeline/gates/archive/`) are written by the
driver (`core/driver.js` fix-retry path) and deleted only by `devteam restart`
(`core/cli/commands/restart.js` — the #106 fix). They are never pruned when a stage
recovers. Verified consequences: (a) a stage that failed, recovered, and is later
re-entered via a downstream recipe's `clear_gates` starts with
`countArchivedAttempts ≥ maxRetries` → instant `convergence-exhausted` on its first new
failure; (b) a fresh (non-`--resume`) run resets `state.fixRetries` to 0 and overwrites
`attempt-1` while stale `attempt-2/3` survive → `detectNoProgress` compares two stale
archives and can halt the new run immediately.

**Change:** give archives exactly two owners and one invariant — *archives never outlive
the failure sequence they describe*:
1. **Prune on recovery:** when a stage's merged/stamped gate reaches PASS, delete that
   stage's archives. Single choke point: wherever the orchestrator finalizes a stage gate
   (merge path and single-role stamp path — [verify-first] find both call sites).
2. **Prune on re-entry:** when gates for a stage are cleared (the 5.1 helper), delete
   that stage's archives in the same operation — re-entry starts a fresh attempt
   sequence. This generalizes the #106 restart-only fix; `restart.js` then delegates to
   the same code instead of carrying its own deletion.
3. `detectNoProgress`/`countArchivedAttempts` (`core/gates/convergence.js`) need no
   change if 1–2 hold; add an internal guard anyway: ignore archive files whose
   timestamp predates the current gate's first attempt, with a comment explaining the
   defense-in-depth.

**Tests:** the two verified scenarios above as regression tests (fail on main, pass
after); restart behavior unchanged (existing #106 tests stay green, now via the shared
path); archives pruned on PASS.

---

## 5.3 Restore the interactive convergence ceiling

**Problem:** removing the agent-falsifiable `gate.retry_number` from convergence was
right, but its replacement counts **archives**, and only the driver archives. A purely
interactive `devteam next` / `devteam stage` loop never archives, so the ceiling check in
the orchestrator never trips — the interactive path went from "falsifiable ceiling" to
"no ceiling."

**Change:** archive at the overwrite point, not the driver. When `runStage`/
`runStageHeadless` is about to dispatch a stage whose existing gate (stage or workstream)
has status FAIL, archive that gate first — same `archiveGate` call the driver uses,
making the driver's own pre-archive redundant (remove it or make it a no-op via the
shared path; [verify-first] read the driver's archive call and the dispatch paths to
place this once, not twice). Manual gate overwrites by hook-driven model writes are out
of scope — document that boundary in the convergence module header (the validator's
retry-integrity check still covers document honesty there).

**Tests:** interactive loop (runCLI or in-process runStageHeadless with
`DEVTEAM_HEADLESS_COMMAND`) failing the same stage `maxRetries+1` times → `next()`
returns `convergence-exhausted` with `no_progress_evidence` populated; driver behavior
unchanged (existing run tests green); no double-archiving per attempt.

---

## 5.4 Bounded isolation (B9): finish the CLI layer or fence it

**Problem (third audit running):** the core read/write paths honor `changeId`
(Phase 1.6), but the Phase-3 CLI decomposition didn't carry it: `grep changeId
core/cli/commands/*.js` → zero matches. `restart`, `log`, `advise`, `replay`,
`derive-approvals`, `spec` hardcode `pipeline/`; `next` has no `--feature` flag so it can
never derive a changeId. Separately, recipes emit in-place paths
(`"pipeline/gates/stage-04.json"`) and the driver joins them to cwd, so in bounded mode
driver auto-fix clears nothing and halts with a misleading "fix steps contain no gate
clears."

**Change (decided: fence now, finish behind the fence):**
1. **Fence immediately:** `loadConfig` rejects `isolation: bounded` with an error
   enumerating the unsupported commands, unless an explicit
   `isolation_acknowledge_partial: true` is set (escape hatch for the supported driver
   path). Silent-wrong is the only unacceptable outcome; this makes the current state
   honest in one PR.
2. **Recipe/driver paths:** route every recipe-emitted and driver-resolved gate path
   through `prefixPipelineRelative` with the run's changeId (this also feeds 5.1's
   helper — build the helper changeId-aware from the start).
3. **CLI layer:** shared `resolveChangeId(flags, config)` helper in `core/cli/`; add
   `--feature` where missing (`next`); wire the six read-side commands. Lift the fence
   per command as each is wired; the fence's error message is the burndown list.

**Tests:** bounded-mode driver auto-fix e2e (clears the right prefixed gates, run
proceeds); fence error names exactly the unwired commands (meta-test derives the list so
it can't go stale); each wired command gets a bounded-mode test.

---

## Sequencing & exit criteria

5.1 and 5.2 first (they share the clear/prune choke point — coordinate or combine);
then 5.3; 5.4's fence can ship any time (small), its wiring last.

**Phase exit:** the generalized re-review scenario cannot skip attestation; stale
archives cannot produce false halts (both proven by tests that fail on today's main);
interactive loops have a real ceiling; bounded mode either works or refuses loudly.
