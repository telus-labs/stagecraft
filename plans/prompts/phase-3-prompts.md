# Phase 3 Prompts — Structural Debt

Suggested order: **3.7a → 3.7b → 3.3 → 3.1a → 3.1b → 3.1c → 3.2 → 3.4 → 3.5 → 3.6**.
Prerequisite: Phase 2 item 2.1 merged (the consistency checker protects these refactors).
Paste the PREAMBLE from [README.md](README.md), then one prompt.

**Extra rule for every prompt in this phase** (add this line after the preamble):
"This is a refactor phase. The standard is mechanical equivalence: npm test must pass
WITHOUT test edits unless the item explicitly authorizes them. If you find yourself editing
many tests, stop and report — the refactor has drifted into a rewrite."

---

## Prompt 3.7a — Bug basket A: guards and merging (3 fixes)

```
TASK: Implement fixes 1, 2, 5 from plans/phase-3-structural-debt.md item 3.7. All three are
[verify-first]: confirm each claim by reading the code; if a claim fails, skip that fix and
report. One commit per fix. Branch: fix/phase3-bugs-a

Fix 1 — write-audit quoted paths (core/guards/write-audit.js:41): `line.slice(3).trim()`
on `git status --porcelain` mis-parses paths git wraps in quotes (spaces/special chars,
C-style escapes) → false-positive violations flip PASS gates to FAIL. Preferred fix: switch
to `--porcelain -z` NUL-delimited output (no quoting at all); otherwise implement proper
unquoting. Write the regression test FIRST: a real temp git repo (tests/write-audit.test.js
already builds these) containing "file with space.js" listed in allowedWrites → no
violation. Note: 3 write-audit tests are conditional on DEVTEAM_HEADLESS_COMMAND=cat — run
with that env set locally to exercise them.

Fix 2 — mergeWorkstreamGates track trust (core/orchestrator.js:439): merged gate copies
wsGates[0].gate.track; if the model omitted it, merged.track is undefined and the validator
flags a gate the orchestrator itself wrote. Fix: fall back to the resolved pipeline track
(from config / custom_stages — read how the merge call sites obtain track). Test: workstream
gates without track → merged gate carries the resolved track.

Fix 5 — track-list literal drift: core/pipeline/stages.js exports the canonical TRACKS
(~line 412); core/gates/validator.js:78 and the doctor list (bin/devteam:1642) keep
independent copies. Import from the canonical source in both. Test: a meta-test asserting
the validator's accepted track set equals Object.keys-of-TRACKS (or however TRACKS is
shaped — read it first).

Done means: each confirmed fix has a test that fails before / passes after; npm test (with
DEVTEAM_HEADLESS_COMMAND=cat) and eslint green; CHANGELOG entry for the basket.
```

---

## Prompt 3.7b — Bug basket B: lifecycle and filtering (3 fixes)

```
TASK: Implement fixes 3, 6, 7 from plans/phase-3-structural-debt.md item 3.7. All
[verify-first]. One commit per fix. Branch: fix/phase3-bugs-b
(Fix 4, the replay race, is NOT in this prompt — it lands with prompt 3.1c.)

Fix 3 — config cache (core/config.js:48-53): loadConfig memoizes per-cwd forever;
clearConfigCache() exists but has no non-test caller. Implement BOTH plan options where
they apply: (a) `devteam assess --apply` calls clearConfigCache() after writing config;
(b) for the driver, READ the loop first and decide: either re-read config at iteration
boundaries, or add a comment stating config is intentionally pinned per-run — pick one,
justify in the comment, and report the choice. Test for (a): assess --apply then a
config-dependent read in the same process sees the new value.

Fix 6 — stage --workstream filter divergence: headless filtering lives inside
runStageHeadless (core/orchestrator.js:264); non-headless is re-implemented in cmdStage
(bin/devteam:444-453) AFTER all prompts render; fanout workstreams match differently per
mode. Fix: one filter in the orchestrator applied BEFORE rendering, shared by both modes;
define the fanout matching rule once (role-prefix match) in a comment. Tests: both modes
filter identically, including a review-fanout descriptor set.

Fix 7 — pricing silent null (core/pricing.js:42): unknown models price to null → budget
sums treat them as zero silently. Fix: when any consumed gate reports tokens for an
unpriced model, surface a WARN ("unpriced model X — budget enforcement incomplete") on the
cost report and wherever cost rollups render (read scripts/budget.js and the gate cost
rollup in mergeWorkstreamGates to find the right seams). Do NOT auto-update the pricing
table. Test: gate with tokens for model "future-model-9" → warning present, totals
unchanged.

Done means: as 3.7a — confirmed fixes tested, npm test / eslint green, CHANGELOG entry.
```

---

## Prompt 3.3 — Deduplicate marker-section helpers (+ inverted-marker bug)

```
TASK: Implement plans/phase-3-structural-debt.md, item 3.3. Read that section, then ALL
THREE implementations before writing anything: core/driver.js:152-165 (upsertSection),
core/gates/validator.js:~280 (stripMarkedSection), bin/devteam:~1802 (near-duplicate
strip). Branch: refactor/markers-module

Implement:
1. New core/markers.js: upsertSection(text, begin, end, body) and
   stripSection(text, begin, end). Handle inverted markers (end before begin) and missing
   end-marker explicitly: treat as corrupt, replace from begin-marker to
   end-marker-or-EOF, emit a warning. Document the chosen semantics in the module header.
   This fixes the verified bug where upsertSection appends a duplicate section on inverted
   markers (driver.js:153-159).
2. Point all three call sites at the module. Where the two strip implementations diverge
   in behavior, enumerate the divergence in your report and adopt the validator's behavior
   (it runs in hooks — least surprise wins) unless you find a concrete reason not to.
3. Unit tests for core/markers.js: normal upsert, inverted markers, missing end marker,
   duplicate sections in input, empty body.

Existing escalation/validator/driver tests are your callers' regression net — they must
pass unchanged unless a test specifically pinned the buggy duplicate-append behavior
(call it out if so).

Done means: one implementation remains (grep proves it); new unit tests pass; npm test /
eslint green; CHANGELOG entry.
```

---

## Prompt 3.1a — CLI refactor PR 1: schema-driven flag parser

```
TASK: Implement PR 1 of plans/phase-3-structural-debt.md, item 3.1. Read that section, then
parseFlags (bin/devteam:253-305 — note it now includes Phase 1.4's fixes) and every `Usage:`
string in bin/devteam. Branch: refactor/cli-flag-schemas

Implement:
1. New core/cli/flags.js: parseFlags(argv, schema), schema =
   { flagName: { type: "boolean"|"string"|"number"|"list", key?, description } }.
   Unknown flags still exit 2 with the same message format. "list" covers the repeatable
   flags (--workstream, --allow-stage, --auto-rule's comma-split — study their current
   semantics and preserve them exactly).
2. A FLAGS schema per command, co-located with each cmdX handler in bin/devteam (the file
   stays monolithic in this PR — commands move in PR 2).
3. Per-command --help generated from the schema, replacing the hand-maintained Usage
   strings. Keep the output format close to current (tests and docs reference it).
4. The Phase-1.4 --apply peek-ahead hack dissolves: assess's schema declares it boolean,
   advise's declares it string. Remove the hack; keep the Phase-1.4 tests green —
   they pin the user-visible behavior, which must not change.

tests/cli.test.js (subprocess-level) must pass UNCHANGED — it is the proof of mechanical
equivalence. Add unit tests for core/cli/flags.js: each type, unknown flag, generated help.

Done means: cli tests unchanged and green; flags.js unit-tested; npm test / eslint /
npm run consistency green (consistency catches help-text references in docs); CHANGELOG
entry.
```

---

## Prompt 3.1b — CLI refactor PR 2: extract command modules

```
TASK: Implement PR 2 of plans/phase-3-structural-debt.md, item 3.1, on top of merged 3.1a.
Branch: refactor/cli-command-modules

Move each command into core/cli/commands/<command>.js exporting
{ name, flags, run(positional, flags) }. bin/devteam becomes a thin dispatcher:
registry lookup → parse with the command's schema → run().

Hard requirements:
- Preserve the lazy getOrchestrator() property (bin/devteam:24) and its rationale comment:
  help/stages/doctor must not load the orchestrator. After the move, verify with:
  `node -e "console.time('t'); require('child_process').execSync('./bin/devteam help'); console.timeEnd('t')"`
  and compare against pre-refactor timing (within noise).
- Move commands in 3-4 groups with ONE COMMIT PER GROUP, running npm test between groups:
  group 1 read-only (help, stages, doctor, summary, log), group 2 pipeline commands
  (stage, next, merge, run, restart, preflight, assess, advise…), group 3 tooling
  (replay, reproduce, ci, release-adjacent, memory, ui…). Derive the exact grouping from
  the actual command list in main()'s switch (bin/devteam:2634).
- Pure mechanical moves: no logic changes, no renames beyond the module structure.
- [verify-first] Before starting, grep tests/ for direct requires of bin/devteam internals;
  if any exist, list them and adapt the move to keep them working (or update them with
  justification).

tests/cli.test.js must pass UNCHANGED throughout.

Done means: bin/devteam is a dispatcher (<~400 lines); per-group commits each green;
npm test / eslint green; timing check in report; CHANGELOG entry.
```

---

## Prompt 3.1c — CLI refactor PR 3: push misplaced logic into core (+ replay race fix)

```
TASK: Implement PR 3 of plans/phase-3-structural-debt.md item 3.1, plus item 3.7 fix 4
(they touch the same code). Read both sections first. Branch: refactor/cli-logic-to-core

Part A — relocate logic: the replay command module contains gate snapshot/restore logic
(originally bin/devteam:1447-1451 region; now in core/cli/commands/replay.js after 3.1b)
that belongs in core/gates/. Move it to a core/gates/ helper. Audit the other command
modules for direct gate/pipeline file manipulation and relocate the same way; target state
is command modules = argument handling + output formatting only. List every relocation in
your report.

Part B — fix the verified replay clobber-and-restore race while the code is in hand:
today the headless run overwrites the original workstream gate and it is restored from
process memory afterwards; a crash between leaves the original silently replaced (the code
comment admits atomicity was waived). Implement the plan's fix: snapshot the original gate
to pipeline/gates/.replay-backup/<name>.json on disk BEFORE dispatch; restore from disk;
delete backup on success; on startup, `devteam replay` detects a leftover backup, says so,
and offers restoration.

Tests: tests/replay.test.js extensions — backup exists during dispatch (observable with a
DEVTEAM_HEADLESS_COMMAND that asserts/captures mid-run state), restore on success path,
leftover-backup detection path. Existing replay tests must keep passing.

Done means: command modules contain no direct gate file manipulation (grep evidence in
report); race fix tested; npm test / eslint green; CHANGELOG entry.
```

---

## Prompt 3.2 — computeFixSteps → per-stage recipe registry

```
TASK: Implement plans/phase-3-structural-debt.md, item 3.2. Read that section, then
core/orchestrator.js:662-1099 (computeFixSteps and helpers, including
clearGatesFromFixSteps at :647 and _wsFromText) and tests/next.test.js in full before
writing anything. Branch: refactor/fix-recipe-registry

The inversion you are fixing: human-readable `rm pipeline/gates/...` strings are generated
first and then PARSED BACK into structured clear_gates. Data must come first.

Implement per the plan item:
1. core/pipeline/fix-recipes.js: one recipe entry per stage —
   { stage, diagnose(gate, ctx) → { clear_gates, steps, notes } } — plus a default recipe.
2. clear_gates produced directly as data; the human-readable command strings DERIVED from
   it by one formatter; delete clearGatesFromFixSteps.
3. Port ONE STAGE PER COMMIT. After each commit, the existing fix-steps/next tests must
   pass byte-stable (prefer exact-equal output; if formatting must change, update tests
   knowingly and call it out).
4. Stage-05's three sub-cases become stage-05's recipe entry. Do NOT touch the broader
   stage-05 special-casing in rolesForStage / requiredApprovalsFor / computeDispatchPlan —
   leave one comment noting it as known debt.
5. Add a registry test: every stage in STAGES resolves to a recipe (default or specific).

Done means: orchestrator.js shrinks ~400 lines; tests/next.test.js green (edits, if any,
enumerated and justified); npm test / eslint green; CHANGELOG entry.
```

---

## Prompt 3.4 — Make @huggingface/transformers optional

```
TASK: Implement plans/phase-3-structural-debt.md, item 3.4. Read that section, then
core/memory/embed.js, tests/memory.test.js, and the doctor's checks. Branch:
refactor/optional-transformers

1. Move @huggingface/transformers from dependencies to optionalDependencies in
   package.json (preserve the version specifier).
2. core/memory/embed.js: wrap the require; on MODULE_NOT_FOUND throw a clear, actionable
   error naming the install command. Verify no OTHER file requires it (grep).
3. devteam doctor reports embedding availability as informational, never as failure.
4. [verify-first] tests/memory.test.js uses DEVTEAM_EMBEDDING_PROVIDER=stub — confirm how
   provider selection works and whether an absent-module path is testable without
   uninstalling (e.g. by injecting a require-failure seam). If not cleanly testable,
   test the error-message function directly and say so.

Done means: npm test / eslint green; in a TEMP CLONE, `npm install --omit=optional` then
devteam doctor + devteam next work and devteam memory fails with the actionable message
(paste the transcript); CHANGELOG entry with an Honest scope note that npm installs
optionals by default so most users see no change.
```

---

## Prompt 3.5 — Declare POSIX-only (and the cheap correctness wins)

```
TASK: Implement plans/phase-3-structural-debt.md, item 3.5. Read that section first.
Branch: docs/posix-only
The DECISION is already made: declare POSIX-only now; do not attempt a Windows port.

1. README prerequisites + docs/faq.md: state macOS/Linux (incl. WSL2) support explicitly,
   one short paragraph each, matching the docs' existing candid tone.
2. devteam doctor and devteam init: on process.platform === "win32", print a clear
   warning recommending WSL2. Warning only — no hard exit.
3. docs/BACKLOG.md: add a Windows-port item (bucket A) listing the three known breakage
   points with their locations: `which` subprocess in doctor (bin/devteam:1664 — pre-3.1
   anchor; locate post-refactor), whitespace command splitting (core/adapters/headless.js:66,
   core/escalation.js:347), POSIX rm strings in fix steps. Follow the BACKLOG's
   impact/effort entry format.
4. Cheap wins that also help POSIX:
   a. Replace the `which` subprocess with an in-Node PATH probe (no child process).
   b. [verify-first] The headless command splitter: confirm it naively splits on
      whitespace; make it THROW a clear error when the command string contains quote
      characters, rather than silently mis-splitting. Do not implement full quoting.
5. Test for the doctor warning: [verify-first] check how (or whether) platform-dependent
   behavior is currently tested; stub process.platform if the codebase has a pattern for
   it, otherwise test the warning function directly.

Done means: npm test / eslint / npm run consistency green; CHANGELOG entry.
```

---

## Prompt 3.6 — Test the untested + coverage signal

```
TASK: Implement plans/phase-3-structural-debt.md, item 3.6. Branch: test/untested-core

1. [verify-first] Confirm core/a11y-fixer.js and core/preflight.js still have no test file
   (grep tests/ for requires/references). For each still-untested module:
   - READ THE MODULE FULLY first.
   - Write behavioral tests following the nearest sibling pattern. For preflight: drive
     runPreflight(cwd, { track, skipWrite }) over fixture projects (the bin/devteam:518
     call site shows the API). For a11y-fixer: identify its pure core and test
     representative inputs including at least one malformed-input case.
   - Target meaningful behavior coverage, not line-coverage theater: every exported
     function, happy path + the failure modes the module's own comments mention.
2. Coverage signal in CI: add a separate NON-BLOCKING step to .github/workflows/test.yml
   running `node --test --experimental-test-coverage tests/*.test.js`, reporting only.
   Do NOT add a threshold. Record the baseline percentage in your report and in a comment
   in the workflow file.

Done means: new test files pass; npm test / eslint green; baseline coverage number in
report; CHANGELOG entry.
```
