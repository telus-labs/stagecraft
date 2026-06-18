# 08 — Code quality

## Summary

The codebase is modular for its delivery speed: command extraction, path helpers,
gate helpers, and cross-host render helpers have kept most modules narrow. Lint is
clean and no multi-file dependency cycles were found. The autonomous driver's single
`run()` function is now the main structural risk; several smaller stale surfaces can
be handled as documentation cleanup.

## Findings

### Q-1 — `driver.run()` is a 897-line state machine in one function

- **Effort to fix:** large.
- **Impact if fixed:** high.
- **Location:** `core/driver.js:618-1514`.
- **Issue:** one function owns intent validation, config/track resolution, lock/state
  lifecycle, repair diagnosis, stoplist, budget and consequence ceilings, dispatch,
  stall probes, transient classification, targeted fixes, rulings, convergence,
  merge, completion, and final persistence. Its closing control flow contains nested
  braces whose ownership is difficult to establish locally.
- **Suggested fix:** preserve the deterministic state-machine contract but extract
  action handlers returning a common transition result. Start with pure handlers for
  dispatch classification and fix/ruling outcomes; leave lock/finalization in `run()`.
  Require characterization tests before movement, not behavior changes in the same PR.
- **verified_by:** function boundary measurement (`run` begins at line 618 and ends at
  1514), direct control-flow inspection, and git history showing 34 commits to
  `core/driver.js` since introduction. Thirteen test files reference the driver,
  providing a refactor safety net.
- **Confidence:** HIGH.

### Q-2 — UI rendering helpers encode “HTML string or text” in one untyped parameter

- **Effort to fix:** medium.
- **Impact if fixed:** medium.
- **Location:** `core/ui/static/app.js:129-184` and renderers throughout the file.
- **Issue:** `badge()`, `chip()`, `checkRow()`, and `addFieldRow(valueHtml)` return or
  accept raw HTML while many callers pass untrusted text. The abstraction hides the
  trust boundary and enabled S-1.
- **Suggested fix:** split text helpers from explicitly named trusted-markup helpers;
  prefer node construction and `textContent` for dynamic data.
- **verified_by:** direct call-site inventory shows `addFieldRow()` receives both
  constants/markup and raw gate strings (`review_shape`, `audit_method`, tools,
  environment, contributors); `escHtml()` is not applied by the helper.
- **Confidence:** HIGH.

### Q-3 — Current support facts remain manually duplicated across too many prose files

- **Effort to fix:** medium.
- **Impact if fixed:** medium.
- **Locations:** `AGENTS.md`, `CONTRIBUTING.md`, `docs/FEATURES.md`,
  `docs/user-guide.md`, `docs/concepts.md`, and `docs/BACKLOG.md`.
- **Issue:** generated stage/host/CLI references are healthy, but test counts, schema
  field names, support status, and canonical ownership are manually repeated. D-1
  through D-5 are all manifestations of this remaining duplication class.
- **Suggested fix:** extend consistency checks only for stable machine-derivable facts:
  schema field vocabulary, current package version, and shipped backlog IDs. Remove
  volatile test counts where generation provides little value.
- **verified_by:** direct cross-file contradictions documented in D-1 through D-5;
  existing generated reference checks demonstrate the successful local pattern.
- **Confidence:** HIGH.

## Dead code and dependency health

- ESLint reports no unused variables/imports in the inspected hotspots.
- All eight production dependencies are directly associated with YAML, telemetry, or
  local embedding features; no duplicate utility library was found.
- OpenAI/Cohere provider branches are deliberate unsupported-option errors, not
  working code. Their stale release promise is D-8, not dead implementation.

## Positive observations

- `core/orchestrator.js` is large (1,219 lines) but already decomposed into named
  planning, dispatch, merge, gate-classification, and summary functions. It does not
  currently justify the same urgency as `driver.run()`.
- High-churn files co-change with focused tests (`driver`/`run`,
  `orchestrator`/`next`).
- The CLI registry split reduced future churn in `bin/devteam` to a 95-line loader.

## Project-specific extensions

No `docs/audit-extensions.md` file is present.
