# Stagecraft Execution Prompts — All Phases

One consolidated playbook. Every work item is a sub-section containing a paste-ready prompt
for a **fresh Claude (Sonnet) session** in the repo root. To run an item: paste the
**PREAMBLE** (§0) plus the item's prompt block as one message. One item = one session =
one branch = one PR.

Status legend: ✅ executed and merged · 🔲 ready to run · ⏸ blocked (see dependency).

| Phase | Theme | Status |
|---|---|---|
| 1 | Trust consolidation | ✅ complete (PRs #63–#69) |
| 2 | Consistency, docs sweep, release | ✅ complete (PRs #71 · #72 · #75 · #76 · release/v0.6.0) |
| 3 | Structural debt | ✅ complete (PRs #79–#89) |
| 4 | Capability roadmap (ADR-first) | ✅ complete (PRs #90–#97) |
| D | Documentation system | ✅ complete (PRs #99 · #102 · #103 · #104 · #105 · #107) |
| 5 | State integrity (round-2 review) | ✅ complete (PRs #114–#117) |
| 6 | Promise integrity | ✅ complete (PRs #118–#121 · #124) |
| 7 | Test & CI harness | ✅ complete (PRs #122 · #125) |
| 8 | Release v0.7.0 + semantic sync | ✅ complete (PRs #123 · #126 · release/v0.7.0) |
| 9 | Evidence-gated capabilities | ✅ complete (PRs #128 · #129 · #131 · this PR) |

Lessons already baked into the preamble from Phase 1–2 execution: mirror CI's env when
testing (`CI=true DEVTEAM_HEADLESS_COMMAND=cat`), never let tests read/write repo-root
state, precondition checks before work, stop-conditions are a success not a failure.

---

## 0. PREAMBLE (paste first, verbatim, before every item prompt)

```
You are implementing exactly one pre-approved work item in the Stagecraft repository
(current directory). Stagecraft is a Node.js CLI (`devteam`) that orchestrates AI coding
tools through an 18-stage gated pipeline. The work item is specified below and in a plan
file under plans/ — the plan file is the authoritative spec; read its referenced section
in full before touching any code.

Hard rules:
1. SCOPE: implement only this item. If you notice other problems, list them under
   "Out-of-scope findings" in your final report. Do not fix them.
2. PRECONDITIONS: if the item lists a PRECONDITION CHECK, run it first and STOP with a
   report if any check fails.
3. VERIFY-FIRST: any step marked [verify-first] is a claim that must be confirmed by
   reading the code before editing. If the claim does not hold, STOP all work on that
   step and report what you actually found. Do not "fix" code that already works.
4. LINE NUMBERS in plan files are historical anchors — main has moved through many PRs
   since they were verified. Always locate the quoted code by searching; never edit by
   line number alone.
5. TESTS: run `npm test`, `CI=true DEVTEAM_HEADLESS_COMMAND=cat npm test` (mirrors
   GitHub Actions exactly — CI=true changes validator behavior and un-skips 3 tests),
   `npx eslint .`, and `npm run consistency` before and after. All green when you
   finish. Never weaken, skip, or delete an existing test to make your change pass; if
   a test legitimately encodes OLD behavior this item changes, update it and call that
   out explicitly.
6. NEW BEHAVIOR NEEDS A TEST: write the regression test first where the item says so;
   in all cases the change must be covered by at least one test that fails without it.
7. TEST HYGIENE: tests that spawn subprocesses must explicitly control every env var
   the code under test reads (especially CI). Tests must never read or write repo-root
   state — per-test mkdtempSync tempdirs with the devteam-test- guard
   (tests/_helpers.js). The stoplist scans git changed-files of its cwd; never point
   test cwd at the real repo. Meta-tests must never assert exact state of the live
   repo tree (sizes, file lists, advisory counts) — use fixture trees, --only
   filters, and env overrides; one canonical full-repo smoke maximum.
8. SOURCE OF TRUTH: core/pipeline/stages.js is canonical for stages/gates/tracks
   (stage gates are plain `stage-NN[letter].json`; workstream gates are dotted
   `stage-NN.<role>.json` per core/hooks/approval-derivation.js). Prose follows code,
   never the reverse — EXCEPT if prose describes BETTER behavior than code implements:
   flag it, don't silently align.
9. CONVENTIONS: comments explain *why* and cite backlog/ADR IDs (house style:
   core/driver.js header). Match surrounding code style. Preserve the project's candid
   tone in prose; never delete a limitation or caveat while moving content.
10. GIT: create the branch named in the item (from main unless stated otherwise).
    Commit with a conventional-commit message ending:
    Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
    Do NOT push, do NOT open a PR, do NOT merge, do NOT switch branches at the end.
11. CHANGELOG: once changelog.d/ exists (Phase 2.4+), add a fragment file instead of
    editing [Unreleased]; before that, add an entry under [Unreleased] in CHANGELOG.md
    matching existing style, with an "Honest scope note" line if limitations remain.
12. STOP CONDITIONS — stop and report rather than improvise if: a [verify-first] claim
    fails; the change requires editing more than ~3 existing tests (beyond any the item
    explicitly authorizes); you need to modify a file the item doesn't mention and can't
    justify in one sentence; npm test fails for reasons unrelated to your change.

Final report format (this is your last message — it is the deliverable):
- WHAT CHANGED: file list with one line each.
- EVIDENCE: the exact verification commands run and their results (paste test counts).
- TESTS ADDED/UPDATED: names and what each proves; pre-existing tests touched + why.
- VERIFY-FIRST RESULTS: each claim → confirmed / not-confirmed + what you found.
- DEVIATIONS from the plan item, if any, with justification.
- OUT-OF-SCOPE FINDINGS, if any.
- The commit hash(es).
```

---

## Phase 1 — Trust Consolidation ✅ complete

All seven items executed and merged (PRs [#63](https://github.com/telus-labs/stagecraft/pull/63)–[#69](https://github.com/telus-labs/stagecraft/pull/69)). Prompts preserved for re-use/reference; if re-running any, re-verify the claims first — the code has changed.

### 1.4 Flag-parsing bugs ✅ #63

```
TASK: Fix the flag-parsing bugs in plans/phase-1-trust-consolidation.md, item 1.4.
Branch: fix/flag-parsing-bugs

The verified bugs: parseFlags in bin/devteam treated --apply as unconditionally
value-taking (for `advise --apply AC-11=A`), but cmdAssess uses it as a boolean —
`assess --apply --json` swallowed --json as the value; terminal `--apply` silently
didn't apply. And --skip-write / --skip-preflight / --skip-advise were checked in
handlers but absent from parseFlags (exit 2 "Unknown flag"; dead guards).

Implement: the three --skip-* flags as booleans (keys matching the existing checks);
--apply peek-ahead boolean-or-value (next token absent or --prefixed → boolean true,
no consume; else consume as value); cmdAdvise errors clearly on bare --apply; audit
all other flags["..."]/flags.x usages for further orphans and report them.
Do NOT restructure parseFlags (that is Phase 3.1).

Required tests (tests/cli.test.js via runCLI): assess --apply --json emits JSON AND
applies; terminal assess --apply applies; advise --apply AC-11=A unchanged;
preflight --skip-write no longer exits 2.
```

### 1.1 Stoplist on the autonomous path ✅ #64

```
TASK: Implement plans/phase-1-trust-consolidation.md, item 1.1. Branch: fix/run-stoplist

The safety stoplist (core/guards/stoplist.js) was enforced only on the interactive
path (cmdStage); the autonomous driver (devteam run) never called it.

Implement: (1) move the track-applicability constant into core/guards/stoplist.js as
exported STOPLIST_TRACKS, import in bin/devteam; (2) driver calls checkStoplist at run
start (after track resolution, before first loop iteration) when the track is guarded;
(3) on match halt BEFORE dispatch with halt_action "stoplist", render explainMatches(),
write the halt event to run-log.jsonl, exit non-zero — mirror the existing typed-halt
plumbing; (4) re-check once immediately before dispatching stage-04 (build), because
the brief may be written by the run itself. Exactly two check points. Preserve
full/hotfix bypass + its comment.

Required tests (tests/run.test.js injected-deps style): quick-track halt before
dispatch with run-log event; full-track no-halt; mid-run brief triggers pre-build halt.
Also update docs/runbooks/autonomous-run.md halt-action table (stoplist row).
Manual smoke per the plan item's Verify block; paste the transcript.
```

### 1.2 `next()` purity — extract the auto-fold write ✅ #65

```
TASK: Implement plans/phase-1-trust-consolidation.md, item 1.2.
Branch: fix/next-purity-auto-fold

next() is documented "Pure read; never mutates state", but tryAutoFoldSignOff wrote
pipeline/gates/stage-07.json as a side effect. Keep the FEATURE; move the WRITE:
1. tryAutoFoldSignOff becomes pure (returns the folded gate object or null).
2. _nextImpl returns a new "fold-sign-off" action carrying the gate content (follow
   the existing versioned action-schema pattern; bump the schema version).
3. cmdNext: on fold-sign-off, write the gate, print, re-run next(), show the
   subsequent action (single-command UX preserved).
4. Driver: write the gate, append an auto-fold-sign-off event to run-log.jsonl,
   continue. No --allow-stage needed for the fold (orchestrator-derived) — but it
   must now be visible in the audit log.
5. Update the purity comments to state the new contract.

tests/auto-fold.test.js (and possibly pipeline-e2e) encode the old behavior —
updating those is EXPECTED; enumerate every change. New tests: next() leaves
pipeline/gates/ byte-identical; the payload validates as a stage-07 gate; driver
writes gate + log event and completes; cmdNext e2e reaches pipeline-complete.
Grep-prove no fs write is reachable from _nextImpl.
```

### 1.3 Validator fail-closed ✅ #66

```
TASK: Implement plans/phase-1-trust-consolidation.md, item 1.3.
Branch: fix/validator-fail-closed

core/gates/validator.js runMain() treated any unknown internal error as PASS exit 0;
and [verify-first] the bypassed-escalation sweep ordered gates by mtime.

Implement: (1) --strict mode (also via CI=true env): unknown-error path exits 1; hook
mode keeps warn-and-pass BUT appends timestamped errors to
pipeline/validator-errors.log; ENOENT and HALT_FS_CODES branches unchanged. (2) The
shipped CI template passes --strict. (3) Replace mtime ordering with content-derived
order (gate timestamp field, stage-order fallback); comment why mtime was wrong.

Required tests (tests/gate-validator.test.js, spawnSync exit codes): unknown-error
path → hook mode exit 0 + log written; --strict exit 1; CI=true exit 1; strict does
not alter normal PASS/FAIL exits; fs.utimesSync manipulation no longer changes the
sweep verdict. (Lesson learned at #66: spawned validators must NOT inherit CI from
the runner — strip it in the test helper's default env.)
```

### 1.5 PATCH MODE on all hosts ✅ #67

```
TASK: Implement plans/phase-1-trust-consolidation.md, item 1.5.
Branch: fix/patch-mode-all-hosts

claude-code and generic adapters render the ctx.patchItems "PATCH MODE" block; codex
and gemini-cli never read ctx.patchItems — a --patch fix routed to them loses its
scoping constraint.

Implement: (1) extract rendering into core/adapters/render-helpers.js as
renderPatchBlock(ctx, ...), claude-code wording canonical; (2) all four adapters call
it; claude-code/generic output must stay byte-identical (hash-compare before/after);
(3) do NOT merge codex/gemini into a shared base (Phase 3) — one comment noting the
duplication; (4) [verify-first] gemini-cli capabilities.json lacks goalLoop — decide
true (omission) vs explicit false (unsupported) from the goal-loop tests and
goalCondition consumers; report the evidence.

Required tests (tests/adapter-contract.test.js): per host, WITH patchItems renders
the block; WITHOUT does not.
```

### 1.6 Bounded isolation read-side ✅ #68

```
TASK: Implement plans/phase-1-trust-consolidation.md, item 1.6.
Branch: fix/bounded-isolation-read-side

core/paths.js maps changeId → pipeline/changes/<id>/… and dispatch honors it, but the
READ side hardcodes pipeline/: next(), summary(), auto-fold artifact paths, and the
driver's lock/run-state/run-log/gates/context helpers. In bounded mode the pipeline
appears permanently "not started".

Implement: (1) read how runStage/runStageHeadless OBTAIN changeId and reuse exactly
that mechanism; (2) thread changeId through next()/summary()/helpers via
core/paths.js; (3) same for all driver path helpers and any pipeline/ path recent
features added; (4) if a surface genuinely can't support bounded mode, make loadConfig
REJECT isolation:bounded naming that command — silent breakage is the only
unacceptable outcome.

Required tests (tests/bounded-workspace.test.js): bounded e2e — seeded bounded gates,
next() advances, summary() reports, injected-deps driver run keeps all state under
the change root. MANDATORY: grep `path.join(cwd, "pipeline"` across core/ — every
remaining hit fixed or carrying a justification comment; include the audit in the
report.
```

### 1.7 Hardening basket ✅ #69 (stacked on #68)

```
TASK: Implement plans/phase-1-trust-consolidation.md, item 1.7 — three fixes, one
commit each. Branch: fix/phase1-hardening (stacked on the bounded-isolation branch).

Fix 1 — summary() crash: gate.status.toLowerCase() and w.status.toLowerCase() guarded
only by `gate ?`; a status-less valid-JSON gate throws. Use (x || "unknown") pattern;
render unknown distinctly. Test: {} gate → summary succeeds.

Fix 2 — secret-scan bypass scope: a devteam-allow-secret: comment ANYWHERE disabled
the whole scan (content the scanned LLM writes). Per-line scoping (own line + next
line); every suppression appends {file,line,reason,ts} to
pipeline/secret-allowlist.log; update help text and header. Tests: comment line 1 +
secret line 30 now FAILS; adjacent comment passes and logs.

Fix 3 [verify-first] — budget cap: driver summed only MERGED stage gates pre-dispatch,
so multi-role per-workstream costs were invisible until merge. Confirm, then include
unmerged workstream gate costs WITHOUT double-counting once the merged gate exists
(read the merge cost rollup first). Test: workstream costs exceed --budget-usd, no
merged gate → dispatch refused.
```

---

## Phase 2 — Consistency, Docs Sweep, Release

Order: 2.1 ✅ → 2.2 ✅ → 2.3 ✅ → 2.4 ✅ → 2.5 ✅ (strictly sequential — 2.3/2.4 both touch
CHANGELOG/CONTRIBUTING; 2.5 exercises 2.4's assemble step).

### 2.1 Consistency checker: prose-vs-code classes ✅ #71

```
TASK: Implement plans/phase-2-consistency-and-docs.md, item 2.1 — EXTEND
scripts/consistency.js with six check classes; do NOT fix the violations (that is 2.2).
Branch: feat/consistency-prose-vs-code

Classes: (1) gate-filename vs canonical names from stages.js/approval-derivation.js;
(2) stage-ID existence + "N-stage" count claims (derive the true count from STAGES);
(3) track lists vs TRACKS; (4) referenced-file existence; (5) command surface (slash
commands vs adapter installs; npm run X vs package.json; devteam flags vs help);
(6) stage rule-file coverage. Exclusions: docs/historical/, docs/audit-archive/.

CRITICAL: baseline mode — scripts/consistency-baseline.json with STABLE keys
(file + class + violation id, not line numbers); baselined violations report without
failing; new violations fail. Generate the initial baseline from your own checker.
Design for its eventual deletion.

ACCEPTANCE: run WITHOUT the baseline must detect the plan item's enumerated known
violations; paste the output lines as proof. Required tests
(tests/consistency-meta.test.js, fixture trees in tempdirs): per-class detection;
clean fixture exit 0; baselined exit 0 with note; non-baselined exit 1.
```

### 2.2 The drift sweep ✅ #72

```
TASK: Implement plans/phase-2-consistency-and-docs.md, item 2.2. ONE COMMIT PER
SUB-ITEM. Branch: docs/drift-sweep
DECISION RULE: code is canonical; prose-better-than-code gets flagged, not aligned.
WORK QUEUE: scripts/consistency-baseline.json; after each sub-item re-run the checker
and shrink the baseline. END STATE: baseline EMPTY and DELETED; checker green
un-baselined.

Sub-items: (1) gate naming — stage gates PLAIN (stage-04b.json per stages.js),
workstream gates DOTTED; examples/sms-opt-in is the reference. (2) ghost command
surface → real devteam CLI; review:derive → devteam derive-approvals; target-project
npm-run examples rephrased generically, not deleted. (3) create thin
rules/stage-04c/04d/06d/06e.md pointer files (purpose, gate keys from stages.js,
pointer to the skill); update pipeline-build.md index. (4) stage/track count claims
fixed everywhere (derive 18 from STAGES; never edit docs/historical/ or
docs/audit-archive/). (5) docs/tracks.md matrix generated from STAGES_BY_TRACK with
do-not-hand-edit markers + a sync check class + meta-test. (6) secondary docs refresh
(CONTRIBUTING, AGENTS, README, TESTING, FAQ, autonomous-run limitations rewrite,
duplicate numbering, BACKLOG E1/E5, open-followups ref). (7) [verify-first] template
dedup — templates/ canonical, docs/ copies become pointers, referers fixed.

Report: per-sub-item files+hash; baseline burndown proof; pinned-prose tests updated;
prose-better-than-code flags.
```

### 2.3 Split rules/gates.md per stage ✅ #75

```
PRECONDITION CHECK (STOP and report if any fails):
- git checkout main && git pull — the drift-sweep merge (PR #72) is required.
- rules/stage-04c.md, stage-04d.md, stage-06d.md, stage-06e.md exist (destinations).
- npm run consistency exits 0 with NO scripts/consistency-baseline.json present.
- npm test green.

TASK: Implement plans/phase-2-consistency-and-docs.md, item 2.3.
Branch: refactor/gates-md-split
Read first: the plan item, plans/prompts/phase-2-prompts.md Prompt 2.3, and
rules/gates.md itself (~21.5 KB).

Why: gates.md is in EVERY stage's readFirst (~10-13K tokens per agent invocation);
each agent needs only its own gate's schema. Repeat the proven pipeline.md split.

Implement the five steps:
1. rules/gates-core.md (~2 KB): ONLY the universal contract — JSON shape, status
   lattice, timestamp/track/chain fields, retry-protocol basics, who writes vs who
   validates. Every stage keeps this in readFirst.
2. Move per-stage gate schemas/examples into that stage's rules/stage-NN.md — add a
   "## Gate" section consistent with the thin files from #72; merge intelligently
   with content already there, do not duplicate.
3. Update every readFirst in core/pipeline/stages.js: gates.md → gates-core.md.
4. rules/gates.md becomes a one-paragraph tombstone (removed in a later release).
5. Report total readFirst framework bytes for stage-04 BEFORE and AFTER (measure,
   don't estimate; target ≥15 KB reduction).

MANDATORY pre-step: grep `gates.md` across core/, tests/, hosts/, skills/, rules/,
docs/, roles/ and handle every reference (validator, contract tests, runbooks, role
briefs; CHANGELOG history entries are records — do NOT rewrite those).

Required tests (tests/contract.test.js): every stage's readFirst includes
gates-core.md; every stage rule file for a gated stage has a gate section whose
field names match that stage's gate skeleton in stages.js.

Report additionally: REFERENCE AUDIT — the grep results and how each referer was
handled.
```

### 2.4 CHANGELOG fragments (backlog C8) ✅ #76

```
PRECONDITION CHECK (STOP and report if any fails):
- git checkout main && git pull — #72 AND the gates.md-split PR must be merged; if
  the split PR is still open, STOP rather than racing it on CHANGELOG.md.
- npm run consistency exits 0, no baseline file; npm test green.

TASK: Implement plans/phase-2-consistency-and-docs.md, item 2.4 (closes BACKLOG C8).
Branch: feat/changelog-fragments
Read first: the plan item, plans/prompts/phase-2-prompts.md Prompt 2.4, AND
scripts/release.js + tests/release.test.js in full.

Implement:
1. changelog.d/ fragment convention: each PR adds changelog.d/<slug>.md in the
   existing CHANGELOG bullet style (Honest-scope-note convention carries over).
   Add changelog.d/README.md (~3 lines) and .gitkeep.
2. Assemble step in scripts/release.js (integrate with its existing flow): at
   release, concatenate fragments (stable alphabetical order) into the new version
   section ALONGSIDE existing [Unreleased] content (both fold; transition-safe),
   then delete fragments, all in the release commit.
3. CI guard: PRs touching core/, bin/, hosts/, rules/, roles/, or skills/ must
   include a changelog.d/ file. Natural home: a workflow step diffing against
   github.event.pull_request.base.sha (must not fire on push-to-main builds);
   consistency-advisory is the documented fallback — pick one and justify. Opt-out:
   literal [skip-changelog] in PR title or any branch commit message. Factor the
   decision logic (changed paths + fragment present + opt-out) into a testable
   script/function — no untestable inline YAML.
4. CONTRIBUTING.md: add the fragment recipe (extend the post-#72 version).

DOGFOOD: this change ships the FIRST changelog.d/ fragment — do not touch
[Unreleased].

Required tests (tests/release.test.js, fixture repos in tempdirs — NEVER the real
CHANGELOG): two fragments → stable-order assembly + files removed + README/.gitkeep
preserved; zero fragments → release unchanged; fragments + existing [Unreleased] →
both released; guard logic: core/ touch without fragment fails, with fragment passes,
with [skip-changelog] passes, docs-only passes.

MANDATORY dry-run: git clone . to a tempdir, two dummy fragments, run the assemble
step (use the script's dry-run/skip flags — read it), paste the resulting section.

Report additionally: CI-GUARD DESIGN — chosen home, why, opt-out mechanics.
```

### 2.5 Cut release v0.6.0 ✅ release/v0.6.0

```
PRECONDITION CHECK (STOP and report if any fails):
- git checkout main && git pull — #72, the gates.md split, and changelog-fragments
  all merged. changelog.d/ exists; scripts/release.js has the assemble step.
- npm run consistency exits 0; both test invocations green.

TASK: Implement plans/phase-2-consistency-and-docs.md, item 2.5 — prepare the release
COMMIT. Branch: release/v0.6.0
Read first: the plan item, plans/prompts/phase-2-prompts.md Prompt 2.5, and
scripts/release.js (including the assemble step).

EXTRA RULES for a release commit:
- A release is a RECORD: fold [Unreleased] + fragments verbatim — no editing,
  summarizing, or reordering beyond documented assembly rules. Version date comes
  from `date -u +%F`, never guessed.
- Do NOT create the git tag (deliberate deviation from the plan file: with this
  repo's merge-commit workflow the tag belongs on main AFTER the release PR merges).
  Put the exact post-merge tag commands in your report. If scripts/release.js wants
  to tag/push itself, use its dry-run/skip flags; if none exist, do its steps
  manually and say so.

Implement:
1. Fold the entire [Unreleased] section + all changelog.d/ fragments into a dated
   `## [0.6.0] - <today>` section; [Unreleased] remains as an empty section;
   fragments deleted (README/.gitkeep stay).
2. package.json → 0.6.0; regenerate package-lock via
   `npm install --package-lock-only` (no hand-editing).
3. templates/ci/github-actions/stagecraft-pr-checks.yml: STAGECRAFT_REF → v0.6.0,
   PLUS a new consistency check class (+ meta-test) asserting the template ref
   matches package.json major.minor — it can never silently go stale again. Check
   whether tests/ci.test.js pins the template; update deliberately if so.
4. [verify-first] Does the CLI print a version (devteam --version/--help; grep
   bin/devteam)? Dynamic-from-package.json → nothing to do; hardcoded → fix + add to
   the consistency check; absent → report only (adding one is out of scope).
5. Release smoke mirroring CI: mktemp dir → devteam init --host generic →
   devteam doctor; paste the transcript. npm pack --dry-run if packable.

NOTE: this branch may trip 2.4's changelog guard via scripts/consistency.js — a
release PR needs no news fragment; tell the human opening the PR to use the
[skip-changelog] opt-out.

Report additionally: the new [0.6.0] header + first/last entry titles (fold proof);
POST-MERGE STEPS (exact tag commands).
```

---

## Phase 3 — Structural Debt ✅ complete

All ten items executed and merged (PRs [#79](https://github.com/telus-labs/stagecraft/pull/79)–[#89](https://github.com/telus-labs/stagecraft/pull/89)). Prompts preserved for re-use/reference; if re-running any, re-verify the claims first — the code has changed.

Order executed: 3.7a → 3.7b → 3.3 → 3.1a → 3.1b → 3.1c → 3.2 → 3.4 → 3.5 → 3.6.

### 3.7a Bug basket A: guards and merging ✅ #79

```
TASK: Implement fixes 1, 2, 5 from plans/phase-3-structural-debt.md item 3.7. All
three are [verify-first]; skip any whose claim fails. One commit per fix.
Branch: fix/phase3-bugs-a

Fix 1 — write-audit quoted paths (core/guards/write-audit.js): slicing
`git status --porcelain` lines mis-parses paths git wraps in quotes (spaces/escapes)
→ false-positive violations flip PASS gates to FAIL. Preferred: switch to
`--porcelain -z` NUL-delimited output. Regression test FIRST: real temp git repo
containing "file with space.js" in allowedWrites → no violation. Run locally with
DEVTEAM_HEADLESS_COMMAND=cat to exercise the conditional write-audit tests.

Fix 2 — mergeWorkstreamGates track trust (core/orchestrator.js): merged gate copies
wsGates[0].gate.track; if the model omitted it, merged.track is undefined and the
validator flags the orchestrator's own gate. Fix: fall back to the resolved pipeline
track (read how merge call sites obtain it). Test: track-less workstream gates →
merged gate carries the resolved track.

Fix 5 — track-list literal drift: stages.js exports canonical TRACKS;
core/gates/validator.js and the doctor keep independent copies. Import from the
canonical source in both. Test: validator's accepted track set equals the canonical
set.
```

### 3.7b Bug basket B: lifecycle and filtering ✅ #80

```
TASK: Implement fixes 3, 6, 7 from plans/phase-3-structural-debt.md item 3.7. All
[verify-first]. One commit per fix. Branch: fix/phase3-bugs-b
(Fix 4, the replay race, lands with item 3.1c — not here.)

Fix 3 — config cache (core/config.js): loadConfig memoizes per-cwd forever;
clearConfigCache() has no non-test caller. Implement: (a) assess --apply calls
clearConfigCache() after writing; (b) for the driver, READ the loop and decide —
re-read config at iteration boundaries OR document intentional per-run pinning in a
comment; pick one, justify, report. Test for (a): apply-then-read in one process
sees the new value.

Fix 6 — stage --workstream filter divergence: headless filtering lives inside
runStageHeadless; non-headless is re-implemented in cmdStage AFTER all prompts
render; fanout workstreams match differently per mode. Fix: one filter in the
orchestrator applied BEFORE rendering, shared by both modes; define the fanout
matching rule once (role-prefix match) in a comment. Tests: both modes filter
identically, including a review-fanout descriptor set.

Fix 7 — pricing silent null (core/pricing.js): unknown models price to null → budget
sums silently treat them as zero. Fix: when a consumed gate reports tokens for an
unpriced model, surface a WARN ("unpriced model X — budget enforcement incomplete")
on the cost report and cost rollups (read scripts/budget.js and the merge rollup for
the right seams). Do NOT auto-update the pricing table. Test: gate with tokens for
"future-model-9" → warning present, totals unchanged.
```

### 3.3 Marker-section helpers dedup ✅ #82

```
TASK: Implement plans/phase-3-structural-debt.md, item 3.3. Read ALL THREE
implementations before writing anything: upsertSection in core/driver.js,
stripMarkedSection in core/gates/validator.js, and the near-duplicate strip in
bin/devteam. Branch: refactor/markers-module

Implement:
1. New core/markers.js: upsertSection(text, begin, end, body) and
   stripSection(text, begin, end). Handle inverted markers (end before begin) and
   missing end-marker explicitly: treat as corrupt — replace from begin-marker to
   end-marker-or-EOF, emit a warning; document the semantics in the module header.
   This fixes the verified bug where upsertSection appends a duplicate section on
   inverted markers.
2. Point all three call sites at the module. Where the two strip implementations
   diverge, enumerate the divergence and adopt the validator's behavior (it runs in
   hooks — least surprise) unless you find a concrete reason not to.
3. Unit tests: normal upsert, inverted markers, missing end, duplicate sections in
   input, empty body.

Existing escalation/validator/driver tests are the callers' regression net — they
pass unchanged unless one pinned the buggy duplicate-append (call it out). Grep-prove
a single implementation remains.
```

### 3.1a CLI refactor PR 1: schema-driven flag parser ✅ #83

```
TASK: Implement PR 1 of plans/phase-3-structural-debt.md, item 3.1. Read parseFlags
in bin/devteam (NOTE: it now contains Phase 1.4's fixes — peek-ahead --apply, the
--skip-* booleans) and every Usage: string. Branch: refactor/cli-flag-schemas

Implement:
1. New core/cli/flags.js: parseFlags(argv, schema), schema =
   { flagName: { type: "boolean"|"string"|"number"|"list", key?, description } }.
   Unknown flags still exit 2 with the same message. "list" covers the repeatable
   flags (--workstream, --allow-stage, --auto-rule's comma-split — preserve their
   exact semantics).
2. A FLAGS schema per command, co-located with each cmdX handler (bin/devteam stays
   monolithic in this PR — commands move in PR 2).
3. Per-command --help generated from the schema, replacing hand-maintained Usage
   strings; keep output format close to current (tests and docs reference it).
4. The Phase-1.4 --apply peek-ahead hack dissolves: assess declares boolean, advise
   declares string. Remove the hack; the Phase-1.4 tests in tests/cli.test.js pin
   the user-visible behavior and MUST stay green unchanged.

tests/cli.test.js must pass UNCHANGED (the proof of mechanical equivalence). Add
unit tests for core/cli/flags.js: each type, unknown flag, generated help.
npm run consistency catches help-text references in docs — keep it green.
```

### 3.1b CLI refactor PR 2: extract command modules ✅ #84

```
TASK: Implement PR 2 of plans/phase-3-structural-debt.md item 3.1, on top of merged
3.1a. Branch: refactor/cli-command-modules

Move each command into core/cli/commands/<command>.js exporting
{ name, flags, run(positional, flags) }; bin/devteam becomes a thin dispatcher
(registry lookup → parse with the command's schema → run()).

Hard requirements:
- Preserve the lazy getOrchestrator() property and its rationale comment:
  help/stages/doctor must not load the orchestrator. Time `./bin/devteam help`
  before and after; compare within noise.
- Move commands in 3-4 groups, ONE COMMIT PER GROUP, npm test between groups:
  read-only first (help/stages/doctor/summary/log), then pipeline commands, then
  tooling. Derive the exact grouping from main()'s actual switch.
- Pure mechanical moves: no logic changes, no renames beyond module structure.
- [verify-first] grep tests/ for direct requires of bin/devteam internals first;
  list and adapt if any.

tests/cli.test.js passes UNCHANGED throughout. Report the timing check.
```

### 3.1c CLI refactor PR 3: logic into core + replay race fix ✅ #85

```
TASK: Implement PR 3 of plans/phase-3-structural-debt.md item 3.1, PLUS item 3.7
fix 4 (same code). Branch: refactor/cli-logic-to-core

Part A — relocate logic: the replay command module contains gate snapshot/restore
logic that belongs in core/gates/. Move it; audit other command modules for direct
gate/pipeline file manipulation and relocate the same way. Target: command modules =
argument handling + output formatting only. List every relocation.

Part B — fix the verified replay clobber-and-restore race: the headless run
overwrites the original workstream gate, restored only from process memory; a crash
between leaves it silently replaced (the code comment admits atomicity was waived).
Fix: snapshot to pipeline/gates/.replay-backup/<name>.json on disk BEFORE dispatch;
restore from disk; delete on success; on startup, devteam replay detects a leftover
backup, says so, offers restoration.

Tests (tests/replay.test.js): backup exists during dispatch (observable via a
DEVTEAM_HEADLESS_COMMAND that captures mid-run state); restore-on-success; leftover-
backup detection. Existing replay tests keep passing. Grep-prove command modules
contain no direct gate file manipulation.
```

### 3.2 computeFixSteps → recipe registry ✅ #86

```
TASK: Implement plans/phase-3-structural-debt.md, item 3.2. Read computeFixSteps and
clearGatesFromFixSteps in core/orchestrator.js (NOTE: post-Phase-1 the driver
consumes structured clear_gates; recent PRs may have touched fix steps — read the
CURRENT code) and tests/next.test.js in full first.
Branch: refactor/fix-recipe-registry

The inversion: human-readable `rm pipeline/gates/...` strings are generated first and
parsed BACK into structured clear_gates. Data must come first.

Implement:
1. core/pipeline/fix-recipes.js: one entry per stage —
   { stage, diagnose(gate, ctx) → { clear_gates, steps, notes } } — plus a default.
2. clear_gates produced directly as data; human-readable command strings DERIVED by
   one formatter; delete clearGatesFromFixSteps.
3. Port ONE STAGE PER COMMIT; existing fix-steps/next tests pass byte-stable after
   each (prefer exact-equal output; knowing updates only, called out).
4. Stage-05's three sub-cases become stage-05's recipe entry. Do NOT touch the
   broader stage-05 special-casing elsewhere — one comment marking it as known debt.
5. Registry test: every stage in STAGES resolves to a recipe.

orchestrator.js should shrink ~400 lines.
```

### 3.4 Optional @huggingface/transformers ✅ #87

```
TASK: Implement plans/phase-3-structural-debt.md, item 3.4. Read core/memory/embed.js,
tests/memory.test.js, and the doctor's checks first. Branch: refactor/optional-transformers

1. Move @huggingface/transformers from dependencies to optionalDependencies
   (preserve the version specifier). Grep-verify no other file requires it.
2. core/memory/embed.js: wrap the require; on MODULE_NOT_FOUND throw a clear
   actionable error naming the install command.
3. devteam doctor reports embedding availability as informational, never failure.
4. [verify-first] tests/memory.test.js uses DEVTEAM_EMBEDDING_PROVIDER=stub —
   confirm provider selection; test the absent-module path via a require-failure
   seam if cleanly possible, else test the error-message function directly and say so.

MANDATORY: in a TEMP CLONE, npm install --omit=optional → devteam doctor and
devteam next work; devteam memory fails with the actionable message. Paste the
transcript. Honest scope note: npm installs optionals by default, most users see no
change.
```

### 3.5 Declare POSIX-only ✅ #88

```
TASK: Implement plans/phase-3-structural-debt.md, item 3.5. The DECISION is made:
declare POSIX-only now; do not attempt a Windows port. Branch: docs/posix-only

1. README prerequisites + docs/faq.md: state macOS/Linux (incl. WSL2) support
   explicitly — one short candid paragraph each.
2. devteam doctor and devteam init: on process.platform === "win32", print a clear
   warning recommending WSL2 (warning only, no hard exit).
3. docs/BACKLOG.md: add a Windows-port item (bucket A, impact/effort format) listing
   the known breakage points: `which` subprocess in doctor (locate it in the
   post-refactor code), whitespace command splitting (core/adapters/headless.js,
   core/escalation.js), POSIX rm strings in fix steps.
4. Cheap wins that also help POSIX: (a) replace the `which` subprocess with an
   in-Node PATH probe; (b) [verify-first] confirm the headless command splitter
   naively splits on whitespace, then make it THROW a clear error on quote
   characters rather than silently mis-splitting (no full quoting support).
5. Test the doctor warning: [verify-first] check how platform-dependent behavior is
   tested elsewhere; stub process.platform if a pattern exists, else test the
   warning function directly.
```

### 3.6 Test the untested + coverage signal ✅ #89

```
TASK: Implement plans/phase-3-structural-debt.md, item 3.6. Branch: test/untested-core

1. [verify-first] Confirm core/a11y-fixer.js and core/preflight.js still have no
   test file (grep tests/). For each still-untested module: READ IT FULLY, then
   write behavioral tests following the nearest sibling pattern (preflight: drive
   runPreflight(cwd, { track, skipWrite }) over fixture projects; a11y-fixer: its
   pure core incl. at least one malformed-input case). Every exported function,
   happy path + the failure modes the module's own comments mention. No
   line-coverage theater.
2. Coverage signal: a separate NON-BLOCKING step in .github/workflows/test.yml
   running `node --test --experimental-test-coverage tests/*.test.js`, report-only.
   NO threshold. Record the baseline percentage in the report and as a comment in
   the workflow file.
```

---

## Phase 4 — Capability Roadmap (ADR-first) ✅ complete

All items executed and merged (PRs [#90](https://github.com/telus-labs/stagecraft/pull/90)–[#97](https://github.com/telus-labs/stagecraft/pull/97)). Prompts preserved for reference; if re-running any, re-verify the claims first — the code has changed.

Order executed: 4.0 → 4.2 → 4.1a → 4.1c → 4.3 → 4.4-ADR-006.

### 4.0 Ground truth check ✅ #90

```
TASK: Execute plans/phase-4-capability-roadmap.md, item 4.0. READ-AND-REPORT only:
you write exactly one file, plans/phase-4-ground-truth.md. No code changes.
Branch: docs/phase-4-ground-truth

1. git show bf048a9 (no-progress fix cycles) and 3d0b16f (gate archiving); read
   docs/autonomous-execution-design.md §4.1 incl. its "Grounding correction"
   (NOTE: Phase 2's sweep updated runbook limitations — read the CURRENT docs); read
   the convergence-related driver/orchestrator code AS IT IS NOW (Phases 1-2 changed
   both files). Write down precisely: what counts as "progress" today, where it's
   computed, which inputs it trusts (especially anything model-written like
   gate.retry_number), what remains count-based, and whether interactive next()
   differs from the driver path.
2. Read docs/BACKLOG.md end to end: list every OPEN item; confirm G10 is the only
   open top-tier item; note anything relevant to 4.1/4.3 that landed since the plans
   were written (including the entire Phase 1-3 execution).
3. Confirm the four §7 open questions (standing grants, track inference, heartbeat,
   exit semantics) are still open; cite partial movement (e.g. the stoplist now
   enforced in the driver — Phase 1.1 — touches the track-inference question).

Output structure: ## Convergence: implemented vs spec (file:line) / ## Backlog
deltas / ## Open questions status / ## Corrections to phase-4 plan items.
```

### 4.2 Progress-based convergence (completion) ✅ #92

```
TASK: Implement plans/phase-4-capability-roadmap.md, item 4.2, SCOPED BY
plans/phase-4-ground-truth.md (read both in full; ground-truth wins — implement only
the delta it identifies). Branch: feat/progress-based-convergence

Design constraints (from ADR-003; not yours to change):
- Breaker trips on NO PROGRESS across fix attempts, not just attempt count.
- Progress comparison uses the per-attempt ARCHIVED gates.
- Prefer orchestrator-stamped fields (trustworthy by construction — see
  core/verify/stamp.js) over model-asserted fields for deltas.
- Remove agent-falsifiable inputs from the convergence decision on BOTH paths:
  derive attempt counts from the archive, not the model-written gate.retry_number,
  in the driver AND interactive next().
- When the breaker trips, the halt/fix_steps output states WHAT didn't change
  ("blocker 'X' identical across attempts 2,3") and feeds the escalation context
  like existing halts do.

Tests: archive fixtures with identical vs differing blocker sets → trips/doesn't;
falsified retry_number ignored on both paths; the no-progress evidence string in the
halt output. Update docs/autonomous-execution-design.md §4.1 to the implemented
state and the autonomous-run runbook limitations. Targeted fanout retry stays
deferred — do not implement it.
```

### 4.1a Draft ADR-004: role tool budgets (G10) ✅ #93

```
TASK: DRAFT (do not implement) docs/adr/004-role-tool-budgets.md per
plans/phase-4-capability-roadmap.md item 4.1. Branch: docs/adr-004-tool-budgets

Preparation (all required): read two existing ADRs in docs/adr/ and match their
structure; read plans/phase-4-ground-truth.md; read hosts/claude-code/adapter.js
ROLE_FRONTMATTER handling, each hosts/*/capabilities.json, assertCapabilities and
the C1 enforcement-level pattern, how host/model are recorded on workstream gates,
and docs/BACKLOG.md's G10 entry verbatim.

The ADR must take a position on: (1) where budgets are declared (the plan recommends
role frontmatter via the existing ROLE_FRONTMATTER mechanism — adopt or argue
against); (2) cross-host degradation via declared enforcement levels following C1
(enforces.tool_budget: native | prompt-only); (3) MCP as mechanism vs vocabulary —
the plan recommends host-native tool pinning first, MCP mediation deferred ("ship
the seam, not the server"); agree in Decision or argue in Alternatives; (4) the
dispatched budget recorded on the workstream gate for the audit trail.

Include: Context, Decision, per-host enforcement table, gate-schema addition,
Alternatives, Consequences (honest: prompt-only hosts cannot enforce),
Implementation sketch (files touched). Status: Proposed. NO code. End your report
with the 3 questions a human reviewer most needs to rule on.
```

### 4.1c Implement ADR-004 ✅ #93/#95

```
PRECONDITION: docs/adr/004-role-tool-budgets.md exists with Status: Accepted. If not
Accepted, STOP immediately and report.

TASK: Implement ADR-004 exactly as written, 2-3 commits on branch
feat/role-tool-budgets: (1) claude-code native enforcement — role frontmatter tools:
pinning via the existing ROLE_FRONTMATTER mechanism, warn-on-missing safety net
preserved; (2) capability plumbing — enforces.tool_budget in every
hosts/*/capabilities.json, assertCapabilities warning (not blocking) on prompt-only
hosts, dispatched budget recorded on the workstream gate per the ADR's schema
addition, gate schema + validator updated; (3) tests + docs — adapter-contract tests
for budget rendering per host, gate-schema tests, FEATURES.md row, concepts.md role
row, conventions.md if the ADR added markers.

Where the ADR is silent, follow the nearest existing pattern (C1 write-enforcement
is the template) and list the inference. Where the ADR conflicts with code reality,
STOP and report — never improvise around an approved design. Report maps each ADR
decision point to the code realizing it.
```

### 4.3 G3 production feedback seam ✅ #96

```
TASK: Implement plans/phase-4-capability-roadmap.md, item 4.3. Check
plans/phase-4-ground-truth.md for deltas first. Branch: feat/production-feedback-seam

SCOPE GUARD — deliberately effort-1: a template, a convention, one optional gate
field, one line of output. NO integrations, NO automated ingestion, NO new commands
(BACKLOG deprioritized F2/F3/F5; the file IS the integration seam).

1. templates/production-feedback-template.md: operator-curated; sections keyed by
   the brief's metric/SLO names + an incidents list. Model on existing templates
   (read retrospective-template.md and two others). Register in templates/README.md.
2. Stage-09 retrospective: include pipeline/production-feedback.md in readFirst when
   present ([verify-first]: does readFirst support optional entries? If not, add an
   "optional" marker handled at render time — smallest possible change). Add a short
   "production deltas vs brief SLOs" section to the retrospective rules/role guidance.
3. Retrospective gate: optional production_feedback_reviewed: true|false|"absent" —
   gate skeleton in stages.js, gate schema, the stage's rules-file gate section.
4. devteam next on pipeline-complete: if the file is absent, ONE suggestion line.
5. Docs: conventions.md entry (catalogue format), FEATURES.md row, open-followups
   runbook cross-link.

Tests: template registered (extend contract tests); gate field validates;
pipeline-complete output line present/absent correctly.
```

### 4.4 Draft ADRs 005–008 ✅ ADR-006 #97 (one session executed)

ADR-006 (track inference under autonomy) executed and merged as PR #97. ADRs 005/007/008 deferred — phase declared complete; draft those when Phase 5 autonomy work begins. Template below preserved for that future session:

Use this template once per ADR, with the bracketed slot filled:

```
TASK: DRAFT (do not implement) docs/adr/00N-<slug>.md for open question [N] from
plans/phase-4-capability-roadmap.md item 4.4. Branch: docs/adr-00N-<slug>

[Slot — pick exactly one:]
[ADR-005 standing grants: read the C6 authority-binding work first (git show
 1647d5d, a2455b1) — a standing grant must produce the same per-decision audit
 record on the gate chain as a per-invocation grant. Must answer: where grants live,
 revocation, how a grant materializes on the chain.]
[ADR-006 track inference under autonomy: read core/guards/stoplist.js (NOTE: now
 enforced in the driver per Phase 1.1 — the floor exists), the assess/track-inference
 code. This ADR sets the ceiling: when may devteam run trust an inferred track
 unconfirmed? Quote the design doc: "Wrong-track autonomy is a 10× cost error."]
[ADR-007 liveness/heartbeat: read the driver loop and run-log.jsonl event shapes.
 Define stall (output but no gate progress) as distinct from the wall-clock timeout;
 propose heartbeat events + an operator surface (devteam run --watch or status).]
[ADR-008 exit semantics: read how devteam run exits today and what advise reports
 post-run. Decide the exit code for "completed but advise reports blockers" and its
 CI implications. Keep it one page.]

Requirements: read docs/autonomous-execution-design.md §7's framing first; match
existing ADR structure; Status: Proposed; include Alternatives and an honest
Consequences section; end your report with the questions a human reviewer must rule
on. NO implementation.
```

**H3 (recipe factory): no prompt exists deliberately** — gated on run-log evidence of
recurring failure classes per ADR-003. Write its prompt only when that evidence exists.

---

## Documentation Plan (D2–D6) ✅ complete

All six workstreams executed and merged: D1 = Phase 2; D2 = [#99](https://github.com/telus-labs/stagecraft/pull/99); D4 = [#102](https://github.com/telus-labs/stagecraft/pull/102); D3a = [#103](https://github.com/telus-labs/stagecraft/pull/103); D3b = [#104](https://github.com/telus-labs/stagecraft/pull/104); D5 = [#105](https://github.com/telus-labs/stagecraft/pull/105); D6 = [#107](https://github.com/telus-labs/stagecraft/pull/107). Prompts preserved for reference; if re-running any, re-verify the claims first — the codebase has changed.

**Add this line to the preamble for every D prompt:**
"You are editing documentation read by humans and, in some cases, by models
mid-pipeline. Preserve the candid house style; never delete a limitation or caveat
while moving content. When you move content, leave a link at the old location only
if external references are plausible; otherwise move cleanly."

### D2 Audience-based information architecture ✅ #99

```
TASK: Implement workstream D2 of plans/documentation-plan.md. Read that section and
the diagnosis (§1) in full, then the current README "Documentation map" and skim
every file it links. Branch: docs/audience-paths

1. Rewrite README's "Documentation map" as four reader-path tables (Evaluator /
   Operator / Contributor / Model), each an ordered 3-5 doc trail with a one-line
   purpose per doc. Every currently-mapped doc appears in exactly one path (or in
   the "evaluating" long-form cluster: presentation-notes, comparative-analysis,
   walkthroughs).
2. Create docs/README.md (~30 lines): the same four paths + one line stating the
   model-boundary rule (nothing under docs/ is load-bearing for a pipeline run;
   models read AGENTS.md + rules/ + roles/ + skills/ only).
3. Operator troubleshooting index: docs/runbooks/README.md mapping symptom →
   runbook section, sourced from the five runbooks' own failure cases. 15-25 rows,
   links with anchors.
4. Consistency check (extend scripts/consistency.js + meta-test): every file in
   docs/ (excluding historical/, audit-archive/, reference/) is linked from
   docs/README.md — no orphan docs.

Do NOT rewrite the documents themselves — this item changes the map + two small
index files. Report lists each doc → assigned path.
```

### D4 Dedup and lifecycle ✅ #102

```
TASK: Implement workstream D4 of plans/documentation-plan.md (sub-items 1, 2, 3, 5;
4 is one CONTRIBUTING paragraph). §3's canonical-home matrix is the rulebook for
every move. Branch: docs/dedup-lifecycle

1. BACKLOG slimming: every struck-through item → one line (ID, title, landed date,
   CHANGELOG link). Before deleting strikethrough detail, CONFIRM the equivalent
   exists in CHANGELOG.md; where it doesn't, MOVE it there. Open items untouched.
2. README diet: keep pitch, first-30-minutes, quick start, D2 path tables,
   prerequisites, license, "why this exists". Feature enumeration beyond ~5
   headline bullets → FEATURES.md links.
3. CONTRIBUTING: add (a) the five principles from plan §2 (~10 lines), (b) the
   "if you changed X, update Y" table, (c) the docs/historical/ archive-policy
   paragraph (matching the audit-archive convention).
4. AGENTS.md refit: ~1 page of what an agent working on THIS repo needs (layout,
   test/lint commands, house conventions, links elsewhere). Structural fix: facts
   become links so they cannot go stale again.

Report: before/after line counts for BACKLOG/README/AGENTS + every fact moved
(from → to).
```

### D3a Generated reference: stages + hosts matrices ✅ #103

```
TASK: Implement workstream D3 sub-items 1, 3, 4 of plans/documentation-plan.md (the
CLI reference, sub-item 2, is a separate later prompt). Read the tracks-matrix
generator from Phase 2.2.5 first — it is the template for the
generate-commit-verify pattern. Branch: docs/generated-reference

1. Extend the existing generator or add scripts/docs-generate.js (read both options,
   pick one, justify): emit docs/reference/stages.md (stage table from STAGES: ID,
   name, roles, conditionalOn, gate file, artifact/template, grouped by phase) and
   docs/reference/hosts.md (capability/enforcement matrix from
   hosts/*/capabilities.json incl. enforces.* levels). Both fenced with
   <!-- generated: do not hand-edit --> markers.
2. npm run docs:generate runs all generators (including the tracks matrix).
3. Consistency check: committed output equals regenerated output (extend
   scripts/consistency.js + meta-test proving a hand-edit is caught).
4. Replace hand-maintained equivalents in docs/concepts.md, docs/user-guide.md,
   docs/FEATURES.md with links + ≤2-line summaries. List every replacement.

Done: docs:generate idempotent (second run = no diff).
```

### D3b Generated CLI reference ✅ #104

```
PRECONDITION: core/cli/flags.js and per-command flag schemas exist (Phase 3.1a).
If not, STOP and report.

TASK: Implement workstream D3 sub-item 2 of plans/documentation-plan.md.
Branch: docs/generated-cli-reference

1. Extend the docs generator: docs/reference/cli.md from the command registry —
   per command: synopsis, description, flag table from the schema, registry order.
   Same generated-marker + consistency-check pattern as D3a.
2. Sweep docs/ + runbooks for duplication (grep `devteam ` code blocks): runbooks
   KEEP inline procedure examples (procedure beats reference); any ENUMERATION of
   flags/commands outside the generated file becomes a link. Judgement rule: an
   example teaching a procedure stays; a table restating the interface goes.
3. One test: a sampled command's --help flags all appear in the generated doc
   (both derive from the schemas — agreement by construction).

Report: kept-vs-linked decisions from step 2.
```

### D5 Model-facing token budget program ✅ #105

```
PRECONDITION: the gates.md split is merged (rules/gates-core.md exists and
stages.js readFirst references it). If rules/gates.md is still ~21 KB and in every
readFirst, STOP and report.

TASK: Implement workstream D5 of plans/documentation-plan.md. Branch: feat/prompt-budget

1. scripts/prompt-budget.js: per stage, sum byte sizes of readFirst FRAMEWORK files
   (rules/, roles/ per role, AGENTS.md — exclude project-dependent pipeline
   artifacts); estimate tokens (bytes/4, say so). Emit
   docs/reference/prompt-budget.md (generated-marker pattern) with per-stage totals
   + top-5 heaviest files.
2. CI advisory (non-blocking): compare against the committed prompt-budget.md; warn
   when any stage's total grows >10%. Home: alongside Phase 3.6's coverage step or
   a consistency.js advisory — pick the cleaner fit, justify.
3. Per-file ceiling advisories in consistency.js: role brief ≤16 KB, stage rule
   file ≤8 KB, AGENTS.md ≤10 KB. Advisory severity. If a CURRENT file exceeds its
   ceiling, do NOT edit it — record in the advisory output + your report.
4. Audit roles/qa.md and roles/platform.md (heaviest briefs): PROPOSE (do not
   perform) moves of stage-conditional content into skills/ SKILL.md files, with
   section names and destinations.

Done: prompt-budget.md committed + idempotent; advisories fire on synthetic
violations (meta-test); the step-4 proposal in the report.
```

### D6 Onboarding flow upkeep ✅ #107

```
TASK: Implement workstream D6 of plans/documentation-plan.md. Branch: docs/onboarding-upkeep

1. EXAMPLE.md freshness stamp: add "captured at vX.Y" near the top ([verify-first]:
   determine the captured version from `git log --follow EXAMPLE.md`; if
   undeterminable, stamp the current version with honest wording about the
   uncertainty). Consistency advisory: warn when the stamp is >1 minor behind
   package.json. Add an "EXAMPLE.md re-capture" line to the release checklist
   (wherever 2.5's release procedure lives).
2. First-30-minutes CI smoke: extend the existing init+doctor smoke in
   .github/workflows/test.yml to execute the README's actual onboarding steps:
   init → doctor → DEVTEAM_HEADLESS_COMMAND=cat devteam stage requirements
   --feature "smoke test feature" --headless → devteam next (assert a valid
   action). If any README step can't run offline, adapt and note the divergence as
   a workflow comment.
3. FAQ policy: 3-line "How this FAQ is maintained" note atop docs/faq.md
   (operational questions only; facts linked, not restated; entries restating
   feature state get deleted). Apply once: convert/delete entries that restate
   feature state (cross-check 3-5 against FEATURES.md). List every entry touched.
```

---

## Phase 5 — State Integrity

Round-2 review (2026-06-12, main @ 2a1d985) findings: state outliving its run and
upstream re-runs not invalidating downstream attestations. Order: 5.1+5.2 (coordinate —
shared choke point) → 5.3 → 5.4. Plan file: plans/phase-5-state-integrity.md.

### 5.1 DAG-derived gate invalidation ✅ #114

```
TASK: Implement plans/phase-5-state-integrity.md, item 5.1. Read that section, then
core/pipeline/fix-recipes.js in full and how next() walks the stage order when a
mid-pipeline gate is missing but later PASS gates exist ([verify-first] — confirm the
skip behavior before building on it). Branch: fix/derived-gate-invalidation

The #109 class generalized: recipes hand-list clear_gates; clearing stage-04 via the
stage-06d recipe leaves stage-05 (peer-review) and stage-06 (QA) PASS gates standing, so
rewritten code re-enters the pipeline without re-review or re-QA.

Implement: (1) core/pipeline/invalidation.js — given a cleared root stage + the active
ordered stage list (track or custom_stages), return every EXISTING downstream stage gate
up to and including the failing stage; (2) recipes declare only root stage(s); derived
clear_gates replaces hand-listed downstream entries (delete them); (3) snapshot-test
equivalence for every existing recipe's current correct behavior including the #109
stage-04a case; (4) [verify-first] confirm chain re-stamping after recipe-driven clears
and document the invariant in the helper header. Build the helper changeId-aware
(prefixPipelineRelative) — Phase 5.4 depends on it.

Required tests: full-track scenario — PASS through stage-06, stage-06d FAILs, derived
set includes stage-04+04a+05+06; after rebuild next() demands re-review and re-QA (this
test must FAIL on today's main); registry meta-test: no recipe carries a hand-listed
downstream gate.
```

### 5.2 Archive lifecycle owner ✅ #115

```
TASK: Implement plans/phase-5-state-integrity.md, item 5.2. Read core/gates/archive.js,
core/gates/convergence.js, the driver's archive call in core/driver.js, and restart's
deletion (the #106 fix) first. Branch: fix/archive-lifecycle
If 5.1 is in flight, coordinate: re-entry pruning belongs in the same operation as gate
clearing.

Invariant to implement: archives never outlive the failure sequence they describe.
(1) Prune a stage's archives when its merged/stamped gate reaches PASS — [verify-first]
find BOTH finalization call sites (merge path and single-role stamp path); (2) prune on
re-entry: clearing a stage's gates (5.1 helper or restart) deletes its archives in the
same operation; restart.js delegates to the shared code instead of carrying its own
deletion; (3) defense-in-depth guard in convergence.js ignoring archives that predate
the current gate's first attempt, with a comment.

Required regression tests (both must FAIL on today's main): (a) stage failed twice,
recovered to PASS, later re-entered via a downstream recipe → no instant
convergence-exhausted; (b) fresh non-resume run with stale attempt-2/3 archives → no
false no-progress halt. Existing #106 restart tests stay green via the shared path.
```

### 5.3 Interactive convergence ceiling ✅ #116 (after 5.2)

```
TASK: Implement plans/phase-5-state-integrity.md, item 5.3. Read the driver's
pre-archive call and runStage/runStageHeadless dispatch paths first ([verify-first]:
place the archive-before-overwrite ONCE, not twice). Branch: fix/interactive-ceiling

The gap: only the driver archives, so countArchivedAttempts never trips for interactive
devteam next / devteam stage loops — that path currently has NO convergence ceiling.

Implement: archive-before-overwrite inside the shared dispatch path — when about to
dispatch a stage whose existing gate (stage or workstream) has status FAIL, archiveGate
it first; make the driver's own pre-archive use the same path (remove duplication).
Manual hook-driven gate overwrites are out of scope — document the boundary in the
convergence module header.

Required tests: interactive headless loop (DEVTEAM_HEADLESS_COMMAND fakes) failing the
same stage maxRetries+1 times → next() returns convergence-exhausted with
no_progress_evidence (FAILS on today's main); no double-archiving per attempt (count
archive files); all existing run/driver tests unchanged.
```

### 5.4 Bounded isolation: fence, then finish ✅ #117

```
TASK: Implement plans/phase-5-state-integrity.md, item 5.4, as TWO commits.
Branch: fix/b9-cli-layer

Commit 1 — the fence (small, honest): loadConfig rejects isolation:bounded with an
error enumerating the unwired commands, unless isolation_acknowledge_partial: true.
A meta-test derives the unwired list (grep for changeId support across
core/cli/commands/) so the fence message cannot go stale.

Commit 2 — the wiring: (a) shared resolveChangeId(flags, config) helper in core/cli/;
add --feature to next; wire restart, log, advise, replay, derive-approvals, spec
([verify-first] each command's pipeline/ path usage first — some may be exempt with a
justification comment, e.g. genuinely global state); (b) recipe/driver gate paths
through prefixPipelineRelative with the run's changeId (composes with 5.1's helper);
(c) lift the fence per wired command.

Required tests: bounded-mode driver auto-fix e2e — recipe clears the right PREFIXED
gates and the run proceeds (FAILS misleadingly on today's main with "fix steps contain
no gate clears"); per-command bounded test for each wired command; fence error matches
the derived list.
```

---

## Phase 6 — Promise Integrity

Make shipped claims true. Order: 6.1 → 6.2 → 6.4 → 6.3 → 6.5. Plan file:
plans/phase-6-promise-integrity.md.

### 6.1 Host-neutral tool budgets ✅ #118

```
TASK: Implement plans/phase-6-promise-integrity.md, item 6.1. Read core/roles.js,
hosts/claude-code/adapter.js ROLE_FRONTMATTER + toolBudgetFor, the orchestrator's
budget resolution and warnIfToolBudgetDegraded, and render-helpers' toolBudgetSection
first. Branch: fix/host-neutral-tool-budgets

Verified dead code: the budget only resolves when the ROUTED adapter exports
toolBudgetFor (claude-code only) — so the prompt-only advisory never renders, the
degradation warning never fires, and dispatched_tool_budget is never stamped on
codex/gemini/generic, while changelog.d/feat-g10-role-tool-budgets.md claims all three.

Implement: (1) role→tools table moves to core/roles.js exporting toolBudgetFor(role);
claude-code adapter consumes it for subagent frontmatter (native enforcement
byte-unchanged — snapshot the frontmatter before/after); (2) orchestrator resolves the
budget host-neutrally for every dispatch: advisory section renders on prompt-only
hosts, degradation warning fires per enforces.tool_budget, dispatched_tool_budget
stamped (keep the mtime guard); (3) adapter-contract tests exercise the REAL resolution
(remove injected descriptor.toolBudget) and fix the stale comment near
tests/adapter-contract.test.js:363; (4) APPEND one honest line to the G10 fragment
noting the prompt-only path landed here (do not rewrite its history).

Required tests: per non-claude host — advisory rendered + budget stamped; warning fires
exactly for prompt-only; claude-code frontmatter byte-identical.
```

### 6.2 pm budget vs brief + checker rule ✅ #119 (after 6.1)

```
TASK: Implement plans/phase-6-promise-integrity.md, item 6.2. [verify-first] read how
stage-03b's gate fields are produced today and what devteam spec verify exits with.
Branch: fix/pm-spec-orchestrator-stamped

The contradiction: roles/pm.md's stage-03b procedure requires devteam spec
generate/verify (shell); pm's budget is Read, Write, Glob; stage-03b declares no shell
capability — under native enforcement the pm cannot follow its own brief.

Decided design (verification belongs to the orchestrator): (1) spec generate/verify
execution moves into the orchestrator stamping layer (core/verify/stamp.js pattern —
model-said vs observed recorded on the stage-03b gate); (2) roles/pm.md stage-03b
rewritten: pm authors ACs and reviews the generated spec; the pipeline runs
generation/verification (note the rejected grant-pm-Bash alternative in the commit
message); (3) new consistency-checker rule: every devteam/shell command in a role
brief's procedure must be compatible with that role's tool budget from core/roles.js —
plus a meta-test with a fixture brief that violates it.

Required tests: stage-03b e2e with stamped spec fields; checker rule fires on the
fixture and passes on the real roles/ after the rewrite.
```

### 6.3 C3 license gate: verify or relabel ✅ #120

```
TASK: Implement plans/phase-6-promise-integrity.md, item 6.3. [verify-first] read
changelog.d/feat-c3-license-gate.md, rules/stage-04a.md, and wherever the license
policy lists live, BEFORE designing the runner. Branch: feat/license-gate-runner

The doctrine exception: license_check_passed and dependency_review_passed are purely
model-asserted. Implement: (1) orchestrator-side Node runner — offline walk of the
target project's installed dependency license metadata (node_modules/*/package.json or
lockfile), evaluated against policy, stamped with model-said vs observed; (2) non-Node
projects: tri-state "unverified-by-orchestrator" + WARN; schema + rules/stage-04a.md
updated; (3) dependency_review_passed: mechanical check if feasible, otherwise relabel
in schema/rules as model-asserted-by-design with one sentence of rationale — report
which.

Required tests: denied-license fixture → stamped FAIL regardless of model claim; clean
fixture → pass; non-Node fixture → WARN + tri-state; schema tests.
```

### 6.4 De-overfit the fix recipes ✅ #121

```
TASK: Implement plans/phase-6-promise-integrity.md, item 6.4. Read
core/pipeline/fix-recipes.js in full (esp. _wsFromText and the stage-06b recipe) and
how mergeWorkstreamGates handles blockers ([verify-first]: do merged blockers retain
their source workstream? If not, making the merge preserve {blocker, workstream} pairs
is the real fix). Branch: fix/recipe-provenance

Implement: (1) provenance-based blocker→workstream attribution replacing _wsFromText
regex (regex stays only as last-resort fallback with a WARN); (2) both hardcoded
["backend","frontend","platform","qa"] arrays → ctx.stageDef.roles; (3) stage-06b
recipe: remove the demo-project filename ("html-reporter.js renderCSS") and the
backend assumption; route by provenance, preserving the three-path behavior — #106
regression tests must pass WITHOUT the project-specific strings; (4) recipe-hygiene
meta-test: no recipe source contains a filename that exists only under examples/.

Required tests: frontend-owned a11y blocker in a non-demo fixture routes to frontend;
multi-workstream FAIL attribution; #106 and #109 regressions green.
```

### 6.5 Small parity basket ✅ PR #124

```
TASK: Implement plans/phase-6-promise-integrity.md, item 6.5 — three fixes, one commit
each. Branch: fix/phase6-parity

Fix 1 [verify-first]: the unpriced-model WARN lives only in mergeWorkstreamGates;
single-role stages stamp without merging and under-count silently — emit the same WARN
on the single-role stamp path. Test: single-role gate with tokens for an unpriced
model → warning, totals unchanged.

Fix 2: hosts/generic/capabilities.json omits goalLoop — add "goalLoop": false with the
gemini-style comment; extend the adapter-contract test to REQUIRE the key on every
host.

Fix 3 (third deferral — do it): extract the ~95%-identical codex/gemini adapters'
shared logic into a core/adapters/ base consumed by both; delete the in-file NOTE
pointing at plans/phase-3-structural-debt.md. Adapter-contract byte-equivalence tests
are the net — rendered output for both hosts must be byte-identical before/after.
```

---

## Phase 7 — Test & CI Harness Hardening

Kill the repo-state-sensitivity class (third recurrence) structurally. Order: 7.1 → 7.2.
Plan file: plans/phase-7-test-harness.md. The preamble's TEST HYGIENE rule already
carries the new meta-test line — verify it, don't re-add it.

### 7.1 Git-aware consistency + meta-test isolation ✅ (PR #122)

```
TASK: Implement plans/phase-7-test-harness.md, item 7.1. Read scripts/consistency.js's
enumeration (checkDocsIndexCoverage, the prose scanner) and
tests/prompt-budget.test.js's real-file mutation + "known exceedance" pin first.
Branch: fix/git-aware-consistency

Live reproduction available: `echo x > docs/SCRATCH.md` makes 5 tests fail while CI
stays green.

Implement (one PR, five parts): (1) repo-root scans enumerate via git ls-files -z
(tracked = blocking); untracked-but-not-ignored → ADVISORY ("would violate X when
committed"); --root fixture mode keeps readdir; (2) --only <check-class> filter; the
prompt-budget and file-size meta-tests invoke only their class; exactly ONE canonical
full-repo smoke remains; (3) PROMPT_BUDGET_FILE env override (mirror
CONSISTENCY_BASELINE_FILE) — delete the in-place rewrite-and-restore of
docs/reference/prompt-budget.md; (4) the stage-05.md "known exceedance" test becomes
fixture-based so improving the real file no longer breaks the suite; (5) permanent CI
probe step: create docs/SCRATCH-ci-probe.md before npm test, delete after — this step
is RED on today's main and GREEN after (state that verification in your report).

Required tests: tracked-vs-untracked fixture git repos in tempdirs; --only filtering;
the env override; advisory-vs-blocking behavior.
```

### 7.2 CI signal quality ✅ (PR #125)

```
TASK: Implement plans/phase-7-test-harness.md, item 7.2 — four items, one commit each.
Branch: fix/ci-signal

1 [verify-first] Onboarding smoke (.github/workflows/test.yml): the || true on the
headless stage step is correct, but the step's own health is unasserted. Capture the
stage step's output and assert the rendered prompt content appears (requirements-role
header); pin the expected next action to run-stage/continue-stage. Verify by breaking
devteam stage in a scratch branch and observing the step fail (describe in the report;
do not commit the breakage).
2 Coverage surfacing: summary to $GITHUB_STEP_SUMMARY + artifact upload; baseline moves
from a YAML comment into a small JSON the workflow reads. Still non-blocking.
3 a11y-fixer success path: dispatch → re-validation (the reason the module exists) is
untested at 69.7% lines — add success-path tests via DEVTEAM_HEADLESS_COMMAND mocks.
4 [verify-first] Preflight git-hygiene dead code: tests document the blocker path is
unreachable on git ≥2.27 (ls-files --ignored --exclude-standard exits 128 without
-c/-o). Fix the invocation in core/preflight.js; convert the documenting test into a
behavioral one (fixture repo with an offender → blocker fires).
```

---

## Phase 8 — Release v0.7.0 + Semantic Sync

Order: 8.3 → 8.2 → 8.1 (release last — it folds this phase's own fragments).
8.2(a–c) need Phase 6.4 merged; 8.3 needs 7.1 merged. Plan file:
plans/phase-8-release-and-sync.md.

### 8.3 Execute D5 step 3 (token work) ✅ (PR #123)

```
PRECONDITION: Phase 7.1 merged (the stage-05.md exceedance test is fixture-based; the
prompt-budget test no longer pins real-file sizes). STOP if not.

TASK: Implement plans/phase-8-release-and-sync.md, item 8.3. [verify-first] read the
D5 fragment's step-4 proposal for the qa/platform brief audit first.
Branch: docs/d5-step3-token-trim

Implement: (1) move the identified stage-conditional sections from roles/platform.md
(15,617 B, 97.6% of ceiling) and roles/qa.md (12,878 B) into the corresponding
skills/*/SKILL.md files; briefs keep role identity + handoff + gate rules; preserve
every caveat moved; (2) trim rules/stage-05.md under 8 KB — the approval-derivation
hook contract detail moves to docs/conventions.md, model-facing essentials stay;
(3) regenerate docs/reference/prompt-budget.md; record before/after per-dispatch bytes
for platform and qa dispatches in the report.

Done means: npm run consistency — ZERO advisories; docs:generate idempotent; contract
tests green (pinned-prose updates enumerated).
```

### 8.2 Runbook and reference sync ✅ (PR #126)

```
PRECONDITION: Phase 6.4 merged (Case 7 must document the post-6.4 recipe behavior).

TASK: Implement plans/phase-8-release-and-sync.md, item 8.2 — six numbered edits, one
commit each. Branch: docs/semantic-sync

(1) escalation.md: rewrite §4c from retry_number-jq instructions to the archive-based
reality (no_progress_evidence, archive-diff post-mortem; ceiling default is 2); fix the
two dead #4b anchors (TOC + §0) to the renumbered §4c heading. (2) fix-and-retry.md:
convergence framing budget-or-no-progress; NEW license-gate FAIL case (policy fix, not
--patch) + index row in runbooks/README.md; rewrite Case 7 to the shipped three-path
a11y recipe (it currently claims "always frontend"); add the #109 stage-04a note to
Cases 4/5 manual-recovery; short tool-budget-denial entry + index row.
(3) autonomous-run.md: stale-archive symptom paragraph (restart clears archives;
pre-Phase-5 leftovers could trip the breaker). (4) docs/adr/README.md: add ADR-006 to
the index; ADR-004 status → Accepted; "Deferred" subsection for ADR-005/007/008 with
pointers to plans/phase-4-capability-roadmap.md §4.4; [verify-first] a small
consistency rule that every docs/adr/*.md appears in the index with matching status —
skip with justification if it doesn't fit the checker's classes. (5) docs/tracks.md:
one sentence + link for devteam assess. (6) rules/stage-02.md: rename the fictional
example ADR numbers (ADR-007/ADR-012 collide with the real framework namespace) to
PADR-style with a clarifying half-sentence.

Done means: consistency green; fixed anchors resolve; grep shows no runbook instructing
operators to consult retry_number.
```

### 8.1 Fragment triage + cut v0.7.0 ✅ (release/v0.7.0)

```
PRECONDITION: 8.2 and 8.3 merged (the release folds their fragments too).

TASK: Implement plans/phase-8-release-and-sync.md, item 8.1. Branch: release/v0.7.0
Release-commit discipline applies (see the 2.5 prompt): verbatim folds, date -u +%F,
NO tag in-session (post-merge tag commands in the report), [skip-changelog] note for
the PR opener.

Implement: (1) the EIGHT backfill fragments (B2, B9, B10, C1, C3, C5, E7, G6 — verify
the set via git tag --contains on their implementing commits) move into the existing
[0.6.0] CHANGELOG section annotated "(entry backfilled post-release)"; delete those
fragment files; fix docs/BACKLOG.md's B9 "(Unreleased)" row and the eight #unreleased
links. (2) assemble remaining fragments + [Unreleased] entries into a dated [0.7.0];
bump package.json + lockfile (npm install --package-lock-only). (3) EXAMPLE.md
re-capture per the D6.1 release-checklist step (the freshness advisory fires at
v0.7.0); update the stamp. (4) refresh examples/sms-opt-in gates to current schema:
orchestrator stamp (currently devteam@0.1.0), stage-04a C3 fields,
dispatched_tool_budget where applicable — the example is the canonical reference and
must not rot.

Done means: consistency green (freshness + template-ref checks); release.js check
clean; init+doctor smoke; the 0.6.0 section contains the annotated backfills.
```

---

## Phase 9 — Evidence-Gated Capabilities (ADR-first)

Workflow per item: draft/ground-truth → HUMAN approval → implement. Never implement
against an unapproved ADR. Order: 9.1 draft + 9.2a in parallel → approvals → 9.3 → 9.4.
Plan file: plans/phase-9-evidence-gated-capabilities.md.

### 9.1a Draft ADR-007: liveness/heartbeat ✅ #128

```
TASK: DRAFT (do not implement) docs/adr/007-liveness-heartbeat.md per
plans/phase-9-evidence-gated-capabilities.md item 9.1. Read the driver loop, the
headless timeout machinery (core/adapters/headless.js SIGTERM→SIGKILL), and
run-log.jsonl event shapes first. Branch: docs/adr-007-heartbeat

The ADR must define: stall (host alive + output flowing, no gate progress) as distinct
from wall-clock timeout; the heartbeat event the driver emits per iteration + a
dispatch-progress probe (log growth vs gate mtime); the operator surface (devteam run
--watch or status reading run-state + last-heartbeat age); stall response (classify via
the existing transient/structural vocabulary). Match docs/adr/ structure; Status:
Proposed; include Alternatives and honest Consequences; end the report with the
questions a human must rule on. NO implementation.
```

### 9.2a H3 ground-truth: the failure corpus ✅ #129 — gate stays shut

```
TASK: Execute plans/phase-9-evidence-gated-capabilities.md item 9.2a. READ-AND-REPORT:
you write exactly one file, plans/h3-ground-truth.md. No code changes.
Branch: docs/h3-ground-truth

ADR-003 gated the recipe factory (H3) on "evidence of recurring-failure volume." The
post-release fix fragments (#106, #108/#109, stale-log, 06d-no-dispatch,
no-source-change) suggest the evidence exists. Inventory the actual corpus: run-logs
and gate archives available across real runs to date; distinct failure classes and
recurrence counts; what fraction of fix-retry cycles an existing recipe handled vs
halted for a human; which recurring failures are DERIVABLE (mechanical resolution) vs
judgment-shaped. Be ruthless about sample size: if the honest answer is "one project,
too few runs," say H3 STAYS GATED and stop — the BACKLOG caveat ("a learned recipe is
a cached judgment… or it amplifies stale judgment") stands until the data says
otherwise. Output structure: ## Corpus inventory / ## Failure classes & recurrence /
## Recipe coverage today / ## Verdict: gate opens or stays shut, with the threshold
that would change it.
```

### 9.2b Draft ADR-009: recipe suggestion ⏸ only if 9.2a opens the gate

```
PRECONDITION: plans/h3-ground-truth.md exists with a verdict that the gate opens. STOP
otherwise.

TASK: DRAFT (do not implement) docs/adr/009-recipe-suggestion.md per item 9.2b.
Branch: docs/adr-009-recipe-suggestion
The shape that honors the caveat: devteam recipes suggest — an analyzer mining
run-logs + archives for recurring (failure-class, resolution) pairs, emitting a
PROPOSED DIFF to core/pipeline/fix-recipes.js for human PR review. Never auto-applied,
never runtime-learned. The ADR defines: mining heuristics, the evidence threshold per
proposal, and why suggestion-not-application is the permanent boundary (or argues
otherwise in Alternatives). Status: Proposed; end with the human ruling questions.
```

### 9.3 Draft ADR-008 ✅ #131 (ADR-005 deferred — see docs/adr/README.md)

```
TASK: DRAFT (do not implement) ONE of the two deferred ADRs, using its preserved brief
in plans/phase-4-capability-roadmap.md §4.4 and the Phase-4 §4.4 prompt template in
this file, with one update each:
[ADR-005 standing grants: must now ALSO cover persistent tool-budget overrides (G10
 landed after the brief was written) — the same chain-bound auditability problem as a
 standing --auto-rule class. Branch: docs/adr-005-standing-grants]
[ADR-008 exit semantics: [verify-first] re-confirm devteam run still exits 0 on
 pipeline-complete with pending advise blockers, then decide the contract and its CI
 implications. One page. Branch: docs/adr-008-exit-semantics]
Status: Proposed; end with the human ruling questions. NO implementation.
```

### 9.4 D5 maturation: adaptive routing evidence review ✅ — stays gated (no real-run telemetry; see plans/adaptive-routing-evidence.md)

```
TASK: Execute plans/phase-9-evidence-gated-capabilities.md item 9.4. READ-AND-REPORT
first deliverable — NOT code: run devteam routing:suggest (and read its inputs) against
the accumulated real-run telemetry and write plans/adaptive-routing-evidence.md
answering ONE question: do the recommendations match what a human concludes in
hindsight, or is the sample still noise? Include per-(role,host) sample counts. The
framework's own stated uncertainty ("converges with small samples or just chases
noise") is the acceptance bar. End with a verdict: continuous routing gets an ADR, or
stays gated with the data threshold that would change it.
```
