# Phase 2 — Consistency Made Mechanical, Docs Sweep, Release

**Goal:** stop fixing prose/code drift by hand. Extend the existing consistency checker so the
drift classes found in the review can never silently recur, then do one guided sweep to fix the
current instances, cut the per-stage token cost, and ship a release.

**Why the order inside this phase matters:** the checker (2.1) lands first so the sweep (2.2)
is driven by its output, not by a hand-curated list that goes stale the day it's written.

**Prerequisite:** Phase 1 items 1.1–1.5 merged (the sweep must document post-fix behavior).

All line numbers verified against commit `212c710` unless marked `[verify-first]`.

---

## 2.1 Extend `scripts/consistency.js` with prose-vs-code checks

**Context:** `scripts/consistency.js` already exists, runs in CI as `npm run consistency`, and is
meta-tested by tests/consistency-meta.test.js. tests/contract.test.js already pins some
stages↔schemas↔roles↔templates relationships. Extend, don't replace.

**New check classes** (each independently reportable, with file:line in output):

1. **Gate filename references.** Scan `rules/`, `roles/`, `docs/runbooks/`, `skills/` for
   anything matching `stage-\d+[a-z]?[._-][A-Za-z-]*\.json` and validate against the canonical
   names derivable from `core/pipeline/stages.js` (stage gate = `stage-NN[letter].json`) and
   `core/hooks/approval-derivation.js` (workstream gate = `stage-NN.<role-or-area>.json`,
   dot-separated — see approval-derivation.js:217). Known current violations the checker must
   catch (this is its acceptance test): `roles/security.md` (`stage-04a-security.json`),
   `rules/stage-04b.md` (`stage-04-security.json`) vs code's `stage-04b.json`
   (core/pipeline/stages.js:145); dash-form workstream names in `rules/stage-04.md`,
   `rules/stage-05.md`, `roles/backend.md`, `roles/qa.md`, `roles/reviewer.md`.
2. **Stage-ID and stage-count claims.** Every `stage-\d+[a-z]?` mentioned in rules/roles/docs
   must exist in `STAGES`; flag "N-stage" claims (`\b\d+-stage\b`) that don't match the actual
   count (currently 18 per README; `skills/audit/SKILL.md:8` says 13; ~10 docs files say 17).
   Allow an explicit inline opt-out comment for historical docs (`docs/historical/`,
   `docs/audit-archive/` are excluded wholesale).
3. **Track lists.** Track names mentioned in rules/docs must be ⊆ `TRACKS` from stages.js;
   flag enumerated lists that omit tracks (`rules/pipeline-tracks.md:53` says "Four tracks";
   `rules/gates.md:480` lists five, omitting `nano`).
4. **Referenced-file existence.** Every relative path reference in rules/roles/skills/runbooks
   (`rules/*.md`, `roles/*.md`, `core/skills/...`, `.devteam/...`, `*.sh`) must exist in the
   repo or in the installed layout. Known violations to catch: `roles/principal.md:13,36` →
   `rules/roles.md` (doesn't exist); `roles/security.md:10,38` and
   `skills/pre-pr-review/SKILL.md` → `core/skills/...` (skills live at `skills/`);
   `rules/orchestrator.md:96` → `bootstrap.sh`; `rules/stage-04a.md` → `roles/dev-platform.md`
   (file is `roles/platform.md`); docs/runbooks/open-followups.md:5 → "escalation.md
   § External integrations" (section doesn't exist).
5. **Command surface.** Slash commands documented in rules/ must be installed by an adapter
   (claude-code installs only `devteam.md`, `audit.md`, `audit-quick.md` — see
   hosts/claude-code/adapter.js); `npm run <script>` references must exist in package.json
   (`roles/reviewer.md` cites `npm run review:derive`, which doesn't exist — real command is
   `devteam derive-approvals`); `devteam` flags mentioned in docs/runbooks must appear in
   bin/devteam's usage/help text.
6. **Stage rule-file coverage.** Every stage in `STAGES` that rules/pipeline-build.md indexes,
   or that has `readFirst` pointing at a `rules/stage-*.md`, must have that file. Currently
   missing: stage-04c, stage-04d, stage-06d, stage-06e rule files; pipeline-build.md's index
   omits 03b/04c/04d/04e/06d/06e.

**Mechanics:** follow the existing checker's report format. Add a `--baseline` mode or a
checked-in allowlist file (`scripts/consistency-baseline.json`) so the checker can land **before**
the sweep: known current violations are baselined; new violations fail CI immediately; the sweep
(2.2) then burns the baseline down to empty and deletes it.

**Tests:** extend tests/consistency-meta.test.js: fixture trees with one violation per class →
detected; clean fixture → exit 0.

**Verify:** `npm run consistency` (with baseline) exits 0; `npm test`; CI workflow already runs
`npm run consistency` — confirm it stays in `.github/workflows/test.yml`.

---

## 2.2 The drift sweep (driven by 2.1's baseline)

**Rule of decision: code is canonical.** Where prose and code disagree on names the *code*
reads/writes (gate filenames, stage IDs), fix the prose. The one exception class: if a rules file
describes behavior that is *better* than what code does, stop and flag it in the PR instead of
silently aligning.

Work through the baseline file from 2.1, plus these named items the checker can't fully express:

1. **Gate naming**: align all prose to `stage-04b.json` (security) and dotted workstream names
   (`stage-04.backend.json`, `stage-05.<area>.json`). Files: roles/security.md, roles/backend.md,
   roles/qa.md, roles/reviewer.md, rules/stage-04.md, rules/stage-04b.md, rules/stage-05.md,
   rules/gates.md (§Stage 04a-security at ~line 214). Note: examples/sms-opt-in already uses the
   dotted code-canonical form — it's the reference.
2. **Ghost command surface**: rules/orchestrator.md "Available Commands" lists `/pipeline`,
   `/nano`, `/quick`, `/hotfix`, `/pipeline-brief`, `/pipeline-review`, `/pipeline-context`,
   `/retrospective`; rules/pipeline-tracks.md references `.devteam/commands/{track}.md`;
   rules/pipeline-core.md references `/status`; rules/orchestrator.md:96 references
   `bootstrap.sh`. None exist. Replace with the real `devteam` CLI invocations
   (`devteam stage`, `devteam next`, `devteam run`, …). These are pre-CLI-era leftovers a model
   will follow into a wall.
3. **Missing stage rule files**: create `rules/stage-04c.md` (red-team), `rules/stage-04d.md`
   (migration-safety), `rules/stage-06d.md` (verification-beyond-tests), `rules/stage-06e.md`
   (performance-budget). Content: thin pointers — stage purpose, gate fields (from stages.js +
   gates schema), and a reference to the corresponding skill (skills/red-team,
   skills/migration-safety, skills/verification-beyond-tests, skills/performance-budget), which
   already hold the depth. Match the structure of an existing thin stage file (e.g.
   rules/stage-06c.md). Update rules/pipeline-build.md's index to list all build-phase stages
   including 03b/04c/04d/04e/06d/06e.
4. **Stage-count and track-count claims**: 17→18 in docs/concepts.md:35, docs/faq.md:75,593,
   docs/ci.md:25, docs/TESTING.md:34, docs/comparative-analysis.md:123,189, both walkthroughs;
   13→18 in skills/audit/SKILL.md:8; "Four tracks"→six in rules/pipeline-tracks.md:53; add
   `nano` to rules/gates.md:480's valid-track list. `[verify-first]` re-grep for `17 stage`,
   `17-stage`, `\b17\b` near "stage" before editing — counts may have shifted.
5. **docs/tracks.md matrix**: the "What each track runs" matrix omits stages 3b/4c/4d/4e/6d/6e.
   Preferred fix: add a small generator (`scripts/` or extend consistency.js with `--fix`-style
   output) that emits the matrix from `STAGES_BY_TRACK` in stages.js, and paste/commit its
   output with a "generated — do not hand-edit" marker the checker verifies. Hand-fixing without
   the generator just re-creates the drift.
6. **Secondary docs refresh** (each is a small targeted edit, not a rewrite):
   - CONTRIBUTING.md: remove "until the tier-1 test suite lands" / "(when the test suite
     exists)" — 62 files / 1,161 tests exist; describe `npm test` + `npm run consistency`.
   - AGENTS.md: "300+ tests"→current count; "11 locked design decisions"→12 (match
     ARCHITECTURE.md); replace the "Open backlog" blurb (lists items that all shipped: OTel,
     secret scanning, gemini adapter, web UI, multi-model review) with a pointer to
     docs/BACKLOG.md instead of a copy.
   - README.md: "11 locked decisions"→12.
   - docs/TESTING.md: "~380 tests across 25+ files"→remove the number (the doc itself says it
     avoids quoting counts); add the autonomous-execution suites (run, classify, escalation,
     chain, archive) to the inventory.
   - docs/faq.md: "201 automated tests"→remove count; "three host adapters"→four; fix
     faq.md:848 ("The adapter does not emit /goal invocations today") — E7 landed, FEATURES.md
     says goal injection is active.
   - docs/runbooks/autonomous-run.md: the "Honest limitations" section still says "No
     auto-rule" and calls `clear_gates` "a planned follow-up"; both shipped (rules/gates.md:447,
     driver consumes them). Rewrite the limitations to the *actual* current ones (count-based
     convergence caveats, transient-classification heuristic v1, no heartbeat).
   - docs/runbooks/escalation.md: two sections both numbered "4b" — renumber.
   - rules/compaction.md: two items numbered "8" — renumber.
   - docs/BACKLOG.md: E1/E5 are listed open but `doctor` and `summary` shipped — strike through
     with the standard landed-note format.
7. **Template dedup** `[verify-first]`: docs/brief-template.md, docs/design-spec-template.md,
   docs/runbook-template.md have diverged twins in templates/. stages.js descriptors point at
   templates/; rules/gates.md:169 and rules/stage-08.md cite the docs/ copies. Diff each pair;
   make templates/ canonical; replace docs/ copies with one-line pointers (or delete and fix
   referers). The annotation-guide asymmetry (only human-read templates get guides) is
   deliberate — preserve it.

**Exit:** consistency baseline file is empty and deleted; checker runs un-baselined in CI.

**Verify:** `npm run consistency` exits 0 with no baseline; `npm test`; spot-read three fixed
files for sense (mechanical edits can mangle prose).

---

## 2.3 Split `rules/gates.md` per stage (token cost)

**Problem:** rules/gates.md is ~21.5 KB and is in **every** stage's `readFirst`
(core/pipeline/stages.js), so every agent invocation carries ~10–13K tokens of framework prose
before reading any code — and any one agent needs only its own gate's schema (~1–2 KB).
pipeline.md was already split this way (rules/pipeline-core.md / pipeline-build.md /
pipeline-tracks.md + per-stage files); this item repeats that proven move for gates.

**Change:**
1. Create `rules/gates-core.md` (~2 KB): the universal gate contract — JSON shape, status
   lattice (PASS/WARN/FAIL/ESCALATE), timestamp/track fields, chain fields, who writes vs who
   validates. Every stage keeps this in `readFirst`.
2. Move each stage's gate-specific schema/examples from gates.md into that stage's
   `rules/stage-NN.md` (creating sections, not new files — the files exist after 2.2.3).
3. Update `readFirst` in core/pipeline/stages.js: replace `rules/gates.md` with
   `rules/gates-core.md` everywhere.
4. Keep `rules/gates.md` as a one-paragraph tombstone pointing to gates-core + per-stage files
   for one release (external docs link to it), then remove in the release after.
5. Measure and record in the PR description: bytes in `readFirst` for stage-04 before/after
   (target: ≥15 KB reduction per invocation).

**Watch out:** the validator (core/gates/validator.js) and tests/contract.test.js may reference
gates.md content/anchors — grep `gates.md` across core/, tests/, hosts/, skills/ and update.

**Tests:** tests/contract.test.js additions: every stage's `readFirst` includes gates-core; every
per-stage rules file contains a gate-schema section matching the stage's gate fields in stages.js.

**Verify:** `npm test`; `npm run consistency`; render a stage prompt
(`devteam stage build` dry path or the render-helpers test) and confirm total prompt size dropped.

---

## 2.4 CHANGELOG fragments (backlog C8)

**Problem:** docs/BACKLOG.md C8 — `[Unreleased]` merge conflicts hit 4+ times; the section is
now enormous.

**Change:** adopt fragment files: each PR adds `changelog.d/<branch-or-pr>.md` containing its
entry (same format as current CHANGELOG bullets, with the existing "Honest scope note"
convention). `scripts/release.js` (exists; read it first) gains an assemble step: concatenate
fragments into the new version section, delete fragments, in the release commit. Add a CI check
(in `.github/workflows/test.yml` or consistency.js): a PR touching core/, bin/, hosts/, rules/,
roles/, or skills/ must include a `changelog.d/` file or carry an opt-out label/marker.
Update CONTRIBUTING.md with the fragment recipe.

**Tests:** extend tests/release.test.js for the assemble step (fixtures: two fragments →
assembled section, fragments removed, ordering stable/alphabetical).

**Verify:** `npm test`; dry-run the release script in a temp clone.

---

## 2.5 Cut a release (v0.6.0)

After 2.1–2.4 are merged:
1. Run the release flow (scripts/release.js per its own docs): fold `[Unreleased]` (the giant
   existing section + any fragments) into `v0.6.0`, dated.
2. Bump package.json to 0.6.0.
3. Update `STAGECRAFT_REF: v0.3.0` in templates/ci/github-actions/stagecraft-pr-checks.yml to
   `v0.6.0` — and add a consistency check (2.1 extension) that the template ref matches the
   current major.minor at release time, so it can't go stale silently again.
4. Tag, do not push the tag without the user's go-ahead.

**Verify:** `npm test`; `devteam --help` shows the right version `[verify-first]` (check whether
the CLI prints a version at all — if not, skip); fresh `devteam init` + `devteam doctor` smoke in
a temp dir (CI already does this — mirror it locally).

---

## Sequencing & exit criteria

2.1 → 2.2 → 2.3 → 2.4 → 2.5. Items 2.3 and 2.4 can run in parallel after 2.2.

**Phase exit:** consistency checker running un-baselined in CI covering the six drift classes;
per-stage prompt overhead reduced ≥15 KB; v0.6.0 tagged locally. After this phase, a doc
claiming a gate name or stage count that disagrees with code **fails CI** — that's the point.
