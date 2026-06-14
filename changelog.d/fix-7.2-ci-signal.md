## fix/ci-signal (Phase 7.2) — CI signal quality

### 7.2.1 — Tighten onboarding smoke assertion
- The CI onboarding smoke step now captures `devteam stage` stdout+stderr and
  asserts the requirements-role header (`Stage stage-01`) appears in the
  output. A crash inside `devteam stage` now fails the step instead of
  silently succeeding behind `|| true`.
- Pinned `devteam next` action check to `run-stage|continue-stage` (the two
  actions reachable from a headless run that wrote no gate), replacing the
  previous six-action whitelist that included `pipeline-complete` and
  `resolve-escalation` (neither reachable from a fresh `init`).

### 7.2.2 — Coverage signal surfacing
- Coverage step now emits a summary block to `$GITHUB_STEP_SUMMARY` — numbers
  are visible from the PR checks list without opening the raw log.
- New `upload-artifact` step saves `coverage-report.txt` for 14 days per node
  version (non-blocking, `if-no-files-found: ignore`).
- Moved the recorded baseline from a YAML comment into
  `.github/coverage-baseline.json` so updating it produces a visible diff.

### 7.2.3 — a11y-fixer success-path tests
- Added three tests covering `fixA11yBlockers`'s dispatch → re-validation path
  (the reason the module exists), which was untested at 69.7% line coverage:
  - PASS gate: returns `{ status: "PASS", exitCode: 0 }`.
  - FAIL gate with remaining blockers: returns `{ status: "FAIL", exitCode: 1,
    remainingBlockers: [...] }`.
  - No gate written by re-run: returns `{ status: "MISSING", exitCode: 1 }`.

### 7.2.4 — Fix preflight git-hygiene dead code
- Fixed `core/preflight.js`: added `-c` (`--cached`) flag to `git ls-files
  --ignored --exclude-standard`. Without it the command exits 128 on git ≥
  2.27, making the blocker path permanently unreachable on modern git (macOS
  Apple Git ≥ 2.28, Ubuntu default git ≥ 2.27).
- Replaced the two documenting tests (which recorded the broken behavior) with
  three behavioral tests: clean repo passes, committed-then-ignored file fires
  a blocker with a `git rm --cached` suggestion.
