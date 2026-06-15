# Runbook: Autonomous run (`devteam run`)

`devteam run` is the bounded autonomous driver (ADR-003). It loops
`next → dispatch → merge` until the pipeline completes, and **halts cleanly the
moment something needs a human**. The loop is deterministic code; the only LLMs
involved are the workstream agents it dispatches.

**Scope (today, Phase 1 + Phase 2 PR-C2):** the driver advances the happy path,
**auto-fixes `code-defect` failures** (clears the failing gate, writes the
blockers into `pipeline/context.md`, and re-dispatches — bounded by a retry
ceiling), **retries transient dispatch failures** with backoff, and — only when
you pass `--auto-rule` — **auto-resolves escalations whose ruling class you
pre-authorized**. It still halts for a human on un-granted escalations,
cannot-decide, `state-corruption`/`external-blocked`, the consequence ceiling, a
budget cap, and structural dispatch failures.

## Autonomous escalation resolution (`--auto-rule`)

By default the driver **halts on every escalation** — it doesn't even dispatch
the Principal. Opt in per-run with an allowlist of bounded ruling classes:

```bash
devteam run --auto-rule formatting-only,doc-only
```

When an escalation arises, the driver dispatches the Principal (`devteam ruling`)
and reads its newest output:

- **`PRINCIPAL-RULING: … [class: X]`** where **X is in your allowlist** → applies
  it (`devteam fix-escalation`), records `auto-ruled` (with the grant class,
  the ruling, and `authority: auto-rule:X`) to `run-log.jsonl`, and resumes.
- **ruling class not granted, or `unclassified`** → halt for a human.
- **`PRINCIPAL-CANNOT-DECIDE: <authority|information|value>`** → halt and surface
  the typed question. Never auto-resolved.

**Hard stops `--auto-rule` can never cross** (halt even with a matching grant):
the consequence ceiling (`sign-off`/`deploy`), and `convergence-exhausted`. And
the driver auto-rules a given escalation **at most once** — if it re-escalates,
it halts. The grant is **CLI-only and per-run** (nothing persists in the repo),
and is an **allowlist only** (no wildcard).

---

## Launch

```bash
devteam run                       # drive the configured track to completion
devteam run --json                # structured summary on stdout (for tooling)
devteam run --until peer-review   # stop after a specific stage
devteam run --budget-usd 10       # stop before a dispatch once spend ≥ $10
devteam run --allow-stage sign-off --allow-stage deploy   # grant the ceiling
devteam run --resume              # continue after a crash/stop
devteam run --force               # override a stale lock
```

Progress prints to **stderr**; the `--json` summary prints to **stdout**.

## What it writes

| File | Purpose |
|---|---|
| `pipeline/run.lock` | Exclusive lock for the run (pid + host + start time). Removed on exit. |
| `pipeline/run-state.json` | Resumable state: current stage, iteration count, per-stage retry counts. |
| `pipeline/run-log.jsonl` | One line per transition (stage, action, `failure_class`, outcome, duration, cost) — the audit + debug trail. |
| `pipeline/gates/archive/<stage>.attempt-N.json` | A snapshot of each failed attempt's stage gate, taken before the auto-fix retry clears/overwrites it. Diff `attempt-1` vs `attempt-2` to see whether blockers were shrinking or stuck — the post-mortem record of a `code-defect` retry sequence. `devteam restart` clears the archive directory; a normal stage re-run does not. |

## Exit codes

| Code | Meaning |
|---|---|
| `0` | `pipeline-complete`, or a clean configured stop (`--until` boundary, or the consequence ceiling — a gate you must approve). |
| `1` | Halted on something that needs fixing (FAIL, escalation, no-progress, merge failure, budget cap, max iterations). |
| `2` | Could not acquire the lock (another run is active). |

## Why it halted — and what to do

Read the `halt_action` (and `failure_class`) in the summary, or the last line of
`run-log.jsonl`:

| `halt_action` | What happened | Do this |
|---|---|---|
| `stoplist` | The change description or `pipeline/brief.md` matched a safety-stoplist phrase (auth/credentials/PII/payments/migrations/…) and the resolved track is lighter than `full`. Checked at run start and again before build. | Switch to `devteam run --track full`. If this is a false positive, re-run with `--force`. |
| `fix-and-retry` | A FAIL the driver won't auto-retry: `state-corruption` (gate unreadable) or `external-blocked` (needs a human/external action). | Run `devteam next` and follow [fix-and-retry.md](fix-and-retry.md). |
| `resolve-escalation` | A gate escalated (`judgment-gate`), the retry budget was spent on a `code-defect` (`convergence-exhausted`), or an escalation's ruling class wasn't in your `--auto-rule` grant. | Follow [escalation.md](escalation.md), then re-run `devteam run`. |
| `resolve-escalation` (`cannot-decide`) | The Principal declared it cannot decide — the run summary carries `cannot_decide.{reason_class, question}`. | Supply the missing authority/information/ranking, encode a `PRINCIPAL-RULING:` line, then re-run. |
| `ceiling` | The next stage is `sign-off` or `deploy` — irreversible/outward-facing. | Review, then re-run with `--allow-stage <name>` to grant it. |
| `budget` | Cumulative `cost_usd` reached `--budget-usd`. | Raise the cap or stop. (Note: the cap prevents the *next* dispatch; it can't cancel one already running.) |
| `until` | Reached the `--until` boundary. | Expected stop — nothing to do. |
| `structural-input` | A stage was dispatched but wrote no gate, and it isn't transient (clean exit with no output, or repeated failure after the transient budget). | Retrying won't help — inspect `pipeline/logs/<workstream>.log` (context overflow, persistent auth/config error). |
| `merge-failed` | A workstream gate was missing or malformed at merge. | Read the reason; fix or re-run the missing workstream. |
| `max-iterations` | The loop hit its guard (`--max-iterations`, default 100). | Almost always a stuck stage — inspect `run-log.jsonl`. |

**Non-halt events** you'll see in progress output / `run-log.jsonl` as the driver works autonomously: `fix-retry` (cleared the failing gate + re-dispatching a `code-defect`, up to `autonomy.max_retries`, default 2), `transient-retry` (a no-gate dispatch is being retried after `--retry-delay-ms`, default 30s, up to once before it's deemed structural), and `auto-ruled` (an escalation was auto-resolved under an `--auto-rule` grant — carries `grant_class`, the `ruling`, and `authority`).

## The consequence ceiling

`devteam run` never advances **into** `sign-off` (stage-07) or `deploy`
(stage-08) on its own — these are irreversible/outward-facing and require an
explicit human grant via `--allow-stage`. This is the line that keeps autonomy
bounded: the driver does the mechanical work up to the decisions that carry real
consequences, and stops there for you.

## Liveness: heartbeats and stall detection (ADR-007 Tier 1)

The driver emits a `heartbeat` event to `run-log.jsonl` at the **start of every
loop iteration**, before dispatching. This bounds the age of the last log entry:
if `run-log.jsonl` went quiet, the driver itself is not looping.

Alongside each `run-stage`/`continue-stage` dispatch the driver runs an
**observe-only stall probe**. It wakes every 60 s and checks whether the
workstream log (`pipeline/logs/`) or any stage gate updated. If neither showed
≥ 512 bytes of growth nor a gate update within 5 minutes, the probe emits a
`stall-detected` event (with `stall_class: "observed"`) to `run-log.jsonl` and
`onEvent`. The dispatch continues unchanged — **no process is killed, no
Promise.race fires**. The probe self-cancels when the dispatch settles so no
stale event is emitted after the stage moves on.

Note: the probe detects **silent hangs** (flat output, no gate) but **not
loop-spew** (a model emitting repetitive output indefinitely resets the clock).
Catching loop-spew requires content-distinct growth and rides with ADR-007
Tier 2 (not yet shipped).

Use `devteam status` to see the current liveness snapshot at any time.

**Config:** `autonomy.stall_threshold_ms` (default 300000) and
`autonomy.stall_min_growth_bytes` (default 512) in `.devteam/config.yml`.

## `devteam status`

```bash
devteam status          # human-readable liveness snapshot
devteam status --json   # machine-readable (CI, tooling)
```

Reads `run-state.json` and the tail of `run-log.jsonl`; reports:

| Field | Meaning |
|---|---|
| `status` | `running` / `completed` / `halted` / `no-run` |
| `current_stage` | The stage the driver is working on |
| `last_action` | Last action dispatched |
| `iterations` | Loop iterations completed so far |
| `cost_usd` | Cumulative cost from all gate files |
| `last_heartbeat_age_ms` | Ms since the last heartbeat event |
| `last_event_age_ms` | Ms since any event in run-log.jsonl |
| `stall_detected` | `true` if the most recent dispatch event was stall-detected |

## Honest limitations

- **Auto-fix only amplifies a competent agent.** On a `code-defect`, the driver
  clears the failing gate and re-dispatches — but whether the *agent* writes a
  correct fix is on the agent. If it doesn't converge within
  `autonomy.max_retries`, the driver escalates (`convergence-exhausted`).
- **Transient-classification is heuristic v1.** The driver classifies dispatch
  failures as `transient` (retry with backoff) or `structural-input` (halt) from
  the exit code and output shape. Edge cases can mis-classify — inspect
  `run-log.jsonl` if the driver retries something that shouldn't be retried.
- **Convergence is progress-based (Phase 4.2).** Both `devteam run` and
  `devteam next` detect a stuck agent by comparing the blocker sets of the last
  two archived attempts: if they are identical the breaker trips and escalates
  with evidence (`"blocker 'X' identical across attempts 1,2"`). A count-based
  ceiling (`autonomy.max_retries`, default 2) is the backstop for the first
  retry, before two archives exist to compare. The `no_progress_evidence` field
  in `run-log.jsonl` carries the operator-readable evidence when this fires.
- **Budget is retrospective.** The cap blocks the *next* dispatch; a single
  expensive stage can overshoot it.
- **Lock is advisory.** `devteam run` holds the lock, but other mutating
  commands (`devteam stage`, `devteam merge`) do not yet check it — don't run
  them against a live autonomous run.
- **Stall detector logs stalls but does not yet act on them (observe-first).**
  `stall-detected` events in `run-log.jsonl` surface the condition but no
  autonomous action is taken. Tier-2 active stall response (SIGTERM kill policy)
  is evidence-gated on the data this item produces — see ADR-007.
- **Stale archives from a prior run can trip the no-progress breaker.** The
  convergence breaker compares the blocker sets in `pipeline/gates/archive/` to
  determine whether a retry made progress. If archive files from a *previous* run
  survive (because the run ended without a `devteam restart`), the breaker may
  see `attempt-1.json` from the old run and `attempt-1.json` from the new run as
  the same stage, conclude no progress was made, and escalate immediately.
  `devteam restart` clears the archive directory and should be called at the start
  of any fresh run. Operators on versions before Phase 5.2 (which fixed archive
  lifecycle management) may see this symptom when upgrading — clearing the archive
  directory manually (`rm -rf pipeline/gates/archive/`) before the first Phase 5.2+
  run resolves it.
