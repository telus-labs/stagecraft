# Runbook: Autonomous run (`devteam run`)

`devteam run` is the bounded autonomous driver (ADR-003). It loops
`next → dispatch → merge` until the pipeline completes, and **halts cleanly the
moment something needs a human**. The loop is deterministic code; the only LLMs
involved are the workstream agents it dispatches.

**Phase 1 PR-A scope (today):** the driver advances the happy path and halts on
any failure, escalation, the consequence ceiling, a budget cap, or a dispatch
that wrote no gate. **It does not auto-fix or auto-rule yet** — that is PR-B
(autonomous fix-and-retry) and Phase 2 (Principal at escalation).

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
| `fix-and-retry` | A stage is FAIL. `failure_class` tells you which kind. | Run `devteam next` and follow [fix-and-retry.md](fix-and-retry.md). PR-B will do this automatically. |
| `resolve-escalation` | A gate escalated (`judgment-gate`) or the retry budget was spent (`convergence-exhausted`). | Follow [escalation.md](escalation.md), then re-run `devteam run`. |
| `ceiling` | The next stage is `sign-off` or `deploy` — irreversible/outward-facing. | Review, then re-run with `--allow-stage <name>` to grant it. |
| `budget` | Cumulative `cost_usd` reached `--budget-usd`. | Raise the cap or stop. (Note: the cap prevents the *next* dispatch; it can't cancel one already running.) |
| `until` | Reached the `--until` boundary. | Expected stop — nothing to do. |
| `no-progress` | A stage was dispatched but wrote no gate (a dispatch failure — host crash, rate limit, context overflow). | Inspect `pipeline/logs/<workstream>.log`. PR-B will classify this as transient (retry) vs structural (halt). |
| `merge-failed` | A workstream gate was missing or malformed at merge. | Read the reason; fix or re-run the missing workstream. |
| `max-iterations` | The loop hit its guard (`--max-iterations`, default 100). | Almost always a stuck stage — inspect `run-log.jsonl`. |

## The consequence ceiling

`devteam run` never advances **into** `sign-off` (stage-07) or `deploy`
(stage-08) on its own — these are irreversible/outward-facing and require an
explicit human grant via `--allow-stage`. This is the line that keeps autonomy
bounded: the driver does the mechanical work up to the decisions that carry real
consequences, and stops there for you.

## Honest limitations (PR-A)

- **No auto-fix.** Any FAIL halts; the driver does not yet execute fix steps or
  re-dispatch. (PR-B.)
- **No transient/structural distinction.** A dispatch that writes no gate halts
  as `no-progress` rather than retrying a transient blip. (PR-B adds
  `classifyDispatch` + backoff.)
- **Budget is retrospective.** The cap blocks the *next* dispatch; a single
  expensive stage can overshoot it.
- **Lock is advisory.** `devteam run` holds the lock, but other mutating
  commands (`devteam stage`, `devteam merge`) do not yet check it — don't run
  them against a live autonomous run.
