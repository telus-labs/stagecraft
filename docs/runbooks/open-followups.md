# Runbook: Open Followups — Extracting Ticket Content

After a pipeline run completes, deferred work items are collected in `open_followups[]` in both the stage-07 PM sign-off gate and the stage-09 retrospective gate. This runbook shows how to extract that content as ticket-ready stubs without a JIRA integration.

For the integration protocol when a JIRA (or Linear / GitHub Issues) connection is available, see [`escalation.md`](escalation.md) § External integrations.

---

## Which gate to read

| Gate | When available | Use when |
|------|---------------|----------|
| `pipeline/gates/stage-09.json` | After retrospective (Stage 9) completes | Preferred — retrospective may have resolved some items |
| `pipeline/gates/stage-07.json` | After PM sign-off (Stage 7) completes | Fallback when retrospective hasn't run yet |

Both gates carry `open_followups[]` in the same shape. The stage-09 list may be shorter: the Principal's Step 9a-followup triage can mark items resolved if they were addressed during the patch cycle.

---

## Step 1 — Check how many items need tickets

```bash
# From stage-09 (preferred)
jq '.open_followups | length' pipeline/gates/stage-09.json

# From stage-07 (fallback)
jq '.open_followups | length' pipeline/gates/stage-07.json
```

If the output is `0`, there are no deferred ticket items for this run.

---

## Step 2 — Print ticket stubs

This command reads `stage-09.json` and prints one markdown-formatted stub per
item. Paste each stub into your ticket system of choice.

```bash
jq -r '
  .open_followups[] |
  "---\n" +
  "**[\(.id)] \(.text | split(";")[0] | split(" —")[0] | rtrimstr(" "))**\n\n" +
  "Source:  \(.source) gate\n" +
  "File:    \(.file // "n/a")\n" +
  "Effort:  \(.effort // "?")\n\n" +
  "Description:\n  \(.text)\n"
' pipeline/gates/stage-09.json
```

To read from stage-07 instead, replace the filename at the end.

### Example output

For a run with two deferred items from the red-team gate:

```
---
**[RT-06] --cloudtrail-days 0 silently falls back to 90 due to falsy guard**

Source:  stage-04c gate
File:    src/cli.js:127
Effort:  XS

Description:
  --cloudtrail-days 0 silently falls back to 90 due to falsy guard; user intent is ignored with no warning emitted.

---
**[RT-08] No retry logic for transient AWS errors**

Source:  stage-04c gate
File:    src/backend/collectors/aws-cloudtrail.js
Effort:  S

Description:
  No retry logic for transient AWS errors; design-spec §9 requires exponential backoff, max 3 attempts.
```

---

## Step 3 — Field mapping to common ticket systems

| `open_followups` field | JIRA | Linear | GitHub Issues |
|------------------------|------|--------|---------------|
| `id` + first clause of `text` | Summary | Title | Title |
| `text` (full) | Description | Description | Body |
| `source` | Label: `red-team` or `qa` | Label | Label |
| `file` | Description → "Affected file:" line | Description | Body |
| `effort` | Story Points proxy: XS=1, S=2, M=3, L=5, XL=8 | Estimate | — |
| `effort` → priority | XS/S → Low, M → Medium, L/XL → High | Priority | Priority label |

---

## TSV output for scripting

If you want to pipe the data into a script rather than read prose stubs:

```bash
jq -r '.open_followups[] | [.id, .source, (.effort // "?"), (.file // "n/a"), .text] | @tsv' \
  pipeline/gates/stage-09.json
```

One line per item, tab-separated: `id`, `source`, `effort`, `file`, `text`.

---

## Linking tickets back to the gate

When you create a ticket, record its ID in `pipeline/context.md` under
`## Open Followup Tickets` so future runs can reference it:

```markdown
## Open Followup Tickets

| Gate ID | Ticket | Summary |
|---------|--------|---------|
| RT-06 | PROJ-1042 | --cloudtrail-days 0 falsy fallback |
| RT-08 | PROJ-1043 | AWS retry backoff missing |
```

This is the manual equivalent of what a JIRA integration performs automatically.

---

## Production feedback (G3 contract)

Open followups cover work deferred **before** deploy. For signals that only
become visible **after** deploy — SLO regressions, incidents, adoption gaps —
use the production feedback file:

1. Copy `templates/production-feedback-template.md` → `pipeline/production-feedback.md`
2. Fill in the SLO/metric delta table, incidents list, and any retrospective notes
3. Stage 9 reads it on the next `devteam stage retrospective` run and adds a
   `## Production Deltas` section to `pipeline/retrospective.md`

`devteam next` mentions this file once (as an optional follow-up) when the
pipeline is complete and the file is absent.

See `docs/conventions.md` § `pipeline/production-feedback.md` for the full protocol.

---

## What about non-ticket followups?

`noted_for_followup` items with `track_for` values other than `"ticket"` are
routed differently and don't appear in `open_followups[]`:

| `track_for` | Where it lands |
|-------------|---------------|
| `lessons-learned` | Retrospective Step 9b synthesis — competes for promotion to `pipeline/lessons-learned.md` |
| `adr-amendment` | `pipeline/retrospective.md` under `## ADR Amendments Needed` |
| `brief-amendment` | `pipeline/retrospective.md` under `## Brief Amendments for Next Run` |
| `deploy-note` | `pipeline/context.md` under `## Deploy Notes` |

To see all followup items regardless of `track_for`, read the source gates
directly:

```bash
# All noted_for_followup items from red-team
jq '.noted_for_followup[]' pipeline/gates/stage-04c.json

# All noted_for_followup items from QA
jq '.noted_for_followup[]' pipeline/gates/stage-04.qa.json
jq '.noted_for_followup[]' pipeline/gates/stage-06.json
```
