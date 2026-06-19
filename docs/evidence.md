# Evidence Readiness

The `devteam evidence` commands measure operational evidence for the capabilities
intentionally gated in GitHub #142–#145. All analysis is offline. They do not enable a
capability, change routing, learn recipes, create grants, terminate stalled processes,
or make network requests.

```bash
devteam evidence status
devteam evidence status --json
devteam evidence status --feature "checkout retry"  # bounded isolation
```

Local status is read-only. Cross-project status reads only bundle files named by the
operator:

```bash
devteam evidence status --bundle project-a.json --bundle project-b.json
devteam evidence status --json --bundle project-a.json --bundle project-b.json
```

## What it reads

The command reads only the selected pipeline root's `run-log.jsonl`, current gate JSON,
and `gates/archive/*.json`. Inputs are bounded by file count, file size, and log-line
size. Symlinks are rejected. Malformed, oversized, unreadable, and truncated inputs are
counted in `quality` instead of crashing the command or silently disappearing.

It does not read source files, prompts, artifacts, host transcripts, Git metadata,
repository remotes, operator identity, or `.devteam/config.yml` values beyond the
isolation mode needed to select the pipeline root.

## What it reports

The JSON output has `schema_version: "1.0"` and contains aggregate sections:

| Section | Meaning |
|---|---|
| `scope` | observed run, completion, and repair-run counts |
| `quality` | missing or degraded source counters |
| `routing` | durable dispatch observations, or legacy gate snapshots when no durable history exists, grouped by role, host, and model |
| `recovery` | fix/retry and convergence counts grouped by stage and failure class |
| `rulings` | auto-applied ruling counts by grant class |
| `stalls` | observed stalls grouped by stage and stall class |
| `readiness` | local conditions and explicit cross-project limitations for each gated capability |

Free-form reasons, blockers, warnings, questions, rulings, paths, timestamps, feature
text, and model output are never copied into the report. Invalid category strings are
collapsed to `other`.

## Reading readiness honestly

Every capability remains `not-ready` until its documented evidence conditions are met
and reviewed by a human. `portfolio_status: "not-assessable"` means the condition needs
multiple independently exported projects; one project cannot satisfy it locally.

Two signals require special care:

- **D5 durable dispatch history.** Runs made after Phase 17 record one allowlisted
  `dispatch-observation` per non-skipped workstream. If those events exist, routing
  aggregates use them exclusively. Older projects still show gate snapshots, but
  those snapshots cannot satisfy the durable-history condition and are never mixed
  with the new events. Historical dispatches are not reconstructed.
- **H3 accepted resolutions.** Existing logs show automated fix/retry outcomes but do
  not prove that a human accepted a learned resolution. The report does not infer
  acceptance from a later PASS.

The durable event contains only stage, role, host, model, gate status, gate-written and
timeout booleans, and optional non-negative cost/duration values. It excludes blockers,
warnings, reasons, prompts, responses, paths, transcripts, feature text, credentials,
and repository identity. Invalid or secret-shaped categories collapse to `other` when
the event is recorded and are checked again at analysis time.

## Collecting real evidence

No special collection mode is required after Phase 17. Run autonomous pipelines
normally, keep the ignored pipeline state, and inspect progress locally:

```bash
devteam run --feature "..." --budget-usd 10
devteam evidence status
devteam evidence status --json
```

For D5, use at least two independent projects and route the same role through at least
two hosts. Each compared `(role, host)` needs five durable observations, and written
gates need cost telemetry. When the local conditions have useful volume, create a new
consented bundle from each project and assess them together. A threshold result still
requires human review and never changes routing automatically.

Portfolio status validates each strict v1 schema and payload digest. Exact duplicate
bundles are ignored. Different bundles with the same `project_ref` are rejected rather
than combined. A met threshold means human review is required; it is never an approval.

## Exporting a bundle

Export is a separate, explicit operation:

```bash
devteam evidence export --out ./stagecraft-evidence.json --consent
```

The destination parent must already exist and must not be a symlink. The destination
must be a new file; export never overwrites. `--consent` acknowledges the documented
field set and the stable pseudonymous project reference. There is no stdout export,
upload, automatic discovery, or background collection.

The v1 bundle contains fixed aggregate fields only: versions, a date, project scope,
quality counters, dense routing/recovery/ruling/stall rows, readiness conditions, a
suppression count, and a canonical payload digest. Rows with fewer than three
observations are omitted. The strict schema is
[`core/evidence/schemas/evidence-export.schema.json`](../core/evidence/schemas/evidence-export.schema.json);
unknown properties and secret-shaped category values are rejected.

Inspect the JSON before sharing it. The bundle intentionally permits correlation of
exports from the same project, and unusual host/model combinations may still be
commercially sensitive. Retention, sharing, and deletion of exported files remain the
operator's responsibility.

## Project identity

The first export creates `.devteam/evidence-project-id`, covered by Stagecraft's managed
`.gitignore` block and mode `0600` where supported. It contains 128 random bits; the raw
value is never printed or exported. The exported `project_ref` is a domain-separated
SHA-256 reference.

```bash
devteam evidence identity --json
devteam evidence identity --rotate --yes
devteam evidence identity --delete --yes
```

Rotation makes future exports unlinkable from earlier ones. Deletion prevents reuse but
cannot revoke bundles already shared. Identity status never creates the file.
