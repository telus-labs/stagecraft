# Evidence Readiness

`devteam evidence status` reports how much local operational evidence exists for the
capabilities intentionally gated in GitHub #142–#145. It is an offline, read-only
inspection command. It does not enable a capability, change routing, learn recipes,
create grants, terminate stalled processes, export data, or make network requests.

```bash
devteam evidence status
devteam evidence status --json
devteam evidence status --feature "checkout retry"  # bounded isolation
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
| `routing` | current/archived gate observations grouped by role, host, and model |
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

Two unavailable signals are intentionally loud:

- **D5 durable dispatch history.** Current gates are a snapshot, and existing run logs
  do not retain per-workstream host/model/cost records for every successful dispatch.
  Gate observations are reported, but not misrepresented as durable history.
- **H3 accepted resolutions.** Existing logs show automated fix/retry outcomes but do
  not prove that a human accepted a learned resolution. The report does not infer
  acceptance from a later PASS.

Phase 16.3 adds the separately consented, aggregate-only export and multi-bundle
portfolio analysis defined in
[`plans/phase-16-evidence-readiness-and-export.md`](../plans/phase-16-evidence-readiness-and-export.md).
Until then, `evidence status` never writes evidence files.
