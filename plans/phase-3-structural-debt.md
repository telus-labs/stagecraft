# Phase 3 — Structural Debt

**Goal:** pay down the engineering debt that makes changes risky: the bin/devteam god-file, the
fix-steps if-ladder, triplicated helpers, the heavyweight dependency, the Windows question, and a
basket of verified-or-flagged small bugs. No behavior changes except where a bug is being fixed.

**Prerequisite:** Phase 2 item 2.1 merged — the consistency checker plus the existing 1,161-test
suite are the safety net for these refactors.

**Sonnet guidance for this phase:** these items are refactors. The standard is *mechanical
equivalence*: after each step, `npm test` must pass **unchanged** (no test edits) unless the item
explicitly says a test encodes a bug. If you find yourself editing many tests, stop — the
refactor has drifted into a rewrite.

All line numbers verified against commit `212c710` unless marked `[verify-first]`.

---

## 3.1 Split `bin/devteam` into per-command modules with flag schemas

**Problem:** bin/devteam is 2,683 lines: flag parsing, 28 command handlers, replay/gate-restore
logic, formatted output. The single flat `parseFlags` (bin/devteam:253-305) is shared mutable
vocabulary across all commands — the Phase 1.4 bugs (`--apply` collision, dead `--skip-*` flags)
were direct products of it. Commands also mix concerns (`cmdReplay` contains gate-restore logic
that belongs in core — the clobber-and-restore race at bin/devteam:1447-1451 is item 3.7.4).

**Approach — three sequenced PRs, tests green after each:**

**PR 1 — schema-driven parser.** Add `core/cli/flags.js`: `parseFlags(argv, schema)` where
schema is `{ flagName: { type: "boolean"|"string"|"number"|"list", key?, description } }`.
Unknown-flag handling stays exit 2. Each command gets a `FLAGS` schema co-located with its
handler; `--help` per command is generated from the schema (replacing hand-maintained usage
strings — grep `Usage:` in bin/devteam for all of them). The `--apply` dual-mode hack from
Phase 1.4 dissolves naturally: `assess`'s schema declares it boolean, `advise`'s declares it
string. Keep bin/devteam monolithic in this PR — only the parser moves.

**PR 2 — extract command modules.** `core/cli/commands/<command>.js`, each exporting
`{ name, flags, run(positional, flags) }`. bin/devteam becomes a thin dispatcher: registry
lookup → parse with the command's schema → `run()`. Preserve the lazy `getOrchestrator()`
pattern (bin/devteam:24 — the rationale comment explains keeping `help`/`stages`/`doctor` fast;
keep that property and the comment). Move in 3–4 groups (read-only commands first:
help/stages/doctor/summary/log; then pipeline commands; then replay/ci/release tooling),
one commit per group, `npm test` between groups.

**PR 3 — push misplaced logic into core.** `cmdReplay`'s gate snapshot/restore → a
`core/gates/` helper (coordinates with 3.7.4); any other handler doing direct gate/pipeline file
manipulation gets the same treatment. Target: command modules contain argument handling +
output formatting only.

**Tests:** tests/cli.test.js drives `bin/devteam` as a subprocess, so it is the regression net —
it must pass unchanged through all three PRs. Add `core/cli/flags.js` unit tests (boolean vs
value vs list, unknown flag, generated help). `[verify-first]` Check whether any test imports
bin/devteam internals directly; if so, list them before starting.

**Verify per PR:** `npm test` (unchanged), `npx eslint .`, `devteam --help` and 3 spot commands
in a temp project, `npm run consistency` (catches help-text references in docs).

---

## 3.2 `computeFixSteps`: per-stage recipe registry

**Problem:** core/orchestrator.js:662-1099 (~440 lines) is a per-stage if-ladder with nested
heuristics (`_wsFromText` regex role attribution, three stage-05 sub-cases). Every new stage
adds a branch. Worse, the data flow is inverted: human-readable `rm pipeline/gates/...` command
strings are generated first and then **parsed back** into structured `clear_gates`
(`clearGatesFromFixSteps`, orchestrator.js:647) — the code comments themselves acknowledge this.

**Change:**
1. Define a recipe entry per stage (data-first):
   `{ stage, diagnose(gate, ctx) → { clear_gates: [...], steps: [...], notes } }` in a new
   `core/pipeline/fix-recipes.js`, keyed by stage ID, with a default recipe for stages without
   special cases.
2. `clear_gates` is now produced directly as data; the human-readable `rm`/retry command strings
   are **derived** from it (one formatter), deleting `clearGatesFromFixSteps`.
3. Port the existing branches one stage per commit, snapshot-testing equivalence: for each
   existing fix-steps test fixture, old output == new output (steps text may be reformatted only
   if tests are updated knowingly — prefer byte-stable).
4. Stage-05's three sub-cases stay special — but as stage-05's recipe entry, not orchestrator
   inline code. Note (don't fix here) the broader stage-05 special-casing in `rolesForStage` /
   `requiredApprovalsFor` / `computeDispatchPlan` — leave a comment; unifying peer-review's
   "areas not roles" model is out of scope.

**Tests:** existing next/fix-steps tests are the harness (tests/next.test.js is 577 lines and
covers this heavily). Add one registry test: every stage in `STAGES` resolves to a recipe.

**Verify:** `npm test` unchanged; `npx eslint .`; line count of orchestrator.js drops ~400.

---

## 3.3 Deduplicate marker-section helpers (and fix the inverted-marker bug)

**Problem:** three copies of begin/end-marker section logic exist with two slightly different
behaviors: core/driver.js:152-165 (`upsertSection`), core/gates/validator.js:280 region
(`stripMarkedSection`), bin/devteam:1802 region (near-duplicate strip). The bin copy's own
comment says "extract when a third caller appears" — it has. Verified bug: `upsertSection`
appends a duplicate section when markers are inverted (`end < begin`, e.g. a hand-edited
context.md) — driver.js:153-159.

**Change:** new `core/markers.js` with `upsertSection(text, begin, end, body)` and
`stripSection(text, begin, end)`; inverted/missing-end markers are handled explicitly (treat as
corrupt: replace from begin-marker to end-marker-or-EOF, and log a warning) — document the
chosen semantics in the module header. Point all three callers at it. Where the two strip
implementations diverge, enumerate the divergence in the PR description and pick one behavior
deliberately (validator's is the one running in hooks — least surprise wins).

**Tests:** unit tests for core/markers.js incl. inverted markers, missing end, duplicate
sections, empty body. Existing escalation/validator/driver tests confirm callers.

**Verify:** `npm test`; grep confirms a single implementation remains.

---

## 3.4 Make `@huggingface/transformers` optional

**Problem:** it's a hard runtime dependency (node_modules ≈ 447 MB) for `devteam memory`
embeddings, which most invocations never touch. It's already lazily `require`d, so the install
cost is the only issue — but it's paid by every adopter of an orchestration CLI.

**Change:**
1. Move to `optionalDependencies` in package.json (or document
   `npm install --no-optional` — prefer optionalDependencies so default installs still work).
2. In core/memory/embed.js, wrap the require: on MODULE_NOT_FOUND, throw a clear actionable
   error ("devteam memory's local embeddings need the optional dependency:
   npm install @huggingface/transformers") — and make sure `devteam doctor` reports embedding
   availability as informational, not failure.
3. CI: keep installing it (npm ci installs optionals by default) so memory tests still run;
   add one test that simulates absence (`DEVTEAM_EMBEDDING_PROVIDER=stub` already exists —
   `[verify-first]` check how tests/memory.test.js selects providers and whether an
   absent-module path is testable without uninstalling).

**Verify:** `npm test`; fresh `npm install --omit=optional` in a clone → `devteam doctor`,
`devteam next` work; `devteam memory` fails with the actionable message.

---

## 3.5 Windows: decide, then make the decision true

**Problem:** silently broken on Windows in at least three places: `cmdDoctor` shells out to
`which` (bin/devteam:1664); headless command strings split on whitespace (headless.js:66,
escalation.js:347) so `C:\Program Files\...` paths can't be invoked; fix-step command strings
are POSIX `rm` (orchestrator.js:636 region — after 3.2 these come from the formatter).
Forward-slash normalization exists elsewhere (paths.js, write-audit.js), so intent is
inconsistent.

**Decision for this plan: declare POSIX-only now; don't half-fix.** A correct Windows port
(command quoting, signals, path semantics in hooks) is real work with no demonstrated demand.
1. README prerequisites + docs/faq.md: state macOS/Linux (incl. WSL2) support explicitly.
2. `devteam doctor` and `devteam init`: on `process.platform === "win32"`, print a clear
   warning recommending WSL2 (warning, not hard exit).
3. File the Windows port as a BACKLOG item (bucket A, with the three known breakage points
   listed) so the decision is revisitable with the evidence attached.
4. Cheap correctness wins that also help POSIX: replace `which` with a PATH probe in Node
   (no subprocess), and have the headless command splitter `[verify-first]` at minimum throw a
   clear error on quoted segments rather than mis-splitting silently.

**Verify:** `npm test`; doctor warning unit-testable by stubbing `process.platform`
(`[verify-first]` check how other platform-dependent code is tested, if any).

---

## 3.6 Test the untested + coverage signal

1. `core/a11y-fixer.js` and `core/preflight.js` are the only core modules with no test file
   (verified by grep at review time — re-verify). Write behavioral tests following the nearest
   sibling pattern (preflight: tests around `runPreflight(cwd, { track, skipWrite })`
   per bin/devteam:518; a11y-fixer: read the module first, test its pure core).
2. Add a non-blocking coverage job: `node --test --experimental-test-coverage` in CI as a
   separate step that reports but never fails the build. Record the baseline number in the PR.
   Do **not** add a threshold yet — thresholds without history invite gaming.

**Verify:** `npm test`; CI run shows the coverage summary.

---

## 3.7 Small-bug basket (one PR each or pair related ones; all `[verify-first]`)

Each was found by a review agent with file:line but not independently re-verified — confirm
before fixing, and write the regression test first:

1. **write-audit quoted paths** (core/guards/write-audit.js:41): `line.slice(3).trim()` on
   `git status --porcelain` output mis-parses paths git wraps in quotes (spaces/special chars,
   C-style escapes) → false-positive violations flip PASS gates to FAIL. Fix: unquote/unescape
   porcelain paths (or use `-z` NUL-delimited output, which is cleaner). Test: repo with
   `file with space.js` in allowedWrites → no violation.
2. **`mergeWorkstreamGates` track trust** (core/orchestrator.js:439): copies
   `wsGates[0].gate.track`; if the model omitted it, merged gate ships `track: undefined` and
   the validator flags a gate the orchestrator itself wrote. Fix: fall back to the resolved
   pipeline track (config/custom_stages) when workstream gates omit it.
3. **Config cache never invalidates in-process** (core/config.js:48-53): memoized per-cwd
   forever; `devteam assess --apply` then reads stale config in the same process; long
   `devteam run` sessions never see YAML edits. Fix: `assess --apply` calls the existing
   `clearConfigCache()` after writing; driver re-reads config at loop iteration boundaries
   (or at minimum documents that it intentionally pins config for the run — pick one, comment why).
4. **Replay clobber-and-restore race** (bin/devteam:1447-1451): the headless run overwrites the
   original workstream gate, restored from memory afterwards; a crash between leaves the
   original silently replaced. Fix (lands naturally with 3.1 PR 3): snapshot the original gate
   to `pipeline/gates/.replay-backup/<name>.json` on disk *before* dispatch, restore from disk,
   delete backup on success; on startup, `devteam replay` detects a leftover backup and offers
   restoration.
5. **Track-list literals drift** (stages.js:412 is canonical; validator.js:78 and the doctor's
   list in bin/devteam:1642 are independent copies): import `TRACKS` in both.
6. **`stage --workstream` filter divergence**: headless filtering inside `runStageHeadless`
   (orchestrator.js:264) vs non-headless re-implementation in cmdStage (bin/devteam:444-453,
   applied *after* rendering all prompts); fanout workstreams make `--workstream backend` match
   differently per mode. Fix: single filter in the orchestrator applied before rendering; define
   the fanout-matching rule once (document: role-prefix match) and test both modes against it.
7. **`pricingFor` prefix matching + silent null** (core/pricing.js:42): unknown models price to
   null → budget under-counts to zero silently. Fix: when pricing is unknown, surface a WARN on
   the gate/cost report ("unpriced model X — budget enforcement incomplete") instead of silent
   zero. Keep the table hand-maintained (per ARCHITECTURE decision on no API-level cost
   enforcement) but make staleness *visible*.

**Verify:** per item: new regression test fails before fix, passes after; `npm test` green.

---

## Sequencing & exit criteria

3.3 and 3.7 anytime; 3.1 before 3.2 is *not* required (different files) but 3.1 PR 3 and 3.7.4
touch the same code — coordinate. Suggested order: 3.7 basket → 3.3 → 3.1 (three PRs) → 3.2 →
3.4 → 3.5 → 3.6.

**Phase exit:** bin/devteam < ~400 lines (dispatcher + registry); no flat shared flag
vocabulary; `clear_gates` produced as data; one marker-helper implementation; install footprint
down ~400 MB for `--omit=optional`; platform support stated honestly; zero known-untested core
modules.
