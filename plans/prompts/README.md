# Sonnet Execution Prompts

Paste-ready prompts for executing the phase plans with Claude (Sonnet). One prompt = one
session = one branch = one PR-sized change.

## How to use

1. Start a **fresh Sonnet session** in the repo root for each prompt. Do not reuse sessions
   across items — stale context from a previous item causes scope bleed.
2. Paste the **PREAMBLE below first**, then the item prompt from the phase file, as one message.
3. When the session ends, check its final report against the item's "Done means" list before
   merging. If the report says a `[verify-first]` claim didn't hold, that's a *success* —
   the item goes back for human triage, not retry.
4. Run prompts in the order listed in each phase file. Dependencies are called out.

Prompt files:
- [phase-1-prompts.md](phase-1-prompts.md) — 7 prompts (trust consolidation)
- [phase-2-prompts.md](phase-2-prompts.md) — 5 prompts (consistency, docs sweep, release)
- [phase-3-prompts.md](phase-3-prompts.md) — 11 prompts (structural debt)
- [phase-4-prompts.md](phase-4-prompts.md) — ADR-first capability prompts
- [docs-prompts.md](docs-prompts.md) — documentation-plan prompts (D2–D5; D1 is Phase 2)

---

## PREAMBLE (paste at the top of every session, verbatim)

```
You are implementing exactly one pre-approved work item in the Stagecraft repository
(current directory). Stagecraft is a Node.js CLI (`devteam`) that orchestrates AI coding
tools through an 18-stage gated pipeline. The work item is specified below and in a plan
file under plans/ — the plan file is the authoritative spec; read its referenced section
in full before touching any code.

Hard rules:
1. SCOPE: implement only this item. If you notice other problems, list them under
   "Out-of-scope findings" in your final report. Do not fix them.
2. VERIFY-FIRST: any step marked [verify-first] is a claim that must be confirmed by
   reading the code before editing. If the claim does not hold, STOP all work on that
   step, and report what you actually found instead. Do not "fix" code that already works.
3. LINE NUMBERS are anchors verified at commit 212c710. If they've drifted, locate the
   quoted code by searching; never edit by line number alone.
4. TESTS: run `npm test` (offline, ~1161 tests, ~6s) and `npx eslint .` before and after.
   Both must pass when you finish. Never weaken, skip, or delete an existing test to make
   your change pass. If a test legitimately encodes the OLD behavior this item changes,
   update it and explicitly call that out in your report.
5. NEW BEHAVIOR NEEDS A TEST: write the regression/behavior test first where the item
   says so; in all cases the change must be covered by at least one test that fails
   without it.
6. SOURCE OF TRUTH: core/pipeline/stages.js is canonical for stages/gates/tracks. Prose
   follows code, never the reverse, unless the item says otherwise.
7. CONVENTIONS: comments explain *why* and cite backlog/ADR IDs (see core/driver.js:9-23
   for house style). Tests use per-test mkdtempSync tempdirs with the devteam-test- guard
   (see tests/_helpers.js). Match surrounding code style exactly.
8. GIT: create a branch named as specified in the item. Commit with a conventional-commit
   message when done. Do NOT push, do NOT open a PR, do NOT merge.
9. CHANGELOG: add an entry under [Unreleased] in CHANGELOG.md (or a changelog.d/ fragment
   if that mechanism exists in the repo by the time you run) matching the existing entry
   style, including an "Honest scope note" line if the item has known limitations.
10. STOP CONDITIONS — stop and report rather than improvise if: a [verify-first] claim
    fails; the change requires editing more than ~3 tests; you need to modify a file the
    item doesn't mention and can't justify in one sentence; npm test fails for reasons
    unrelated to your change.

Final report format (this is your last message):
- WHAT CHANGED: file list with one line each.
- EVIDENCE: the exact verification commands run and their results (paste test counts).
- TESTS ADDED/UPDATED: names and what each proves.
- DEVIATIONS from the plan item, if any, with justification.
- OUT-OF-SCOPE FINDINGS, if any.
```
