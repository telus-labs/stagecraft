# Documentation Plan — Structure, Flow, and Sustainability

**Scope:** this plan is about the documentation *system* — who reads what, where each fact
lives, and how docs stay true as the code moves. The individual drift *fixes* are Phase 2's
job ([phase-2-consistency-and-docs.md](phase-2-consistency-and-docs.md)); this plan prevents
the next round of drift and improves reading flow. Execution prompts:
[prompts/docs-prompts.md](prompts/docs-prompts.md).

## 1. Diagnosis (from the 2026-06-10 review)

What's strong — and must be preserved:
- **Layered onboarding** (README "First 30 minutes" → EXAMPLE.md → concepts.md → user-guide →
  adoption-guide) is genuinely good. EXAMPLE.md, the runbooks, and examples/sms-opt-in are
  best-in-class artifacts.
- **Honesty as house style** (limitations sections, "Honest scope note" convention, self-audit
  archive). Any restructuring that dilutes this is a regression.

What's broken — root causes, not symptoms:
1. **Every fact lives in ~5 places** (README, FEATURES.md, BACKLOG strikethrough note,
   CHANGELOG, comparative-analysis refresh) with no declared owner — so they diverge at
   exactly the project's development velocity (17-vs-18 stage count in ~10 files, three names
   for one gate file, AGENTS/CONTRIBUTING/TESTING describing a months-old repo).
2. **No audience separation.** The README doc map is a flat list of ~30 documents. An
   evaluator, a daily operator, a contributor, and a *model mid-pipeline* have four disjoint
   reading needs, but the corpus is organized by topic, not reader.
3. **Hand-transcribed views of code.** The tracks matrix, stage lists, capability tables, and
   CLI usage strings are all hand-copied from `core/pipeline/stages.js`, `capabilities.json`,
   and `bin/devteam` — transcription is where drift is born.
4. **Model-facing docs are unbudgeted.** Every stage dispatch carries ~40–50 KB (~10–13K
   tokens) of framework prose (AGENTS.md + pipeline.md + the full gates.md + role brief)
   before reading any code. Nobody owns that number, so it only grows.
5. **BACKLOG doubles as a changelog** (full implementation detail inside struck-through rows),
   and `[Unreleased]` is a merge-conflict magnet (the repo's own C8 item).

## 2. Principles (adopt explicitly, write into CONTRIBUTING)

1. **One owner per fact.** Every class of fact has exactly one canonical home (matrix below);
   everywhere else links, never restates. A restatement is a bug.
2. **Generate, don't transcribe.** Any doc content derivable from code (matrices, stage
   tables, CLI reference, capability grids) is emitted by a script and fenced with
   `<!-- generated: do not hand-edit -->` markers that the consistency checker enforces.
3. **Docs are routed by audience, not topic.** Four named reader paths; every doc belongs to
   exactly one primary path.
4. **Model-facing prose is code.** rules/, roles/, skills/ have a token budget per dispatch,
   measured in CI, with regressions flagged like a performance budget — the framework already
   preaches this for target projects (stage-06e); apply it to itself.
5. **Drift fails CI.** The Phase-2 consistency checker is the enforcement arm of principles
   1–4. A documentation rule without a check is a wish.

## 3. Canonical-home matrix

| Fact class | Canonical home | Everyone else |
|---|---|---|
| Stage/gate/track definitions | `core/pipeline/stages.js` | generated tables + links |
| What shipped | CHANGELOG.md (via changelog.d/ fragments) | FEATURES.md links to entries |
| Feature descriptions (current behavior) | docs/FEATURES.md | README summarizes 5 bullets max |
| What's planned/open | docs/BACKLOG.md (one line per landed item + CHANGELOG link) | — |
| Design rationale | ARCHITECTURE.md + docs/adr/ | docs cite decision numbers |
| CLI flags/usage | command flag schemas (after Phase 3.1) → generated docs/cli-reference.md | runbooks cite, never restate |
| Host capabilities/enforcement | hosts/*/capabilities.json → generated matrix | — |
| Operator procedure | docs/runbooks/ | — |
| Model-facing pipeline rules | rules/ (per-stage) | docs never duplicate rules content |
| Positioning/comparison | docs/comparative-analysis.md | README one paragraph |

## 4. Workstreams

### D1 — Drift fixes + enforcement *(== Phase 2; listed for completeness)*
Consistency checker with six prose-vs-code classes, the sweep, gates.md split, changelog
fragments, release. See phase-2 plan. Everything below assumes D1 done.

### D2 — Audience-based information architecture
Restructure the *map*, not the documents. Four declared reader paths, each with an entry
point and an ordered 3–5 doc trail:
- **Evaluator** ("should we adopt?"): README → EXAMPLE.md → comparative-analysis →
  adoption-guide. Target: decision-ready in 30 minutes (the README already claims this —
  make the claim navigable).
- **Operator** ("I run pipelines daily"): user-guide → tracks → conventions → runbooks →
  cost. Add the one missing piece: a **single troubleshooting index** mapping symptom →
  runbook section (today an operator must know which of five runbooks owns their symptom).
- **Contributor** ("I change Stagecraft"): CONTRIBUTING → ARCHITECTURE → TESTING →
  host-adapter contract → docs/adr/. CONTRIBUTING gains the doc-rules from §2.
- **Model** (never reads docs/): AGENTS.md + rules/ + roles/ + skills/ only. Declare this
  boundary: nothing under docs/ may be load-bearing for a pipeline run (one current
  violation: rules files citing docs/-side templates — fixed in Phase 2.2.7; the checker
  keeps it fixed).

Concretely: rewrite the README "Documentation map" as four short path tables; add a 30-line
docs/README.md index with the same paths; move evaluator-only long-form (presentation-notes,
comparative-analysis) out of the main reading flow into an "evaluating" cluster.

### D3 — Generated reference docs (the anti-transcription program)
Each is a small script + committed output + checker rule (the Phase 2.2.5 tracks-matrix
generator is the template):
1. **docs/reference/stages.md** — stage table (ID, name, roles, conditionalOn, gate file,
   artifact) from `STAGES`. Replaces hand-maintained stage lists in concepts.md/tracks.md.
2. **docs/reference/cli.md** — full CLI reference generated from the per-command flag
   schemas (lands naturally after Phase 3.1a; until then, defer — do not hand-write it).
3. **docs/reference/hosts.md** — capability/enforcement matrix from
   `hosts/*/capabilities.json` (replaces the hand table in user-guide/FEATURES).
4. One `npm run docs:generate` target runs all generators; consistency.js fails CI if
   committed output ≠ regenerated output.

### D4 — Dedup and lifecycle
1. **BACKLOG slimming:** struck-through items become one line + CHANGELOG link; the
   implementation detail moves to (or already exists in) the CHANGELOG entry. (The repo's own
   audit flagged this as P3-5.)
2. **README diet:** README keeps: pitch, first-30-minutes, quick start, the four path tables
   (D2), license. Feature enumeration lives in FEATURES.md only.
3. **Doc-update checklist in the PR flow:** a short table in CONTRIBUTING — "if you changed X,
   update Y" (stages.js → run docs:generate; new flag → schema description is the doc; new
   feature → FEATURES row + fragment; new decision → ADR). The changelog.d CI guard
   (Phase 2.4) already enforces the fragment half.
4. **Archive policy:** anything superseded moves to docs/historical/ (excluded from the
   checker) rather than being half-updated in place — formalize the convention the audit
   archive already uses.
5. **AGENTS.md refit:** it is the one doc read by *both* models and contributors, and it
   drifted worst. Split duties: AGENTS.md keeps only what an agent needs to work on the
   stagecraft repo itself (~1 page, stable); everything else becomes links. Add it to the
   checker's referenced-file and count-claim checks.

### D5 — Model-facing token budget program
1. After the gates.md split (Phase 2.3), add `scripts/prompt-budget.js`: computes per-stage
   readFirst byte/token totals (framework prose only) and writes
   docs/reference/prompt-budget.md. CI advisory: warn when any stage's budget grows >10%
   in a PR.
2. Per-file ceilings as checker advisories: role brief ≤ 16 KB, stage rule file ≤ 8 KB,
   AGENTS.md ≤ 10 KB — chosen from current healthy files; tune after measurement.
3. Audit the three heaviest role briefs (qa.md 320 lines, platform.md 364) for content that
   belongs in skills/ (loaded only when the stage needs it) rather than the always-loaded
   brief.

### D6 — Onboarding flow upkeep
1. **EXAMPLE.md freshness:** it's the single best onboarding artifact and it's a captured
   run — meaning it silently rots. Add to the release checklist (Phase 2.5's process): re-run
   the traced pipeline per minor release, or stamp EXAMPLE.md with "captured at vX.Y" and a
   checker rule that the stamp matches the last-but-one minor.
2. **First-30-minutes smoke:** CI already does init+doctor in a temp dir; extend the smoke to
   the README's actual step list (headless requirements stage with
   `DEVTEAM_HEADLESS_COMMAND=cat`, `devteam next`) so the onboarding instructions are
   *executed*, not just proofread.
3. **FAQ pruning:** FAQ accumulated answers that contradict shipped features (faq.md:848 vs
   landed E7 — fixed in Phase 2.2.6). Policy going forward: FAQ entries answer *operational*
   questions only and link for facts; entries restating feature state get deleted, not
   updated.

## 5. Sequencing

| Step | Depends on | Effort |
|---|---|---|
| D1 (Phase 2) | Phase 1 partially | — (planned) |
| D2 IA restructure | D1 sweep done (don't reorganize stale docs) | 1–2 sessions |
| D4.1/D4.2/D4.5 dedup | D1 | 1–2 sessions |
| D3.1, D3.3 generators | D1 checker | 1 session each |
| D3.2 CLI reference | Phase 3.1a flag schemas | 1 session |
| D5 token budget | Phase 2.3 gates split | 1–2 sessions |
| D6 onboarding upkeep | Phase 2.5 release process | 1 session |
| D4.3 checklist + CONTRIBUTING principles | any time after D1 | trivial |

**End state worth stating:** a fact about Stagecraft exists in exactly one authored place or
is generated from code; every doc has one declared audience; the per-stage prompt cost is a
measured, budgeted number; and the CI that already guards the code guards the prose.
