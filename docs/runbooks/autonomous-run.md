# Runbook: Autonomous run (`devteam run`)

`devteam run` is the bounded autonomous driver (ADR-003). It loops
`next → dispatch → merge` until the pipeline completes, and **halts cleanly the
moment something needs a human**. The loop is deterministic code; the only LLMs
involved are the workstream agents it dispatches.

**Scope (today, Phase 1 PR-A + PR-B):** the driver advances the happy path,
**auto-fixes `code-defect` failures** (clears the failing gate, writes the
blockers into `pipeline/context.md`, and re-dispatches — bounded by a retry
ceiling), and **retries transient dispatch failures** with backoff. It still
halts for a human on escalations, `state-corruption`/`external-blocked`, the
consequence ceiling, a budget cap, and structural dispatch failures. **It does
not auto-rule escalations yet** — that is Phase 2 (Principal at escalation).

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
| `fix-and-retry` | A FAIL the driver won't auto-retry: `state-corruption` (gate unreadable) or `external-blocked` (needs a human/external action). | Run `devteam next` and follow [fix-and-retry.md](fix-and-retry.md). |
| `resolve-escalation` | A gate escalated (`judgment-gate`) or the driver's retry budget was spent on a `code-defect` (`convergence-exhausted`). | Follow [escalation.md](escalation.md), then re-run `devteam run`. |
| `ceiling` | The next stage is `sign-off` or `deploy` — irreversible/outward-facing. | Review, then re-run with `--allow-stage <name>` to grant it. |
| `budget` | Cumulative `cost_usd` reached `--budget-usd`. | Raise the cap or stop. (Note: the cap prevents the *next* dispatch; it can't cancel one already running.) |
| `until` | Reached the `--until` boundary. | Expected stop — nothing to do. |
| `structural-input` | A stage was dispatched but wrote no gate, and it isn't transient (clean exit with no output, or repeated failure after the transient budget). | Retrying won't help — inspect `pipeline/logs/<workstream>.log` (context overflow, persistent auth/config error). |
| `merge-failed` | A workstream gate was missing or malformed at merge. | Read the reason; fix or re-run the missing workstream. |
| `max-iterations` | The loop hit its guard (`--max-iterations`, default 100). | Almost always a stuck stage — inspect `run-log.jsonl`. |

**Non-halt events** you'll see in progress output / `run-log.jsonl` as the driver works autonomously: `fix-retry` (cleared the failing gate + re-dispatching a `code-defect`, up to `autonomy.max_retries`, default 2) and `transient-retry` (a no-gate dispatch is being retried after `--retry-delay-ms`, default 30s, up to once before it's deemed structural).

## The consequence ceiling

`devteam run` never advances **into** `sign-off` (stage-07) or `deploy`
(stage-08) on its own — these are irreversible/outward-facing and require an
explicit human grant via `--allow-stage`. This is the line that keeps autonomy
bounded: the driver does the mechanical work up to the decisions that carry real
consequences, and stops there for you.

## Honest limitations

- **Auto-fix only amplifies a competent agent.** On a `code-defect`, the driver
  clears the failing gate and re-dispatches — but whether the *agent* writes a
  correct fix is on the agent. If it doesn't converge within
  `autonomy.max_retries`, the driver escalates (`convergence-exhausted`).
- **No auto-rule.** Escalations (`judgment-gate`) still halt for a human; the
  Principal-at-escalation path is Phase 2.
- **Gate-clearing is by recipe.** The driver clears the `pipeline/gates/*` paths
  named in `computeFixSteps`' output (parsed from its `rm` steps). A FAIL with no
  recipe re-dispatches nothing new and converges to an escalation. A structured
  `clear_gates` field on the fix recipe is a planned follow-up.
- **Convergence is count-based.** The driver-side ceiling counts re-dispatches;
  true progress-based detection (blocker counts decreasing) needs gate archiving.
- **Budget is retrospective.** The cap blocks the *next* dispatch; a single
  expensive stage can overshoot it.
- **Lock is advisory.** `devteam run` holds the lock, but other mutating
  commands (`devteam stage`, `devteam merge`) do not yet check it — don't run
  them against a live autonomous run.
