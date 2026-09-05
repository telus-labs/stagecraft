- **Reviewers may reproduce, not re-verify.** The stage-05 efficiency rule and
  the backend/frontend/reviewer briefs said "do not re-run" lint and tests;
  both review passes of a real change re-ran them anyway, and in the first pass
  that execution is what caught two e2e tests binding the same port. The rule
  now says: cite the orchestrator-stamped results, one run to reproduce a
  specific suspicion is fine, re-running the whole suite by default (or
  `npm audit`) is not.
- **Per-stage dispatch timeouts in config.** `pipeline.dispatch_timeout_ms`
  (run-wide) and `pipeline.dispatch_timeouts` (by stage name or id) set the
  per-workstream wall-clock cap that only `--timeout-ms` could set before;
  `0` means no cap and `--timeout-ms` still wins. A 40-turn peer review on a
  real diff needed ~14 minutes against the 10-minute default and the only
  remedy was a run-wide flag on every invocation. `core/config.js` exports
  `resolveDispatchTimeoutMs`; the orchestrator applies it when it builds the
  dispatch context, so `devteam run` and `devteam stage --headless` both honour
  it. `devteam init` documents the keys in the generated config.
- **The gate validator calls out placeholder timestamps.** Two runs wrote
  round, wrong `timestamp` values (`2026-09-04T00:00:00Z` at 23:43,
  `05:30:00.000Z` at 05:29) and nothing said so. A timestamp more than six
  hours from validation time, in either direction, or one that is not an
  ISO-8601 date, now prints an advisory naming it as a likely placeholder and
  pointing at `_orchestrator_observed.at` as the trusted time. Advisory only:
  exit codes are unchanged.
