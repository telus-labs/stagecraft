# 10 — Sequenced roadmap

## Summary

One batch of small fixes (Batch 1, all XS-effort, ~half a day total), then a second batch of medium-investment items (Batch 2, ~3 days), then a single strategic investment whose payoff compounds with new host adapters (Batch 3, ~week). One item is explicitly deferred-with-reason.

**Total effort to land everything except Parked items: ~5 days of focused work.** Most of the value comes in Batch 1 — small things that close residual gaps from the recent audit cycle.

## Batch 1 — Immediate (P1 quick wins)

All XS effort. Land as one or two commits.

### PR 1.1 — Hygiene sweep

Closes the post-v0.2.0 residue. Group these into one commit.

| # | Item | Effort | Verification |
|---|---|---|---|
| 1 | **P1-1**: `core/gates/validator.js` `node:` import prefix | XS | `grep -E "^const (fs\|path) = require" core/gates/validator.js` matches `node:` form. Suite still 378/378. |
| 2 | **P1-2**: Update `docs/TESTING.md` summary line | XS | `grep "378 tests" docs/TESTING.md` matches. |
| 3 | **P1-4**: Document stdout-vs-stderr logging norm | XS | New paragraph in `AGENTS.md` (or `docs/conventions.md`). |
| 4 | **P2-5**: Inline comments on `computeDispatchPlan` + `hostFromPath` | XS | Functions have 2-3 line docblocks. |

**Parallelize:** all four are independent file edits; one commit.
**Total estimated effort:** XS (~1-2 hours).
**Infrastructure changes needed:** none.

### PR 1.2 — Test surface closure

Closes the test-coverage residue and locks the audit-process lesson.

| # | Item | Effort | Verification |
|---|---|---|---|
| 1 | **P1-3**: `tests/consistency-meta.test.js` | XS | New file: spawns `node scripts/consistency.js`, asserts exit 0. Suite increases by 1 test. |
| 2 | **P1-5**: Add "verify before promoting" to audit skill | XS | New `## Process discipline` section in `skills/audit/SKILL.md`. |

**Parallelize:** independent.
**Total estimated effort:** XS (~30 minutes).
**Infrastructure changes needed:** none.

## Batch 2 — Weeks 1–2 (P2 targeted)

### PR 2.1 — Adapter de-duplication (the role list)

Closes the role-list duplication that just bit the audit feature.

| # | Item | Effort | Verification |
|---|---|---|---|
| 1 | **P2-2**: Share role list across adapters | S | Adding a 9th role requires only one file edit. Install-roundtrip tests still pass for all 3 hosts. |

**Effort:** S (half day).
**Risk:** low.
**Dependencies:** none.

### PR 2.2 — Subprocess timeout for headless mode

| # | Item | Effort | Verification |
|---|---|---|---|
| 1 | **P2-3**: `--timeout-ms` on `devteam stage --headless` | S | Test: pass `--timeout-ms 100` with a sleeping `DEVTEAM_HEADLESS_COMMAND`; expect timeout-related exit + clear error. |

**Effort:** S (half day).
**Risk:** low (opt-in flag; default of 10 min unlikely to affect existing usage).

### PR 2.3 — Helper-script test coverage

| # | Item | Effort | Verification |
|---|---|---|---|
| 1 | **P2-1**: `tests/visualize.test.js`, `tests/pr-pack.test.js` | S | New tests; suite increases. Coverage gap closed. |

**Effort:** S.
**Risk:** low.

### PR 2.4 — Template documentation decision

| # | Item | Effort | Verification |
|---|---|---|---|
| 1 | **P2-4**: Decide on asymmetric template-doc coverage | S to M | Either (a) annotate the 9 missing templates with the same shape as brief / design-spec / runbook, or (b) document the asymmetry explicitly in `docs/concepts.md`'s template section. |

**Effort:** S (decision + 1 doc) or M (full annotation pass).
**Risk:** low.

**Batch 2 parallelization:** PRs 2.1, 2.2, 2.3, 2.4 are independent; can land in any order. Total ~3 days if done sequentially.

## Batch 3 — Month 1+ (P3 strategic)

### PR 3.1 — `core/adapters/base-install.js`

| # | Item | Effort | Verification |
|---|---|---|---|
| 1 | **P3-1**: Extract shared installer base | M | Each adapter shrinks: claude-code 404→~250 LOC, codex 233→~80, gemini-cli 234→~80. Install-roundtrip tests stay green for all 3. |

**Effort:** M (~week including testing).
**Risk:** medium — touches all 3 adapters and the install protocol.
**Dependencies:** Batch 2 PR 2.1 (role-list dedup) lands first; the installer base inherits from that work.

**Mini-proposal:**

> The current `install()` in each host adapter follows the same 5-step pattern (roles → rules → commands → skills → settings) with capability-specific differences. Extract a `core/adapters/base-install.js` that takes a host's capabilities object and exposes `installRoles(targetDir, opts)`, `installCommands(...)`, etc. Each adapter's `install()` becomes ~20 lines of "call the base helpers in the right order, wire in host-specific things like Claude Code's hooks settings." Validates by reducing the per-adapter line counts above and by enabling future adapters (BACKLOG A2-A5) to be ~150-line additions instead of ~250.

**Validation criterion:** when this lands, the next adapter add (Cursor / Aider / Cline / Windsurf — A2 in BACKLOG) takes less than half a day.

## Roadmap risks

What could go wrong with this sequence:

- **Batch 2's PR 2.1 (role-list dedup) interacts with Batch 3's PR 3.1 (installer base).** If PR 3.1 starts before 2.1 lands, the role-list change in 3.1 would be wasted work. **Order matters: 2.1 → 3.1.**
- **PR 2.3's helper-script tests might surface hidden bugs.** That's fine; we'd fix them in the same PR. Worth budgeting one extra hour.
- **PR 2.4's "decide on annotation asymmetry" could spiral if the team decides to annotate all 9 templates.** Time-box the decision; don't let it expand mid-PR.

## What this audit explicitly did NOT find

For symmetry, the absence of findings is itself useful:

- **No security P0.** The codebase is in a defensible security posture. The one near-miss (Finding S5) was retracted via verification before reaching the backlog.
- **No `npm audit` issues.** Resolved during P2 of the previous audit by removing `@opentelemetry/sdk-node`.
- **No broken builds or failing tests.** 378/378 green; 185/185 consistency checks pass.
- **No dead code.** Previous round removed the budget guard; nothing else flagged.
- **No major architectural issues.** Core/adapter separation honored. Gate JSON as the contract. Single source of truth for roles, stages, schemas.

## Recommended cadence

When should the next audit run?

- **After Batch 1 lands** — re-audit Phase 1 (compliance) to confirm consistency issues are closed.
- **Before BACKLOG A2 (Cursor adapter) lands** — re-audit Phase 0.2 (architecture) and Phase 2.3 (code quality) to confirm the installer base is paying off.
- **On every minor version bump** — quick audit (`/audit-quick`) for a fast health check, full `/audit` quarterly.
- **After any incident** — failure mode, regression, or unexpected user-reported behavior — re-audit the affected subsystem.

## Final note (this is a self-audit)

Stagecraft auditing itself worked. Output is concrete (file paths, line numbers, specific findings) rather than gestural. One finding (S5) was caught and retracted via live verification — exactly the discipline the new "process lesson" P1-5 codifies for future audits. The 11 output files weigh in around ~3,200 lines total, written in ~30 minutes of analysis time against a ~9,200-line JS codebase.

The audit feature is dogfood-validated.

## Project-Specific

*(No `docs/audit-extensions.md`.)*
