---
name: implement
description: "Plan, execute, verify, and commit a single codebase improvement. Use this skill whenever the user says things like 'implement [item]', 'work on [roadmap item]', 'fix [finding from audit]', 'plan the change for [item]', 'execute the plan', or 'verify the changes'. Also triggers on 'next item from the roadmap' or 'pick up where we left off'. This skill is for small-to-medium changes that don't need the full /pipeline. It ensures changes are planned before coded, verified after coding, and committed atomically with human approval at every step."
---

# Implement a Change

A four-step workflow for implementing improvements: **plan**, **execute**, **verify**, **commit**. Use this for focused changes (a few files, clear scope) where the full `/pipeline` would be overkill.

When to use this vs. `/pipeline`: if the change needs requirements refinement (PM), architectural decisions (Principal), or touches multiple areas (backend + frontend + infra), use `/pipeline` instead.

## Before Starting

Load context about the project and the change:

1. Read `docs/audit/00-project-context.md` if it exists — lint command, test command, framework, conventions.
2. Read `docs/audit/01-architecture.md` if it exists — component map and dependency graph.
3. Read `docs/audit/10-roadmap.md` if it exists — the sequenced improvement plan.
4. Read `pipeline/context.md` if it exists — open questions, prior decisions, fix log.
5. If the project has a AGENTS.md, read the coding standards sections.
6. If none of these exist, ask the user: "What are this project's lint/test commands, and are there coding conventions I should follow?"

**Identify what to implement.** The user may:
- Name a specific item from the roadmap — look it up in `docs/audit/10-roadmap.md`
- Describe the change directly — use their description as the spec
- Say "next item" — pick the next unfinished item from the roadmap, respecting the sequence

If the scope is unclear, ask before planning.

## Step 1: Plan

Write a detailed implementation plan **before touching any code**. The goal is to surface problems, missing context, and open questions before investing effort in coding.

The plan covers:

1. **Context** — What's wrong today and the concrete impact. Why fix it now rather than later.

2. **Approach** — The strategy. If there are multiple ways to do this, briefly note the alternatives and why this approach wins. Keep it to 2-3 sentences.

3. **File-by-file changes** — Every file that needs modification, with the specific change described precisely enough for someone to review the plan without reading the code.

4. **New code** — Any new files, functions, classes, or config to create. Describe the interface and behavior. Do not write code yet.

5. **Tests** — Specific test cases to add or update. Include the scenario, the input, and the expected behavior. Think about edge cases, not just the happy path.

6. **Documentation** — Which docs change and how. Check the project's documentation requirements (AGENTS.md, CONTRIBUTING.md) for what's expected.

7. **Migration & compatibility** — Breaking changes? Deployment ordering? Data migration? Feature flags needed? If none, say "none" explicitly so it's clear you considered it.

8. **Verification** — How to confirm this works. Include the specific commands to run (from `docs/audit/00-project-context.md` or the project's AGENTS.md).

9. **Rollback** — If this causes problems after deployment, what's the recovery? Is a git revert safe, or are there side effects?

10. **Open questions** — Anything uncertain that needs human input before proceeding. This is the most important section — it prevents building the wrong thing.

Present the plan and **wait for the user to approve or adjust it** before moving to Step 2. Do not proceed automatically.

## Step 2: Execute

Implement the approved plan with these checkpoints:

- After each file change, verify naming, patterns, and conventions match the rest of the codebase.
- Run the linter after each file (use the command from project context). Fix issues before moving to the next file.
- **If you discover the plan missed something or got something wrong — STOP and tell the user.** Do not improvise. Plans are always wrong in some details; the correct response is to flag it, not to silently adapt.
- After all code changes, run the relevant tests (scoped to the changed area if possible).
- Update documentation as specified in the plan.

When done, present:
- The complete diff
- Anything that deviated from the plan and why
- Any follow-up work this change reveals

**Do not commit.** The user reviews the diff first.

## Step 3: Verify

After the user approves the diff (or after adjustments), run full verification:

1. Run the full test suite — report pass/fail with details on any failures
2. Run the linter on the whole project — report any violations
3. Check that components depending on the changed code still work
4. Confirm documentation is consistent with the new code
5. Review the diff one final time against the project's coding conventions
6. Check: did this change introduce any anti-patterns from the audit findings (see `docs/audit/03-compliance.md`)?
7. List any follow-up items or tech debt this change creates

Give a clear verdict: **ready to commit** or **issues to fix first** (with specifics).

## Step 4: Commit

Each implemented item should be **one atomic commit**. This keeps history clean and makes reverts safe.

After Verify passes ("ready to commit"):

1. **Draft a commit message** following this format:
   ```
   <type>(<scope>): <short summary>

   <what changed and why — 1-3 lines>
   ```
   Where `type` is one of: `fix`, `feat`, `refactor`, `test`, `docs`, `perf`, `chore`.
   Derive `scope` from the primary area changed (e.g., `auth`, `api`, `build`).

2. **Present the message to the user** and ask: "Commit with this message? (yes / edit / skip)"
   - **yes** → stage the relevant files and commit. Do not use `git add -A`; add specific files that were changed as part of this implementation.
   - **edit** → the user provides an adjusted message, then commit.
   - **skip** → do not commit. Warn: "Changes are uncommitted — remember to commit before starting the next item."

3. **After committing**, print: the commit hash, the one-line summary, and the number of files changed.

### Uncommitted change guard

If the user asks to implement another item (or says "next item") and there are **uncommitted changes from a previous implement cycle**, stop and warn:

> There are uncommitted changes from the previous implementation. Commit them first? (yes / skip)

Do not start a new Plan step with a dirty working tree from a prior implement cycle. This prevents changes from piling up across multiple items.

## After Completion

If `docs/audit/10-roadmap.md` exists, update it: mark the completed item with `[DONE]` at the start of its title, and append any follow-up items to the appropriate priority category.

If `pipeline/context.md` exists, append a note under `## Fix Log` documenting what was changed and why.
