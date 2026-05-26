# Testing strategy

ai-dev-team currently has **zero automated tests**. Every contract we've stress-tested in conversation is verified by manual smoke tests, not locked in. This is the single biggest robustness gap.

This document proposes how to test the framework, what to cover, and in what order.

## Why this matters now

The core has 11 locked contract decisions (see `ARCHITECTURE.md`). Right now any of them can silently break:

- A schema edit that drops `orchestrator` from the required-fields list.
- A `stages.js` edit that breaks the merged-stage roleWrites filter.
- An adapter `install()` that forgets to write a file the `status()` check expects.
- A change in `next()` that no longer recognizes a partial multi-role stage.
- A regex edit in `approval-derivation` that mis-parses `REVIEW:` markers.

The forks have 26 (claude) / 20 (codex) tests precisely because these contracts get fragile fast under maintenance. We need to start that suite now, before the next contract edit lands.

## Testing tools

**Use `node --test`** — Node's built-in test runner. No new dependency. Matches the predecessor forks' style. Tests live under `tests/<area>.test.js` and run with:

```bash
npm test                 # all tests
node --test tests/gate-validator.test.js   # one file
```

Stretch: add `node --experimental-test-coverage` once the suite is meaningful.

## Test categories (and what to cover)

### Tier 1 — blocking 1.0

These verify the contracts that, if broken, silently make the system wrong. Must land before the first tagged release.

| File | Covers | Notes |
|---|---|---|
| `tests/contract.test.js` | Cross-artifact consistency: every stage in `stages.js` has a matching schema, every role in `stages.js` has a matching role brief, every schema has matching fields in `gates.md`, etc. | Lift the shape from `claude-dev-team/tests/contract.test.js`. |
| `tests/gate-validator.test.js` | Validator behavior: PASS exit 0, FAIL exit 2, ESCALATE exit 3, WARN exit 0, missing fields exit 1, bypassed escalation halts the pipeline. | Mostly portable from claude. |
| `tests/orchestrator.test.js` | `runStage()` decomposes multi-role stages correctly. `buildDescriptor()` honors `roleWrites` + `subagent` override. `mergeWorkstreamGates()` aggregates status correctly (ESCALATE > FAIL > WARN > PASS) and structure. | New — none of this logic existed in the forks. |
| `tests/next.test.js` | All 10 scenarios from the manual smoke test of `next()`: empty, run-stage, continue-stage, merge, fix-and-retry, resolve-escalation, pipeline-complete, conditional skip, track filter, --json. | New. |
| `tests/router.test.js` | Resolution precedence: `stages > roles > default_host`. Missing adapter → clear error. Multi-host install picks per workstream. | New. |
| `tests/config.test.js` | YAML loader: missing file → defaults; bad YAML → clear error; routing fields properly parsed. | New. |
| `tests/adapter-contract.test.js` | Every adapter under `hosts/` exports the required surface: `capabilities`, `install`, `renderStagePrompt`, `status`, `uninstall`. Optional: `invoke`. `capabilities.json` parses, includes required keys. | Lift shape from claude. |
| `tests/install-roundtrip.test.js` | For each adapter: install → status reports ok → uninstall → status reports missing. Idempotency: install twice = no extra writes. | New. |
| `tests/approval-derivation.test.js` | Parses review files correctly: section + REVIEW marker → verdict. Upserts the right gate. PASS only when approvals >= required AND no changes_requested. Lock acquisition under contention. | Lift from claude. |

**Tier 1 size estimate:** ~600-1200 lines across 9 files. About 2 days of focused work.

### Tier 2 — for a public release

Guards against regressions in specific paths.

| File | Covers | Notes |
|---|---|---|
| `tests/stoplist.test.js` | Stoplist matches the right phrases; bypass requires explicit flag. | Lift from claude. |
| `tests/budget.test.js` | Budget tracker accumulates correctly, escalates when over-limit, warns when configured to warn. | Lift from claude. |
| `tests/security-heuristic.test.js` | Trigger paths match expected files; doesn't false-positive on safe paths. | Lift from claude. |
| `tests/tracks.test.js` | `orderedStageNamesForTrack(track)` returns the right list per track; unknown track throws; nano excludes most stages; full has all 11. | New. |
| `tests/schemas.test.js` | Each `stage-NN.schema.json` is a valid JSON Schema 2020-12. Each example in `rules/gates.md` validates against its declared schema. | Use ajv; new. |
| `tests/cli.test.js` | `bin/devteam` exits with right codes for known commands, unknown command, missing flags. `--json` outputs valid JSON. | New. |
| `tests/dogfood.test.js` | Run the whole pipeline against a fixture target project; verify final state matches expectations. | Lift idea from claude. |

**Tier 2 size estimate:** ~600 more lines across 7 files. About 2-3 more days.

### Tier 3 — nice to have

Add as you find bugs or as the BACKLOG items land.

| File | Covers |
|---|---|
| `tests/headless.test.js` | `runHeadless()` spawning, stdin pipe, gate detection. Use `DEVTEAM_HEADLESS_COMMAND=cat` for stubbing. |
| `tests/conditionalOn.test.js` | Conditional dispatch fires/skips correctly for security-review and any future conditional stages. |
| `tests/multi-host.test.js` | End-to-end: install two adapters, run a build with split routing, merge, verify per-workstream gates carry the right host field. |
| `tests/stage-numbering.test.js` | Detect off-by-one stage refs in role briefs (the bug class we just fixed). Grep-based assertion that role-X writes stage-Y where stage-Y matches stages.js. |
| `tests/concurrency.test.js` | approval-derivation lock under contention (spawn 5 processes, each writing to the same area). |

## Fixtures

Most tests need a "fake target project" directory tree. Standardize on a fixture helper:

```js
// tests/_helpers.js (new)
function makeTargetProject(opts = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'devteam-test-'));
  fs.mkdirSync(path.join(cwd, '.devteam'), { recursive: true });
  if (opts.config) {
    fs.writeFileSync(path.join(cwd, '.devteam', 'config.yml'), opts.config);
  }
  return cwd;
}

function seedGate(cwd, name, gate) {
  fs.mkdirSync(path.join(cwd, 'pipeline', 'gates'), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, 'pipeline', 'gates', `${name}.json`),
    JSON.stringify(gate, null, 2),
  );
}
```

These two helpers cover ~80% of the setup boilerplate across the suite.

## What NOT to test (intentionally out of scope)

- **LLM outputs.** Anything that depends on calling Anthropic/OpenAI/Google APIs. Tests should run in CI with no external dependencies. Mock or stub.
- **Real `claude --print` / `codex exec`.** Hosts may not be installed on the CI runner. Use `DEVTEAM_HEADLESS_COMMAND=true` or `cat` to test wiring.
- **Subagent quality.** Whether the "implement" skill produces good code is not something this test suite checks. That's evals territory.
- **Doc prose.** No tests that grep prose for specific wording; brittle.

## CI hookup (later)

Once tier 1 is in:

```yaml
# .github/workflows/test.yml
name: test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm test
```

That's the whole CI for tier 1. Tier 2 might add matrix builds across Node 18/20/22; tier 3 might add coverage reporting.

## Recommended starting point

If you do one test file first, make it `tests/contract.test.js`. It catches the broadest class of bugs (cross-artifact drift) with the lowest setup cost — pure file reads + structural assertions, no execution required. It's also the test most likely to fail on a real edit and surface a real bug.

If you do three test files, add `tests/gate-validator.test.js` and `tests/orchestrator.test.js`. Those three together would have caught every contract regression we hit during this migration.

## Test coverage estimate

A complete tier 1 suite (9 files, ~800 lines) gives you regression coverage on:
- ~95% of `core/` modules
- 100% of contract F/B identity fields
- The full multi-host install + dispatch loop
- Conditional dispatch (security-review)
- Per-role allowedWrites
- Stage 5 approval derivation

That's the minimum bar for "I trust the system not to silently break when I edit it." Without it, every refactor is back to manual smoke tests.
