# Stagecraft Consolidation & Roadmap Plans

Four phase plans produced from the 2026-06-10 full-framework review. Each phase is a set of
PR-sized work items with file/line anchors, acceptance criteria, and verification commands,
written to be executed by Claude (Sonnet) one item at a time.

| Phase | Plan | Prompts | Theme | Gate to start |
|---|---|---|---|---|
| 1 | [phase-1-trust-consolidation.md](phase-1-trust-consolidation.md) | [prompts](prompts/phase-1-prompts.md) | Safety gaps in the autonomous path + verified CLI bugs | none — start here |
| 2 | [phase-2-consistency-and-docs.md](phase-2-consistency-and-docs.md) | [prompts](prompts/phase-2-prompts.md) | Make prose/code drift mechanically impossible; release | Phase 1 items 1.1–1.5 merged |
| 3 | [phase-3-structural-debt.md](phase-3-structural-debt.md) | [prompts](prompts/phase-3-prompts.md) | bin/devteam split, fix-steps registry, dependency & portability decisions | Phase 2 item 2.1 merged (consistency checker protects the refactor) |
| 4 | [phase-4-capability-roadmap.md](phase-4-capability-roadmap.md) | [prompts](prompts/phase-4-prompts.md) | Resume planned capability work (G10, convergence, G3, H3 pre-work) | Phases 1–2 complete |
| Docs | [documentation-plan.md](documentation-plan.md) | [prompts](prompts/docs-prompts.md) | Documentation system: audience paths, generated reference, token budgets | D1 (= Phase 2) done; see its sequencing table |

**Executing with Sonnet:** every work item has an exact paste-ready prompt under
[prompts/](prompts/README.md). Paste the shared PREAMBLE from prompts/README.md, then the
item prompt, into a fresh Sonnet session — one item per session per branch.

## How to run these with Sonnet

- **One work item per session/PR.** Each item is scoped to be independently mergeable.
  Paste the item (plus the "Conventions" section below) as the task. Do not batch items.
- **Every item has a Verify block.** The change is not done until those commands pass.
  `npm test` and `npx eslint .` must be green after every item (1,161 tests, ~6s, fully offline).
- **Line numbers are anchors, not gospel.** They were verified against commit `212c710`
  (2026-06-10). If the file has moved, search for the quoted code, don't edit blind.
- **Items marked `[verify-first]`** contain a claim from review agents that was not
  independently re-verified. The first step of those items is to confirm the claim;
  if it doesn't hold, stop and report instead of "fixing" working code.
- **Follow repo conventions**: comments explain *why* with backlog/ADR IDs
  (see existing style in core/driver.js:9-23), tests use per-test `mkdtempSync`
  tempdirs with the `devteam-test-` guard (see tests/_helpers.js), commits use
  conventional-commit format, and CHANGELOG entries go under `[Unreleased]`
  (until Phase 2 item 2.4 lands fragments).

## Conventions (paste along with each work item)

- Repo: Node.js CLI, no test framework — bare `node --test tests/*.test.js`.
- Run `npm test` and `npx eslint .` before declaring done.
- Source of truth for stages/gates is `core/pipeline/stages.js`; prose must match code, never the reverse, unless the item says otherwise.
- Never weaken an existing test to make a change pass. If a test encodes the old behavior the item intentionally changes, update the test and say so in the PR description.
- Update `docs/FEATURES.md` / relevant runbook only when the item says to; doc sweeps are Phase 2's job.
