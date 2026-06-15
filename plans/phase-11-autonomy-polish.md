# Phase 11 — Autonomy Polish (ADR-006, ADR-007, ADR-008)

**Goal:** implement the three accepted autonomy ADRs as one phase. All three are small,
driver-adjacent, and share the `devteam run` startup/teardown path:

- [ADR-006](../docs/adr/006-track-inference-under-autonomy.md) — track-inference provenance
  (`pipeline/track.json`, explicit confirmation, no internal inference).
- [ADR-007](../docs/adr/007-liveness-heartbeat.md) — liveness, **observe-first** staging.
- [ADR-008](../docs/adr/008-exit-semantics.md) — exit semantics, **A-default + opt-in flag**.

**Read the ADRs' revision notes first.** Each was accepted *with adjustments* to its
original draft; the items below implement the **adjusted** decisions, not the original
prose. Where a plan item and the ADR body disagree, the ADR's revision note (and this
plan) win.

Order: **11.1 → 11.2 → 11.3**, independent enough to parallelize but all touch
`core/driver.js` / `core/cli/commands/run.js`, so serial avoids merge churn. Standard
preamble rules apply (CI-env-mirrored tests, no repo-root test state, verify-first).

All anchors verified at the Phase-10 baseline; locate by search.

---

## 11.1 Liveness: heartbeat + observe-only stall logging + `devteam status` (ADR-007 Tier 1)

**Implements ADR-007 Tier 1 ONLY. The Tier-2 active stall response (SIGTERM kill policy)
and `--watch` are explicitly OUT of scope** — they are evidence-gated on the
`stall-detected` data this item produces (see 11.4).

**Change:**
1. **Heartbeat event.** At the start of each driver loop iteration, before `next()`, emit a
   `heartbeat` event to `run-log.jsonl` and via `onEvent` (shape in ADR-007 §2). Cheap: no
   new fs scans. Gives `run-log.jsonl` a bounded last-event age.
2. **Observe-only stall probe.** Alongside each `run-stage`/`continue-stage` dispatch, run a
   fire-and-forget interval (NOT a `Promise.race`, NOT a kill — ADR-007 revision note Tier 1)
   that wakes every `stallPollIntervalMs` (default 60s) and, if neither the workstream log
   (`pipeline/logs/<id>.log` via `logsDir`) grew by ≥`stallMinGrowthBytes` (default 512) nor
   the gate updated within `stallThresholdMs` (default 5 min), emits a `stall-detected` event
   (shape in §3) with `stall_class: "observed"` (NOT transient/structural — no action is
   taken in Tier 1). The interval self-cancels when the dispatch settles. [verify-first] read
   how the dispatch is awaited in `core/driver.js` and how `logsDir`/gate paths resolve
   (changeId-aware — Phase 5).
3. **Scope: silent hangs only.** Document in code that any log growth resets the clock, so
   loop-spew is NOT detected (ADR-007 revision note); that needs content-distinct growth and
   rides with Tier 2.
4. **`devteam status`.** New read-only command: reads `run-state.json` + the tail of
   `run-log.jsonl`, reports `status / current_stage / last_action / iterations / cost_usd /
   last_heartbeat_age_ms / last_event_age_ms / stall_detected` (ADR-007 §5). No `--watch`.
5. **Config + state:** `autonomy.stall_threshold_ms`, `autonomy.stall_min_growth_bytes`
   (optional, defaults above). No `stallRetries` counter needed in Tier 1 (no retry/kill).

**Tests** (tests/run.test.js + a status test; CI-env-mirrored): heartbeat emitted every
iteration; observe-only probe emits `stall-detected` when log+gate are both flat past the
threshold (injected clock) and does NOT kill or alter the dispatch; probe self-cancels when
the dispatch settles first (no stale event after the stage moves on); `devteam status`
computes ages from a fixture run-log.

**Verify:** `npm test` / `npx eslint .` / `npm run consistency` green; manual: tail
`run-log.jsonl` during a `DEVTEAM_HEADLESS_COMMAND=sleep` dispatch and observe a
`stall-detected` line with no kill.

**Docs:** remove "No heartbeat" from `docs/runbooks/autonomous-run.md` Honest Limitations;
add a "the driver logs stalls but does not yet act on them (observe-first)" note; add
`devteam status` to the CLI reference (regenerates) + a runbook row.

---

## 11.2 Exit semantics: advise sweep → JSON count + loud line + `--fail-on-advisory` (ADR-008)

**Implements the adjusted ADR-008: A's default (exit 0 unchanged) + opt-in flag exiting 3.**

**Change:**
1. **Post-completion advise sweep.** After `pipeline-complete`, before the driver returns
   its summary, run an in-process advise check ([verify-first] read `core/advise.js` for the
   `noted_for_followup` collection + `QA_BLOCKER`/`PEER_REVIEW_RISK`/`A11Y_FIX` classes;
   reuse it, don't reimplement). Add `advisory_blockers_count` and a per-class breakdown to
   the driver summary; bump `RUN_SCHEMA_VERSION`.
2. **Default exit code UNCHANGED.** `pipeline-complete` still exits 0. Do NOT change the
   `cleanStop` default (ADR-008 revision: external `if devteam run; then merge` consumers
   must not break).
3. **Loud completion line.** When `advisory_blockers_count > 0`, print to stderr:
   `pipeline complete — N advisory blocker(s) remain; run \`devteam advise\` to review`.
4. **Opt-in `--fail-on-advisory` flag.** When set and unaddressed blocker-class items remain,
   exit **3** (not 1 — preserve the failed-vs-advisory distinction; add 3 to the documented
   exit-code table). Default threshold: `QA_BLOCKER` + `A11Y_FIX`. `--fail-on-advisory=all`
   adds `PEER_REVIEW_RISK`. [verify-first] confirm the run.js exit logic location
   (`cleanStop`) and the flag-schema pattern in `core/cli/commands/run.js`.

**Tests** (tests/run.test.js): completing pipeline with a `QA_BLOCKER` `noted_for_followup`
entry → default exit 0 + the loud line + `advisory_blockers_count` in `--json`;
`--fail-on-advisory` → exit 3; `--fail-on-advisory` with only a `PEER_REVIEW_RISK` item →
exit 0 (below default threshold) unless `=all`; clean pipeline → exit 0, no line.

**Verify:** `npm test` / eslint / consistency green.

**Docs:** a first-class exit-code table (ADR-008 Q4) — add to
`docs/runbooks/autonomous-run.md` (codes 0/1/2/3) and the `devteam run` CLI reference;
`docs/ci.md` example showing both the lenient (default) and strict (`--fail-on-advisory`)
patterns.

---

## 11.3 Track provenance: `pipeline/track.json` + confirmation guard (ADR-006)

**Implements the adjusted ADR-006: explicit config flag (not `CI=true`), no `--apply`
breakage, halt (no interactive prompt).**

**Change:**
1. **`pipeline/track.json`** (under `pipelineRoot()`, changeId-aware): `{track, source,
   confidence, reasons, assessed_at, assessed_by}` (ADR-006 §2). `source: "human" |
   "inferred"`.
2. **`devteam assess` (default) writes `pipeline/track.json`** as the per-run inference
   record. **`devteam assess --apply` keeps writing project-wide `custom_stages`,
   unchanged** (ADR-006 revision note 2 — no breaking change). Add `--confirm` to write
   `source: "human"`. [verify-first] read `core/cli/commands/assess.js` +
   `core/stage-shopping/assess.js` for the current `--apply` behavior.
3. **`resolveTrack` reads `track.json`** in precedence
   `--track > pipeline/track.json > custom_stages > default_track > "full"`, returning
   `{track, source, confidence}` ([verify-first] current `resolveTrack` at
   `core/driver.js` returns just the track — extend without breaking callers).
4. **`checkTrackConfidence` guard keyed on `autonomy.require_confirmed_track` config (NOT
   `CI=true`** — ADR-006 revision note 1; `CI` is already overloaded by validator strict-mode
   and set by verify/runner). When the flag is **off** (default): warn-once on an inferred
   track, never block. When **on**: an `inferred` track at `medium`/`low` confidence is a
   typed `unconfirmed-track` **halt** (no interactive prompt — revision note 3) requiring
   `--track` or `--force`; `high` proceeds. `--track` overrides everything silently;
   `--force` bypasses the halt. Log a `track-confidence-check` event; add `track_source` +
   `track_confidence` to the `run-start` event.

**Tests** (tests/run.test.js + assess/stage-shopping test): no `track.json` → falls through
to config/default; `require_confirmed_track` on + inferred/medium → `unconfirmed-track` halt
(no prompt); same + `--force` → proceeds; `human` source any confidence → no halt;
`require_confirmed_track` off → warn-only; `assess` default writes `track.json`; `--apply`
still writes `custom_stages` (regression guard for no-breakage); `--confirm` sets
`source: "human"`.

**Verify:** `npm test` / eslint / consistency green.

**Docs:** `docs/tracks.md` "Track record" section; `docs/runbooks/autonomous-run.md`
pre-run checklist (`devteam assess` as the recommended init step) + the `unconfirmed-track`
halt row; `docs/ci.md` example adds the assess step + `require_confirmed_track`.

---

## 11.4 Parked (evidence-gated, NOT in this phase)

- **ADR-007 Tier 2 — active stall response (SIGTERM kill policy, transient/structural).**
  Gated on the `stall-detected` observe-only data from 11.1: it answers (a) do stalls
  actually happen, (b) where should `stallThresholdMs` sit relative to the wall-clock
  timeout, (c) is content-distinct growth needed to catch loop-spew. Re-open a follow-up
  decision (a Tier-2 ADR revision or new ADR) once a few real runs have produced
  `stall-detected` events. Same evidence-gate discipline as H3.
- **ADR-007 `--watch`** — pure terminal UX; ship whenever, not part of this phase.

When 11.1–11.3 land, mark Phase 11 complete in `plans/prompts/ALL-PROMPTS.md` and the plans
index, and note in each ADR that its Tier-1/accepted scope shipped.

---

## Sequencing & exit criteria

11.1 → 11.2 → 11.3 (serial; all touch the driver startup/teardown). 11.4 stays parked.

**Phase exit:** `devteam run` emits heartbeats and logs (but does not act on) stalls;
`devteam status` reports liveness; advisory blockers are visible in `--json` + a loud line,
hard-gateable via `--fail-on-advisory` (exit 3) without changing the default exit-0
contract; track provenance is recorded in `pipeline/track.json` and enforced only under
`autonomy.require_confirmed_track`, with no `CI`-coupling and no `assess --apply` breakage.
