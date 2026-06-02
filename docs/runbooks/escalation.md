# Runbook: Handling an Escalation

You just ran a stage and `devteam next` reports `resolve-escalation`. This runbook walks through what to read, what to decide, and how to encode the decision so the pipeline can move on. Read top to bottom; it's a procedure, not a reference.

For the why-this-mechanism-exists framing, see `rules/escalation.md`. For specific scenarios (security veto, migration veto, two reviewers disagree), see `docs/faq.md` § "When do I write `status: ESCALATE`?".

## 0. What you're looking at

ESCALATE is the protocol firing when something only a human can decide — not a model bug. The pipeline is doing its job by stopping. The agent that wrote ESCALATE is telling you: "I have a specific question I can't answer without you."

The pipeline halts here on purpose. `devteam next` will keep saying `resolve-escalation` until you act.

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

**Shape A — must-fix.** The escalation surfaces a real defect; the right call is to fix it before moving on. Examples: a security finding with a working exploit, a wrong error class that ships a lie to ops dashboards, a migration rollback that doesn't actually roll back. Cost: re-run build (and any later stages that re-run after build).

**Shape B — defer.** The escalation is real but not load-bearing for this release; the right call is to record it as a follow-up and proceed. Examples: an observability gap at a layer that's hard to instrument cleanly, a doc drift that doesn't affect users, a `PATTERN:` worth promoting later. Cost: a ticket and a one-line note in `context.md`.

If you can't tell which shape it is, the question to ask is: **"If I deferred this and we shipped, what's the worst that happens?"** If the answer is "an observability blind spot we'll fix on the next pass," defer. If it's "a customer gets a wrong error message and we don't see it," fix.

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
  --topic "F-12 must-fix vs defer (TypeError mis-classification at server.js:46)" \
  --context pipeline/red-team-report.md,pipeline/code-review/by-platform.md \
  --target-gate pipeline/gates/stage-05.json \
  --headless
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

The `PRINCIPAL-RULING:` prefix is the convention; nothing parses it today, but reviewers and the next reader can grep for it.

## 4. Encode the decision

### 4a. Must-fix path

```bash
# Clear the escalation-time gates so the stage can re-run cleanly.
devteam restart <stage>            # e.g. devteam restart peer-review
# If the fix is in an EARLIER stage (e.g. peer-review escalated
# because of a build defect), restart the earlier stage with cascade:
devteam restart build --cascade

# Or for build specifically, use the scoped --patch flow that targets
# only the cited blockers without rebuilding everything:
devteam stage build --patch --from peer-review --headless
```

After the fix lands and the originating stage re-PASSes:

```bash
devteam stage pre-review --headless    # if you went all the way back
devteam stage peer-review --headless   # re-run the stage that escalated
devteam next                           # confirms the new state
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

## 5. Stop and ask if any of these are true

Hold the resolution and surface upstream when:

- The escalation cites a **security veto** (stage-04b with `veto: true`). Don't override; the Security role must personally re-review the fix and flip `veto`.
- The escalation cites a **migration safety veto** (stage-04d with `veto: true`). Same — Migrations role re-reviews the fix.
- **Two reviewers disagree** and one wants the other's position blocked. Escalate to Principal for a binding ruling; don't pick a side yourself.
- The fix would require **rewriting an ADR or the design spec**. That's a new ADR, not a gate edit. See `roles/principal.md` § "On an ADR Task".

## 6. Common gotchas

- **The hook will overwrite manually-edited approvals.** For Stage 5 specifically, `approval-derivation.js` re-derives `approvals[]` and `changes_requested[]` from the review files on every `Write|Edit` event. Your manually-set status, blockers, and warnings persist; the approval count doesn't. If you set status to PASS manually, save it — but if a reviewer file then changes, the hook will recompute. Document the final state in `context.md` so the audit trail isn't ambiguous.

- **Bypassed escalation halts the pipeline globally.** If you write a *newer* gate with PASS without resolving an older ESCALATE, the validator's bypassed-escalation sweep catches it on the next run and halts with `BYPASSED ESCALATION`. Resolve oldest first.

- **`devteam restart` doesn't undo source-code changes.** It clears gate files and (by default) injected blocker sections. The actual code/test/spec edits the previous run made are still there — that's usually what you want, but if you need a code-level revert, that's `git` territory.

## 7. After resolution

Run `devteam next` and confirm the action is something other than `resolve-escalation`. If you're advancing past a stage whose gate you hand-edited (defer path), the audit trail will show the gate as PASS or WARN with a `warnings[]` entry — that's the record. The retrospective at Stage 9 will harvest deferrals and lessons.

## See also

- `rules/escalation.md` — the protocol spec (what fields go where, when to escalate vs FAIL)
- `docs/faq.md` § "When do I write `status: ESCALATE`?" — common scenarios
- `docs/user-guide.md` § `devteam next says resolve-escalation` — the one-paragraph version
- `core/hooks/approval-derivation.js` — how Stage 5 gates derive from review files
