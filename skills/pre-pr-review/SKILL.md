---
name: pre-pr-review
description: "Review the current branch before creating a pull request. Use this skill whenever the user says 'review my changes', 'review this branch', 'pre-PR review', 'check before I merge', 'is this ready to merge', 'review before PR', or 'code review'. Also triggers on 'check my work' or 'anything I missed?' when there are uncommitted or branch-level changes. This skill is for changes made OUTSIDE the /pipeline — the pipeline has its own Stage 5 peer review. Use this after direct edits, implement skill work, or /hotfix runs."
---

# Pre-PR Review

Review the current branch as a thorough, senior code reviewer. The goal is to catch issues before they reach human reviewers — saving review cycles and preventing convention drift.

This skill is for changes made **outside the pipeline**. If you just ran `/pipeline`, Stage 5 already reviewed the code — you don't need this skill.

## Setup

1. **Detect the base branch** — do not assume `main`:
   ```bash
   BASE=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
   if [ -z "$BASE" ]; then
     git show-ref --verify --quiet refs/heads/main && BASE=main || BASE=master
   fi
   echo "Base branch: $BASE"
   ```

2. **Load the project's standards** (read whichever exist):
   - AGENTS.md (coding standards, platform rules)
   - `skills/code-conventions/SKILL.md` (project coding conventions)
   - `docs/audit/03-compliance.md` (known conventions and anti-patterns from audit)
   - `docs/audit/00-project-context.md` (project context, commands)
   - CONTRIBUTING.md

3. **Get the scope of changes:**
   ```bash
   git rev-parse --abbrev-ref HEAD
   git log --oneline $BASE..HEAD
   git diff --name-only $BASE...HEAD
   git diff $BASE...HEAD
   ```

4. **Check for merge conflicts** with the base branch:
   ```bash
   git merge-tree $(git merge-base HEAD $BASE) $BASE HEAD | head -20
   ```
   If there are conflicts, flag them immediately — they must be resolved before any review makes sense.

5. **Read each changed file in full** (not just the diff). A change that looks correct in isolation may be wrong in context — duplicate of something nearby, inconsistent with an adjacent function, or breaking a pattern in the same file.

If the diff is very large (20+ files), ask the user: "This is a large diff. Should I review everything, or focus on specific areas?"

## Review Checklist

Work through each area. For each issue found, report: the file and line, what's wrong, why it matters, and the suggested fix.

### Correctness
- Does the logic do what it's supposed to? Trace the main code paths.
- Are edge cases handled (empty inputs, nulls, error conditions)?
- Are there off-by-one errors, wrong comparisons, or missed conditions?

### Project Conventions
- Does the code follow the project's established patterns and style?
- If the project has documented rules (AGENTS.md, linter config, code-conventions skill), are they followed?
- Is naming consistent with the rest of the codebase?
- Does it use existing helpers/utilities rather than reimplementing them?

### Tests
- Are there tests for the new or changed behavior?
- Do the tests cover the important cases, not just the happy path?
- Are test markers/labels applied correctly per project convention?
- Are mocks reasonable (not so broad they'd pass if production code were deleted)?

### Error Handling
- Are errors caught and handled appropriately?
- Are error messages helpful for debugging (not swallowed, not leaking internals)?
- Are transient failures retried where appropriate?

### Security
- Run through `skills/security-checklist/SKILL.md` if it exists.
- Any hardcoded secrets, tokens, or credentials?
- User input validated at the boundary?
- Sensitive data logged or exposed in responses?

### Documentation
- Code comments for non-obvious logic?
- Docstrings for public functions/classes?
- README or other docs updated if behavior changed?
- If the project requires doc updates alongside code changes, are they included?

### Operational Concerns
- Performance implications? (new DB queries, N+1 patterns, missing pagination)
- Is the change easy to revert if something goes wrong?
- Does this need a feature flag or staged rollout?

### Audit Anti-Patterns
If `docs/audit/03-compliance.md` exists, cross-check: does this change introduce any of the anti-patterns previously identified in the codebase audit?

## Verdict

End with a clear verdict:

- **Approve** — No issues or only minor nits. Ready to merge.
- **Request Changes** — Issues that should be fixed before merging. List each with severity (must-fix vs. nice-to-have).
- **Comment** — Questions or suggestions that don't block merging but are worth discussing.

For each issue, be specific: cite the file, the line, the rule or convention, and the fix. Vague feedback like "improve error handling" is not helpful.
