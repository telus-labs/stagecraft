# Bug Diagnosis — [brief one-line summary of the bug]

## Symptom

> Paste the reported symptom verbatim.

## Root Cause

Explain the root cause precisely: which code path, invariant violation, or data condition triggers the bug. Cite specific file:line references where the defect lives.

## Proposed Fix

Describe the fix at code-level specificity (file, function, change). This must be actionable enough for the build workstream to implement without further guidance.

## Affected Files

List every file the fix MUST touch. The build workstream is constrained to this set by the structural scope gate; amendments require a recorded justification that peer review scrutinizes.

| File | Change |
|------|--------|
| `src/example/module.js` | Update `handleX()` to check Y before Z |

## Regression Criterion

Define the observable condition that distinguishes buggy from fixed behaviour. Phrase it as a test scenario the executable-spec stage can translate into a runnable test:

> **Given** [precondition], **when** [action], **then** [expected outcome — not the current buggy outcome].

## Out-of-Scope Items

List any related issues discovered that are NOT part of this fix. These go to the backlog, not this repair run.

- (none)
