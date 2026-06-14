---
name: review-rubric
description: "Standard code review checklist for all reviewers. Load this when performing a peer review at Stage 5. Covers spec compliance, correctness, security, test coverage, readability, and performance. Defines what constitutes APPROVED vs CHANGES_REQUESTED and how to write review findings."
---

# Review Rubric

Use this skill when performing a code review. It defines the standard
review checklist every reviewer must work through.

## Mandatory Checks (every review)

### 1. Spec Compliance
- Does the code match `pipeline/design-spec.md`?
- Are all API contracts implemented as specified?
- Are there undocumented deviations? (BLOCKER if unexplained)

### 2. Correctness
- Are all edge cases from the spec handled?
- Are error paths handled and tested?
- Are there off-by-one errors, null dereferences, or type mismatches?

### 3. Security
- No secrets in code
- Input validation present
- Auth checks in place where spec requires them
- No SQL string concatenation

### 4. Test Coverage
- Does new behaviour have corresponding tests?
- Do tests actually test the behaviour (not just call the function)?

### 5. Readability
- Can a new team member understand this code in 5 minutes?
- Are complex sections commented?

## Comment Classification

Every review comment must be one of:

**BLOCKER** — Must be fixed before this PR can merge.
  Use for: security issues, missing tests, spec violations, broken behaviour.

**SUGGESTION** — Would improve the code. Author's call.
  Use for: style preferences, minor optimisations, naming improvements.

**QUESTION** — Need clarification. Not blocking unless answered badly.
  Use for: unclear intent, possible oversight, design question.

## Verdict

`REVIEW: APPROVED` — No blockers. May have suggestions.
`REVIEW: CHANGES REQUESTED` — One or more blockers. List them.

## Scope

This rubric is for **pipeline Stage 5 peer reviews** — when dev agents review
each other's PRs during a `/pipeline` run. For standalone pre-merge review
of changes made outside the pipeline (direct edits, `implement` skill work,
`/hotfix` runs), use the `pre-pr-review` skill instead.

## Gotchas (add failures here over time)

- Do not approve a PR just because it "looks fine". Work through the checklist.
- Do not raise the same point another reviewer already raised (read their review first).
- Do not BLOCKER a style preference. That's what linters are for.

---

## Platform Reviewer Focus (Stage 5, when reviewing as `dev-platform`)

Apply the coding-principles rubric explicitly — BLOCKER for unstated
assumptions (§1), overcomplication (§2), drive-by edits (§3), or a
missing/weak Plan with unverifiable steps (§4).

Focus on: infrastructure impact, deploy risk, CI coverage, observability
(metrics, logs, traces named in the design-spec).

Classify as BLOCKER / SUGGESTION / QUESTION inside each section.
Use `PATTERN:` to call out something done especially well.

---

## QA Reviewer Focus (Stage 5, when reviewing as `dev-qa`)

Apply the coding-principles rubric. BLOCKER on unstated assumptions (§1),
overcomplication (§2), drive-by edits (§3), or missing/weak plan (§4).

Focus on: **testability**. Does the change actually admit tests for the
acceptance criteria? Are state transitions observable? Is the tested surface
stable? Flag hidden coupling (singletons, global clocks, module-level state)
as a BLOCKER — it obstructs tests.

Use `PATTERN:` to call out testing patterns the team should adopt as default.
