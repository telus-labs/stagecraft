## fix(b9-cli-layer): wire all seven CLI read-side commands for bounded isolation — Phase 5.4 commit 2

**Scope**: Phase 5.4, commit 2 — B9 bounded workspace isolation, CLI read-side wiring.

### What was broken

In `isolation: bounded` mode, the seven CLI read-side commands (`next`, `restart`,
`log`, `advise`, `replay`, `derive-approvals`, `spec`) silently read from and wrote
to the global `pipeline/` directory instead of the per-change
`pipeline/changes/<changeId>/` subtree. The autonomous driver's auto-fix path
additionally looked for `clear_gates` entries at in-place paths, finding nothing
and halting with _"fix steps contain no gate clears"_.

### What changed

#### New: `core/cli/resolve-change-id.js`
Shared helper `resolveChangeId(flags, config)` returns `changeIdFromFeature(flags.feature)`
in bounded mode or `null` in in-place mode. The presence of this import token is what
the meta-test in `tests/bounded-fence.test.js` greps for to determine a command is "wired".

#### CLI commands — `--feature` flag and bounded path routing
All seven commands now accept `--feature <name>` and call `resolveChangeId` at entry.
Each routes artifact reads and writes through the bounded path helpers:

| Command | Bounded path used |
|---------|-------------------|
| `next` | `pipelineRoot(cwd, changeId)` for production-feedback check |
| `restart` | `gatesDir(cwd, changeId)`, `pipelineRoot(cwd, changeId)` for context.md |
| `log` | `buildEvents(cwd, changeId)` scans bounded pipelineRoot |
| `advise` | `gatesDir(cwd, changeId)`, `pipelineRoot(cwd, changeId)/context.md` |
| `replay` | `gatesDir(cwd, changeId)` for gate lookup and archive |
| `derive-approvals` | `pipelineRoot(cwd, changeId)/code-review`; passes `DEVTEAM_REVIEW_DIR` and `DEVTEAM_GATES_DIR` env vars to the hook subprocess |
| `spec` | `pipelineRoot(cwd, changeId)` as `pipelineDir` for brief/spec/test-report |

#### `core/driver.js` — `prefixPipelineRelative` for recipe `clear_gates`
Recipes emit gate paths in the in-place format (`"pipeline/gates/stage-NN.json"`).
The driver now rewrites each path through `prefixPipelineRelative(rel, changeId)` before
calling `clearGates()`, so bounded runs clear the correct `pipeline/changes/<id>/gates/`
file instead of a non-existent in-place file that caused the "no gate clears" false halt.

#### `core/log/journal.js` — `buildEvents` accepts `changeId`
`buildEvents(cwd, changeId)` now uses `pipelineRoot(cwd, changeId)` as the scan root.
`walkArtifacts` receives `relBase = pipelineRoot` instead of `cwd`, and computes
`"pipeline/" + path.relative(relBase, full)` so ARTIFACT_PATTERNS (which all start
with `"pipeline/"`) match in both in-place and bounded mode.

#### `core/hooks/approval-derivation.js` — env-var path overrides
`DEVTEAM_REVIEW_DIR` and `DEVTEAM_GATES_DIR` environment variables override the
hook's hardcoded in-place paths, allowing `devteam derive-approvals` to pass the
bounded paths to the hook subprocess without changing its argument interface.

#### `core/spec/verify.js` — `opts.pipelineDir` parameter
`verify(cwd, opts)` now accepts `opts.pipelineDir` to override the default
`cwd/pipeline` root, used by `devteam spec` in bounded mode.

#### `core/config.js` — `BOUNDED_UNWIRED_COMMANDS` emptied
Now `[]` — all seven commands are wired. The bounded isolation fence is fully
transparent for all CLI commands and no longer requires `isolation_acknowledge_partial: true`.

### Tests added

`tests/bounded-mode-wiring.test.js` (16 tests):
- Driver auto-fix regression: recipe clears the PREFIXED bounded gate and the run completes.
- Per-command bounded path coverage for all seven wired commands (next, restart, log, advise, replay, derive-approvals, spec): each test verifies the command reads/writes from `pipeline/changes/<id>/` when `--feature` is supplied and from `pipeline/` without it.
