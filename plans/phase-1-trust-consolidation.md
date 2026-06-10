# Phase 1 — Trust Consolidation

**Goal:** close the safety gaps in the newly-shipped autonomous path (`devteam run`) and fix
verified CLI bugs, before anyone runs the framework unattended on real work. No new features.

**Why first:** the autonomy program (ADR-003 Phases 0–2) just landed. Every item here is a case
where the framework's *stated* guarantee and its *actual* behavior diverge. Those divergences are
trust-killers for a framework whose differentiator is "verified, not trusted."

All line numbers verified against commit `212c710`.

---

## 1.1 Enforce the stoplist on the autonomous path

**Severity: highest in this phase.**

**Problem:** the safety stoplist (auth/credentials/PII/payments/migrations phrases that force the
`full` track) is enforced only in the interactive path. `cmdStage` calls `checkStoplist`
(bin/devteam:329, with the track-applicability constant at bin/devteam:33-35), but the autonomous
driver (`devteam run`, core/driver.js) never calls it — it dispatches via `runStageHeadless`
directly. So `devteam run --track quick` on an auth-touching change bypasses the strongest guard,
on exactly the path (unattended) where it matters most.

**Change:**
1. Move the "which tracks the stoplist applies to" constant from bin/devteam:33-35 into
   `core/guards/stoplist.js` (export e.g. `STOPLIST_TRACKS`), and import it in bin/devteam so
   there is one source of truth.
2. In `core/driver.js`, at run start (after track resolution, before the first iteration of the
   loop), call `checkStoplist({ description, cwd })` when the resolved track is in
   `STOPLIST_TRACKS`. The description source: the feature text if available in run options,
   else empty string — `checkStoplist` also scans `pipeline/brief.md` on disk
   (see `collectScanStrings` in core/guards/stoplist.js:66).
3. On a match: do **not** dispatch. Halt with a new typed halt (reuse the existing halt
   plumbing — see how `judgment-gate` halts are surfaced) with `halt_action: "stoplist"`,
   render `explainMatches()` output, write the halt to `run-log.jsonl`, and exit non-zero.
4. Mid-run guard: also run the check when the driver is about to dispatch **stage-04 (build)**,
   because the brief may have been written *by* the run after start (requirements stage) and the
   start-of-run check would have seen no brief. One check at run start + one before build is
   sufficient; do not check every stage.

**Do not** change behavior for `full` and `hotfix` tracks (they bypass by design — keep the
comment from bin/devteam:33-35 explaining why).

**Tests:** in tests/run.test.js style (injected deps), add:
- run with `--track quick` + a brief containing a stoplist phrase → halts before dispatch,
  `run-log.jsonl` contains the stoplist halt event, exit path matches other halts.
- same brief with `--track full` → no halt.
- brief written mid-run (inject a `runStageHeadless` fake that writes a stoplist-matching brief
  during requirements) → halt before stage-04 dispatch.

**Verify:** `npm test`; `npx eslint .`; manual: in a temp project,
`devteam init --host generic`, write a brief mentioning "password storage", run
`DEVTEAM_HEADLESS_COMMAND=true devteam run --track quick --max-iterations 2` → must refuse.

**Docs touched (only these):** docs/runbooks/autonomous-run.md halt-action table (add `stoplist`),
CHANGELOG `[Unreleased]`.

---

## 1.2 Make `next()` actually pure — extract the sign-off auto-fold write

**Problem:** core/orchestrator.js:483 documents `next()` as "Pure read; never mutates state", and
core/driver.js's design comments rely on that. But `tryAutoFoldSignOff` (orchestrator.js:538,
called from `_nextImpl` at orchestrator.js:1122) **writes `pipeline/gates/stage-07.json`** with
`pm_signoff: true` as a side effect of asking "what's next?". Consequences: (a) two load-bearing
comments are false; (b) the driver's consequence ceiling for `sign-off` is silently satisfied by a
gate the orchestrator wrote during a read.

**Decision (do this, not the alternatives):** keep the auto-fold *feature* (sign-off is mechanical
when the AC mapping is clean — that's sound), but move the **write** out of `next()`:

1. Change `tryAutoFoldSignOff` to a pure function that returns the folded gate object (or null)
   without writing.
2. `_nextImpl` returns a new action `fold-sign-off` carrying the gate content in the action
   payload (follow the existing versioned action-schema pattern, bin/devteam:718 region —
   bump the schema version if the schema is versioned per-action-set).
3. Callers perform the write:
   - `cmdNext` (bin/devteam): on `fold-sign-off`, write the gate, print what happened, then
     re-run `next()` and show the subsequent action (preserves current single-command UX).
   - `core/driver.js`: on `fold-sign-off`, write the gate, append a distinct
     `{"event":"auto-fold-sign-off", "derived_from": "brief AC mapping"}` record to
     `run-log.jsonl`, and continue the loop. **Do not** require `--allow-stage sign-off` for the
     fold itself — the fold is orchestrator-derived from verified AC mapping, not model-asserted —
     but it must now be visible in the audit log (today it is invisible).
4. Update the purity comments (orchestrator.js:483, driver.js header) to state the new contract:
   `next()` never writes; the `fold-sign-off` action is the mechanism by which callers write.

**Compatibility:** any test or consumer asserting that calling `next()` twice produces the folded
state must be updated to execute the action first. Search tests for `auto-fold` /
`tryAutoFoldSignOff` (tests/auto-fold.test.js exists) and update deliberately — say so in the PR.

**Tests:** auto-fold tests assert (a) `next()` leaves the gates dir byte-identical (snapshot dir
before/after), (b) `fold-sign-off` action payload validates against the gate schema, (c) driver
writes the gate + log event and proceeds, (d) cmdNext end-to-end via `runCLI` still reaches
`pipeline-complete` on a clean nano run (tests/pipeline-e2e.test.js will catch regressions).

**Verify:** `npm test`; `npx eslint .`; grep that no `fs.write` remains reachable from `_nextImpl`.

---

## 1.3 Gate validator: fail closed where it matters

**Problem:** `runMain()` in core/gates/validator.js treats any unknown internal error as PASS,
exit 0 (validator.js:625-627: "internal error: …; treating as PASS"). The validator underpins the
tamper-evident chain and CI blocking; fail-open means a validator bug silently green-lights
everything. Additionally the bypassed-escalation sweep orders gates by **mtime**
(validator.js:411-421 region — confirm exact lines), so `git checkout` or `touch` can change
verdicts.

**Change:**
1. Add a `--strict` mode to the validator CLI (and/or honor `CI=true`): in strict mode, the
   unknown-error path exits **1** with the error message, never 0. Keep the current
   warn-and-pass behavior for the **hook** invocation path only (the documented rationale —
   don't kill a user's interactive session on a validator bug — is legitimate *there*), but
   even in hook mode, append the error to `pipeline/validator-errors.log` so failures are
   discoverable instead of vanishing.
2. Update the shipped CI template (templates/ci/github-actions/stagecraft-pr-checks.yml) and
   `devteam ci install` output so CI invocations pass `--strict`.
3. Replace mtime ordering in the escalation sweep with a content-derived order: sort by the
   gate's own `timestamp` field, falling back to stage order from `core/pipeline/stages.js`.
   Document why mtime was wrong in a comment.

**Tests:** extend tests/gate-validator.test.js (it already drives exit codes via `spawnSync`):
inject an unreadable/corrupt condition that reaches the unknown-error path (e.g. make a gates
*file* where a directory is expected, or monkeypatch via a wrapper script) → exit 0 + log file in
hook mode, exit 1 in `--strict`. Add an mtime-manipulation test (`fs.utimesSync`) asserting the
verdict no longer changes.

**Verify:** `npm test`; `npx eslint .`; `npm run consistency`.

---

## 1.4 Fix the flag-parsing bugs (verified)

**Problem:** `parseFlags` (bin/devteam:253-305) is one flat vocabulary for ~28 commands.
Verified consequences:
- `--apply` is value-taking (bin/devteam:294, for `advise --apply AC-11=A`), but `cmdAssess`
  uses it as a boolean. `devteam assess --apply --json` swallows `--json` as the value;
  `devteam assess --apply` (last arg) sets `flags.apply = undefined` → **silently does not apply**.
- `--skip-write`, `--skip-preflight`, `--skip-advise` are checked (bin/devteam:518, 340, 726)
  but absent from `parseFlags` → `Unknown flag` exit 2. The guards are dead code and the
  documented flags are unusable.

**Change (minimal — the full per-command schema refactor is Phase 3 item 3.1):**
1. Add the three `--skip-*` flags to `parseFlags` as booleans, keys matching the existing
   checks (`flags["skip-write"]`, `flags["skip-preflight"]`, `flags["skip-advise"]`).
2. For `--apply`: peek the next arg — if absent or it starts with `--`, set `flags.apply = true`
   (boolean) without consuming; otherwise consume as value (preserves `advise --apply AC-11=A`).
   Update `cmdAssess` to accept `flags.apply === true`; update `cmdAdvise` to error clearly if
   `flags.apply === true` (it requires a value).
3. Audit the rest: grep `flags\[\"` and `flags\.` in bin/devteam for every key, and confirm each
   has a `parseFlags` entry; list any further orphans found in the PR description and fix the
   same way.

**Tests:** add to tests/cli.test.js via `runCLI`: `assess --apply --json` produces JSON **and**
applies; `assess --apply` (terminal) applies; `advise --apply AC-11=A` unchanged;
`preflight --skip-write` no longer exits 2.

**Verify:** `npm test`; manual spot-check of the four commands above in a temp project.

---

## 1.5 codex/gemini adapters: render PATCH MODE (+ shared rendering)

**Problem:** `renderStagePrompt` in hosts/claude-code/adapter.js:346-363 and
hosts/generic/adapter.js:36-53 render the `ctx.patchItems` "PATCH MODE — targeted fix only"
block. hosts/codex/adapter.js and hosts/gemini-cli/adapter.js never read `ctx.patchItems`
(verified by grep). `--patch --from <stage>` is the centerpiece of the fix-and-retry runbook;
a patch workstream routed to codex/gemini loses its scoping constraint entirely.

**Change:**
1. Extract the PATCH MODE block rendering into `core/adapters/render-helpers.js` (it already
   exists and is the shared-rendering home — follow its existing export style) as
   `renderPatchBlock(ctx)`, and call it from **all four** adapters. Take the claude-code
   wording as canonical.
2. While there: codex and gemini-cli adapters are ~95% identical (158/159 LOC). Do **not** do a
   full base-class refactor here (scope creep); only extract what PATCH MODE needs. Note the
   dedup opportunity in a code comment referencing Phase 3.
3. `hosts/gemini-cli/capabilities.json` is missing the `goalLoop` capability key that codex and
   claude-code declare. `[verify-first]` Check whether gemini CLI headless actually supports the
   goal-loop pattern (see `goalCondition` consumers in core/pipeline/stages.js and the goal-loop
   tests). If it's simply an omission, add it; if genuinely unsupported, add an explicit
   `"goalLoop": false` with a comment so absence is never ambiguous again.

**Tests:** extend tests/adapter-contract.test.js (it already byte-pins the shared gate footer
across hosts): for every host with `renderStagePrompt`, rendering a descriptor with `patchItems`
must include the normalized PATCH MODE block; rendering without `patchItems` must not.

**Verify:** `npm test`; `npx eslint .`.

---

## 1.6 Bounded isolation (B9): finish the wiring

**Problem:** `core/paths.js` cleanly maps `changeId → pipeline/changes/<id>/…` and dispatch
honors it, but `next()` (orchestrator.js:494), `summary()` (orchestrator.js:1270), and the driver
(driver.js:54-57 — lock, run-state, run-log, gates) hardcode `path.join(cwd, "pipeline", …)`.
In bounded mode, dispatch writes gates where `next()` never looks: the pipeline appears
permanently "not started".

**Change:** thread `changeId` through the read side:
1. `next()`, `summary()`, and every helper they call that touches `pipeline/` paths
   (orchestrator.js:552-553, 579 — brief, test-report, runbook) must resolve paths via
   `core/paths.js` (`gatesDir(cwd, changeId)`, `prefixPipelineRelative`).
2. The driver's four path helpers (driver.js:54-57) and the context.md path (driver.js:165)
   likewise take `changeId`.
3. `changeId` resolution: follow however `runStage`/`runStageHeadless` currently obtain it
   (config / flag) — reuse that mechanism, do not invent a new flag.
4. If after step 3 some surface genuinely cannot support bounded mode yet, make `loadConfig`
   **reject** `isolation: bounded` with a clear error listing the unsupported command, rather
   than leaving silent breakage. Silent-wrong is the only unacceptable outcome.

**Tests:** extend tests/bounded-workspace.test.js with an end-to-end: bounded config →
seed gates under `pipeline/changes/<id>/gates/` → `next()` advances; `summary()` reports them;
a short driver run (injected deps) reads/writes everything under the change root.

**Verify:** `npm test`; grep `path.join(cwd, "pipeline"` in core/ — remaining hits must each
have a comment justifying why they are changeId-exempt (e.g. genuinely global state).

---

## 1.7 Small hardening (one PR, three fixes)

1. **`summary()` crash on status-less gate** (verified): orchestrator.js:1316 does
   `gate.status.toLowerCase()` guarded only by `gate ?`; orchestrator.js:1319 same for
   `w.status`. A valid-JSON gate without `status` throws and takes down `devteam summary` and
   the UI's `/api/state`. Fix: `(gate.status || "unknown").toLowerCase()` pattern in both spots;
   render `unknown` distinctly. Test: gate file `{}` → summary succeeds with `unknown`.
2. **Secret-scan bypass scope** (verified): core/hooks/secret-scan.js:123 disables the entire
   scan if `devteam-allow-secret:` appears **anywhere** in the content — content the scanned LLM
   writes. Change to per-line scoping: the magic comment only suppresses findings on its own
   line (and optionally the immediately following line, matching common comment-above-code
   style). Additionally, every suppression appends `{file, line, reason}` to
   `pipeline/secret-allowlist.log` so suppressions are auditable. Update the hook's stderr help
   text (secret-scan.js:215) and tests/secret-scan.test.js accordingly.
3. **Budget cap blind spot** `[verify-first]`: driver budget check (driver.js:107-119 region)
   sums only **merged** stage gates and only pre-dispatch, so a multi-role stage's cost is
   invisible until after its merge. Confirm by reading the cost-summing code; then include
   unmerged per-workstream gate costs (`pipeline/gates/stage-NN.<role>.json`) in the sum.
   Test: workstream gates with `cost_usd` exceeding the cap, no merged gate → next dispatch
   refused.

**Verify:** `npm test`; `npx eslint .`.

---

## Sequencing & exit criteria

Order: 1.4 (unblocks clean CLI testing) → 1.1 → 1.2 → 1.3 → 1.5 → 1.6 → 1.7.
Items are independent except where noted; one PR each.

**Phase exit:** all seven merged; `npm test` green; a manual smoke of
`devteam run` on a stoplist-matching brief halts; CHANGELOG updated per item.
Do **not** start Phase 2's doc sweep until 1.1–1.5 are merged (the sweep documents the new
behavior; documenting first would recreate drift).
