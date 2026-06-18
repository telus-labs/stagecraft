# 03 — Convention compliance

## Summary

The load-bearing contracts remain intact. Lint passes, production imports use the
`node:` prefix, the adapter/gate seams are unchanged, and recent contract changes
landed with tests. The compliance gap is explanatory drift: comments and current
documentation still describe intermediate implementation phases that have since
shipped.

| Convention | Status | Evidence |
|---|---|---|
| Built-in imports use `node:` | Held | Repository scan found only fixture strings in tests |
| No `agent` identity field | Held | Schemas and production code retain `workstream` / `host` / `orchestrator` |
| Model-neutral core | Held | Provider execution remains behind adapters and `runHeadless()` |
| Contract changes update tests | Held | Windows, documentation-gate, cost-gate, and targeted-retry commits include tests |
| Lint clean | Held | `npm run lint` and focused ESLint pass exited 0 |
| Current comments describe current behavior | Needs work | C-1 and C-2 |

## Findings

### C-1 — Autonomous-driver header describes behavior that no longer exists

- **Location:** `core/driver.js:1-16`.
- **Category:** naming and clarity.
- **Deviation:** the header says the driver “does not auto-fix or auto-rule yet” and
  that `fix-and-retry` always halts. The same module now implements targeted fixes,
  derived gate clearing, granted rulings, diagnosis mode, and bounded retries.
- **Impact:** this is the first explanation maintainers encounter in the highest-churn
  autonomous component, so it sends readers toward an obsolete mental model.
- **Suggested fix:** rewrite the header around the current bounded-autonomy contract
  and link ADR-003/006/009 rather than phase-specific PR labels.
- **verified_by:** direct inspection of `core/driver.js:1-16` and the active branches in
  `run()` (`core/driver.js:618-1512`); `tests/run.test.js`, `tests/repair-mode.test.js`,
  and `tests/targeted-build-retry.test.js` exercise the newer behavior.
- **Confidence:** HIGH.

### C-2 — Configuration comment says progress detection is a future dependency

- **Location:** `core/config.js:27-35`.
- **Category:** error handling / architecture commentary.
- **Deviation:** `autonomy.max_retries` says progress-based detection requires gate
  archiving that “this layer does not add.” Gate backup, convergence detection, and
  no-source-change handling are now shipped and consumed by the driver.
- **Impact:** low runtime risk, but it obscures why both count and progress ceilings
  exist and makes the default look less capable than it is.
- **Suggested fix:** describe `max_retries` as the count ceiling alongside the current
  progress/convergence checks.
- **verified_by:** direct inspection of `core/config.js:27-35`,
  `core/gates/convergence.js`, `core/gates/backup.js`, and the convergence branches in
  `core/driver.js`; `tests/convergence.test.js` verifies the current mechanism.
- **Confidence:** HIGH.

## Positive observations

- Central modules use structured child-process argv for host invocation and browser
  launch; shell mode is limited to project-configured verification commands.
- Adapter discovery, stage shape, routing precedence, and gate identity remain behind
  their documented boundaries.
- The test suite contains no committed `.skip()` or `.todo()` cases.

## Possibly intentional deviations

- `core/driver.js` imports `spawnSync` midway through the module near its sole use.
  This is unusual relative to top-level imports, but keeps the repair-scope helper
  visually self-contained and is not worth changing alone.
- Test fixture source strings intentionally include unprefixed built-in imports to
  test standards discovery and security behavior; they are not runtime violations.

## Project-specific extensions

No `docs/audit-extensions.md` file is present.
