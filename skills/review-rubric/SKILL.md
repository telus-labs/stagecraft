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
