---
name: qa-test-authoring
description: "QA Developer: Stage 6 test-authoring phase. Map every acceptance criterion to at least one test, write the test suite, and produce pipeline/pr-qa.md. Does NOT run the suite — that is the test-execution phase (skills/qa-test-execution/SKILL.md)."
---

# QA Test-Authoring Task (Stage 6 authoring phase)

Use this skill when you are the QA Developer writing tests during the Stage 6
authoring phase. This phase produces the test code; running the suite is a
separate stage-6 execution phase (see `skills/qa-test-execution/SKILL.md`).

## Procedure

1. Read `pipeline/context.md` — check for `PM-ANSWER:` items and
   `## Brief Changes` that affect acceptance criteria.
2. Read `pipeline/brief.md` carefully. For each acceptance criterion in §3,
   plan at least one test that exercises it. Map one-to-one where possible —
   §3.1 → test "…ac1…", §3.2 → test "…ac2…". This mapping enables the
   sign-off auto-fold.
2a. If `pipeline/spec.feature` exists (stage-03b ran), it is the canonical
   list of behaviours to test. Every `Scenario:` in the file must have at
   least one test mapped to it. The Scenario name + `@AC-N` tag are how the
   test-report mapping table cross-references back to the brief. Run
   `devteam spec verify` after writing test-report.md to catch drift between
   brief / spec / report.
3. Append an `## Assumptions` block to `pipeline/context.md` for non-obvious
   test choices (e.g. "assuming deterministic clock via clock-injection;
   otherwise flaky on CI"). Per coding-principles §1.
4. Write tests in `src/tests/` organised by type:
   - `src/tests/unit/` — isolated logic
   - `src/tests/integration/` — service interactions
   - `src/tests/e2e/` — at least one E2E per acceptance criterion
5. Match existing test conventions. If a convention is missing, read the
   code-conventions skill and note in `pipeline/pr-qa.md` under
   `## Conventions applied`.
6. Do not mock away real business logic. Test real behaviour. If a test
   requires a mock (network, clock, random), justify it inline with a
   one-line comment.
