# Stage advisory — `devteam advise`

Stagecraft tracks `noted_for_followup[]` items written by stage agents (primarily the QA
workstream at stage-04 and the red-team at stage-04c).  After any stage completes, you can ask
Stagecraft to classify these items' downstream risk and apply a decision.

## When it fires

- `devteam next` shows a one-line warning on stderr when unresolved BLOCKER-risk items exist.
- `devteam advise` shows the full panel with options at any time.

The warning from `devteam next` is advisory only — it never prevents advancing.

When a stage is actively failing (gate status FAIL), `devteam advise` shows that blocker at the
top of its output before the follow-up items panel:

```
❌ Active pipeline blocker: fix-and-retry — red-team (stage-04c)
   stage failed; address blockers and rewrite the gate
   Run `devteam next` for the full fix steps.
```

This is separate from `noted_for_followup` items — it reflects a gate-level failure that must be
resolved before the pipeline can advance.

When all `noted_for_followup` items are addressed, `devteam advise` prints:

```
All noted_for_followup items addressed.
```

and exits 0.

## Option types

| Option | Action | What gets written to context.md |
|---|---|---|
| `fix` | **Dispatches** the frontend agent headlessly to apply the HTML fix now, then re-runs the accessibility audit to verify | `NOTED: <item-id> — … — stage manager: fix-applied-and-verified` (or `fix-attempted` / `fix-dispatch-failed` on partial or total failure) |
| `scaffold` | Prints the command to run (`devteam stage build --workstream qa --patch`) and writes a pending marker — **does not dispatch automatically; you must run the printed command** | `SCAFFOLD-PENDING: <ac-refs> — <summary>` |
| `defer` | Acknowledge deferral with a ticket reference | `DEFERRED: <ac-refs> — <summary> — ticket <ID>` |
| `amend` | Flag for PM to scope-down or remove the AC | `BRIEF-AMEND-NEEDED: <ac-refs> — stage manager: scope-down or remove` |
| `nothing` | Record that no action was taken | `NOTED: <item-id> — <summary> — stage manager: no action` |
| `known-flaky` | Mark a test as expected-flaky for QA | `KNOWN-FLAKY: <item-id> — <summary>` |
| `wontfix` | Explicitly remove from delivery scope | `WONTFIX: <ac-refs> — <summary>` |
| `fix-now` | Record intent to fix before advancing | `NOTED: <item-id> — <summary> — stage manager: fix-now` |

`fix` is only offered for `A11Y_FIX` items (see risk classifications below).  `scaffold` is offered
for `QA_BLOCKER` items.  All other options are available across classifications.

## Risk classifications

| Classification | Meaning | Typical source |
|---|---|---|
| `A11Y_FIX` | Item from the accessibility audit gate (stage-06b) when the gate is FAIL — HTML remediation required before the pipeline can advance | Accessibility audit (stage-06b) |
| `QA_BLOCKER` | Item references an AC that has no `@AC-N` scenario in `spec.feature` — QA will fail | Build QA workstream |
| `PEER_REVIEW_RISK` | No AC ref, but severity is `high` or `critical` — likely to surface as CHANGES_REQUESTED | Red-team (stage-04c) |
| `QA_NOISE` | Timing/flakiness keywords; not a hard coverage gap | Any workstream |
| `INFO` | No risk signal detected; informational only | Any workstream |

`A11Y_FIX` items are gate-aware: if the accessibility audit re-runs and the gate becomes PASS,
any remaining `noted_for_followup` items from that gate are reclassified as `INFO` — they are
moderate or minor findings, not pipeline blockers.

## Usage

```bash
# Show advisory panel
devteam advise

# Apply selections: AC-11 → scaffold, AC-10 → defer with ticket, AC-12 → nothing
devteam advise --apply AC-11=A,AC-10=B:PROJ-123,AC-12=A

# Machine-readable output
devteam advise --json

# Suppress the advisory warning in devteam next (CI/unattended runs)
devteam next --skip-advise
```

**Option letters (A/B/C/D)** are shown in the panel for each item and are item-specific — the
same letter does not map to the same action across different risk classifications.  For a
`QA_BLOCKER` item `A` means `scaffold`; for an `A11Y_FIX` item `A` means `fix`; for an `INFO`
item `A` means `nothing`.  Always read the panel to confirm which letter maps to which action
before running `--apply`.

**Ticket ID syntax for `defer`:**  `<itemId>=B:<ticketId>` — the ticket ID is appended after
the option letter, separated by `:`.  If you omit it, `PLACEHOLDER` is written and you can
fill it in manually.

## How downstream stages see decisions

All decisions are written into the `<!-- devteam:advise:begin/end -->` section of
`pipeline/context.md`.  Re-running `devteam advise --apply` replaces this section atomically —
it is safe to run multiple times.

QA (stage-06) reads `DEFERRED: AC-N` entries and skips coverage checks for those ACs,
provided a ticket reference is present.  `KNOWN-FLAKY` entries cause QA to retry once before
counting a failure.  `BRIEF-AMEND-NEEDED` entries are picked up by the PM at the next stage
where PM reads context.md.

## Clearing all items

To acknowledge everything without action:
```bash
devteam advise --apply $(devteam advise --json | \
  jq -r '[.items[] | select(.addressed==false) | "\(.item.id)=D"] | join(",")')
```

Or pass the recommended options as printed in the apply hint at the bottom of `devteam advise`.
