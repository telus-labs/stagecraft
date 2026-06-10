# Phase 2 Prompts — Consistency, Docs Sweep, Release

Run in order: **2.1 → 2.2 → (2.3 and 2.4 in parallel) → 2.5**. Do not start until Phase 1
items 1.1–1.5 are merged. Paste the PREAMBLE from [README.md](README.md), then one prompt.

---

## Prompt 2.1 — Extend the consistency checker with prose-vs-code checks

```
TASK: Implement plans/phase-2-consistency-and-docs.md, item 2.1. Read that section in full,
then read scripts/consistency.js and tests/consistency-meta.test.js completely — you are
extending an existing checker and must match its report format and architecture.
Branch: feat/consistency-prose-vs-code

You are adding six check classes (gate filename references, stage-ID/stage-count claims,
track lists, referenced-file existence, command surface, stage rule-file coverage). The
plan item specifies each class precisely, including the regexes' shape and the exclusion
of docs/historical/ and docs/audit-archive/.

Critical design requirement — BASELINE MODE: the repo currently CONTAINS violations of
every class (they are enumerated in the plan item; they are your acceptance tests). The
checker must land before they are fixed. Implement a checked-in
scripts/consistency-baseline.json: violations present in the baseline are reported as
"baselined" and do not fail; anything NOT in the baseline fails. Generate the initial
baseline by running your own checker and capturing its findings. Item 2.2 will burn the
baseline down; design for its eventual deletion (checker runs clean with no baseline file).

Acceptance: your checker, run WITHOUT the baseline, must detect at least these known
violations (all enumerated with file:line in the plan item): the three conflicting
security-gate names; dash-form workstream gate names in rules/stage-04.md, stage-05.md and
three role files; the "13-stage" claim in skills/audit/SKILL.md; "Four tracks" in
rules/pipeline-tracks.md; the five-track list in rules/gates.md; the nonexistent
rules/roles.md, bootstrap.sh, core/skills/ paths, roles/dev-platform.md; the ghost slash
commands in rules/orchestrator.md; npm run review:derive in roles/reviewer.md; the missing
stage rule files for 04c/04d/06d/06e. If your checker misses any of these, it is not done.

Required tests (extend tests/consistency-meta.test.js): one fixture-tree violation per
class → detected; clean fixture → exit 0; baselined violation → exit 0 with "baselined"
note; non-baselined violation → exit 1.

Done means: `npm run consistency` exits 0 with the baseline in place; all meta-tests pass;
npm test / eslint green; CHANGELOG entry added.
```

---

## Prompt 2.2 — The drift sweep

```
TASK: Implement plans/phase-2-consistency-and-docs.md, item 2.2. Read that section in full
first. Branch: docs/drift-sweep
This is a LARGE but mechanical item; work through it sub-item by sub-item, one commit per
numbered sub-item (1 gate naming, 2 ghost commands, 3 missing stage rule files, 4 counts,
5 tracks matrix, 6 secondary docs, 7 template dedup).

Operating rules specific to this item:
- The decision rule is in the plan: CODE IS CANONICAL. Where prose and code disagree on
  names the code reads/writes, fix the prose. EXCEPTION: if a rules file describes behavior
  BETTER than what code does, do not silently align — flag it in your report and skip it.
- Your work queue is scripts/consistency-baseline.json (created by item 2.1) PLUS the
  named sub-items the checker can't express. After each sub-item, re-run
  `npm run consistency`, remove the now-fixed entries from the baseline, and confirm the
  checker stays green.
- For sub-item 3 (new rules/stage-04c.md, stage-04d.md, stage-06d.md, stage-06e.md):
  these are THIN pointer files — stage purpose, gate fields from core/pipeline/stages.js,
  reference to the corresponding skill (skills/red-team, skills/migration-safety,
  skills/verification-beyond-tests, skills/performance-budget). Copy the structure of an
  existing thin stage file (read rules/stage-06c.md first). Do not duplicate skill content.
- For sub-item 5 (docs/tracks.md matrix): build the small generator described in the plan
  (emit the matrix from STAGES_BY_TRACK), commit its output with a "generated — do not
  hand-edit" marker, and add the marker check to the consistency checker.
- For sub-item 4 stage counts: [verify-first] re-grep before editing — derive the true
  stage count from core/pipeline/stages.js and use that number, not the plan's.
- For sub-item 7 (template dedup): [verify-first] diff each docs/*-template.md against its
  templates/ twin before deciding; templates/ is canonical; replace docs/ copies with
  pointers; fix referers (rules/gates.md:169, rules/stage-08.md). Preserve the deliberate
  annotation-guide asymmetry.
- Prose quality: these files are read by models mid-pipeline. After mechanical edits,
  re-read each changed paragraph for sense. Broken grammar in a rules file is a real bug.

Done means: scripts/consistency-baseline.json is EMPTY and deleted; `npm run consistency`
exits 0 un-baselined; npm test / eslint green; your report lists every file touched grouped
by sub-item, plus any "prose was better than code" flags.
```

---

## Prompt 2.3 — Split rules/gates.md per stage

```
TASK: Implement plans/phase-2-consistency-and-docs.md, item 2.3. Read that section, then
rules/gates.md in full, and the readFirst lists in core/pipeline/stages.js.
Branch: refactor/gates-md-split

Why: rules/gates.md (~21.5 KB) is in EVERY stage's readFirst, costing ~10-13K tokens per
agent invocation when each agent needs only its own gate's schema (~1-2 KB). You are
repeating the proven pipeline.md split.

Implement the five numbered steps in the plan item:
1. rules/gates-core.md (~2 KB): universal contract only — JSON shape, status lattice,
   timestamp/track/chain fields, who writes vs validates. Every stage keeps this.
2. Move per-stage gate schemas/examples into that stage's rules/stage-NN.md (the files all
   exist after item 2.2).
3. Update every readFirst in core/pipeline/stages.js: gates.md → gates-core.md.
4. rules/gates.md becomes a one-paragraph tombstone pointing to the new locations.
5. Record in your report: total readFirst bytes for stage-04 before and after (target
   ≥15 KB reduction).

MANDATORY pre-step: grep `gates.md` across core/, tests/, hosts/, skills/, docs/ and
handle every reference (the validator and tests/contract.test.js may pin its content).

Required tests (tests/contract.test.js): every stage's readFirst includes gates-core.md;
every rules/stage-NN.md contains a gate-schema section whose field names match that
stage's gate skeleton in stages.js.

Done means: contract tests pass; npm test / npm run consistency / eslint green; before/after
byte counts in the report; CHANGELOG entry added.
```

---

## Prompt 2.4 — CHANGELOG fragments (backlog C8)

```
TASK: Implement plans/phase-2-consistency-and-docs.md, item 2.4. Read that section, then
scripts/release.js and tests/release.test.js in full. Branch: feat/changelog-fragments

Why: docs/BACKLOG.md C8 — the giant [Unreleased] section caused 4+ merge conflicts.

Implement:
1. changelog.d/ fragment convention: each PR adds changelog.d/<slug>.md with its entry in
   the existing CHANGELOG bullet style (including the "Honest scope note" convention).
   Add changelog.d/README.md (3 lines) explaining the format, and a .gitkeep so the dir
   persists empty.
2. scripts/release.js assemble step: concatenate fragments (stable alphabetical order)
   into the new version section and delete them, in the release commit. Read the script's
   existing flow first and integrate, don't bolt on.
3. CI guard: a PR touching core/, bin/, hosts/, rules/, roles/, or skills/ must include a
   changelog.d/ file. Implement wherever the repo's existing checks live
   (.github/workflows/test.yml or scripts/consistency.js — pick the one that can see the
   diff; if neither can cleanly, implement as a consistency.js advisory and say so).
   Include an opt-out marker for genuinely no-news changes (e.g. [skip-changelog] in the
   commit message) and document it.
4. CONTRIBUTING.md: add the fragment recipe (CONTRIBUTING was refreshed in item 2.2 —
   extend, don't rewrite).

Required tests (tests/release.test.js): two fixture fragments → assembled into the version
section in stable order, fragment files removed; zero fragments → release still works.

Done means: tests pass; npm test / eslint green; dry-run of the release assemble step in a
temp clone shown in your report; this change itself ships the first changelog.d/ fragment.
```

---

## Prompt 2.5 — Cut release v0.6.0

```
TASK: Implement plans/phase-2-consistency-and-docs.md, item 2.5. Read that section and
scripts/release.js (including the new assemble step from item 2.4) first.
Branch: release/v0.6.0

Steps:
1. Run the release flow per the script's own documentation: fold [Unreleased] plus any
   changelog.d/ fragments into a dated v0.6.0 section.
2. Bump package.json to 0.6.0.
3. templates/ci/github-actions/stagecraft-pr-checks.yml: STAGECRAFT_REF v0.3.0 → v0.6.0,
   and add a consistency-checker rule that the template ref matches package.json
   major.minor, so it cannot silently go stale again.
4. Create the git tag v0.6.0 LOCALLY. Do not push anything.
5. [verify-first] Check whether the CLI prints a version (devteam --help / --version);
   if it reads package.json dynamically nothing more is needed; if hardcoded anywhere,
   fix that spot and add it to the consistency check.

Done means: npm test / npm run consistency / eslint green; fresh `devteam init` +
`devteam doctor` smoke in a mktemp dir (mirroring CI) shown in your report; CHANGELOG has
a clean, dated v0.6.0 section and an empty [Unreleased]; local tag exists.
```
