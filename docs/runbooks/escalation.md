# Runbook: Handling an Escalation

`devteam next` reports `resolve-escalation`. This runbook covers what to read, what to decide, and how to encode the decision so the pipeline can advance. Follow the sections in order.

For the mechanism's design rationale, see `rules/escalation.md`. For specific scenarios (security veto, migration veto, two reviewers disagree), see `docs/faq.md` § "When do I write `status: ESCALATE`?".

---

- [0. What you're looking at](#0-what-youre-looking-at)
- [1. Read the three places that hold the disagreement](#1-read-the-three-places-that-hold-the-disagreement)
- [2. Decide](#2-decide)
- [3. Get a Principal ruling](#3-get-a-principal-ruling-when-applicable)
- [4. Encode the decision](#4-encode-the-decision)
- [4b. Retry loop exhaustion](#4b-retry-loop-exhaustion--a-distinct-escalation-shape)
- [5. Stop and ask if any of these are true](#5-stop-and-ask-if-any-of-these-are-true)
- [6. Common gotchas](#6-common-gotchas)
- [7. After resolution](#7-after-resolution)
- [7b. Two-round peer review exhaustion](#7b-two-round-peer-review-exhaustion)

---

## 0. What you're looking at

ESCALATE signals that a decision requires human judgment. It is not a model bug. The agent that wrote ESCALATE has a specific question it cannot resolve autonomously. The pipeline halts until you act. `devteam next` will continue to report `resolve-escalation` until the escalation is encoded.

The action carries a `failure_class` distinguishing *why* you're being asked to rule: **`judgment-gate`** (a gate wrote `status: ESCALATE` — the usual case, §1–4) versus **`convergence-exhausted`** (no gate escalated; the stage hit its retry budget and `next` escalated on its own — see [§4b](#4b-retry-loop-exhaustion--a-distinct-escalation-shape)).

## 1. Read the three places that hold the disagreement

Order matters — read in this order so you build the picture from outside in.

**(a) `devteam next --json`** — start here. Returns the action, the stage, the gate path, and the reason. Example:

```bash
devteam next --json
```
```json
{
  "action": "resolve-escalation",
  "stage": "stage-05",
  "name": "peer-review",
  "gate": "pipeline/gates/stage-05.json",
  "reason": "platform reviewer escalated F-12 and F-13 to Principal"
}
```

**(b) The gate file** — read what the escalating agent actually wrote:

```bash
cat pipeline/gates/stage-05.json
# Or, for the per-workstream gate that triggered it:
cat pipeline/gates/stage-05.platform.json
```

The key fields:

- `status: "ESCALATE"` — confirms this is an escalation, not a FAIL
- `escalation_reason` — one-sentence factual summary
- `decision_needed` — the specific question
- `options` — choices the agent surfaced (if any)
- `escalated_by` — which agent wrote this
- `pipeline_halted_at` — where to resume after resolution

For Stage 5 escalations specifically, also check the inline `ESCALATE:` marker in the review file:

```bash
grep -A 5 "ESCALATE:" pipeline/code-review/by-platform.md
# Or whoever escalated.
```

**(c) The source artifact the escalation cites.** This is where you do the actual reading. If the escalation says "F-12 at server.js:46", open that file at that line and look. If it cites a red-team finding, open `pipeline/red-team-report.md` and find the F-NN in question.

> **Don't try to decide from the gate alone.** The gate is a summary. The decision usually requires reading the code, the spec, and the prior reviewer notes together.

## 2. Decide

Two broad shapes, and most decisions fit one:

**Shape A — must-fix.** The escalation surfaces a real defect that must be resolved before advancing. Examples: a security finding with a working exploit, a wrong error class that misreports to ops dashboards, a migration rollback that doesn't function. Cost: re-run build and any downstream stages.

**Shape B — defer.** The escalation is real but not load-bearing for this release. Record it as a follow-up and proceed. Examples: an observability gap at a layer that's hard to instrument cleanly, a doc drift that doesn't affect users, a `PATTERN:` worth promoting later. Cost: a ticket and a one-line note in `context.md`.

If the shape is unclear, ask: "If I deferred this and shipped, what's the worst outcome?" An observability blind spot that can be addressed next pass is a defer. A wrong error message that reaches customers and is invisible to ops is a fix.

The Principal role is the architecture authority for this kind of call. If the escalation specifically requests Principal review (e.g. `escalated_to_principal: true`, or the reviewer wrote `ESCALATE to Principal:`), invoke the Principal subagent to produce a written ruling. See § 3 below.

## 3. Get a Principal ruling (when applicable)

If the escalation needs Principal judgment specifically — common for cross-cutting design questions or two-reviewers-disagree cases — invoke the Principal role directly. Two paths:

**Interactive (Claude Code):**

```
> Use the principal subagent to read pipeline/code-review/by-platform.md
> and pipeline/red-team-report.md, then rule on F-12 (must-fix vs defer)
> and F-13. Write the ruling to pipeline/context.md under a
> ## Principal Rulings section.
```

**Headless:**

```bash
devteam ruling \
  --target-gate pipeline/gates/stage-05.json \
  --headless
# --topic is optional: auto-derived from the gate's escalation_reason + decision_needed.
# Supply it explicitly only when you want to override or narrow the auto-derived topic.
# --context is optional: comma-separated paths the Principal should read in addition
# to the gate (e.g. --context pipeline/red-team-report.md,pipeline/code-review/by-platform.md).
```

Routes via `routing.roles.principal` (or `routing.default_host` if not set), dispatches the Principal subagent against the cited context, and waits for the ruling to land in `pipeline/context.md`. Refuses cleanly if the routed host doesn't support `--headless`.

The ruling format that the rest of the pipeline knows how to read:

```markdown
## Principal Rulings

PRINCIPAL-RULING: F-12 → must-fix before Stage 6. The TypeError
mis-classification ships a lie to ops dashboards; that's a deploy-
blocker class issue. Re-run build with the F-12 fix scoped via
`--patch --from peer-review`.

PRINCIPAL-RULING: F-13 → defer to a follow-up ticket. The HTTP-
parser layer is hard to instrument from middleware without
bypassing Express's request lifecycle. Tracked as TICKET-1234.
```

The `PRINCIPAL-RULING:` prefix is the machine-readable convention. `devteam fix-escalation` reads these lines via `loadPrincipalRulings()` and dispatches an applicator agent that implements what each ruling prescribes — clearing the right gate files and re-running the indicated stages. Reviewers and future readers can also grep for it directly.

### Typed rulings and "cannot decide" (ADR-003 Phase 2)

A ruling line may carry a trailing `[class: <slug>]` naming the *kind* of decision (e.g. `formatting-only`, `doc-only`, `known-safe-dependency-bump`):

```markdown
PRINCIPAL-RULING: lint style → accept prettier defaults [class: formatting-only]
```

The class is what an operator pre-authorizes for **autonomous** resolution via `devteam run --auto-rule <classes>` (Phase 2 PR-C2). An untagged ruling parses as `unclassified` and is **never** auto-applied — it always halts for a human. Pick the narrowest honest class; never inflate it to fit a grant.

When a decision is **not derivable** from the artifacts, the Principal writes a typed cannot-decide line instead of guessing:

```markdown
PRINCIPAL-CANNOT-DECIDE: authority → Who approves accepting the residual auth risk for the v1 ship?
```

The reason class is one of **authority** (commits a resource not granted), **information** (the deciding fact is outside every artifact), or **value** (two legitimate objectives the brief doesn't rank). `devteam next` surfaces this question directly, and the driver never auto-resolves it — a human supplies the missing authority, fact, or ranking, then encodes a normal `PRINCIPAL-RULING:` line.

## 4. Encode the decision

### 4a. Must-fix path

After the Principal ruling is written to `pipeline/context.md`:

```bash
# Primary path — automated implementation:
devteam fix-escalation --headless
# Reads PRINCIPAL-RULING: lines, dispatches an applicator agent that clears the
# right gate files and re-runs the indicated stages automatically.

devteam next   # confirm the escalation is resolved
```

**Manual path** (when you want direct control of the sequence, or the applicator can't infer the right steps from the ruling text):

```bash
# For a build defect surfaced at peer-review:
devteam stage build --patch --from peer-review --workstream <owning-area> --headless
devteam merge build
devteam stage pre-review --headless
devteam stage peer-review --headless
devteam merge peer-review
devteam next

# For a defect that requires clearing the whole build stage:
devteam restart build --cascade
devteam stage build --patch --from peer-review --headless
devteam merge build
devteam stage pre-review --headless
devteam stage peer-review --headless
devteam merge peer-review
devteam next
```

### 4b. Defer path

Hand-edit the escalating gate. Two changes:

1. Status: `ESCALATE` → `PASS` (or `WARN` if the deferral is real but you want it visible)
2. Move the cited items from wherever they live in the gate into `warnings[]` with a ticket reference

Example, before:

```json
{
  "stage": "stage-05",
  "status": "ESCALATE",
  "escalation_reason": "F-12 and F-13 need Principal ruling",
  ...
}
```

After:

```json
{
  "stage": "stage-05",
  "status": "WARN",
  "escalation_reason": "F-12 → must-fix (now FIXED); F-13 → deferred (TICKET-1234)",
  "warnings": [
    "F-13 (HTTP-parser 400/431 unlogged) deferred to TICKET-1234 — see pipeline/context.md § Deferred follow-ups"
  ],
  ...
}
```

Then record the deferral in `pipeline/context.md` under a `## Deferred follow-ups` section so the retrospective (Stage 9) sees it:

```markdown
## Deferred follow-ups

- **F-13** — HTTP-parser 400/431 unlogged. Same class as F-07 but at a
  layer that's hard to instrument cleanly from Express middleware.
  Filed as TICKET-1234. Deferred at Stage 5 by Principal ruling on 2026-06-02.
```

After the edit:

```bash
devteam validate    # confirm the gate is structurally valid
devteam next        # should now report run-stage <next-stage>
```

## 4c. Retry loop exhaustion — a distinct escalation shape

When `devteam next` reports `resolve-escalation` but the gate shows
`retry_number: 3` (or higher) on a stage-06 gate, this is **not** a
normal escalation — it's the retry protocol auto-escalating because the
same test failure repeated three times identically. The pipeline chose to
stop rather than loop forever.

```bash
# Confirm this is a retry exhaustion, not a Principal-requested escalation
cat pipeline/gates/stage-06.json | jq '{retry_number, previous_failure_reason, this_attempt_differs_by, failing_tests}'
```

If `retry_number >= 3` and `failing_tests` in the current gate matches the
previous gate exactly, you are in retry exhaustion.

**Root cause is almost always one of two things:**

**Root cause A — the implementation is fundamentally wrong.** The owning dev
fixed the symptom (a specific assertion) but not the underlying behaviour. Each
retry addressed a different surface manifestation of the same bug. Evidence:
`this_attempt_differs_by` describes minor changes but `failing_tests` is
unchanged.

→ Get a Principal ruling on whether the spec or the implementation is the
source of truth. Invoke via:

```bash
devteam ruling \
  --topic "Stage 6 retry exhaustion: failing_tests unchanged after 3 cycles on <AC-N>" \
  --context pipeline/gates/stage-06.json,pipeline/test-report.md,pipeline/brief.md,pipeline/design-spec.md \
  --headless
```

The Principal reads the failing test, the acceptance criterion, and the
implementation. The ruling is either: (a) the implementation is wrong in a
specific way — annotate with `PRINCIPAL-RULING:` and re-run build with that
constraint; or (b) the acceptance criterion is ambiguous — the PM rewrites
it, which may require a brief amendment and a new QA cycle.

**Root cause B — the test itself is wrong.** The test asserts the wrong
thing, or it's flaky (timing-sensitive, ordering-dependent, global-state
leak). Evidence: the implementation looks correct but the test fails
non-deterministically or asserts an assumption that isn't in the brief.

→ Clear the QA gate and re-run QA with the retry context visible:

```bash
rm pipeline/gates/stage-06.json
# The retry_number and previous_failure_reason remain in context.md;
# QA reads them and revises the failing test rather than re-running the implementation.
devteam stage qa --headless
```

**After ruling:**

```bash
# After Principal ruling, clear the escalation flag by encoding the ruling:
# (Follow escalation.md § 4a must-fix or § 4b defer as appropriate)
devteam validate   # confirm gate is no longer ESCALATE
devteam next       # confirm advance
```

The retry counter resets on the next stage-06 invocation — the `retry_number`
field is per-gate-file, not persistent across runs.

---

## 5. Stop and ask if any of these are true

Hold the resolution and surface upstream when:

- The escalation cites a **security veto** (stage-04b with `veto: true`). Don't override; the Security role must personally re-review the fix and flip `veto`.
- The escalation cites a **migration safety veto** (stage-04d with `veto: true`). Same — Migrations role re-reviews the fix.
- **Two reviewers disagree** and one wants the other's position blocked. Escalate to Principal for a binding ruling; don't pick a side yourself.
- The fix would require **rewriting an ADR or the design spec**. That's a new ADR, not a gate edit. See `roles/principal.md` § "On an ADR Task".

## 6. Common gotchas

- **The hook will overwrite manually-edited approvals.** For Stage 5, `approval-derivation.js` re-derives `approvals[]` and `changes_requested[]` from the review files on every `Write|Edit` event. Manually-set status, blockers, and warnings persist; the approval count does not. If a reviewer file changes after you set status to PASS manually, the hook recomputes. Document the final state in `context.md` to keep the audit trail unambiguous.

- **Bypassed escalation halts the pipeline globally.** If you write a *newer* gate with PASS without resolving an older ESCALATE, the validator's bypassed-escalation sweep catches it on the next run and halts with `BYPASSED ESCALATION`. Resolve oldest first.

- **`devteam restart` doesn't undo source-code changes.** It clears gate files and (by default) injected blocker sections. The actual code/test/spec edits the previous run made are still there — that's usually what you want, but if you need a code-level revert, that's `git` territory.

## 7. After resolution

Run `devteam next` and confirm the action is something other than `resolve-escalation`. If you're advancing past a stage whose gate you hand-edited (defer path), the audit trail will show the gate as PASS or WARN with a `warnings[]` entry — that's the record. The retrospective at Stage 9 will harvest deferrals and lessons.

## 7b. Two-round peer review exhaustion

When `pipeline/context.md` contains a `REVIEW-ESCALATED:` line for an area,
or the Stage 5 gate for that area shows two consecutive `changes_requested`
entries from the same reviewer, the orchestrator has hit the two-round cap and
must not invoke the dev a third time. This escalation is distinct from a
normal "reviewer disagrees" case — the process itself requires a binding ruling.

```bash
# Identify which area hit the cap
grep "REVIEW-ESCALATED:" pipeline/context.md

# Read both rounds of review for that area
cat pipeline/code-review/by-<reviewer>.md | grep -A 30 "## Review of <area>"

# Read the dev's PR for that area
cat pipeline/pr-<area>.md

# Read what the dev changed between round 1 and round 2
git log --oneline pipeline/pr-<area>.md
```

**The Principal gets four inputs:**
1. The reviewer's round-1 section (original BLOCKER)
2. The dev's PR showing what changed in response
3. The reviewer's round-2 section (renewed BLOCKER or updated complaint)
4. The acceptance criterion and design-spec section the BLOCKER references

Invoke the Principal:

```bash
devteam ruling \
  --topic "Two-round review exhaustion: <area> — <reviewer> renewed BLOCKER after dev addressed round 1" \
  --context pipeline/code-review/by-<reviewer>.md,pipeline/pr-<area>.md,pipeline/brief.md,pipeline/design-spec.md \
  --headless
```

**Three possible outcomes from the ruling:**

**Outcome A — BLOCKER is valid; dev must implement Principal's ruling.**
The Principal specifies exactly what must change. Clear the area's build gate
and re-run with the ruling as the constraint:

```bash
devteam stage build --patch --from stage-05.<area> --workstream <area> --headless
devteam merge build
devteam stage pre-review --headless
devteam stage peer-review --headless   # reviewer sees the ruling-driven change
```

**Outcome B — BLOCKER is not valid; reviewer must approve.**
The Principal rules the reviewer's interpretation is wrong. The reviewer
updates their review file section to `REVIEW: APPROVED`, then:

```bash
devteam derive-approvals pipeline/code-review/by-<reviewer>.md
devteam merge peer-review
devteam next   # should advance past Stage 5
```

**Outcome C — Fundamental disagreement; pipeline explicitly FAILs.**
The Principal finds neither side is clearly right and the feature should not
proceed as designed. The gate is written with `status: "FAIL"` and a `PRINCIPAL-RULING:`
entry in `pipeline/context.md` naming the design change needed. This requires
a return to Stage 2 (design) with a new ADR for the disputed decision — not a
build patch.

```bash
devteam stage design --headless   # Principal re-opens design with new ADR scope
# Then full build re-run from Stage 4
```

---

## See also

- `rules/escalation.md` — the protocol spec (what fields go where, when to escalate vs FAIL)
- `docs/faq.md` § "When do I write `status: ESCALATE`?" — common scenarios
- `docs/user-guide.md` § `devteam next says resolve-escalation` — the one-paragraph version
- `core/hooks/approval-derivation.js` — how Stage 5 gates derive from review files
- [`fix-and-retry.md`](fix-and-retry.md) — for FAIL (not ESCALATE) cases: red-team, QA, pre-review, peer-review, PM sign-off, deploy
- [`deploy-failure.md`](deploy-failure.md) — Stage 8 failure: diagnose, investigate, and rollback procedures
