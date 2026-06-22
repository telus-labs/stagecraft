# Pipeline Conventions

The pipeline uses a small vocabulary of **markers**: short prefixes and section headings that agents use to communicate across stages. Most markers are documented inside agent prompts; this page is the stage-manager-facing catalogue for when you encounter something like `QUESTION: ... @PM` or `BLOCKER:` in a `pipeline/*.md` file.

Each entry covers: where the marker lives, who writes it, its format, and what reads it.

- [Inline line markers](#inline-line-markers)
- [Section markers (in `pipeline/context.md`)](#section-markers-in-pipelinecontextmd)
- [Auto-injected sections (validator-managed)](#auto-injected-sections-validator-managed)
- [Section markers (in `pipeline/pr-<area>.md`)](#section-markers-in-pipelinepr-areamd)
- [Auto-captured stage transcripts (`pipeline/logs/`)](#auto-captured-stage-transcripts-pipelinelogs)
- [Magic comments (in source code)](#magic-comments-in-source-code)
- [Cheat sheet](#cheat-sheet)
- [See also](#see-also)

## Inline line markers

These appear on their own line, with lowercase content after the colon. Most can appear in `pipeline/context.md` or in stage-specific files; the table notes where.

### `QUESTION: <text> @<role>`

A question that needs a human decision. Common during requirements, design, and clarification.

- **Where:** `pipeline/context.md` (canonical). Also propagated into `pipeline/brief.md`'s § *Open Questions*. Edit context.md; leave brief.md alone.
- **Written by:** PM (most common), Principal (during design), any dev (mid-build).
- **Format:** `QUESTION: <text>` with `@PM` or `@PRINCIPAL` etc. naming who must answer.
- **Read by:** Stage 3 (clarification) checks for any `QUESTION:` not followed by `PM-ANSWER:`; if any exist, invokes PM. The orchestrator's startup check (`rules/orchestrator.md`) halts the pipeline if questions exist at advance time.

### `PM-ANSWER: <text>`

The answer to a `QUESTION:`. Written directly below the question.

- **Where:** `pipeline/context.md`, on the line right after the `QUESTION:` it answers.
- **Written by:** **You** (the human stage manager), or the PM agent during Stage 3 clarification.
- **Format:** `PM-ANSWER: <text>`. Multi-line is fine; readers consume everything between this line and the next blank line or marker.
- **Read by:** Devs at Stage 4 build (they trace every changed hunk to brief / design-spec / a `PM-ANSWER:`).

**Worked example.** See [`user-guide.md` § Answering an open question between stages](user-guide.md#answering-an-open-question-between-stages).

### `CONCERN: <text>`

A cross-boundary edit that the dev wants to flag before making it. Coding-principles §3 (Surgical Changes).

- **Where:** `pipeline/context.md`.
- **Written by:** Devs before touching a file outside their owned area (e.g. backend dev needing to edit `src/frontend/`).
- **Format:** `CONCERN: <description of the cross-boundary need>`. Should include why the edit is necessary and what alternative was rejected.
- **Read by:** Reviewers at Stage 5 (a missed `CONCERN:` for a cross-boundary edit is a BLOCKER per the rubric).

### `BLOCKER: <text>` / `SUGGESTION: <text>` / `PATTERN: <text>`

Reviewer findings, classified by severity.

- **Where:** `pipeline/code-review/by-<reviewer>.md` files, inside per-area `## Review of <area>` sections.
- **Written by:** Stage 5 reviewers.
- **Format:**
  - `BLOCKER: <text>` — must be fixed before approval. Cite line, file, principle.
  - `SUGGESTION: <text>` — improvement worth doing; not a blocker.
  - `PATTERN: <text>` — pattern worth promoting (good *or* bad). Principal harvests these at Stage 9 retro.
- **Read by:** The implementing dev (must address `BLOCKER:` entries before re-review). `approval-derivation.js` parses these to write per-area Stage 5 gates.

### `REVIEW: APPROVED` / `REVIEW: CHANGES REQUESTED`

The reviewer's verdict for an area, one per `## Review of <area>` section.

- **Where:** `pipeline/code-review/by-<reviewer>.md`, at the end of each area section.
- **Written by:** Stage 5 reviewers.
- **Format:** Literal text. Exactly one per area section.
- **Read by:** `core/hooks/approval-derivation.js` parses each section's `REVIEW:` marker and writes the corresponding per-area workstream gate. Do not write the gate directly; the hook does it.

### `ESCALATE: <text>` (inline override)

When a reviewer or agent wants the merged gate to land as `ESCALATE` regardless of what the approval-derivation hook would otherwise derive. Used when something needs a Principal ruling.

- **Where:** `pipeline/code-review/by-<reviewer>.md` (Stage 5) or any review/report file.
- **Written by:** The escalating agent.
- **Format:** `ESCALATE: <one-sentence reason>` followed by `ESCALATE-TO: <role>` if a specific role should rule (typically Principal).
- **Read by:** The stage manager notices the inline marker and resolves it via the [escalation runbook](runbooks/escalation.md). Note: the approval-derivation hook does not currently auto-flip the gate status based on this marker; the stage manager (or reviewer) sets `status: ESCALATE` directly in the gate.

### `REVIEW-ESCALATED: <text>`

Same shape as `ESCALATE:` but specifically after two review rounds with persistent CHANGES_REQUESTED. The Principal must rule.

- **Where:** `pipeline/context.md`.
- **Written by:** Reviewers after Round 2 fails the same way as Round 1.
- **Format:** `REVIEW-ESCALATED: <area> after 2 rounds — principal ruling requested`.
- **Read by:** You (read the [escalation runbook](runbooks/escalation.md) and route to Principal via `devteam ruling`).

### `PRINCIPAL-RULING: <topic> → <decision>`

A Principal's binding answer to a question / escalation that needed Principal-level judgment.

- **Where:** `pipeline/context.md`, under a `## Principal Rulings` section (create the section if it doesn't exist).
- **Written by:** Principal subagent (often dispatched via `devteam ruling`), or you directly.
- **Format:** `PRINCIPAL-RULING: <topic> → <one-line decision>` followed by a one-paragraph rationale.
- **Read by:** Devs and reviewers reading context.md before/during their work. The orchestrator does not parse this today; it's a human-readable artifact.

## Section markers (in `pipeline/context.md`)

These are full `## Heading` sections, not single lines.

### `## Open Questions`

Where `QUESTION:` lines collect. The brief template also has this section in `pipeline/brief.md`, but answers go in context.md, not brief.md.

### `## Brief Changes`

Amendments to the original brief that emerged during the run (e.g. an answer to a `QUESTION:` added a new acceptance criterion).

- **Written by:** PM (or you).
- **Format:** A bulleted list of changes; each bullet is a one-paragraph diff-style description. Reference the AC number being added/removed/modified.
- **Read by:** Devs at every later stage. `pipeline/brief.md` stays as the original intent; `## Brief Changes` accumulates the deltas. The retrospective harvests these for "the spec moved during the run" lessons.

### `## Assumptions`

Non-obvious choices a dev made when implementing.

- **Written by:** Each implementing dev (Stage 4), per coding-principles §1.
- **Format:** Bulleted list; each bullet states the assumption + why the conservative alternative was chosen.
- **Read by:** Reviewers at Stage 5 (an assumption that contradicts brief/spec without a `CONCERN:` is a BLOCKER).

### `## Principal Rulings`

Collects `PRINCIPAL-RULING:` lines. Created automatically by `devteam ruling --headless`.

### `## Deferred follow-ups`

Items consciously deferred during escalation resolution. See [escalation runbook](runbooks/escalation.md) § 4b.

- **Written by:** You, when you defer an escalation rather than fix-now.
- **Format:** Bulleted list; each entry names the item, why it was deferred, and a ticket reference.
- **Read by:** Stage 9 retrospective. Surfaced in the retro doc so the pattern of deferrals is visible across runs.

## Advisory decision markers (devteam advise — managed)

Written into the `<!-- devteam:advise:begin/end -->` section of `pipeline/context.md` by
`devteam advise --apply`.  The entire section is replaced atomically on each apply — do not
hand-edit.  See [`rules/advise.md`](../rules/advise.md) for full option semantics.

| Marker | Format | Meaning |
|---|---|---|
| `DEFERRED:` | `DEFERRED: AC-N — <summary> — ticket <ID>` | AC intentionally deferred; ticket reference signals QA to skip coverage check |
| `WONTFIX:` | `WONTFIX: AC-N — <summary>` | AC explicitly removed from delivery scope |
| `NOTED:` | `NOTED: <item-id> — <summary> — stage manager: no action` | Acknowledged; stage manager chose to do nothing |
| `KNOWN-FLAKY:` | `KNOWN-FLAKY: <item-id> — <summary>` | Test reliability issue; QA retries once before counting as FAIL |
| `BRIEF-AMEND-NEEDED:` | `BRIEF-AMEND-NEEDED: AC-N — stage manager: scope-down or remove` | PM flag to amend brief before peer-review |
| `SCAFFOLD-PENDING:` | `SCAFFOLD-PENDING: AC-N — <summary>` | Scaffold-test chosen; stage manager must run the printed command to dispatch the agent |

**Read by:** Stage 6 (QA) respects `DEFERRED:` and `KNOWN-FLAKY:`.  Stage 5 (peer-review) role
briefs note `BRIEF-AMEND-NEEDED:` entries as pending brief amendments.  Stage 9 (retrospective)
harvests all advisory markers as part of the "deferrals" pattern.

## Auto-injected sections (validator-managed)

These appear/disappear automatically based on gate state. Don't hand-edit.

### `## IMMEDIATE: Red-Team Blockers — Fix Before Peer Review`

Wrapped in `<!-- devteam:red-team-blockers:begin/end -->`. Auto-injected when stage-04c (red-team) writes FAIL. Auto-stripped when stage-04c next writes PASS/WARN.

### `## IMMEDIATE: QA Build Failures — Fix Before Re-Running QA`

Wrapped in `<!-- devteam:qa-build-blockers:begin/end -->`. Auto-injected when stage-04.qa writes FAIL. Auto-stripped on PASS/WARN.

To clear either of these manually (e.g. when restarting the originating stage from scratch), use `devteam restart <stage>`, which strips the section.

## Section markers (in `pipeline/pr-<area>.md`)

### `## Plan`

The dev's preamble before any edits. Coding-principles §4.

- **Written by:** Each implementing dev, at the **top** of their PR summary, before the first source edit.
- **Format:** Numbered list of steps; each step has a `verify:` line stating how the dev will confirm it works.
- **Read by:** Reviewers (a missing or weak Plan is a BLOCKER).

### `## Verify`

Required before writing a PASS gate (PR #10).

- **Written by:** Each implementing dev at Stage 4 completion.
- **Format:** Bulleted list, one bullet per acceptance criterion the dev claims to have satisfied. Each bullet ties (a) the exact command/action and (b) the observed output.
- **Read by:** Reviewers, peer-review hook, orchestrator-stamped verification (PR #8).

### `## Out of Scope — Noticed`

Things the dev noticed but did not fix because they're outside the brief.

- **Written by:** Implementing devs.
- **Format:** Bulleted list. Each bullet is a one-line description and (optionally) a ticket reference.
- **Read by:** Reviewers (flagging an Out-of-Scope item is *not* a BLOCKER; it's how scope discipline is enforced). Stage 9 retro harvests these.

## Auto-captured stage transcripts (`pipeline/logs/`)

Per-stage logs written by `devteam stage X --headless`. Contains the full stdout/stderr from the host CLI for that stage, with a header (start time, command, host) and trailer (end time, exit code).

- **Where:** `pipeline/logs/<workstreamId>.log`. For multi-role stages, one file per workstream (`stage-04.backend.log`, `stage-04.frontend.log`, etc.).
- **Written by:** `core/adapters/headless.js → runHeadless()`, automatically when a stage runs in `--headless` mode. Does not apply to user-driven mode; the transcript lives in the host tool's session log.
- **Read by:** You, post-hoc or while the stage is running. `cat pipeline/logs/stage-04.backend.log` for the full transcript of one workstream. Output is streamed directly to disk with constant memory use and flushed before the dispatch resolves, so liveness checks and `tail -f` can observe progress during long runs.
- **Opt out:** `DEVTEAM_NO_LOG=1` in the environment.
- **Companion command:** `devteam log [--follow]` for a chronological cross-stage timeline. The per-stage logs are the deep-dive; `devteam log` is the overview.

Not committed to git by default. Typically `.gitignore` `pipeline/logs/` since the files are large and easy to regenerate. Audit-grade pipelines may want to commit them; that is a team policy decision.

## Magic comments (in source code)

Single-line `// comment` markers that change framework behavior at write time.

### `devteam-allow-secret: <reason>`

Suppresses the secret-scan PreToolUse hook for a single line. Use when the hook fires a false positive on something that resembles a credential but is intentional (e.g. an example in `docs/`, a test fixture, or a config schema).

- **Where:** Inline comment on the same line as the would-be-blocked content.
- **Format:** `// devteam-allow-secret: <one-sentence justification>` (or the language's comment syntax — `#`, `;`, `--`).
- **Read by:** `core/hooks/secret-scan.js`. The reason is logged so the bypass is auditable.

### `stagecraft-no-memory`

Marks an artifact to skip persistent memory ingest.

- **Where:** Anywhere in a stage artifact file (`brief.md`, `design-spec.md`, ADR, etc.).
- **Format:** Bare token `stagecraft-no-memory` somewhere in the file.
- **Read by:** `core/memory/index.js` skips files containing this token during `devteam memory ingest`.

## Cheat sheet

| You see / want to write | Goes in | Format |
|---|---|---|
| Open question | `pipeline/context.md` | `QUESTION: <text> @PM` |
| Answer to one | same line below | `PM-ANSWER: <text>` |
| Cross-boundary edit warning | `pipeline/context.md` | `CONCERN: <text>` |
| Reviewer block / suggest / pattern | `pipeline/code-review/by-<reviewer>.md` | `BLOCKER: …` / `SUGGESTION: …` / `PATTERN: …` |
| Reviewer verdict | same | `REVIEW: APPROVED` or `REVIEW: CHANGES REQUESTED` |
| Inline escalation request | review file or context | `ESCALATE: <reason>` |
| Principal's binding ruling | `pipeline/context.md` § Principal Rulings | `PRINCIPAL-RULING: <topic> → <decision>` |
| Conscious deferral (escalation) | `pipeline/context.md` § Deferred follow-ups | bulleted list w/ ticket refs |
| Defer a follow-up AC (with ticket) | `pipeline/context.md` advisory section | `devteam advise --apply AC-N=B:PROJ-XYZ` |
| Mark follow-up as no action | `pipeline/context.md` advisory section | `devteam advise --apply <id>=A` (nothing) |
| Mark test as expected-flaky | `pipeline/context.md` advisory section | `devteam advise --apply <id>=B` (known-flaky) |
| Flag AC for PM to amend | `pipeline/context.md` advisory section | `devteam advise --apply <id>=C` (amend) |
| Dev's non-obvious choice | `pipeline/context.md` § Assumptions | bulleted list |
| Brief amendment mid-run | `pipeline/context.md` § Brief Changes | bulleted diff-style |
| Dev's plan before editing | `pipeline/pr-<area>.md` § Plan | numbered with `verify:` per step |
| Dev's evidence before PASS | `pipeline/pr-<area>.md` § Verify | bullet per AC, command + output |
| Noticed-but-not-fixed | `pipeline/pr-<area>.md` § Out of Scope — Noticed | bulleted list |
| Override secret-scan | source file | `// devteam-allow-secret: <reason>` |
| Skip memory ingest | artifact file | `stagecraft-no-memory` |

## `pipeline/production-feedback.md` (G3 — production feedback contract)

An operator-curated file written **after deploy** (not by any pipeline agent).
Its purpose is to close the brief→production loop: the brief names SLOs and
metrics; this file records what production actually showed.

- **Who writes it:** the stage manager (or an external integration, e.g. a Jira/Datadog webhook).
- **When:** after the feature has been live long enough to have signal (typically 24–72 hours post-deploy).
- **Format:** free-form Markdown; use `templates/production-feedback-template.md` as the scaffold.
  Sections are keyed by the brief's metric/SLO names; an incidents list is always present (write "None" if clean).
- **What reads it:** Stage 9 (retrospective) reads it when present, adds a `## Production Deltas` section
  to `pipeline/retrospective.md`, and records `production_feedback_reviewed: true` in the gate.
- **When absent:** Stage 9 skips this section and stamps `production_feedback_reviewed: "absent"`.
  `devteam next` on a completed pipeline mentions the file once as an optional follow-up.
- **Integration point by design:** automated tools (Datadog alerts → file, Jira comments → file) can write
  to this path without any framework changes. The file is the integration protocol.

See `docs/runbooks/open-followups.md` for how the open-followups runbook cross-references this file.

## Stage 5 approval-derivation hook contract

This section is operator/tooling reference. Model agents need only the review
file format and the `BLOCKER:` line convention — both are in
`rules/stage-05.md`. Come here when debugging the hook or extending it.

### How `approval-derivation.js` processes review files

The hook (registered as PostToolUse on Write/Edit in `.devteam/settings.json`)
fires whenever a reviewer writes or edits `pipeline/code-review/by-<role>.md`.
It parses the file for `## Review of <area>` sections and the `REVIEW:` marker
that closes each section, then upserts `pipeline/gates/stage-05.<area>.json`.

For each `## Review of <area>` section:
- If `REVIEW: APPROVED` — adds `reviewer` to `approvals[]`.
- If `REVIEW: CHANGES REQUESTED` — adds an entry to `changes_requested[]`
  and resets `blockers[]` to the extracted `BLOCKER: <text>` lines from
  that section.
- Self-reviews (area == reviewer's own workstream) are skipped with a WARN log.

`blockers[]` structure after extraction:

```json
{
  "stage": "stage-05", "workstream": "backend",
  "status": "FAIL",
  "changes_requested": [{ "reviewer": "dev-platform", "timestamp": "…" }],
  "blockers": [
    { "reviewer": "dev-platform", "text": "Missing pagination on ListUsersCommand — truncates at 100" },
    { "reviewer": "dev-platform", "text": "iam_admin_users stub unconditionally emits PASS — remove or mark always_insufficient" }
  ]
}
```

Each entry carries `reviewer` (who wrote it) and `text` (raw `BLOCKER:` line
with prefix stripped). `blockers` is reset on each hook run for that area, so
a re-review that flips to `REVIEW: APPROVED` clears the array.

### Gate merge — `affected_workstreams[]` derivation

When `devteam merge peer-review` writes `pipeline/gates/stage-05.json`, it
derives `affected_workstreams` from the per-area gates: any area whose gate
has `changes_requested` non-empty contributes its area name. Area names map
1:1 to build workstreams (`backend` → `dev-backend`, etc.):

```json
{
  "stage": "stage-05", "status": "FAIL",
  "affected_workstreams": ["backend"],
  "workstreams": [
    { "workstream": "backend",  "status": "FAIL" },
    { "workstream": "frontend", "status": "PASS" },
    { "workstream": "platform", "status": "PASS" }
  ]
}
```

Per-area gates do not carry `affected_workstreams` — the area name itself is
the attribution. Use the merged gate for stage-manager-facing queries.

### Concurrency

The hook uses per-gate file locks (`.stage-05-<area>.lock`) plus atomic
rename writes. Safe for concurrent reviewer writes in agent-teams mode.

### Conservative error handling

Any parse or IO failure in the hook exits 0 with a WARN log — it never
halts the host session on a hook bug. If a gate is not updating after a
review file write, run `devteam derive-approvals` manually to re-process
all existing `by-*.md` files.

## Repair-mode vocabulary (ADR-009 §Decision.8)

"Fix" is already overloaded in this codebase. The vocabulary map below draws the lines between the user-facing flag, the track option, and the internal driver machinery so they are never conflated:

| Term | Axis | Meaning |
|---|---|---|
| `--repair "<symptom>"` | intent | User-initiated bug fix: diagnosis + minimal change + reproduction. Orthogonal to `--track`. |
| `--feature "<description>"` | intent | Additive work, implemented fully. The default intent when `--repair` is absent. |
| `hotfix` (a `--track` value) | depth | Skip planning stages, keep every safety and review stage — orthogonal to intent. |
| `fix-and-retry` | internal | The driver self-correcting a failed gate mid-run (distinct from `--repair`). |
| `fix-recipes.js` / `fix_steps` | internal | The per-stage mechanism that produces each retry step. |
| `advise --apply` | internal | Applies those fix steps to `pipeline/context.md`. |
| PATCH MODE (`--patch --from`) | mechanism | The build-scoping constraint that `--repair` reuses to limit changes to diagnosed files. |

**The key distinctions that matter in practice:**

- A `--repair` run will itself emit `fix-retry` events in its `run-log.jsonl` as the driver self-corrects mid-run. That coexistence is expected: the two words describe different things (user intent vs. internal recovery).
- `--repair --track full` is a supported combination — deep repair of auth/payments/migration code requires a heavier verification depth. `hotfix` is the *default* depth for repair, not a forced one.
- Renaming `fix-and-retry` / `fix_steps` / `fix-recipes` to free up "fix" was rejected: the tail wagging the dog — it touches gate-schema fields, the runbook, run-log event names, and the consistency checker.

See [`docs/runbooks/repair-flow.md`](runbooks/repair-flow.md) for the operator procedure when running in repair mode, and [ADR-009](adr/009-repair-mode.md) for the full decision record.

## See also

- [`docs/runbooks/escalation.md`](runbooks/escalation.md) — full procedure when a gate hits `ESCALATE`
- [`docs/runbooks/repair-flow.md`](runbooks/repair-flow.md) — repair mode: diagnosis gate, scope-gate FAIL recovery, tri-state reproduction
- [`docs/user-guide.md`](user-guide.md) § Daily loop — operational reference
- [`rules/coding-principles.md`](../rules/coding-principles.md) — what the dev-side markers (`QUESTION:`, `CONCERN:`, `## Plan`, `## Assumptions`) enforce
- [`core/hooks/approval-derivation.js`](../core/hooks/approval-derivation.js) — how `REVIEW:` markers become Stage 5 gates
- [`core/hooks/secret-scan.js`](../core/hooks/secret-scan.js) — how `devteam-allow-secret:` is honored
- [`rules/advise.md`](../rules/advise.md) — advisory system: classifying and acting on noted_for_followup[] items
