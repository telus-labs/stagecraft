# Phase 7 — Test & CI Harness Hardening

**Goal:** kill the repo-state-sensitivity test class structurally (it has now recurred
three times: stoplist tests, secret-scan debris, and the consistency/prompt-budget
meta-tests), and fix the CI blind spots found in round 2. Rules in prompt preambles did
not stop the recurrences; harness properties will.

Findings verified at main `2a1d985`. The live reproduction: a stray untracked
`docs/CHANGELOG.md` (a leaked PR body) made 5 tests fail locally while CI stayed green.

---

## 7.1 Git-aware consistency enumeration + meta-test isolation

**Problem:** `checkDocsIndexCoverage()` and the prose scanner in
`scripts/consistency.js` enumerate the live tree via `fs.readdirSync`, so ANY untracked
`.md` under a scanned dir can trip a blocking check. Five separate tests spawn full-repo
`consistency.js` and assert exit 0, so one debris file fans out to five failures.
Additionally `tests/prompt-budget.test.js` temporarily REWRITES the real
`docs/reference/prompt-budget.md` mid-suite (parallel test processes can observe it; a
hard kill leaves the repo dirty), and one test asserts `rules/stage-05.md` REMAINS over
its 8 KB ceiling — improving the file breaks the suite.

**Change (four parts, one PR):**
1. **Checker:** when scanning the repo root and `.git` exists, enumerate via
   `git ls-files -z` (tracked files = blocking checks). Untracked-but-not-ignored files
   found by a readdir diff → **advisory** ("untracked file would violate X when
   committed"). `--root` fixture mode keeps plain readdir. This is also the right
   product behavior: a scratch file must not fail the lint.
2. **Fan-out:** add `--only <check-class>` to consistency.js; the prompt-budget and
   file-size meta-tests invoke only their own class so unrelated violations can't fail
   them. Exactly ONE canonical full-repo smoke remains (the consistency-meta test 1).
3. **No live-file mutation:** `PROMPT_BUDGET_FILE` env override (the
   `CONSISTENCY_BASELINE_FILE` pattern already exists — mirror it); the test writes its
   synthetic budget to a tempdir. Remove the in-place rewrite-and-restore.
4. **Unpin the exceedance:** the "stage-05.md is known to exceed" test becomes
   fixture-based (a synthetic oversized file under `--root`), so trimming the real file
   (Phase 8) no longer breaks the suite.
5. **Prove the class dead:** a CI step that creates `docs/SCRATCH-ci-probe.md` before
   `npm test` and deletes it after. Red on today's main; green after this PR. Keep it
   permanently.

**Tests:** meta-tests for tracked-vs-untracked behavior (fixture git repos in tempdirs);
`--only` filtering; the env override; the CI probe step itself.

**Also:** add one line to the prompt-preamble TEST HYGIENE rule in
`plans/prompts/ALL-PROMPTS.md` §0: "meta-tests must never assert exact state of the
live repo; use fixtures, --only filters, and env overrides." (Forward-looking; executed
items keep their historical text.)

---

## 7.2 CI signal quality

1. **Tighten the D6 onboarding smoke** [verify-first]: in
   `.github/workflows/test.yml`, the headless stage step runs with `|| true` (correct —
   `cat` writes no gate) but the step's own health is unasserted: a crash in
   `devteam stage` still yields `run-stage` from `next`, which the whitelist accepts.
   Capture the stage step's output and assert the rendered prompt content appears
   (e.g. the requirements-role header line), keeping the tolerated non-zero exit. Also
   pin the expected `next` action to `run-stage`/`continue-stage` instead of the
   six-action whitelist.
2. **Coverage signal surfacing:** the 85% baseline lives in a YAML comment and the
   numbers only in logs. Emit the coverage summary to `$GITHUB_STEP_SUMMARY` and upload
   the raw report as an artifact. Move the recorded baseline into a small JSON the
   workflow reads, so updating it is a diff, not a comment edit. Still non-blocking.
3. **a11y-fixer success path:** `core/a11y-fixer.js` is 69.7% covered — every failure
   exit tested, the dispatch → re-validation success path (the reason the module
   exists) untested, despite being mockable via `DEVTEAM_HEADLESS_COMMAND`. Add the
   success-path tests.
4. **Preflight git-hygiene dead code** [verify-first]: tests document that the
   git-hygiene blocker path is unreachable on git ≥ 2.27 (`git ls-files --ignored
   --exclude-standard` exits 128 without `-c`/`-o`). Fix the invocation in
   `core/preflight.js` so the check actually runs, and convert the documenting test
   into a behavioral one (fixture repo with an ignored-but-tracked offender → blocker).

**Tests:** per item; the smoke change verified by intentionally breaking `devteam stage`
in a scratch branch and observing the step fail (describe in the PR, don't commit the
breakage).

---

## Sequencing & exit criteria

7.1 first (it unblocks Phase 8's stage-05.md trim), then 7.2.

**Phase exit:** the CI probe step proves stray files can't fail the suite; no test
mutates or pins real repo files; the onboarding smoke fails when dispatch breaks;
coverage is readable without opening logs; the two known dead/under-tested paths are
live and tested.
