# 05 — Documentation health

## Summary

Documentation breadth is a major strength: onboarding, concepts, methodology,
reference tables, runbooks, ADRs, deployment guidance, testing, and dogfooding all
exist and are indexed. Generated references and consistency checks protect many
structural facts. The current weakness is lifecycle reconciliation after exceptional
delivery velocity: shipped features remain open in the backlog, current docs retain
old source-of-truth locations, and test/version claims disagree.

## Findings

### D-1 — The active backlog contains three shipped capabilities

- **Locations:** `docs/BACKLOG.md:78-86` and the “Consciously deprioritized” section.
- **Gap:** A6 lists the exact Windows breakpoints fixed by PRs #224/#226/#227/#228;
  B3 cost gating shipped in PR #221; B6 documentation gating shipped in PR #225 and
  was already partially present at sign-off. B6 is simultaneously called open and
  consciously deprioritized.
- **Suggested fix:** move B3 and B6 to Shipped. Reframe A6 as native-Windows
  validation/support, dependent on T-1, rather than an unstarted port.
- **verified_by:** merged commits `9a720ed`/`a9e2a9b` (cost gate),
  `f6ef75e`/`69b9d44` (documentation gate), and Windows commits/PRs listed in T-1;
  direct code matches in `core/gates/validator.js`, `core/command-line.js`,
  `core/process-kill.js`, and doctor tests.
- **Confidence:** HIGH.

### D-2 — Current feature/concept docs point tool budgets at the old authority

- **Locations:** `docs/FEATURES.md:161`, `docs/concepts.md:81`, and
  `docs/runbooks/fix-and-retry.md:575`.
- **Gap:** these say role budgets originate in Claude-specific `ROLE_FRONTMATTER`.
  Phase 6 moved the host-neutral authority to `core/roles.js`; adapters customize or
  translate it.
- **Suggested fix:** name `core/roles.js` as the canonical budget source and describe
  `ROLE_FRONTMATTER` as Claude-specific rendering metadata.
- **verified_by:** direct inspection of `core/roles.js:1-24` and adapter
  `toolBudgetFor()` implementations; `plans/phase-6-promise-integrity.md` records the
  move.
- **Confidence:** HIGH.

### D-3 — Performance-gate field name is wrong in two current guides

- **Locations:** `docs/FEATURES.md:61`, `docs/user-guide.md:425`.
- **Gap:** both advertise `checks_run[]`; the schema and UI use
  `checks_performed[]`.
- **Suggested fix:** replace the field name and let consistency validate this
  schema-to-doc vocabulary in future.
- **verified_by:** `core/gates/schemas/stage-06e.schema.json` requires
  `checks_performed`; `core/ui/static/app.js:912-915` renders it; no schema field named
  `checks_run` exists.
- **Confidence:** HIGH.

### D-4 — Contributor-facing test counts disagree with each other and reality

- **Locations:** `AGENTS.md:15` (~1,641), `CONTRIBUTING.md:215` (~1,200), and
  `plans/README.md:53` (1,161).
- **Gap:** the final CI-equivalent run executes 1,941 tests across 91 files.
- **Suggested fix:** use “~1,940 tests” in current contributor docs, or avoid a count
  where it adds maintenance without decision value. Historical phase narratives can
  keep their contemporaneous counts.
- **verified_by:** the final `CI=true DEVTEAM_HEADLESS_COMMAND=cat npm test` run
  reported 1,941 passing tests; the suite contains 91 test files.
- **Confidence:** HIGH.

### D-5 — Feature support still declares Stagecraft POSIX-only

- **Location:** `docs/FEATURES.md:331`.
- **Gap:** doctor no longer emits the referenced blanket warning and the three known
  portability fixes have landed. Full native support is not yet proven because T-1
  remains open.
- **Suggested fix:** describe Windows as implemented/experimental pending a native CI
  lane; keep WSL2 as the conservative recommendation until that lane is green.
- **verified_by:** Windows merge commits in T-1 and direct inspection of current
  doctor, command-line, fix-recipes, and process-kill implementations; workflow
  inspection verifies the remaining evidence gap.
- **Confidence:** HIGH.

### D-6 — Comparative analysis is a v0.5 snapshot with unrefreshed external claims

- **Location:** `docs/comparative-analysis.md`.
- **Gap:** the matrix reports Stagecraft v0.5.0, ~23k LOC, ~1,100 tests, and explicitly
  says competitors were not reverified after 2026-06-03. Stagecraft is v0.7.0 with
  50,898 JavaScript lines and ~1,800 declared tests; competitor ecosystems also moved.
- **Suggested fix:** refresh first-party facts, distinguish methodology/tooling more
  carefully, and replace dated opportunity rows with current strategic deltas.
- **verified_by:** `package.json`, repository inventory in `00-project-context.md`, and
  first-party June 2026 sources for Spec Kit, BMAD, Agent OS, OpenSpec, Kiro, and
  AI-DLC collected during this audit.
- **Confidence:** HIGH.

### D-7 — Two plan documents contain a broken dogfooding-guide link

- **Locations:** `plans/phase-14-dogfooding-support.md:638` and
  `plans/prompts/ALL-PROMPTS.md:2007`.
- **Gap:** `guides/dogfooding.md` resolves under `plans/`, but the file lives under
  `docs/guides/`.
- **Suggested fix:** use `../docs/guides/dogfooding.md` in both plan documents.
- **verified_by:** filesystem check confirms `docs/guides/dogfooding.md` exists and
  `plans/guides/dogfooding.md` does not.
- **Confidence:** HIGH.

### D-8 — Embedding-provider errors carry an expired v0.3 promise

- **Location:** `core/memory/embed.js:38-39`.
- **Gap:** OpenAI and Cohere errors say “planned for v0.3”; v0.7 ships only local and
  stub providers, while `docs/memory.md` correctly documents the actual surface.
- **Suggested fix:** remove the release promise and list supported providers in the
  error.
- **verified_by:** direct provider switch inspection and `docs/memory.md`; production
  dependency inventory contains the local Hugging Face runtime and no OpenAI/Cohere
  SDK.
- **Confidence:** HIGH.

## Onboarding assessment

The first-30-minutes workflow is unusually strong and runs in CI. A new contributor
can locate architecture, tests, command recipes, and ownership boundaries quickly.
The main friction is quantitative distrust: three test counts and stale feature claims
make readers wonder which current document is authoritative.

## Project-specific extensions

No `docs/audit-extensions.md` file is present.
