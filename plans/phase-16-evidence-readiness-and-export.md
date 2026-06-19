# Phase 16 — Evidence Readiness and Privacy-Safe Export

**Status:** Complete. PR 16.1 privacy/schema review merged as PR #246; PR 16.2
implements local evidence readiness; PR 16.3 implements opt-in export and portfolio
analysis.
**Roadmap item:** Audit P3-1 / Proposal 4.1.
**Purpose:** make the evidence thresholds for GitHub #142–#145 measurable without
turning Stagecraft's local audit trail into a telemetry product.

---

## 1. Decision summary

Stagecraft will add two related but deliberately separate capabilities:

1. `devteam evidence status` computes the current project's contribution locally
   from existing gates, archives, and `run-log.jsonl`. It emits counts and unmet
   conditions; it never writes or transmits evidence. Cross-project conditions are
   reported as unassessable unless the operator explicitly supplies redacted bundles.
2. `devteam evidence export` creates an explicitly requested JSON bundle containing
   typed aggregates only. It never includes raw records, source, prompts, artifacts,
   free-form model text, repository metadata, or credentials.

There is no network transport in Phase 16. Export means writing a local file selected
by the operator. Upload, collection, automatic submission, background telemetry, and
cross-project discovery are permanent non-goals unless a later ADR changes the trust
model.

The implementation was split into three reviewable slices, with the privacy model
approved before runtime behavior was added.

---

## 2. Evidence questions

The feature exists only to answer the current capability gates:

| Gate | Evidence needed | Safe aggregate |
|---|---|---|
| H3 recipe suggestions (#142) | repeated fix-and-retry classes across independent runs/projects; accepted resolution signal | counts by stage, failure class, outcome, and project; no blocker or recipe text |
| D5 adaptive routing (#143) | comparative dispatch volume, pass rate, duration, and cost by role/host | counts and numeric totals by role/host/model; no prompt, response, or feature text |
| Standing grants (#144) | consequence-ceiling halts and operator-approved classes | counts by ruling class and outcome; no ruling question or decision text |
| Active stall response (#145) | observed stall frequency and classification | counts by stage, host, and stall class; no transcript or command line |

The status command reports whether each gate's documented threshold is met. It does
not decide that a capability is safe, alter routing, learn recipes, create grants, or
activate stall termination.

---

## 3. Data inventory and classification

### 3.1 Raw local sources

| Source | Useful fields | Sensitive or excluded fields | Classification |
|---|---|---|---|
| `pipeline/run-log.jsonl` | event/outcome, stage, role/workstream, host, failure/stall/ruling class, numeric duration/cost | reasons, blockers, fix steps, questions, rulings, targets, paths, archive names, feature/change identifiers, exact timestamps | confidential raw audit data |
| `pipeline/run-state.json` | counters and completed-stage/run boundaries | feature/symptom text, targeted-fix details, transient error text, filesystem state | confidential resumable state |
| `pipeline/gates/*.json` | stage, status, track, host, workstream, model, numeric telemetry | blockers, warnings, free-form stage fields, checks/output text, hashes that can correlate a prompt/tool set, exact timestamps | confidential model-authored records |
| `pipeline/gates/archive/` | attempt count, stage, status, retry number | complete historical gates, blocker text, diffs/reasons, archive filenames | highly sensitive historical audit data |
| `.devteam/config.yml` | none required for export beyond already-observed host/track values | deploy targets, commands, account/project names, routing policy | confidential operator configuration |
| Git/repository metadata | none | remote URL, repository name, branch, commit, author/email, file paths | excluded |
| host transcripts/logs | none | prompts, responses, source excerpts, command output, secrets | excluded |

Raw local sources remain untouched by Phase 16. Its evidence code is read-only except
for the local project identity file and an operator-selected export destination. Phase
18 later adds a separately confirmed, append-only resolution-acceptance event under
ADR-012.

### 3.2 Export allowlist

The exporter uses a closed allowlist. Unknown source fields are ignored, never copied.
The v1 bundle may contain only:

- schema and Stagecraft version;
- a pseudonymous project reference;
- coarse generation date (`YYYY-MM-DD`, UTC), not a timestamp;
- aggregate run counts and data-quality flags;
- categorical counts for stage, track, status, action, failure class, stall class,
  ruling class, role/workstream, host, and model identifier;
- numeric sums/counts for duration, tokens, and USD cost;
- threshold results and missing-evidence reason codes.

No free-form source value enters the bundle. Category values are accepted only when
they match Stagecraft's enumerations or installed adapter/model identifiers after
length and character validation. Unknown values collapse to `other`; they are not
echoed.

---

## 4. Threat model

### 4.1 Assets

- proprietary source and generated artifacts;
- prompts, model responses, blocker/warning prose, and human rulings;
- secrets appearing in command output or model-authored text;
- repository, organization, operator, customer, and feature identity;
- commercially sensitive model usage, cost, failure, and velocity data;
- the integrity of readiness conclusions.

### 4.2 Actors and trust boundaries

The local operator and local filesystem are trusted to the same degree as existing
Stagecraft audit files. Model-authored gate/log content is untrusted input. An export
recipient is not trusted with raw project data. The CLI process is the redaction and
aggregation boundary. There is no trusted Stagecraft server in this design.

### 4.3 Threats and controls

| Threat | Control | Residual risk |
|---|---|---|
| Secrets or source leak through free-form fields | aggregate from a field allowlist; never serialize raw objects; schema rejects additional properties | a secret deliberately used as an adapter/model identifier could survive unless category validation collapses it |
| Identity leak through repo names, paths, remotes, feature slugs, timestamps, or Git metadata | never read Git identity; exclude paths/change IDs; use date-only generation time | rare category combinations may fingerprint a small project |
| Cross-export tracking | random local 128-bit identity, exported only as a domain-separated SHA-256 project reference; documented rotation | stable reference intentionally permits correlation across exports until rotated |
| Accidental export | status is read-only; export requires an explicit subcommand, destination, and consent flag; no default destination and no network | shell history records the destination path |
| Symlink/path overwrite | require a new destination; use exclusive create; reject directories and symlinked parents; never follow or overwrite a destination symlink | an attacker controlling parent directories can still race local writes; document trusted-directory requirement |
| Log injection / malformed JSON / huge files | line-by-line bounded parsing, type checks, per-file byte ceiling, malformed/truncated counters | skipped records reduce completeness; readiness must report that degradation |
| Tampered evidence | include deterministic canonical-payload SHA-256 digest and source quality counters; optionally verify gate chains locally | digest detects accidental modification, not malicious regeneration by a local attacker |
| Re-identification from sparse aggregates | suppress dimensions with fewer than 3 observations in export; merge into `other`; status remains unsuppressed locally | aggregate totals and unusual host/model combinations can still be identifying |
| Misuse as capability approval | bundle carries readiness facts and threshold results, not an approval bit; docs require human review | recipients may still over-interpret threshold satisfaction |

### 4.4 Explicitly rejected designs

- **Raw redaction by regex.** Secret patterns are incomplete and free-form text can
  reveal sensitive facts without containing a credential. Aggregation is safer than
  trying to sanitize prose.
- **Automatic telemetry.** It changes the product trust model and creates collection,
  retention, deletion, and breach obligations unrelated to the current gate.
- **Repository-name hashing.** Low-entropy names are dictionary-reversible. Project
  identity must start as random entropy, not transformed metadata.
- **Exact event export.** Even without text, event ordering and timestamps can expose
  work cadence and make individuals or incidents identifiable.
- **A single status/export command.** Read-only local inspection must not be one flag
  away from producing a shareable artifact.

---

## 5. Project identity, consent, retention, and deletion

On first export, Stagecraft creates `.devteam/evidence-project-id` with 128 bits of
cryptographically random data and mode `0600` where the platform supports it. The raw
identifier never appears in output. The exported `project_ref` is:

```text
sha256("stagecraft-evidence-project-v1\0" + raw_project_id)
```

The file is local state and must be covered by Stagecraft's managed `.gitignore` rules.
`devteam evidence identity --rotate` replaces it after confirmation; future bundles
cannot be correlated with old ones. `devteam evidence identity --delete` removes it.
Deletion does not revoke bundles already shared.

Export requires all of:

```text
devteam evidence export --out <new-file.json> --consent
```

`--consent` means the operator has reviewed the documented field set and accepts the
intentional correlation provided by `project_ref`. JSON stdout is not an export target;
this avoids accidental piping or terminal capture. Bundles have no automatic retention
or upload. The CLI prints a post-write reminder that the file is operator-owned and can
be deleted normally.

---

## 6. Bundle contract (v1)

The implementation PR will add a JSON Schema with `additionalProperties: false` at
every object boundary. The conceptual top-level shape is:

```json
{
  "schema_version": "1.0",
  "stagecraft_version": "0.7.0",
  "generated_date": "2026-06-18",
  "project_ref": "sha256:<64 lowercase hex chars>",
  "scope": {
    "project_count": 1,
    "run_count": 12,
    "complete_run_count": 10
  },
  "quality": {
    "malformed_records": 0,
    "truncated_sources": 0,
    "chain_failures": 0,
    "cost_coverage_dispatches": 8
  },
  "routing": [],
  "recovery": [],
  "rulings": [],
  "stalls": [],
  "readiness": [],
  "suppressed_observations": 0,
  "payload_sha256": "sha256:<digest of canonical payload without this field>"
}
```

Rows use fixed keys and numeric aggregates. Export rows with `observations < 3` are
suppressed or merged into `other`. Local status uses the unsuppressed counts because it
does not cross the filesystem trust boundary.

The v1 schema is additive only within the `1.x` line. Consumers must reject an unknown
major version and ignore no fields: schema validation is strict so a producer cannot
quietly widen the privacy surface.

---

## 7. Command contracts

### 7.1 `devteam evidence status`

- read-only and offline;
- supports in-place and bounded change roots via existing path helpers;
- default project mode lists each gate's local contribution, local threshold progress,
  data-quality warnings, and `portfolio_status: not-assessable` wherever the gate
  requires multiple projects;
- portfolio mode accepts explicit repeated `--bundle <file.json>` inputs, validates
  their schema/digests, de-duplicates `project_ref`, and evaluates cross-project
  thresholds using aggregates only; it never discovers projects or raw data;
- `--json` returns a documented stable shape containing aggregates, never raw records;
- exits 0 when analysis completed, regardless of readiness; exits 1 only for an
  analysis error. Readiness is data, not process success.

### 7.2 `devteam evidence export`

- requires `--out` and `--consent`;
- writes one schema-valid JSON document using exclusive-create semantics;
- never overwrites; the operator must select a new destination;
- never sends network requests and never reads host transcripts or source files;
- records suppressed and malformed counts so privacy/quality tradeoffs stay visible;
- exits non-zero without writing if identity creation, source analysis, schema
  validation, canonical digesting, or destination checks fail.

### 7.3 `devteam evidence identity`

- reports whether an identity exists, never its raw value;
- rotation and deletion are explicit actions;
- `--json` may return only `{ "exists": boolean, "project_ref": string|null }`.

---

## 8. Implementation sequence

### PR 16.1 — Privacy model and bundle contract

- approve data inventory, threat model, identity design, consent boundary, suppression
  threshold, bundle contract, and command semantics;
- no runtime behavior or data collection changes;
- update current roadmap/backlog pointers.

**Complete:** merged as PR #246.

### PR 16.2 — Local evidence readiness

- add a pure evidence analyzer over injected records plus bounded streaming readers;
- add `devteam evidence status` and help/reference documentation;
- derive thresholds from the current #142–#145 evidence plans, with reason codes;
- distinguish locally measurable conditions from cross-project conditions that cannot
  be decided from one project;
- include malformed, oversized, incomplete, and bounded-isolation fixtures;
- prove the command is read-only by snapshotting the target tree before/after tests.

**Complete.** The analyzer reports unavailable durable-routing
and accepted-resolution signals explicitly rather than deriving them from snapshots.

### PR 16.3 — Opt-in aggregate export

- add project identity lifecycle and managed-ignore entry;
- add strict v1 JSON Schema, canonical digest, suppression, consent, and safe write;
- add explicit multi-bundle portfolio status with schema/digest validation and
  `project_ref` de-duplication;
- add hostile fixtures with secrets in every free-form source field and assert none
  appear in serialized output;
- add symlink/existing-file tests on supported platforms;
- document inspection, sharing, rotation, retention, and deletion.

No later capability in #142–#145 is implemented by these PRs. After real projects use
the status/export loop, the existing evidence reviews are repeated and their human
owners decide whether each gate opens.

---

## 9. Verification and acceptance

Phase 16 is complete only when:

1. two external project fixtures can calculate all four readiness reports without
   manual gate/log archaeology;
2. an exported bundle contains no source, prompts, secrets, personal text, paths,
   exact timestamps, repository identifiers, or raw gate/log records;
3. hostile values in every excluded source field are absent byte-for-byte from output;
4. status produces no filesystem changes;
5. export produces no network activity and no file without explicit consent;
6. rotation makes future `project_ref` values unlinkable to prior ones;
7. malformed/truncated input lowers reported evidence quality rather than silently
   disappearing;
8. lint, consistency, and the full CI-shaped suite pass on Linux, macOS, and the
   existing Windows smoke surface.

## 10. Approved implementation decisions

1. Cross-export correlation uses a stable, rotatable random project identity.
2. The minimum exported dimensional cell size is 3.
3. Validated model identifiers are included; malformed or secret-shaped values collapse
   locally to `other` and are rejected at the bundle boundary.
4. Export always requires a new destination. There is no `--force` in v1.
