# Stage 04e — Peer-Review Preflight

Stage 04e is a **mechanical gate** that runs before peer-review (stage-05). It executes deterministic shell checks — no LLM invocation — to catch issues that would otherwise be flagged as BLOCKER by peer reviewers in the next stage.

## When it runs

`devteam preflight` runs it explicitly. It also runs **automatically** at the start of `devteam stage peer-review` unless:
- `pipeline/gates/stage-04e.json` already exists with `status: "PASS"` (stage manager ran it manually), OR
- the `--skip-preflight` flag is passed to `devteam stage peer-review`

## What it checks

### Check A — Git hygiene (`git_hygiene_pass`)

Finds committed files that are now covered by `.gitignore` rules.

**Why**: A common pipeline failure pattern is adding `*.pyc` or `__pycache__/` to `.gitignore` after the files have already been committed. Peer reviewers flag these as BLOCKERs; the stage manager must then re-run the full peer-review stage after fixing a mechanical issue that could have been caught earlier.

**Command**: `git ls-files --ignored --exclude-standard`

**On failure**: Lists affected files + a `git rm --cached` fix command.

### Check B — Import path verification (`import_path_pass`)

Scans `conftest.py` files for `sys.path.insert(0, ".")` which inserts the project root rather than `src/`. Combined with a `try/except ImportError` fallback, this silently causes tests to exercise a reference implementation instead of the production code path, producing false-positive PASS gates.

**Why**: If `from backend.main import app` fails because `backend` is not on `sys.path`, and the `except` clause activates an inline reference implementation, the test suite passes — but it is not testing the real code. Stage-06 (QA) produces a green gate while the actual backend is untested. Peer reviewers who inspect `conftest.py` flag this as a BLOCKER.

**Fix**: Change `sys.path.insert(0, ".")` to `sys.path.insert(0, "src")`.

### Check C — Deferred items risk (`deferred_items_count`)

Reads `pipeline/gates/stage-04c.json` `noted_for_followup[]` and counts items. Non-zero emits a **warning** (not a blocker): these items are known to often drive peer-review CHANGES REQUESTED.

**Why**: Red-team agents classify some findings as `noted_for_followup` rather than `must_address_before_peer_review`. Peer reviewers independently find the same issues and flag them as BLOCKERs, causing an avoidable round-trip. The warning gives the stage manager a chance to address them before dispatching reviewers.

## Gate file

`pipeline/gates/stage-04e.json` — written by `runPreflight()` in `core/preflight.js`.

Fields: `status` (PASS/FAIL), `blockers[]`, `warnings[]`, `git_hygiene_pass`, `import_path_pass`, `deferred_items_count`. Schema: `core/gates/schemas/stage-04e.schema.json`.

## Stage manager commands

```bash
# Run preflight manually
devteam preflight

# Force peer-review to re-run preflight even if stage-04e.json is PASS
devteam stage peer-review --skip-preflight

# After fixing a blocker, re-run preflight and then proceed
devteam preflight && devteam stage peer-review
```

## Fix-and-retry

See `docs/runbooks/fix-and-retry.md § Case 10` for step-by-step resolution of each blocker type.
