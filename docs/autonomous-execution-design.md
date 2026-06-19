# Autonomous pipeline execution — design

**Status:** Design (reviewed) — companion to [ADR-003](adr/003-bounded-autonomous-execution.md)
**Date:** 2026-06-09
**Authors:** Mumit Khan (design), reviewed with Claude

This document specifies how Stagecraft moves from a **human-driven** stage manager
(a person reads `devteam next`, types the indicated command, repeats) to a
**bounded autonomous** driver that advances the pipeline on its own and halts only
where a decision genuinely requires human authority.

It is deliberately staged. The foundational layer (a typed failure model) has
standalone value for the *human-driven* product and ships first. The autonomous
driver is the capstone and ships last, gated on the layers beneath it.

---

## 1. Motivation and the honest boundary

### 1.1 What this is

`devteam next` already returns one of six actions — `run-stage`, `continue-stage`,
`merge`, `fix-and-retry`, `resolve-escalation`, `pipeline-complete`
(`core/orchestrator.js:1046–1099`). The pipeline is already a state machine. An
autonomous stage manager is a driver loop around it:

```
while action != pipeline-complete:
  r = next()
  dispatch / merge / fix / escalate / halt   # based on r.action and r.failure_class
```

The orchestrator loop is **code** (deterministic, cheap). The dispatched workstream
agents are **LLMs** (non-deterministic, where the real work and the real cost live).
This separation is the whole design: the driver never needs to understand the code
being written — it needs to know *which* workstream to fire and *what kind* of
failure it is looking at.

### 1.2 What this is not

This is **not** "remove the human." Stagecraft's thesis is that the unit is the
team, not the model (`docs/BACKLOG.md`, bet #7), and `ESCALATE` exists precisely
because some decisions exceed an agent's authority. An autonomous loop that never
escalates has eliminated a safety mechanism, not solved the underlying problem.

The design therefore reframes the human's role rather than removing it:

| | Human-driven (today) | Bounded autonomous (target) |
|---|---|---|
| Human reads `next`, types command | Yes, every transition | No — the driver does it |
| Human fixes mechanical failures | Yes | No — driver re-dispatches with context |
| Human resolves judgment escalations | Yes | Only the ones the Principal can't derive |
| Human authorizes irreversible stages | Implicit | **Explicit grant, always required** |

The human shifts from **mechanical sequencer** to **authority grantor**. That is a
cheaper, more scalable role — and it is the only honest version of "full automation"
that keeps Stagecraft's quality model intact.

---

## 2. Layer 1 — A typed failure model (foundational)

### 2.1 The problem, grounded

Today a gate `status` is one of `PASS | WARN | FAIL | ESCALATE`
(`core/gates/schemas/gate.schema.json:24`). `next()` collapses everything non-passing
into two branches: `FAIL → fix-and-retry`, `ESCALATE → resolve-escalation`
(`core/orchestrator.js:1077–1094`). A grep for `transient | failureClass | retryable`
across `core/` and `bin/` returns **zero hits** — there is no typed failure model.

`FAIL` is doing the work of at least five distinct situations that demand opposite
responses. The conflation is visible in the code:

- An **unreadable/corrupt gate** returns `fix-and-retry` with command
  `cat <gate> # then repair` (`core/orchestrator.js:1068`) — a human diagnostic, not
  an executable fix.
- A **genuinely failing test** also returns `fix-and-retry`, with executable rebuild
  commands (`core/orchestrator.js:1085`).

A driver iterating `commands[]` cannot tell these apart. It would "retry" a corrupt
gate by re-running the stage, which cannot repair corruption.

### 2.2 The infinite-loop hole (why this is correctness, not polish)

The sharpest consequence: **structural-input failures never write a gate.** A context
overflow or a host that errors out produces `gatePath: null`
(`core/adapters/headless.js:191`). Then:

1. `next()` sees no stage gate → `!fs.existsSync(stageGatePath)` → returns `run-stage`
   ("stage not started"), `core/orchestrator.js:1029`.
2. The driver re-dispatches. Same oversized prompt. Same overflow. No gate again.
3. The convergence mechanism (`retry_number` / `this_attempt_differs_by`) lives
   *inside the gate* (`gate.schema.json:72–83`). No gate is ever written, so it never
   fires.
4. There is no circuit breaker in `next()`.

The loop runs forever, re-paying tokens each iteration, never escalating. A naive
`devteam run` built today would do exactly this. The taxonomy is the fix.

### 2.3 Classify by required response, not by cause

The driver does not care *what* went wrong; it cares *what to do next*. There are
exactly five distinct responses, so five classes:

| Class | Required driver response | Counts against convergence budget? |
|---|---|---|
| **transient** | wait + backoff, re-dispatch *identical* | No |
| **structural-input** | halt — retry cannot help; needs config/human repair | No (never retry) |
| **code-defect** | re-dispatch agent with blockers as context | **Yes** |
| **judgment-gate** | route to Principal / human ruling | No (escalates) |
| **external-blocked** | suspend, surface human checkpoint, do not retry | No |

Cause maps many-to-one onto response: context-overflow and a corrupt gate are
different causes but the same response (halt, don't retry). That collapse is what
makes five classes tractable.

### 2.4 Every discriminating signal already exists

The signals are present in the codebase today — scattered across three layers and
never assembled into a class:

| Class | Real detection signal | Where it surfaces |
|---|---|---|
| transient | Promise *rejects* (spawn error, `headless.js:164`); or `exitCode≠0 && gatePath===null`; or `timedOut===true` (`headless.js:189`) | `runHeadless` return |
| structural-input | same raw signal as transient, disambiguated by log content (overflow) or by *repetition* | `runHeadless` + teed log |
| code-defect | gate written, `status:"FAIL"`, `blockers[]` populated, `computeFixSteps`≠null | gate file |
| judgment-gate | gate written, `status:"ESCALATE"` | gate file |
| external-blocked | `status:"FAIL"` + a `computeFixSteps` step with empty `commands[]` + human-action description (e.g. `orchestrator.js:631–636`) | gate + `computeFixSteps` |
| state-corruption (→ structural response) | `loadGateSafe` error (`orchestrator.js:1068`); or merge returns `"malformed"`/`"missing"` (`orchestrator.js:360,365`) | `next()` / `mergeWorkstreamGates` |

Six rows, five response-classes (state-corruption shares the structural-input
response). **No new gate fields and no schema migration are required** — the model
assembles signals that `runHeadless`, the validator, and `computeFixSteps` already
produce.

### 2.5 The convergence mechanism

The gate schema defines `this_attempt_differs_by` with the stated intent *"same
content twice escalates instead of retrying"* (`gate.schema.json:80–83`). The
design goal is a **progress-based** breaker (trip on lack of change: blockers
5→3→3, not on a fixed count that would kill a run converging 5→3→1).

**Implemented state (Phase 4.2):** the progress-based breaker is fully implemented
on both the interactive (`devteam next`) and autonomous (`devteam run`) paths.

**Progress metric:** `core/gates/convergence.js` reads archived attempt gates
(`pipeline/gates/archive/<stage>.attempt-N.json`, written by `core/gates/archive.js`
before each retry clears the live gate) and compares the blocker sets of the last
two attempts. If the normalized, sorted blocker fingerprints are identical across
two consecutive archives, the breaker trips. Empty blocker sets are not treated as
stuck — they are a rare edge case, not a stall.

**Interactive path (`next()`):** uses `countArchivedAttempts()` instead of the
model-written `gate.retry_number` for the count ceiling — removes an
agent-falsifiable input. Runs the progress check first; if blockers are stuck it
escalates with `no_progress_evidence` in the return object before even reaching the
count ceiling. The count ceiling is a backstop for stages where only one archive
exists yet (first retry — insufficient data for comparison).

**Driver path (`devteam run`):** the driver's own `state.fixRetries` counter
(written to `run-state.json`) was already agent-independent. The progress check
is added after each `archiveGate()` call: if `detectNoProgress()` fires, the halt
carries `no_progress_evidence` in the summary and run-log for operator inspection.
The count ceiling (`state.fixRetries[stage] >= max_retries`) remains as the
backstop for the first retry.

**Operator surface:** when the breaker trips, `halt_reason` and `no_progress_evidence`
both state what didn't change, e.g.:
`"blocker 'unit tests failing' identical across attempts 1,2"`. This feeds the
escalation context the same way the count-based halt did.

This is the orchestrator-side backstop for the agent-side self-escalation rule in
`rules/gates-core.md` § Retry Protocol.

**Landed in H1 PR-1:** the count-based ceiling, wired into `next()`.
**Landed in Phase 4.2:** progress-based detection, operator evidence, interactive-path
parity (archive count replaces `gate.retry_number`).

### 2.6 Where the classifier lives

Two detection points, because the signal arrives in two phases:

**Phase 1 — dispatch-time** (`runHeadless` returns, before any gate is read). A
`classifyDispatch({exitCode, gatePath, timedOut, writeViolations})`:

- promise rejected / `exitCode≠0 && gatePath===null`, *first occurrence* →
  **transient** (backoff, retry identical).
- same signal recurring, or log matches an overflow signature → **structural-input**
  (halt).
- `gatePath===null && exitCode===0` ("exited clean, wrote nothing") →
  **structural-input**. The `replay` command (E6) already has this exact mtime-based
  "host exited 0 but did nothing" disambiguator (`bin/devteam`), reusable here.
- `writeViolations.length > 0` → policy failure → structural (halt; the agent
  breached its write boundary).

**Phase 2 — evaluation-time** (`next()` reads the gate). A
`classifyGate(gate, fixSteps)`:

- `loadGateSafe` error → **state-corruption** (halt).
- `status:"ESCALATE"` → **judgment-gate**.
- `status:"FAIL"` + every `fixSteps` step has empty `commands[]` → **external-blocked**.
- `status:"FAIL"` + executable `commands[]` → **code-defect**; then check
  `this_attempt_differs_by` for thrash → escalate if stalled.

`next()` then carries the class on the action object.

**Scoping decision (H1 vs H2):** the design originally sketched *new* actions
(`halt`, `block`). Landing those in H1 would change the action vocabulary that the
icon map (`bin/devteam`), the web UI (`core/ui/static/app.js`), and the runbooks
consume — for no benefit, since nothing *acts* on `halt`/`block` until the driver
exists. So **H1 adds `failure_class` as additive metadata on the existing actions**
(`fix-and-retry`, `resolve-escalation`); the new actions are deferred to **H2**,
where the driver can act on them. What `next()` emits today:

```jsonc
{ "action": "fix-and-retry",      "failure_class": "code-defect",      "fix_steps": [...] }
{ "action": "fix-and-retry",      "failure_class": "state-corruption", "blockers": [...] }
{ "action": "resolve-escalation", "failure_class": "judgment-gate" }
{ "action": "resolve-escalation", "failure_class": "convergence-exhausted" }
// external-blocked: classifier supports it, but no current computeFixSteps recipe
// emits an all-human-action step set, so it activates when such a recipe is added.
```

This keeps `next()` a pure function of disk state for the gate-based classes, while
the dispatch-time classes (`classifyDispatch` — transient vs structural-input) are
owned by the driver (the only thing that holds the `runHeadless` return) and land
with H2. That split keeps `next()` stateless and testable, and confines the
stateful concerns (retry/backoff/budget) to the driver.

**Landed in H1 PR-1:** `core/gates/classify.js` (`classifyGate`), the four
gate-time classes + `convergence-exhausted` on `next()` actions, `next --json`
`schema_version`, and the `failure_class` tag in human output.

### 2.7 The one genuinely fuzzy cut

Transient vs. structural-input cannot be reliably told apart from a bare non-zero
exit with no gate. Three options, in order of robustness:

1. **Repetition heuristic** (v1): treat the first no-gate failure as transient
   (backoff + retry); if the *identical* dispatch fails the same way twice,
   reclassify as structural and halt. No host cooperation; caps the cost leak at one
   wasted retry.
2. **Log-signature matching**: grep the teed log (`pipeline/logs/<ws>.log`) for
   host-specific overflow/auth/rate-limit strings. Works, but brittle across CLI
   version bumps.
3. **Host-adapter typed exit** (mature): extend the capability contract so each host
   maps exit codes / stderr to a typed reason. Principled; composes with G10; real
   surface area across `hosts/*`.

Ship (1) in v1; treat (3) as the maturation path.

---

## 3. Layer 2 — Typed escalation and authority provenance (safety)

### 3.1 Typed "I cannot decide"

`resolve-escalation` emits a freeform `devteam ruling --topic "..."`
(`core/orchestrator.js:1082`). There is no typed escalation, and no definition of when
even a Principal must stop. The design defines it precisely. An LLM Principal can
resolve an escalation **iff the answer is derivable from artifacts it can read**
(brief, spec, `context.md`, gates, code, history). It genuinely cannot when the
escalation is **underdetermined**, which has exactly three sources:

1. **Missing authority** — the decision commits a resource never granted (spend
   money, accept legal/security risk, change scope, sign off on prod). Reasoning does
   not manufacture authority. *Halt.*
2. **Missing information** — the deciding fact lives outside every readable artifact
   ("does the client accept this latency?"). The Principal can flag it, not know it.
   *Halt — as a question.*
3. **Irreducible value tradeoff** — two legitimate objectives conflict and the brief
   does not rank them. Deriving a ranking is hallucinating a stakeholder's priority.
   *Halt.*

Consequence: a well-built Principal should **almost never halt on "I can't reason
this out."** It halts on "I lack authority / information / a ranking." The Principal's
"cannot decide" output is therefore **typed**:

```jsonc
{ "decidable": false, "reason_class": "authority|information|value",
  "question": "...", "options": ["..."] }
```

which makes the human checkpoint a short, structured decision (a grant, a fact, or a
ranking) rather than a debugging session.

### 3.2 Authority provenance in the audit chain

Stagecraft has strong **computation** provenance: C4 reproducibility fingerprints
*what produced a gate* (`model`, `model_version`, `temperature`, `seed`,
`system_prompt_hash`, `tools_hash` — `core/reproducibility.js`,
`gate.schema.json:99–138`), C1 audits writes (`core/guards/write-audit.js`), and C6
(tamper-evident gate chain) **has landed** (PR-D1, `core/gates/chain.js`): each stage
gate carries `chain.prev_hash` and `devteam verify-chain` detects post-hoc edits.

None of it records **authority** provenance. In a human-driven run a person typed
`devteam ruling`, so accountability is implicit. In an autonomous run the gate would
record "claude-opus-4-7 at temp 0" as the thing that resolved a security escalation —
that is computation provenance, not decision accountability.

The design adds authority attribution to the gate and chains it under C6: each
advance past a judgment gate records *which authority was exercised, under whose
grant*. A post-incident audit can then reconstruct "the Principal auto-resolved this
under standing grant of type X, issued by human Y on date Z." This is the prerequisite
for letting `devteam run` touch anything consequential, and it slots into the C6 work
rather than duplicating it. **Status:** ✅ fully landed. C6's tamper-evident chain
landed (PR-D1); `--auto-rule` records authority to `run-log.jsonl` (PR-C2); and
PR-D2 binds that authority record *onto the chained gate* (`resolved_by`) so it
inherits the tamper-evidence — `devteam verify-chain` surfaces it per stage.

---

## 4. Layer 3 — The bounded autonomous driver (capstone)

### Transition handler contract

The driver decomposes actions behind one internal transition-result contract. A
handler returns a control decision (`continue`, `halt`, or `complete`), summary and
run-state patches, and ordered run-log/progress events. `run()` applies that result
and retains ownership of the loop, lock lifecycle, and final persistence. This keeps
handler extraction behavior-preserving: handlers may decide a transition, but they
cannot quietly acquire locks, spin a second loop, or finalize run state.

The extraction is deliberately sequenced. Characterization tests pin summary,
`run-state.json`, and `run-log.jsonl` outcomes. Pure dispatch handlers now decide
authority guards, normalize host results, and classify successful, transient, and
structural outcomes; `run()` still performs invocation, persistence, retry delay,
and loop control. Fix/ruling/merge handling moves only after this slice is reviewed.

### 4.1 `devteam run`

A new command implementing the driver loop. It is **code, not an LLM** — the only
LLMs in the loop are the dispatched workstream agents and (at escalation) the
Principal.

```
devteam run [--track <t>] [--until <stage>] [--max-retries N]
            [--budget-usd X] [--auto-rule <grant-set>] [--fresh]
```

Loop, per iteration:

1. Call `next()`. Switch on `action` and `failure_class` (§2.6).
2. `run-stage` / `continue-stage` → dispatch (inheriting per-workstream routing from
   config; `continue-stage` dispatches only the *remaining* workstreams).
3. `merge` → `devteam merge <stage>`.
4. `fix-and-retry` (`code-defect`) → archive the current gate, check for
   no-progress (identical blockers across last two archives → escalate immediately
   with `no_progress_evidence`), execute `fix_steps.commands[]`, propagate the
   blockers into `context.md` (§4.3), re-dispatch; the count-based ceiling
   (`autonomy.max_retries`) is a backstop for the first retry. See §2.5.
5. `transient` → backoff, re-dispatch identical; do not increment the convergence
   budget.
6. `halt` (`structural-input` / `state-corruption`) → stop with a typed diagnosis.
7. `block` (`external-blocked`) → suspend; surface a human checkpoint.
8. `resolve-escalation` (`judgment-gate`) → dispatch the Principal (§3.1); if
   `decidable:false`, halt as a typed question; else write the ruling and resume.
9. `pipeline-complete` → run a final `advise` sweep (§4.4) and exit.

### 4.2 The consequence ceiling (resolves the philosophy tension)

Autonomy is **scoped by consequence**, not uniform. `devteam run` may autonomously
advance up to — **but not into** — the irreversible/outward-facing stages:

- **stage-07 sign-off**, **stage-08 deploy** (`core/pipeline/stages.js:363,381`):
  always require an explicit human grant, regardless of Principal confidence. These
  are also the non-idempotent stages (running deploy twice deploys twice), so the
  ceiling and the idempotency exclusion are nearly the same set.
- Everything up to and including **stage-06e / stage-09 retro** is eligible for
  unattended advance.

This is what makes the feature on-thesis: the human is not removed, they are
concentrated at the decisions that genuinely need them.

### 4.3 Cross-stage context propagation

A re-dispatched agent reads `context.md` + gate + brief but has no memory of *why* it
is being re-run. Before any `fix-and-retry` re-dispatch, the driver writes the failing
stage's blockers into `context.md` so the agent sees the reason (e.g. peer-review's
"integration tests not updated" reaches the rebuilt backend workstream). The
`--from <stage>` and `--patch` flags that `computeFixSteps` already emits
(`orchestrator.js:645,712,739`) are the existing mechanism; the driver populates the
context they reference.

### 4.4 Budget, state, locking, observability (the MVP blockers)

- **Budget:** no `--budget-usd` enforcement exists today; cost is only summed
  retrospectively at merge (`orchestrator.js:385,441`). The driver must estimate
  headroom *before* each dispatch and refuse to dispatch when the running total
  (summed from `cost_usd` gate fields) would exceed the cap. Best-effort across hosts
  that don't report cost; log "cost unknown" rather than block.
- **Run state:** the pipeline is stateless within a run by design. The driver needs a
  `pipeline/run-state.json` (current stage, per-stage retry counts, which workstreams
  completed) so a crash/restart resumes instead of re-running completed stages.
- **Locking:** no lock file exists. The driver must hold an exclusive lock on the
  pipeline dir for the run; other `devteam` mutating commands check it.
- **Stage timeout:** `runHeadless` has per-workstream timeouts; the driver needs a
  stage-level wall-clock timeout so one hung workstream doesn't hang the run.
- **Run log:** a `pipeline/run-log.jsonl` (one entry per transition: stage, action,
  failure_class, outcome, duration, cost, authority exercised) is the audit + debug
  artifact for unattended runs.

### 4.5 Multi-host (inherited free; fanout deferred)

Routing-based multi-host (different roles → different hosts) is inherited from
`runStage`/`resolveAdapter` with zero driver work. Peer-review **fanout** (same role
to N hosts, all must agree) works for dispatch but **targeted retry is deferred to a
later phase**: retrying one fanout host while reusing another's older gate produces a
merge across two code states. v1 behavior is whole-stage retry on fanout FAIL —
wasteful but correct. Targeted fanout retry is gated on a gate-versioning scheme (each
gate records the commit it reviewed) that makes the merge consistency check solvable.

---

## 5. The recipe factory (upside multiplier — separate bet)

A distinct, optional layer that makes autonomy *compound* rather than sit at a fixed
ceiling. Each resolved escalation is a triple `(failure signature, context,
ruling+fix)`. Persisted and semantically indexed, a recurring *derivable* failure can
be resolved deterministically next time instead of re-escalating — `computeFixSteps`
becomes an append-only learned store seeded by hand and grown by every run.

The substrate already exists: the `core/memory/` embedding store
(`chunker`/`embed`/`index`/`store`, D7) does semantic similarity, and D4→D5 already
prove the learning-loop pattern (for routing). The missing wire is `computeFixSteps`
consulting the memory store on a FAIL signature before escalating.

This is a strictly safer subset of the deprioritized G9 (self-modifying pipeline): it
grows fix-recipes, not `stages.js`/`roles/`; and it learns within *one* project's
recurring failures, dodging the "wait for multiple teams" objection that shelved G9.
**Caveat — a learned recipe is a cached judgment.** Code drifts; a recipe correct at
commit A can be silently wrong at commit Z. Learned recipes need recency/confidence
decay and a re-escalation trigger when the signature matches but surrounding code has
changed materially. Without that, the learning loop becomes a stale-judgment
amplifier. Treat as a separate bet, after Layers 1–3.

---

## 6. Roadmap

Staged so value is front-loaded and the uncertain bet is last. Each phase is
independently shippable and useful on its own.

### Phase 0 — Failure taxonomy core (near-term, high value, low controversy)

Improves the **human-driven** product immediately and de-risks everything after.

- ✅ **PR-1 (landed):** `core/gates/classify.js` (`classifyGate`); the four
  gate-time classes (`state-corruption`, `judgment-gate`, `external-blocked`,
  `code-defect`) plus `convergence-exhausted` carried as `failure_class` on
  `next()` action objects (additive — action vocabulary unchanged); count-based
  retry ceiling wired into `next()` via `autonomy.max_retries` (§2.5);
  `next --json` `schema_version`; `failure_class` tag in human output. Tests:
  `tests/classify.test.js` + new cases in `tests/next.test.js`. No schema migration.
- ⬜ `classifyDispatch()` (transient vs. structural-input) + the repetition
  heuristic (§2.7, option 1). **Deferred to H2** — it has no caller until the
  driver holds the `runHeadless` return.

**Exit criteria:** `devteam next` reports a failure class for every non-pass outcome;
the human sees correct guidance (re-run vs. fix vs. repair vs. escalate).

### Phase 1 — Driver MVP

Split into two PRs so the safe skeleton ships before auto-execution.

**PR-A — skeleton + happy path + safety rails (✅ landed):** `core/driver.js`
(`run()`) + `devteam run`. Loop over `run-stage`/`continue-stage`/`merge`/
`pipeline-complete`; **halts** on any `fix-and-retry`/`resolve-escalation`
(surfacing `failure_class`), at the consequence ceiling (§4.2 — `sign-off`/
`deploy`, grant via `--allow-stage`), on `--budget-usd` (pre-dispatch, summed
from merged stage gates), at the `--until` boundary, or on a no-gate dispatch
(no-progress guard — the interim stand-in for `classifyDispatch`). Run-scoped
state: `pipeline/run.lock` (advisory), `run-state.json` (resumable via
`--resume`), `run-log.jsonl` (audit). Per-stage `--timeout-ms`, `--max-iterations`
guard. In-process dispatch (calls `runStageHeadless`/`mergeWorkstreamGates`
directly). `--json` summary carries `schema_version`. Tests: `tests/run.test.js`
(13). **Dispatch is injectable** in `run()` for deterministic loop tests.

**PR-B — autonomous fix-and-retry (✅ landed):** acts on `code-defect` — clears
the `pipeline/gates/*` paths the recipe names (in-process, extracted from
`computeFixSteps`' `rm` steps; the `devteam stage`/`merge` strings are ignored
since the loop re-dispatches itself), propagates blockers into `context.md` via
an upserted `<!-- devteam:run-blockers -->` section (§4.3), and loops — bounded
by a **driver-side** retry ceiling (`autonomy.max_retries`, the authoritative
backstop since `next()`'s `convergence-exhausted` relies on the agent bumping
`retry_number`). Adds `classifyDispatch` (the H1-deferred dispatch-time
classifier) replacing PR-A's no-progress guard: a no-gate dispatch is
`transient` (backoff `--retry-delay-ms`, default 30s, then re-dispatch) up to
`maxTransientRetries` (default 1), then `structural-input` → halt; a clean exit
with no gate is structural immediately. Escalations still halt for a human
(Phase 2 adds the Principal). Tests: `classifyDispatch` units + fix-retry /
transient-recovery / convergence-ceiling / structural cases in `tests/run.test.js`.
Follow-ups: a structured `clear_gates` field on the fix recipe (retire `rm`
string-parsing) and gate archiving for progress-based convergence.

**Exit criteria:** a full-track run with only machine-diagnosable failures
completes unattended up to sign-off; escalations and structural failures halt
cleanly with typed diagnosis; cost is capped.

### Phase 2 — Typed escalation + authority provenance (safety)

Split into two PRs (contract first, then gated autonomy — mirrors H1→H2).

**PR-C1 — Typed escalation contract (✅ landed, no autonomy change):** the
Principal now writes ONE of two typed lines — `PRINCIPAL-RULING: <topic> →
<decision> [class: <slug>]` (the optional bounded class is what `--auto-rule`
will match; untagged ⇒ `unclassified`, never auto-applied) or
`PRINCIPAL-CANNOT-DECIDE: <authority|information|value> → <question>` (the §3.1
boundary — these always require a human). New `core/escalation.js` parses both;
the ruling prompt (`renderPrincipalRulingPrompt`), `roles/principal.md`, and
`rules/escalation.md` carry the contract; `devteam next` surfaces a cannot-decide
question directly. Improves the human-driven flow and is the prerequisite for
auto-rule. Backward-compatible: legacy untyped rulings parse as `unclassified`.
Tests: `tests/escalation.test.js`.

**PR-C2 — Driver auto-rule (✅ landed):** `--auto-rule <class,…>` — a **CLI-only,
per-run, allowlist-only** grant (no config persistence, no wildcard); default
empty = halt on every escalation (today's behavior, Principal not even
dispatched). On a granted run the driver renders + dispatches the Principal
**in-process** via `core/escalation.js` (`runRuling` / `runFixEscalation`;
injectable for tests — the same code path `devteam ruling` / `fix-escalation`
use), reads the Principal's newest output via `loadPrincipalOutputs`, and:
applies a ruling whose
`class` ∈ the grant (`fix-escalation`) then resumes; halts on a cannot-decide
(surfacing `cannot_decide.{reason_class, question}` in the summary), an ungranted/
`unclassified` class, or no output. **Hard stops it never crosses** (DD-C4): the
consequence ceiling and `convergence-exhausted`; and it auto-rules a given
escalation **at most once**. Authority provenance (`grant_class`, `ruling`,
`authority: auto-rule:<class>`) is recorded to `run-log.jsonl`; chaining under C6
is a follow-up. Tests in `tests/run.test.js` (injected runners).

**Exit criteria:** the driver resolves *derivable*, pre-authorized escalations via
the Principal and halts on authority/information/value (or any ungranted class)
with a structured question; every autonomous advance has an accountable authority
record.

### Phase 3 — Recipe factory (upside bet, conditional)

Gated on Phases 0–2 landing **and** evidence of real recurring-failure volume.

- `computeFixSteps` consults `core/memory/` on FAIL signatures (§5).
- Recency/confidence decay + re-escalation on material code drift.

**Exit criteria:** a previously-escalated, derivable failure resolves deterministically
on recurrence, with drift-triggered re-escalation demonstrated.

### Explicitly deferred

- Targeted fanout retry (needs gate-versioning; §4.5).
- Host-adapter typed exit codes (§2.7, option 3 — composes with G10).
- Multi-pipeline concurrency / merge queue (the scenario where autonomy ROI is
  highest, but a separate concurrency problem).

---

## 7. Open questions

1. **Grant model.** How is a standing `--auto-rule` grant expressed and scoped, and
   where is it stored so it is itself auditable? (Ties to Phase 2 + C6.)
2. **Track inference.** Require explicit `--track`, or read from a
   `pipeline/track.json` written at init? Wrong-track autonomy is a 10× cost error.
3. **Heartbeat.** Unattended runs need a liveness signal (gate-mtime poll or periodic
   stdout) so an operator can tell "progressing" from "hung."
4. **`pipeline-complete` with pending advise.** Should the driver exit non-zero when
   `advise` still reports BLOCKER items, even though all gates PASS?
