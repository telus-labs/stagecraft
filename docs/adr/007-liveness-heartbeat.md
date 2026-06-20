# ADR 007 — Liveness/heartbeat: stall detector distinct from wall-clock timeout

**Status:** Accepted
**Date:** 2026-06-14 (accepted 2026-06-15, observe-first staging)
**Authors:** Mumit Khan (design), drafted with Claude Sonnet 4.6

## Context

`devteam run` dispatches each stage by spawning a headless host CLI (e.g. `claude --print`)
and waiting for the child to exit. The driver has exactly one liveness guard today: a
wall-clock timeout (`ctx.timeoutMs`, default 10 min) after which the child receives SIGTERM
and — if it ignores that — SIGKILL five seconds later (`core/adapters/headless.js:163–168`).

The runbook already admits the gap:

> "No heartbeat. A hung dispatch (waiting on a model API) is invisible to the driver
> until it exits. `--budget-usd` + a wall-clock timeout in your CI config are the
> practical guards."
>  — `docs/runbooks/autonomous-run.md`, "Honest limitations"

### Two distinct failure modes — currently conflated

**Wall-clock timeout** is a blunt instrument: the child's *total* elapsed time exceeds the
ceiling. If a fast LLM returns in 2 minutes but a later stage idles for 9 minutes and 59
seconds before resuming, the run continues normally. If a stage hangs at second 9:59 the
timeout fires. The timeout is correct and should stay.

**Stall** is a distinct condition: the host process is alive, its output stream is flowing
(stdout/stderr bytes accumulating), but no gate file has been written and no log-file growth
has been observed for a configurable interval. In practice: the API is healthy enough to keep
the connection open, but the model is stuck in a repetitive loop, waiting for a tool call
that never resolves, or generating output that will never produce a gate. The wall-clock
timeout would eventually catch this — but only after the full `timeoutMs` elapses, burning
tokens for the entire window even when the stall is detectable minutes earlier.

The difference matters most in long-dispatch stages: a `full`-track build stage with a 10-
minute budget can stall visibly at minute 3 (log volume plateaus, no gate written). A stall
detector would surface this at minute 3+`stallThresholdMs`; a wall-clock timeout surfaces it
at minute 10.

### What the driver already records

`core/driver.js:logEvent` appends one JSON line to `pipeline/run-log.jsonl` on each state
transition. The existing event vocabulary, as of the current codebase:

| `outcome` value | When emitted |
|---|---|
| `dispatched` | Immediately after `runStageHeadless` resolves; carries `duration_ms`, `timed_out`, `no_gate` |
| `transient-retry` | A no-gate dispatch is being retried after backoff |
| `fix-retry` | A `code-defect` gate was cleared for re-dispatch |
| `auto-ruled` | An escalation was resolved under `--auto-rule` |
| `halt` / `ceiling-halt` / `budget-halt` / etc. | Driver stopped |
| `complete` | `pipeline-complete` |

There is no event between `dispatch` and `dispatched`. A dispatch that takes 9 minutes
leaves a 9-minute silence in `run-log.jsonl`. An operator tailing the log (`tail -f
pipeline/run-log.jsonl`) has no way to distinguish "the driver is working" from "the
driver has hung". `run-state.json` has a `last_action` and `current_stage` field but no
timestamp indicating when that state was entered.

### Why this matters now

ADR-003 added a budget cap, a consequence ceiling, and convergence detection — all of which
are post-dispatch guards. None protect against the silent hang *during* a dispatch. The gap
stands on its own merits: unattended `devteam run` ships today, and a hung dispatch burns
tokens up to the budget cap and exits only on wall-clock timeout, with no intermediate
signal and no record in the audit log of *why* the run went quiet.

> **Revision note (2026-06-15, critical review).** The original draft justified this ADR as
> a prerequisite blocker for ADR-005 (standing grants) and the H3 recipe factory. As of the
> Phase-9 evidence reviews, **ADR-005 is Deferred and H3 stays gated** (`plans/h3-ground-truth.md`),
> so that rationale no longer holds. It is removed: the liveness gap is justified by the
> *currently shipping* unattended driver, not by deferred work. The Phase-9 plan's "9.1 ADR
> draft immediately" line referred to ordering within Phase 9 (now complete), not an ongoing
> block.

### Relevant injection seams

The driver's `run()` function already accepts injectable dependencies for deterministic
testing:

- `opts.sleep` — injectable `setTimeout` wrapper (used for retry backoff)
- `opts.onEvent` — progress callback called on every transition
- `opts.runStageHeadless` — injectable dispatch function

A stall detector that runs *alongside* a dispatch (not inside `runHeadless`) needs an
additional seam: a way to poll the log file and gate directory at configurable intervals
while the dispatch Promise is pending. `Promise.race(dispatch, stallTimer)` is the natural
shape; `opts.sleep` already sets the precedent for injectable timers.

---

## Decision

> **Revision note (2026-06-15, critical review) — the decision is staged "observe-first."**
> The sections below describe the full design, but it ships in two tiers so a trivially-safe
> observability win is not blocked on a consequential, debatable action:
>
> **Tier 1 — decided, ships now (no behavior change, no process killing):**
> - §2 the per-iteration `heartbeat` event;
> - §3 the dispatch-progress probe in **observe-only mode** — it emits `stall-detected`
>   events to `run-log.jsonl` and `onEvent`, but **never kills the child and never resolves
>   a `Promise.race`**. Observe-only needs no race combinator (it is a fire-and-forget
>   interval that self-cancels when the dispatch settles), which removes the dangling-timer
>   correctness hazard from v1 entirely;
> - §5 `devteam status` (a read over files the driver already writes).
>
> **Tier 2 — deferred until Tier-1 data exists:**
> - §4 the **active stall response** (the transient→structural SIGTERM kill policy). Three
>   reasons to wait: (a) at the proposed defaults the structural kill fires at
>   `2 × stallThresholdMs` ≈ the wall-clock timeout, so it saves little until the threshold
>   is tuned below `timeoutMs/2`; (b) the right threshold is an empirical question the
>   Tier-1 `stall-detected` events are designed to answer; (c) killing a live child is the
>   only irreversible action here and deserves real data before it becomes default.
> - the `--watch` rendering (§5) — pure terminal UX, explicitly not load-bearing.
>
> **Scope correction for §1/§3:** the log-growth probe treats *any* byte growth as progress,
> so it detects **silent hangs** (flat output, no gate) but **not loop-spew** (a model
> emitting repeating output forever — that resets the clock and never fires, despite being a
> motivating example in Context). v1 is therefore scoped to silent hangs only; catching
> loop-spew requires *content-distinct* growth (content-hashing the log), which is more
> expensive and rides with the Tier-2 active-response decision, not v1.

### 1. Define stall precisely and separately from wall-clock timeout

**Stall** is defined as: the host child process is alive (has not exited, no SIGTERM has
fired) **and** the dispatch-progress probe has not observed a qualifying progress signal
within a configurable `stallThresholdMs` window (proposed conservative default: **5
minutes**).

A "qualifying progress signal" is either:
- **Log growth:** `pipeline/logs/<workstreamId>.log` grew by more than `stallMinGrowthBytes`
  bytes (proposed default: **512 bytes**) since the probe last checked.
- **Gate written:** `pipeline/gates/<workstreamId>.json` appeared or was updated since the
  probe last checked.

Either signal resets the stall clock. Neither is required simultaneously. This two-probe
design tolerates silent-but-progressing LLM calls (no output for 90 seconds but the gate
appears on completion) while catching the pathological case (output flat-lined for many
minutes, no gate).

A stall is **not** a timeout. The wall-clock `timeoutMs` ceiling in `runHeadless` remains
unchanged. A stall detected at minute 3 does not kill the child; it records an event and
surfaces the condition (see §3 and §4 below). The operator or an automated policy decides
what to do. This preserves the current behaviour for the common case where a slow API is
just slow.

### 2. Emit a `heartbeat` event to `run-log.jsonl` each driver iteration

At the **start** of each loop iteration, before calling `next()`, the driver emits a
`heartbeat` event:

```jsonc
{
  "ts": "2026-06-14T10:05:00Z",
  "outcome": "heartbeat",
  "iteration": 7,
  "stage": "build",               // r.name from the previous iteration, or null on first
  "action": "run-stage",          // r.action from the previous iteration
  "run_state_path": "pipeline/run-state.json",
  "cost_usd_so_far": 0.42
}
```

The heartbeat event is deliberately cheap: no filesystem scans beyond what the driver
already does (it reads `run-state.json` and `run-log.jsonl` paths it already tracks). Its
purpose is to give a human or monitor a guaranteed per-iteration timestamp in the log, so
the age of the last record in `run-log.jsonl` is always bounded by one iteration's
duration.

The heartbeat does **not** replace the `dispatched` event (which records post-dispatch
results); it sits before `next()` so there is always a record of "the driver is alive and
about to decide."

`onEvent` is called with `{ type: "heartbeat", iteration, stage, action, cost_usd }` in
parallel with the log write, so the `--watch` surface (§4 below) receives it without
polling the file.

### 3. Add a dispatch-progress probe alongside each `run-stage` / `continue-stage` dispatch

When the driver commits to a `run-stage` or `continue-stage` dispatch, it races two
Promises:

```
Promise.race([
  _runStageHeadless(stageName, dispatchCtx),   // the real dispatch
  stallProbe(workstreamId, cwd, changeId, stallOpts)  // polling side-car
])
```

`stallProbe` is a polling loop that wakes every `stallPollIntervalMs` (proposed default:
**60 seconds**) and checks:

1. Has the dispatch Promise already settled? If yes, exit silently — no stall.
2. Has the log file grown by at least `stallMinGrowthBytes` since the last poll? If yes,
   reset the stall clock.
3. Has the gate file been written or updated since the last poll? If yes, reset the stall
   clock.
4. Has more than `stallThresholdMs` elapsed since the last progress signal? If yes, emit a
   `stall-detected` event and resolve the probe Promise with `{ stalled: true }`.

When `Promise.race` resolves with the dispatch result (normal case), the probe is cancelled
and no stall event is written. When the probe resolves first (stall case), the driver
records the event and applies the stall policy (§4).

The probe is injectable via `opts.stallProbe` for deterministic testing. When not provided,
the real probe is used. This follows the same pattern as `opts.sleep`.

**`stall-detected` event shape:**

```jsonc
{
  "ts": "2026-06-14T10:08:00Z",
  "outcome": "stall-detected",
  "iteration": 7,
  "stage": "build",
  "action": "run-stage",
  "stall_threshold_ms": 300000,
  "log_growth_bytes_last_interval": 0,
  "gate_updated": false,
  "dispatch_elapsed_ms": 180000,
  "stall_class": "transient"     // or "structural" — see §4
}
```

### 4. Stall response: classify via the existing transient/structural vocabulary

On a stall, the driver classifies it with the same `transient` / `structural` vocabulary
that `classifyDispatch` already uses for no-gate dispatch failures:

| Condition | Classification | Driver action |
|---|---|---|
| First stall for this stage in this run, dispatch still running | `transient` | Log `stall-detected` with `stall_class: "transient"`, emit `onEvent`, let the dispatch continue (do **not** kill it), continue polling |
| Second stall for this stage (log still flat, gate still absent) | `structural` | Log `stall-detected` with `stall_class: "structural"`, emit `onEvent`, SIGTERM the child (matching `runHeadless` timeout behaviour), then fall into the existing `structural-input` halt path |
| Stall detected but log has grown (slow but alive) | reset | Reset the stall clock; log a `stall-reset` event; continue |

**Why not kill on first stall?** A model streaming a long response may pause for 3–4 minutes
without output while reasoning. One transient stall is plausible; a second consecutive stall
after the same stage resumes is structural. This mirrors the existing transient/structural
split for no-gate failures (`classifyDispatch`), where one retry is permitted before the
driver concludes the input is unworkable.

**Why not require output growth AND gate progress?** Gate progress only happens at dispatch
completion; requiring it during a running dispatch would always trigger a false stall. Log
growth is the in-flight signal; gate presence is the completion signal. The probe uses
whichever is available.

The `transient` stall counter is stored in `run-state.json` alongside the existing
`state.transient[stageName]` counter for no-gate retries. They are separate fields to avoid
conflating two distinct failure sources.

### 5. Operator surface: `devteam status` and `devteam run --watch`

**`devteam status`** (or `devteam run --json` post-run) reads:

1. `pipeline/run-state.json` for `current_stage`, `last_action`, `iterations`.
2. The last line of `pipeline/run-log.jsonl` for its `ts` field, computing
   `last_event_age_ms = now - Date.parse(ts)`.
3. The last `heartbeat` event's `ts` for `last_heartbeat_age_ms`.

Output (structured):

```jsonc
{
  "status": "running",           // "running" | "completed" | "halted" | "no-run"
  "current_stage": "build",
  "last_action": "run-stage",
  "iterations": 7,
  "cost_usd": 0.42,
  "last_heartbeat_age_ms": 45000,
  "last_event_age_ms": 45000,
  "stall_detected": false        // true if a stall-detected event is the most recent dispatch event
}
```

**`devteam run --watch`** (new flag): instead of the current one-line-per-event stderr
progress, `--watch` renders a rolling status block (updated in-place via ANSI) showing:
current stage, elapsed dispatch time, log growth rate (bytes/min), last-heartbeat age, and
stall status. It consumes the `onEvent` callback stream (already exists) rather than polling
files, so no new I/O coupling is introduced in the driver.

`--watch` is an operator convenience flag. It is not required for stall detection — stall
detection happens inside the driver loop regardless of `--watch`. The flag only changes the
terminal rendering.

---

## Consequences

**Positive:**

- **Fills the admitted gap.** The runbook's "No heartbeat" limitation is resolved. An
  operator tailing `run-log.jsonl` or running `devteam status` can now see that the driver
  is alive (heartbeat age) and whether a dispatch is making progress (stall status).
- **No new external dependencies.** The stall probe uses `fs.stat` on files the driver
  already writes (`pipeline/logs/`, `pipeline/gates/`). No new I/O beyond what already
  happens.
- **Inherits the existing failure vocabulary.** `stall-detected` with `stall_class:
  "transient"` or `"structural"` reuses the same terms operators already know from
  `classifyDispatch`. A new failure class is not introduced.
- **Post-dispatch audit.** `stall-detected` events in `run-log.jsonl` are the data source
  for post-mortem analysis: how often did dispatch stall, at which stage, for how long.
  ADR-003 §4.3 (typed failure model) benefits from this data.
- **Safe default.** The transient/structural escalation policy means the driver does not
  kill a dispatch on the first stall — a conservative default appropriate for slow APIs.
- **Composes with budget cap.** A stall that becomes structural ends the dispatch, which
  triggers the existing `structural-input` halt — and the budget cap, if set, fires before
  the *next* dispatch. The two guards are additive.

**Negative / costs:**

- **New driver complexity: `Promise.race` dispatch wrapper.** The current dispatch call is a
  single `await _runStageHeadless(...)`. Racing it against a probe adds a Promise-combinator
  that must be correctly cancelled when the dispatch wins. Cleanup is subtle: if the dispatch
  resolves but the probe is still polling, the probe's `setTimeout` chain must be cancelled
  to avoid a dangling timer that emits stale events after the stage has moved on.
- **Test complexity.** Deterministic tests for stall detection require injected clocks (the
  probe's `setTimeout` calls) and injected log/gate mtime observers. The existing `opts.sleep`
  pattern sets the precedent; it must be extended to the probe's internal sleep. Tests that
  mock `_runStageHeadless` must be updated to participate in the `Promise.race`.
- **False stall risk on slow APIs.** A model that pauses for more than `stallThresholdMs`
  while generating a valid response will trigger a transient stall. The 5-minute default is
  conservative, but teams on especially slow API tiers may need to raise it. The threshold
  must be configurable (via `.devteam/config.yml` `autonomy.stall_threshold_ms`) and
  documented, not hardcoded.
- **`--watch` ANSI rendering is terminal-dependent.** In-place ANSI rewriting breaks on
  non-TTY terminals (redirected to a log file, `script` capture). The flag must detect a
  non-TTY stdout and fall back to the existing line-per-event format. A CI operator who
  passes `--watch` to capture progress to a file must get useful, non-garbled output.
- **Log growth probe requires log file to be present.** If `DEVTEAM_NO_LOG=1` is set (or
  `ctx.log === false`), the log file is not written and the log growth probe has no data.
  In that mode the probe must rely solely on gate mtime. This is a valid degraded-mode
  path, but it makes the stall detector less sensitive. The stall probe must check
  `logDisabled` from `runHeadless`'s context and skip the growth check when logging is off.
- **`run-state.json` stall counter is a new field.** A run resumed from a pre-ADR-007
  `run-state.json` will have no `stallRetries` field. The driver must default it to `{}`,
  consistent with how `state.transient`, `state.fixRetries`, and `state.autoRule` are
  already initialised on resume.

**What now needs to be true:**

- `core/driver.js`: add `stallProbe()` (injectable), `Promise.race` around the dispatch
  call, `stallRetries` field in `run-state.json`, and `heartbeat` event emission at the
  start of each iteration.
- `core/adapters/headless.js`: no changes required — stall detection runs in the driver,
  not inside `runHeadless`. The SIGTERM path in `runHeadless` is reused when the driver
  decides to cancel a structural stall (via a `cancel()` callback or by calling the
  child's `kill` through an exposed handle — this detail is for the implementation PR).
- `docs/runbooks/autonomous-run.md`: remove "No heartbeat" from Honest Limitations; add
  a new row to the halt table for `structural-input` stall; add a troubleshooting entry
  for "Driver reported a stall — what do I do?".
- `tests/run.test.js` (or equivalent): cases for heartbeat emission (every iteration),
  transient stall (first stall → continue), structural stall (second stall → halt with
  `structural-input`), stall reset (growth signal before second stall → reset counter).
- `.devteam/config.yml` schema: new optional `autonomy.stall_threshold_ms` and
  `autonomy.stall_min_growth_bytes` fields with the defaults above.

---

## Alternatives considered

1. **Rely on the wall-clock timeout alone (`--timeout-ms`).** The current state. Rejected
   as the primary liveness guard because it is undiscriminating: a dispatch that hangs at
   minute 3 and a dispatch that legitimately takes 9 minutes are indistinguishable until
   minute 10. The admission in the runbook confirms this is a known gap, not an intentional
   tradeoff.

2. **Kill the child process on the first stall.** Simpler than the transient/structural
   split. Rejected: a pause in output from a slow-but-alive LLM API is a normal operating
   condition. Killing on first stall would produce false positives on heavily loaded API
   tiers. The one-transient-then-structural escalation is the same conservative posture the
   driver already applies to no-gate dispatch failures.

3. **External monitor process (sidecar).** Run a separate `devteam watch` process that
   polls files and sends signals to the driver. Rejected: it requires inter-process
   communication, a separate lifecycle, and coordination on POSIX signals or a named
   pipe — significant complexity for a use case that fits cleanly inside the existing
   `Promise.race` pattern. The `onEvent` callback already gives `--watch` all it needs
   without a sidecar.

4. **Heartbeat-only, no active stall response.** Emit the `heartbeat` event but take no
   autonomous action on a detected stall — the operator reads `run-log.jsonl` and decides.
   Rejected as insufficient for unattended runs: a CI pipeline that starts `devteam run` and
   waits for exit code gets no benefit from a heartbeat record it cannot read while the run
   is blocked. The whole motivation is autonomy at machine speed — the driver must be able
   to act.

5. **Integrate stall detection into `runHeadless` as a polling thread.** Keep the probe
   inside the adapter so it has direct access to the child process handle. Rejected: the
   adapter's contract is "spawn, stream, resolve" — adding polling complexity there
   violates the boundary between the dispatcher (which knows about stages and policy) and
   the adapter (which knows about spawning and I/O). Policy decisions (transient vs.
   structural, stall counting) belong in the driver, not the adapter.

6. **Use OS-level process accounting (`/proc`, `psutil`) to detect CPU-idle children.**
   Detect stalls by watching for the child entering a long CPU-idle / wait state. Rejected:
   not portable across macOS and Linux in a Node.js process without native bindings;
   over-engineering when file-based growth polling achieves the same observable result.

7. **Write `last_heartbeat_at` to `run-state.json` on each iteration instead of a separate
   event in `run-log.jsonl`.** Simpler for `devteam status` (one file to read). Rejected:
   `run-state.json` is the *resumable* state; the heartbeat record is *audit* data. Mixing
   them blurs the boundary. `run-log.jsonl` is already the audit trail; the heartbeat event
   belongs there. `devteam status` can read the last heartbeat from the log by scanning
   backward for `"outcome":"heartbeat"` — a single read on a bounded file.

---

## Implementation sketch (post-ADR approval; no code in this draft)

Files, sized as one PR (two small PRs if the `--watch` rendering is split off):

1. `core/driver.js` — add `heartbeat` event emission at iteration start; add `stallProbe()`
   function (with injectable clock); wrap the `run-stage`/`continue-stage` dispatch in
   `Promise.race`; track `state.stallRetries[stageName]`; apply transient/structural
   stall policy.
2. `tests/run.test.js` — four new test cases: heartbeat per-iteration, transient stall,
   structural stall halt, stall reset on log growth.
3. `docs/runbooks/autonomous-run.md` — update Honest Limitations (remove "No heartbeat");
   add stall halt row to the halt table; add troubleshooting section.
4. `.devteam/config.yml` schema docs / JSON schema — `autonomy.stall_threshold_ms`,
   `autonomy.stall_min_growth_bytes`.
5. `docs/adr/README.md` — move ADR-007 from Deferred to the main index table.

The `--watch` rendering (Decision §5, "devteam run --watch") is a UX improvement; it can
ship in a follow-up PR and is not a prerequisite for the stall-detection safety feature.

**Implementation update (2026-06-19):** the follow-up watch renderer is implemented in
Phase 20. It consumes callback-only progress samples from the Tier 1 probe, redraws on
interactive stderr, and falls back to line-oriented output without ANSI when redirected.
Tier 2 process termination remains evidence-gated and unchanged.

---

## Questions for a human reviewer to rule on

1. **Stall threshold default (5 minutes).** Is 5 minutes (`stallThresholdMs = 300_000`) the
   right conservative default? A lower threshold (e.g. 2 minutes) catches stalls faster but
   increases false-positive rate on slow API tiers. A higher threshold (e.g. 10 minutes,
   equal to the wall-clock timeout) makes the stall detector redundant for the default
   configuration. The 5-minute proposal is a judgment call — if the team has empirical data
   on API pause distribution from `run-log.jsonl`, that should govern the choice.

2. **Stall response: let the dispatch continue, or kill it?** This ADR proposes that a
   *transient* stall leaves the child running and continues polling. An alternative is to
   SIGTERM the child on the first stall, report `stall-detected`, and let the caller retry
   via the existing `transient-retry` path. The "let it run" approach is gentler but means
   a structural stall wastes 2 × `stallThresholdMs` before halting. Which cost is more
   acceptable: wasted dispatch time, or a false kill on a legitimately slow API?

3. **Log growth as a progress signal.** The log-growth probe treats any byte growth as
   progress — even a repeating error line. An LLM stuck in a tight loop that emits 512
   bytes of identical content every 60 seconds would reset the stall clock indefinitely
   until the wall-clock timeout fires. Should the probe require *distinct* output growth
   (content-hashed) rather than *any* growth? Content-hashing the log is more expensive
   and complex; operator ruling requested.

4. **`devteam status` command surface.** The ADR proposes `devteam status` reads
   `run-state.json` + `run-log.jsonl` and reports `last_heartbeat_age_ms`. Does this warrant
   a new subcommand, or should it be a flag on an existing command (`devteam run --status`)?
   The project has been conservative about adding subcommands.

5. **`--watch` flag scope.** The ADR scopes `--watch` to a rendering change (in-place ANSI
   vs. line-per-event). Should `--watch` also imply stall alerting (emit a warning to stderr
   when `last_heartbeat_age_ms` exceeds a threshold) so an operator watching a run gets a
   visible alert without reading the log file? Or should stall alerting always be the
   driver's autonomous action, not a UI concern?

6. **`DEVTEAM_NO_LOG=1` and stall detection.** When logging is disabled, the growth probe
   has no file to stat. The probe falls back to gate-mtime only. Is the degraded sensitivity
   acceptable, or should `DEVTEAM_NO_LOG=1` be incompatible with stall detection (raise a
   warning)? The env var is documented primarily for tests; production runs should not need it.

7. **Stall counter persistence across `--resume`.** A run resumed after a crash has
   `state.stallRetries` from the interrupted run. If a stage previously hit a transient
   stall and then the run crashed, should the resumed run treat the next stall for that
   stage as transient (reset counter on resume) or structural (honour the counter from
   before the crash)? The safer choice is structural (counter not reset), but it penalises
   a legitimate resume after an unrelated crash.
