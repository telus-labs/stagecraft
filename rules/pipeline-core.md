# Pipeline Core (Stages 1–3, 9, durations)

Stages with mostly single-agent flows: requirements (PM), design
(Principal), pre-build clarification, and the post-deploy
retrospective. Stage Duration Expectations live here too. The
build/review/test/deploy stages live in `pipeline-build.md` (which
indexes the per-stage `stage-NN.md` files). Track routing and the
safety stoplist live in `pipeline-tracks.md`.

## Stage 1 — Requirements (PM)

Invoke: `pm` agent
Input: user's feature request
Output: `pipeline/brief.md`
Gate file: `pipeline/gates/stage-01.json`
Gate key: `"status": "PASS"`

The PM defines acceptance criteria and scope. Engineers do not begin design
until the gate passes. After gate passes → HUMAN CHECKPOINT A.

---

## Stage 2 — Design (Principal + Dev input)

Step 2a — Principal drafts:
  Invoke: `principal` agent
  Input: `pipeline/brief.md`
  Output: `pipeline/design-spec.md` (status: DRAFT)

Step 2b — Dev annotation (parallel, read-only):
  Invoke in parallel: `dev-backend`, `dev-frontend`, `dev-platform`
  Each appends concerns to: `pipeline/design-review-notes.md`
  These are read-only passes — no code written yet.

Step 2c — Principal chairs review:
  Invoke: `principal` agent
  Input: `pipeline/design-spec.md` + `pipeline/design-review-notes.md`
  Output: updated `pipeline/design-spec.md`, ADR files in `pipeline/adr/`
  Gate file: `pipeline/gates/stage-02.json`
  Gate keys: `"arch_approved": true` AND `"pm_approved": true`
  For PM approval: invoke `pm` agent to confirm scope fit after Principal approves.

After both approvals → HUMAN CHECKPOINT B.

---

## Stage 3 — Pre-Build Clarification

Check `pipeline/context.md` for any lines starting with `QUESTION:` that lack a `PM-ANSWER:`.
If any exist: invoke `pm` agent with those questions before proceeding.
If none: proceed immediately.

---

## Stage 9 — Retrospective (all agents → Principal synthesis)

Full protocol: see `.devteam/rules/retrospective.md`.

Runs automatically after Stage 8 (PASS or FAIL) and after any red halt.
Not gated by user approval — retros on failed runs are the most valuable.

Step 9a — Contribution (parallel, read-heavy):
  Invoke in parallel: `pm`, `principal`, `dev-backend`, `dev-frontend`,
  `dev-platform`, `dev-qa`. When Stage 4.5b fired, also invoke
  `security-engineer`. Each appends a section to `pipeline/retrospective.md`
  using the four-heading template. Each produces one concrete lesson.

Step 9b — Synthesis:
  Invoke: `principal` agent.
  Input: `pipeline/retrospective.md` + `pipeline/lessons-learned.md`
  Output: synthesis block prepended to retrospective, updated
  `pipeline/lessons-learned.md` (max 2 promotions, retire rules proved
  wrong or reinforced ≥5 times without defect).
  Gate file: `pipeline/gates/stage-09.json`
  Gate key: `"status": "PASS"` (informational — only FAIL if synthesis
  itself failed)

After gate: the orchestrator prints the synthesis block and the list of
promoted/retired lessons to the user. No checkpoint — pipeline ends here.

**Seeding**: on the first pipeline run in a project, `pipeline/lessons-learned.md`
does not exist. Principal creates it during synthesis if any lesson is
promoted. Until then, agents skip the "read lessons-learned" step.

---

## Stage Duration Expectations

Typical durations for each stage. These are guidelines, not hard limits —
Claude Code does not enforce timeouts on agent execution. If a stage
seems stalled, use `devteam next` to check progress and `devteam summary`
for a full state dump.

| Stage | Typical Duration | Notes |
|-------|-----------------|-------|
| 1 — Requirements | 2-5 min | Single agent (PM). Fast unless scope is ambiguous. |
| 2 — Design | 5-15 min | Sequential: draft → annotation → review. Longest non-build stage. |
| 3 — Clarification | <1 min | Pass-through if no open questions. |
| 4 — Build | 5-20 min | Parallel (3 devs). Wall-clock = slowest dev. Complexity-dependent. |
| 5 — Code Review | 5-15 min | 3 reviewers, each reading 2 PRs. Sequential fallback is slower. |
| 6 — Test & CI | 3-10 min | Depends on test suite size and whether retries are needed. |
| 7 — PM Sign-off | 1-3 min | Single agent review. |
| 8 — Deploy | 3-10 min | Docker build + smoke tests. Network-dependent. |
| 9 — Retrospective | 3-8 min | Parallel contributions + Principal synthesis. Skippable only for trivial hotfixes. |

**Full pipeline**: 28-88 minutes typical, depending on feature complexity.

**Stall indicators**:
- Stage 4 taking >30 min: check if a dev agent hit an ambiguity and wrote
  a `QUESTION:` to `pipeline/context.md` without the orchestrator noticing.
- Stage 6 retry loops: check if the same test is failing repeatedly
  (auto-escalates after 3 identical failures).
- Any stage with no gate file written after 15 min: likely a context or
  permission issue. Check the agent's output for errors.

**Claude Code session limits**: Claude Code conversations have a context
window limit. Long pipeline runs may trigger automatic compaction. The
`devteam summary` command captures current pipeline state, and
`.devteam/rules/compaction.md` tells Claude what to preserve after compaction.
