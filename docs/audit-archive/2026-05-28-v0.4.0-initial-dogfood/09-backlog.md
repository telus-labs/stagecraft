# 09 — Backlog

## Summary

This self-audit surfaced **0 P0 items** (no broken builds, no critical security holes, no data-corruption risks). The work that emerged is hygiene and small-investment items: doc gaps, a couple of small code-quality cleanups, two reliability concerns that matter only at the margin. The codebase is in a defensible state.

The notable shape: the existing `docs/BACKLOG.md` already tracks the medium-and-larger ideas (cross-project memory, more host adapters, B2 perf-budget stage, etc.); this audit's roadmap is mostly **complementary** — small things that don't rise to BACKLOG-entry level but should still get done.

## Themes

### Theme 1 — Doc completion residue from the v0.2.0 uplift

Three of the post-Phase-1 findings (D1 missing template guides, D3 stale test count, D4 onboarding video) trace to the same root cause: the tier-1/2/3 doc uplift was thorough but a few corners weren't swept. The fix is finishing the sweep, not a structural change.

### Theme 2 — Multi-adapter duplication

Findings Q1 (role-list duplicated in 3 adapters) and Q2 (install-roundtrip pattern duplicated in 3 adapters) are the same shape: every adapter re-implements the same loop. The fix is a shared installer base in `core/adapters/`. Investment pays off on every future adapter add (A2-A5 in the existing BACKLOG).

### Theme 3 — Subprocess hygiene

Finding P5 (no subprocess timeouts) and the historical pattern of `process.exit()` from many sites (validator, hooks, CLI) suggest a small operational gap: subprocesses in the orchestrator have no upper bound on wall-clock. Matters most for `--headless` runs in CI where a hung host CLI hangs the pipeline indefinitely.

### Theme 4 — Audit process maturity

The Phase-2 security review's near-miss (Finding S5: a finding promoted to medium severity based on signature-only reasoning, retracted after live verification) is a process lesson, not a code finding. **Future audits should verify before promoting.** Worth codifying as a checklist in the audit skill.

## Rating scales

- **Effort:** XS (<1 day) / S (1–3 days) / M (week) / L (2 weeks)
- **Risk of change:** low / medium / high
- **Risk of NOT changing:** low / medium / high
- **Confidence:** HIGH / MEDIUM / LOW

## P0 — Fix now

**None.** The codebase has no critical issues. This is the right state to be in.

## P1 — Quick wins

Land in the next 1–2 commits.

### P1-1: Fix `core/gates/validator.js` import inconsistency

- **Theme:** Doc completion residue (Theme 1) — but really, code consistency.
- **Source:** Finding N1.
- **Description:** Change `require("fs")` / `require("path")` to `require("node:fs")` / `require("node:path")`. Every other JS file uses the `node:` prefix; this is the only outlier.
- **Affected:** `core/gates/validator.js:29-30`.
- **Effort:** XS.
- **Risk of change:** low.
- **Risk of NOT changing:** low.
- **Confidence:** HIGH.

### P1-2: Update `docs/TESTING.md` summary line

- **Theme:** Doc completion residue.
- **Source:** Finding D3.
- **Description:** Current text says "362 tests / 24 files"; actual is 378 / 25. Either update the numbers or change the wording to "see `npm test` output" to avoid future drift.
- **Effort:** XS.
- **Risk of change:** low.
- **Risk of NOT changing:** low.
- **Confidence:** HIGH.

### P1-3: Add `tests/consistency-meta.test.js`

- **Theme:** Test coverage gap.
- **Source:** Finding T3.
- **Description:** Add a meta-test that runs `node scripts/consistency.js` as a subprocess and asserts exit 0. Five lines. Ensures `npm test` alone is enough to catch contract drift, without requiring CI.
- **Effort:** XS.
- **Risk of change:** low.
- **Risk of NOT changing:** medium (developer running `npm test` locally could land a contract-breaking change that only CI catches).
- **Confidence:** HIGH.

### P1-4: Document the stdout-vs-stderr logging norm

- **Theme:** Doc completion residue.
- **Source:** Finding L1.
- **Description:** The pattern (stdout for primary user output, stderr for warnings + side-channel framing) is real but undocumented. Add a paragraph to `AGENTS.md` or a new `docs/conventions.md`.
- **Effort:** XS.
- **Risk of change:** low.
- **Risk of NOT changing:** low (cultural drift over time).
- **Confidence:** HIGH.

### P1-5: Add the audit's "verify before promoting" lesson to the skill

- **Theme:** Audit process maturity (Theme 4).
- **Source:** the S5 near-miss in this audit.
- **Description:** Add a "Process discipline" section to `skills/audit/SKILL.md` stating: any finding that names a vulnerability MUST be verified before being promoted past LOW confidence. Live exploit attempt or code-path trace.
- **Effort:** XS.
- **Risk of change:** low.
- **Risk of NOT changing:** medium (future audits could promote false findings to P0 status).
- **Confidence:** HIGH.

## P2 — Targeted improvements

Land in weeks 1–4.

### P2-1: Add `tests/visualize.test.js`, `tests/pr-pack.test.js`

- **Theme:** Test coverage gap.
- **Source:** Findings T1, T2.
- **Description:** Two helper scripts have no direct tests. Smoke-test them via `tests/visualize.test.js` (assert output structure for one fixture pipeline) and unit-test the pure helpers in `tests/pr-pack.test.js`.
- **Effort:** S (half day).
- **Risk of change:** low.
- **Risk of NOT changing:** low.
- **Confidence:** HIGH.

### P2-2: DRY the role list across the 3 host adapters

- **Theme:** Multi-adapter duplication.
- **Source:** Finding Q1.
- **Description:** Lift the role list to a single source (scan `roles/*.md` or read `roles/_manifest.json`). Per-host frontmatter stays per-adapter; the *list* becomes shared.
- **Affected:** `hosts/claude-code/adapter.js:27-90`, `hosts/codex/adapter.js:34`, `hosts/gemini-cli/adapter.js:35`.
- **Effort:** S.
- **Risk of change:** low (the per-adapter frontmatter customization is preserved; only the list source changes).
- **Risk of NOT changing:** medium (every new role pays the friction tax; just happened with `auditor`).
- **Confidence:** HIGH.
- **Dependencies:** none.

### P2-3: Add subprocess timeout to `--headless` mode

- **Theme:** Subprocess hygiene (Theme 3).
- **Source:** Finding P5.
- **Description:** Add a `--timeout-ms` flag to `devteam stage --headless` (default ~10 minutes). Propagate to `core/adapters/headless.js`'s `spawn` call. Document `--timeout-ms 0` as the "no timeout" escape.
- **Effort:** S.
- **Risk of change:** low (opt-out via flag).
- **Risk of NOT changing:** medium (a hung host CLI in CI hangs the pipeline indefinitely).
- **Confidence:** HIGH.

### P2-4: Annotate the remaining 9 templates

- **Theme:** Doc completion residue (Theme 1).
- **Source:** Finding D1.
- **Description:** Currently `docs/brief-template.md`, `design-spec-template.md`, `runbook-template.md` have section-by-section annotation guides. The other 9 templates (build, clarification, pr-summary, pre-review, retrospective, review, test-report, adr, plus the audit templates) don't. Decide: annotate all, or document the asymmetric coverage explicitly.
- **Effort:** S to M (writing 9 doc files of ~50–80 lines each, or one paragraph clarifying the asymmetry).
- **Risk of change:** low.
- **Risk of NOT changing:** low.
- **Confidence:** HIGH.

### P2-5: Add inline comments to `computeDispatchPlan` and `hostFromPath`

- **Theme:** Comment-density gap in hot files.
- **Source:** Finding D2.
- **Description:** Add 2-3 lines of comment above each function explaining the implicit contract (the fanout matrix for `computeDispatchPlan`; what counts as a "known host" for `hostFromPath`).
- **Effort:** XS.
- **Risk of change:** low.
- **Risk of NOT changing:** low (friction for future contributors).
- **Confidence:** HIGH.

## P3 — Strategic investments

Long-term, paired with mini-proposals. Month 2+.

### P3-1: Extract `core/adapters/base-install.js`

- **Theme:** Multi-adapter duplication.
- **Source:** Finding Q2.
- **Description:** Each adapter's `install()` follows the same shape with 70% shared structure. Extract a base installer exposing `installRoles`, `installRules`, `installCommands`, `installSkills`, `installSettings` as capability-parameterized helpers. Per-host adapter becomes ~30 lines of capability-specific wiring.
- **Mini-proposal:** new adapter additions become trivial (one capabilities.json + one ~50-line adapter.js). Validates by reducing `hosts/claude-code/adapter.js` from 404 → ~250 LOC and `hosts/codex/adapter.js` from 233 → ~80 LOC, without behavior change.
- **Effort:** M.
- **Risk of change:** medium (touches all 3 adapters; install-roundtrip tests must stay green).
- **Risk of NOT changing:** medium (slows BACKLOG A2/A3/A4/A5 adapter additions).
- **Confidence:** HIGH.

### P3-2: Split `core/orchestrator.js`

- **Theme:** Hot-file growth (Theme not promoted — it's a watch item).
- **Source:** Finding Q3.
- **Description:** Already flagged in v0.1.0 audit as a P2 deferral. The file hasn't grown materially since; defer remains correct. **Action: do nothing this cycle.** Re-check next audit.
- **Effort:** M when triggered.
- **Risk of change:** medium.
- **Risk of NOT changing:** low (currently working fine).
- **Confidence:** HIGH.

## Parked

Items that don't justify work right now. Include the reasoning.

### Parked-1: Onboarding video / GIF

- **Source:** Finding D4.
- **Reason for parking:** preference, not gap. Text walkthrough in EXAMPLE.md is sufficient.
- **What would change this:** sustained user feedback that the text walk-through isn't enough.

### Parked-2: Hash-verify Hugging Face model downloads

- **Source:** Finding S8.
- **Reason for parking:** the supply-chain risk is real but low. Implementation would require maintaining hashes per model version; high friction for low risk reduction.
- **What would change this:** a publicized incident with the HF CDN, or a security-conscious user request.

### Parked-3: Memory `MemoryStore` sqlite-vec backend

- **Source:** Finding P7.
- **Reason for parking:** at the current per-project scale (≤1k chunks), JSON backend is fast enough. The interface is ready; implementation lands when a project hits 5k+ chunks.
- **What would change this:** any user report of >100ms query latency.

### Parked-4: Concurrency test for approval-derivation

- **Source:** Findings T4, P3.
- **Reason for parking:** the lock acquisition path is exercised in unit tests; real concurrent contention test would be useful but not urgent. Already listed in `docs/TESTING.md` tier 3.
- **What would change this:** an observed gate-corruption incident under multi-reviewer Stage 5.

## Project-Specific

*(No `docs/audit-extensions.md`.)*
