# Stagecraft Consolidation & Roadmap Plans

Phase plans produced from the 2026-06-10 full-framework review. Each phase is a set of
PR-sized work items with file/line anchors, acceptance criteria, and verification commands,
written to be executed by Claude (Sonnet) one item at a time. **All phases are complete.**

| Phase | Plan | Prompts | Theme | Status |
|---|---|---|---|---|
| 1 | [phase-1-trust-consolidation.md](phase-1-trust-consolidation.md) | [prompts](prompts/ALL-PROMPTS.md) | Safety gaps in the autonomous path + verified CLI bugs | ✅ complete (PRs #63–#69) |
| 2 | [phase-2-consistency-and-docs.md](phase-2-consistency-and-docs.md) | [prompts](prompts/ALL-PROMPTS.md) | Make prose/code drift mechanically impossible; release | ✅ complete (PRs #71 · #72 · #75 · #76 · v0.6.0) |
| 3 | [phase-3-structural-debt.md](phase-3-structural-debt.md) | [prompts](prompts/ALL-PROMPTS.md) | bin/devteam split, fix-steps registry, dependency & portability decisions | ✅ complete (PRs #79–#89) |
| 4 | [phase-4-capability-roadmap.md](phase-4-capability-roadmap.md) | [prompts](prompts/ALL-PROMPTS.md) | Resume planned capability work (G10, convergence, G3, H3 pre-work) | ✅ complete (PRs #90–#97) |
| Docs | [documentation-plan.md](documentation-plan.md) | [prompts](prompts/ALL-PROMPTS.md) | Documentation system: audience paths, generated reference, token budgets | ✅ complete (PRs #99 · #102 · #103 · #104 · #105 · #107) |
| 5 | [phase-5-state-integrity.md](phase-5-state-integrity.md) | [prompts](prompts/ALL-PROMPTS.md) | State lifecycle: derived gate invalidation, archive ownership, interactive ceiling, B9 fence | ✅ complete (PRs #114–#117) |
| 6 | [phase-6-promise-integrity.md](phase-6-promise-integrity.md) | [prompts](prompts/ALL-PROMPTS.md) | Make shipped claims true: G10 prompt-only path, pm budget, C3 runner, recipe de-overfit | ✅ complete (PRs #118–#121 · #124) |
| 7 | [phase-7-test-harness.md](phase-7-test-harness.md) | [prompts](prompts/ALL-PROMPTS.md) | Kill the repo-state test class structurally; CI signal quality | ✅ complete (PRs #122 · #125) |
| 8 | [phase-8-release-and-sync.md](phase-8-release-and-sync.md) | [prompts](prompts/ALL-PROMPTS.md) | v0.7.0 with honest attribution; semantic runbook sync; D5 token work | ✅ complete (PRs #123 · #126 · v0.7.0) |
| 9 | [phase-9-evidence-gated-capabilities.md](phase-9-evidence-gated-capabilities.md) | [prompts](prompts/ALL-PROMPTS.md) | ADR-007 heartbeat, H3 ground-truth, ADR-008, adaptive-routing evidence | ✅ complete (PRs #128 · #129 · #131 · #133) — ADR-005 deferred |
| 10 | [phase-10-repair-mode.md](phase-10-repair-mode.md) | [prompts](prompts/ALL-PROMPTS.md) | `devteam run --repair` bug-fix intent (ADR-009): PATCH-MODE-scoped build, diagnosis stage, failing-first reproduction | ✅ complete (PRs #140 · #141 · #146 · #147) |
| 11 | [phase-11-autonomy-polish.md](phase-11-autonomy-polish.md) | [prompts](prompts/ALL-PROMPTS.md) | Autonomy polish (ADR-006/007/008): track provenance, liveness heartbeat (observe-first), advise-aware exit semantics | 🔲 ready (ADRs Accepted) |

**Executing with Sonnet:** every work item has an exact paste-ready prompt in
[prompts/ALL-PROMPTS.md](prompts/ALL-PROMPTS.md) (single source of truth, with status
chips). Paste its §0 PREAMBLE plus the item prompt into a fresh Sonnet session — one
item per session per branch.

---

## Evidence reviews

Read-and-report analyses produced during the roadmap — no code changed in these sessions.
They document why certain capability gates remain shut and what would open them.

| File | Phase item | PR | Verdict |
|---|---|---|---|
| [phase-4-ground-truth.md](phase-4-ground-truth.md) | 4.0 — convergence vs. spec | — | Implementation matched spec; no gaps at Phase 4 entry |
| [h3-ground-truth.md](h3-ground-truth.md) | 9.2a — H3 recipe factory corpus | #129 | Gate stays shut: zero run-logs, zero gate archives; re-escalate after ≥2 real projects with ≥5 autonomous runs each |
| [adaptive-routing-evidence.md](adaptive-routing-evidence.md) | 9.4 — D5 adaptive routing | #133 | Gate stays shut: max 4 dispatches per role (sms-opt-in fixture only); re-escalate after ≥5 dispatches per (role, host) pair across ≥2 real user projects with cost telemetry |

---

## How to run these with Sonnet (historical reference)

All phases are complete. These notes are preserved for re-use if new phases are planned.

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
