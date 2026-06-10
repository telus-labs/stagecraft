# Documentation Plan Prompts (D2–D6)

Prompts for [documentation-plan.md](../documentation-plan.md). D1 is Phase 2 (already has
prompts). Run order: **D2 → D4 → D3a → D3b (after Phase 3.1a) → D5 → D6**. Paste the
PREAMBLE from [README.md](README.md) first. These are prose-heavy items — one extra rule
for all of them:

**Extra rule:** "You are editing documentation read by humans and, in some cases, by models
mid-pipeline. Preserve the project's candid house style (limitations stated plainly, 'Honest
scope note' convention). Never delete a limitation or caveat while moving content. When you
move content, leave a link at the old location only if external references are plausible
(README anchors, ARCHITECTURE decision numbers); otherwise move cleanly."

---

## Prompt D2 — Audience-based information architecture

```
TASK: Implement workstream D2 of plans/documentation-plan.md. Read that section and the
diagnosis (§1) in full first, then the current README "Documentation map" section and
skim every file it links. Branch: docs/audience-paths

1. Rewrite README's "Documentation map" as four short reader-path tables exactly as D2
   specifies (Evaluator / Operator / Contributor / Model), each path an ordered 3-5 doc
   trail with a one-line purpose per doc. Every doc currently in the map must appear in
   exactly one path (or be explicitly clustered under "evaluating" long-form:
   presentation-notes, comparative-analysis, walkthroughs).
2. Create docs/README.md (~30 lines): the same four paths, plus one line stating the
   model-boundary rule: nothing under docs/ is load-bearing for a pipeline run; models
   read AGENTS.md + rules/ + roles/ + skills/ only.
3. Create the operator troubleshooting index: docs/runbooks/README.md mapping symptom →
   runbook section. Source the symptom list from the runbooks themselves (each runbook's
   failure cases/headings — read all five). 15-25 rows, one line each, links with anchors.
4. Add a consistency-checker rule (extend scripts/consistency.js, following its existing
   check style): every file in docs/ (excluding historical/, audit-archive/, reference/)
   is linked from docs/README.md — no orphan docs.

Do NOT rewrite the documents themselves — this item changes the map and adds two small
index files only.

Done means: npm run consistency green including the new orphan check; npm test / eslint
green; report lists each doc → assigned path.
```

---

## Prompt D4 — Dedup and lifecycle

```
TASK: Implement workstream D4 of plans/documentation-plan.md (sub-items 1, 2, 3, 5;
sub-item 4 archive policy is one paragraph inside CONTRIBUTING). Read §§1-3 of the plan
first — §3's canonical-home matrix is the rulebook for every move you make.
Branch: docs/dedup-lifecycle

1. BACKLOG slimming: every struck-through item becomes one line — ID, title, landed date,
   link to its CHANGELOG entry. Before deleting any strikethrough detail, CONFIRM the
   equivalent detail exists in CHANGELOG.md; where it does not, MOVE it into the
   appropriate CHANGELOG entry rather than deleting. Open items are untouched.
2. README diet: README keeps pitch, first-30-minutes, quick start, the D2 path tables,
   prerequisites, license, "why this exists". Feature enumeration beyond ~5 headline
   bullets moves to (or already exists in) docs/FEATURES.md — link, don't restate. Diff
   your result against the canonical-home matrix.
3. CONTRIBUTING: add (a) the five principles from plan §2, condensed to ~10 lines, and
   (b) the "if you changed X, update Y" table from D4.3, and (c) one paragraph on the
   docs/historical/ archive policy (D4.4) matching the convention docs/audit-archive/
   already uses.
4. AGENTS.md refit (D4.5): reduce to ~1 page of what an agent working on the stagecraft
   repo itself needs: layout, test/lint commands, house conventions (comment style, test
   tempdir pattern), links elsewhere. Remove: the stale test counts, decision counts,
   shipped-backlog blurb (Phase 2.2 partially fixed these — your job is structural: facts
   become links so they cannot go stale again).

Done means: npm test / eslint / npm run consistency green; report shows before/after line
counts for BACKLOG.md, README.md, AGENTS.md, and lists every fact moved (from → to).
```

---

## Prompt D3a — Generated reference docs: stages + hosts matrices

```
TASK: Implement workstream D3 sub-items 1, 3, 4 of plans/documentation-plan.md (the CLI
reference, sub-item 2, is a separate later prompt — skip it). Read the D3 section and the
tracks-matrix generator built in Phase 2.2.5 first — it is your template for the
generate-commit-verify pattern. Branch: docs/generated-reference

1. scripts/docs-generate.js (or extend the Phase-2 generator — read it and decide; report
   the choice): emits
   - docs/reference/stages.md: table from STAGES in core/pipeline/stages.js — stage ID,
     name, roles, conditionalOn, gate filename, artifact/template. Group by pipeline
     phase the way stages.js orders them.
   - docs/reference/hosts.md: capability/enforcement matrix from hosts/*/capabilities.json
     — one row per capability key, one column per host, plus the enforces.* levels.
   Both outputs fenced with <!-- generated: do not hand-edit --> markers.
2. npm run docs:generate runs all generators (including the Phase-2 tracks matrix).
3. Consistency check: committed output must equal regenerated output (run the generator
   to a temp file, compare). Wire into scripts/consistency.js.
4. Replace hand-maintained equivalents: find stage tables / host-capability tables in
   docs/concepts.md, docs/user-guide.md, docs/FEATURES.md and replace each with a link to
   the generated reference plus at most a 2-line summary. List every replacement.

Done means: npm run docs:generate idempotent (second run = no diff); consistency check
catches a hand-edit to generated output (prove with a test in consistency-meta);
npm test / eslint green; CHANGELOG entry.
```

---

## Prompt D3b — Generated CLI reference (run only after Phase 3.1a is merged)

```
PRECONDITION: core/cli/flags.js and per-command flag schemas exist (Phase 3.1a). If they
do not, STOP and report.

TASK: Implement workstream D3 sub-item 2 of plans/documentation-plan.md.
Branch: docs/generated-cli-reference

1. Extend the docs generator: docs/reference/cli.md from the command registry — per
   command: synopsis, description, flag table (name, type, description from the schema),
   in the registry's order. Same generated-marker + consistency-check pattern as D3a.
2. Sweep docs/ and docs/runbooks/ for hand-written flag tables or usage blocks that
   duplicate the reference (grep for `devteam ` code blocks): runbooks KEEP their inline
   command invocations (procedure beats reference — do not strip working examples), but
   any *enumeration* of flags/commands outside the generated file becomes a link.
   Judgement rule: an example teaching a procedure stays; a table restating the interface
   goes.
3. devteam --help and the generated reference must agree by construction (both derive
   from the schemas) — add one test asserting a sampled command's help output flags all
   appear in the generated doc.

Done means: generator idempotent; consistency green; npm test / eslint green; report
lists kept-vs-linked decisions from step 2.
```

---

## Prompt D5 — Model-facing token budget program

```
PRECONDITION: Phase 2.3 (gates.md split) is merged. If rules/gates.md is still ~21 KB and
in every readFirst, STOP and report.

TASK: Implement workstream D5 of plans/documentation-plan.md. Branch: feat/prompt-budget

1. scripts/prompt-budget.js: for every stage in STAGES, sum the byte sizes of its
   readFirst framework files (rules/, roles/ for each role, AGENTS.md — exclude pipeline
   artifacts like brief.md which are project-dependent) and estimate tokens (bytes/4 is
   fine; say so in output). Emit docs/reference/prompt-budget.md (generated-marker
   pattern from D3) with per-stage totals and the top-5 heaviest files overall.
2. CI advisory (non-blocking): compare against the committed prompt-budget.md; warn when
   any stage's total grows >10%. Wire wherever Phase-3.6's non-blocking coverage step
   lives, or as a consistency.js advisory — pick the cleaner fit and report.
3. Per-file ceiling advisories in consistency.js: role brief ≤ 16 KB, stage rule file
   ≤ 8 KB, AGENTS.md ≤ 10 KB. Advisory severity, not failure. If any CURRENT file already
   exceeds its ceiling, do not edit it — record it in the advisory output and list it in
   your report (trimming is step 4's judgment work, possibly a follow-up).
4. Audit roles/qa.md and roles/platform.md (the two heaviest briefs): identify sections
   that are stage-conditional knowledge belonging in a skills/ SKILL.md (loaded only when
   that stage runs) versus always-needed role identity. PROPOSE the moves in your report
   with section names and destinations — do NOT move content in this PR.

Done means: prompt-budget.md committed and idempotent; advisories fire on synthetic
violations (meta-test); npm test / eslint / consistency green; the step-4 proposal in the
report; CHANGELOG entry.
```

---

## Prompt D6 — Onboarding flow upkeep

```
TASK: Implement workstream D6 of plans/documentation-plan.md. Branch: docs/onboarding-upkeep

1. EXAMPLE.md freshness stamp: add a "captured at vX.Y" stamp line near the top
   ([verify-first]: determine which version the current capture reflects from git history
   — `git log --follow EXAMPLE.md`; if undeterminable, stamp the current version and note
   the uncertainty in the stamp's wording honestly). Add a consistency advisory: warn
   when the stamp is more than one minor version behind package.json. Add an "EXAMPLE.md
   re-capture" line to the release checklist (wherever Phase 2.5 documented the release
   flow — scripts/release.js docs or CONTRIBUTING).
2. First-30-minutes CI smoke: extend the existing init+doctor smoke in
   .github/workflows/test.yml to execute the README's actual onboarding steps:
   devteam init → devteam doctor → DEVTEAM_HEADLESS_COMMAND=cat devteam stage requirements
   --feature "smoke test feature" --headless → devteam next. Assert next returns a valid
   action. Read the README's First-30-minutes section and tests/ci.test.js patterns first;
   if any README step cannot run offline, adapt the smoke and note the divergence as a
   comment in the workflow.
3. FAQ policy: add a 3-line "How this FAQ is maintained" note at the top of docs/faq.md
   (operational questions only; facts are linked, not restated; entries restating feature
   state get deleted). Then apply it once: identify FAQ entries that restate feature state
   (grep for feature claims; cross-check 3-5 against FEATURES.md) and convert them to
   links or delete. List every entry touched.

Done means: CI smoke passes locally (act or manual command transcript in report);
consistency green; npm test / eslint green; CHANGELOG entry.
```
