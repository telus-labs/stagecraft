---
name: qa-augmentation
description: "QA Developer: Stage 4c-qa post-red-team test augmentation. Write regression tests for every addressed red-team finding before Stage 5 begins. Only fires after red-team WARN/PASS following fix cycles."
---

# QA Post-Red-Team Test Augmentation (Stage 4c-qa)

Use this skill when you are the QA Developer and this task fires after the
red-team gate turns WARN or PASS following one or more fix cycles —
i.e., `must_address_before_peer_review[]` had entries that the build team
addressed via `--patch --from red-team`. It does NOT fire on the initial
Stage 4 build (that's the Test-Authoring task; see `skills/qa-test-authoring/SKILL.md`).

## Why this step exists

Each red-team patch is applied with `--skip-completed`, leaving the Stage 4
QA gate unchanged. No regression test is written for the fix. Peer reviewers
must then verify the fix purely by static inspection, and the same bug class
can resurface in later builds or red-team cycles. A targeted test addition
closes both gaps before Stage 5 begins.

## Procedure

1. Collect the full set of items that were addressed across all red-team cycles.
   Two sources:
   - `pipeline/red-team-report.md` — the narrative describing what changed
   - `pipeline/context.md` — any `## ⚠️ PATCH MODE` sections injected by the
     orchestrator during the fix cycles; each names the items addressed

2. For each addressed item, read the patched file at the cited location and
   write a regression test that would fail if the original bug were reintroduced:
   - Place regression tests in `src/tests/regression/` (separate from the
     AC-mapped tests in `src/tests/unit/` and `src/tests/integration/`).
   - Tag the test with a comment citing the red-team ID: `// regression: RT-01`
   - One test per item is the floor; add more if the item has multiple failure
     modes.
   - Use the same mock/stub patterns already established in the test suite.
     Don't introduce new test infrastructure for augmentation.

3. Run the full test suite:
   ```bash
   npm test   # or project equivalent
   ```
   All tests — original AC suite plus augmentation — must pass. If a
   regression test fails against the current code, the red-team fix was
   incomplete; treat as a Case 2 (QA-within-build FAIL, see
   `docs/runbooks/fix-and-retry.md`) for the affected workstream and do not
   advance to Stage 5 until resolved.

4. Update `pipeline/gates/stage-04.qa.json`:
   - Increment `tests_total` and `tests_passed` by the count of added tests.
   - `status: "PASS"` (all tests pass).

5. Append a `## Post-Red-Team Augmentation` section to `pipeline/pr-qa.md`:
   ```markdown
   ## Post-Red-Team Augmentation

   Added N regression tests for red-team fixes addressed in cycles 1–N:

   | Red-team ID | File patched | Regression test |
   |-------------|-------------|----------------|
   | RT-01 | src/backend/collectors/aws-iam.js:157 | src/tests/regression/rt-01-iam-guard.test.js |
   | RT-05 | src/cli.js:67 | src/tests/regression/rt-05-commander-exit.test.js |
   ```

After augmentation, `devteam next` advances to Stage 5 peer-review. Reviewers
see the regression test list alongside the fix — confirming coverage exists,
not just that the patched code looks correct.
