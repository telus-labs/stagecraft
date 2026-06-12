# Phase 6 — Promise Integrity

**Goal:** close the gaps where shipped documentation describes behavior the code does not
implement, and where the framework's own "verified, not trusted" doctrine has an
exception. Nothing here is new capability; it is making existing claims true.

All findings verified at main `2a1d985` (round-2 review). Anchors by search, not line.

---

## 6.1 Tool budgets: make the prompt-only path real

**Problem:** G10's budget source of truth is `ROLE_FRONTMATTER[role].tools` inside
`hosts/claude-code/adapter.js` (`toolBudgetFor()`), and only that adapter exports it.
`core/orchestrator.js` resolves the budget from the **routed** adapter, so for
codex/gemini-cli/generic it is always `null`: `toolBudgetSection()` in render-helpers
never renders, `warnIfToolBudgetDegraded()` never fires, and `dispatched_tool_budget` is
never stamped on non-claude dispatches. The changelog fragment
(`changelog.d/feat-g10-role-tool-budgets.md`) and a test comment in
`tests/adapter-contract.test.js` both describe the intended behavior as if it works;
tests pass because they inject `descriptor.toolBudget` directly.

**Change:**
1. Move the role→tools table to a host-neutral home: `core/roles.js` (it already owns
   role metadata — [verify-first] read it) exporting `toolBudgetFor(role)`. The
   claude-code adapter consumes it to build subagent frontmatter (its native
   enforcement), instead of owning it.
2. The orchestrator resolves the budget from `core/roles.js` for every dispatch,
   regardless of host: prompt-only hosts get the advisory section rendered,
   `warnIfToolBudgetDegraded` fires per its capabilities declaration, and
   `dispatched_tool_budget` is stamped on all workstream gates the dispatch actually
   wrote (keep the existing mtime guard).
3. Fix the adapter-contract tests to exercise the real resolution path (no injected
   `descriptor.toolBudget`), and correct the stale test comment. Amend the G10 fragment
   with one honest line noting the prompt-only path landed in this PR (do not rewrite
   the fragment's history; append).

**Tests:** per host: codex/gemini/generic dispatch renders the advisory section and
stamps `dispatched_tool_budget`; degradation warning fires exactly for
`enforces.tool_budget: "prompt-only"`; claude-code native behavior byte-unchanged
(frontmatter snapshot).

---

## 6.2 The pm role can't follow its own brief

**Problem:** `roles/pm.md`'s stage-03b procedure instructs the pm to run
`devteam spec generate` and `devteam spec verify`, but pm's declared tool budget is
`Read, Write, Glob` — no Bash. Under claude-code's native enforcement the pm subagent
cannot execute its own documented procedure. stage-03b also declares no
`requiredCapabilities: { shell: true }` in `core/pipeline/stages.js`, so the C5
capability assertion doesn't catch the contradiction either.

**Change (decided design — verification belongs to the orchestrator, not the agent):**
1. Move `spec generate`/`spec verify` execution into the orchestrator's stamping layer:
   the stage-03b gate's spec-related fields become orchestrator-stamped by running the
   spec commands in `core/verify/stamp.js`'s flow (the same pattern as lint/tests —
   [verify-first] read how stage-03b's gate fields are currently produced and what
   `spec verify` exits with).
2. `roles/pm.md` stage-03b section rewritten: the pm authors the AC list and reviews the
   generated spec; the pipeline runs the generation/verification. This is strictly more
   aligned with the trust model than granting pm Bash (the rejected alternative — note
   it in the commit message).
3. Add a consistency-checker rule (small, follows existing classes): every
   `devteam`/shell command appearing in a role brief's procedure must be compatible with
   that role's tool budget from `core/roles.js` (after 6.1 the budget is host-neutral
   and checkable). This catches the next budget/brief contradiction mechanically.

**Tests:** stage-03b e2e — gate's spec fields stamped by the orchestrator with
model-said vs observed recorded; the new checker rule flags a fixture brief commanding
Bash from a Bash-less role; pm fixture passes after the rewrite.

---

## 6.3 C3 license gate: verify or relabel

**Problem:** `license_check_passed` and `dependency_review_passed` on the stage-04a gate
are purely model-asserted — the one surface where the "verified, not trusted" doctrine
is not applied. A model can claim a clean license scan that never ran.

**Change:**
1. [verify-first] Read the C3 implementation (`changelog.d/feat-c3-license-gate.md`,
   `rules/stage-04a.md`, wherever the policy allow/deny lists live) to see exactly what
   the model is asked to do.
2. Implement an orchestrator-side runner for the Node case: walk the target project's
   installed dependency metadata (package.json `license` fields via
   `node_modules/*/package.json` or the lockfile — offline, no network), evaluate
   against the configured policy, and stamp `license_check_passed` + structured
   `license_findings` with the model-said vs observed pattern from
   `core/verify/stamp.js`.
3. Non-Node projects (no lockfile detected): stamp the field
   `"unverified-by-orchestrator"` and emit a WARN — explicitly model-asserted is
   acceptable only when explicitly labeled. Update `rules/stage-04a.md` and the
   stage-04a gate schema for the tri-state.
4. `dependency_review_passed`: same treatment if a mechanical check is feasible
   ([verify-first] what the field means per rules); if it is genuinely judgment-based,
   relabel it in the schema/rules as model-asserted by design with one sentence of
   rationale, and remove it from any prose implying verification.

**Tests:** fixture project with a denied license → stamped FAIL regardless of the
model's claim; clean project → stamped pass; non-Node fixture → WARN + tri-state;
schema tests for the new value.

---

## 6.4 De-overfit the fix recipes

**Problem:** recipe routing is the top source of real-usage bugs (3 of the last 4 fix
PRs). Verified instances: the stage-06b recipe hardcodes the **backend** workstream and
cites a demo-project filename ("html-reporter.js renderCSS") in
`core/pipeline/fix-recipes.js`; `["backend","frontend","platform","qa"]` is hardcoded as
the clear-all fallback in two places instead of reading `ctx.stageDef.roles`;
`_wsFromText` attributes blockers to workstreams by regex over blocker text.

**Change:**
1. Replace `_wsFromText` regex attribution with provenance: merged gates carry
   `workstreams[]` — attribute each blocker to the workstream gate it came from
   ([verify-first] confirm blockers survive the merge with their source identifiable; if
   they don't, make the merge preserve `{blocker, workstream}` pairs — that is the real
   fix). Keep the regex only as a last-resort fallback with a WARN that attribution is
   heuristic.
2. Both hardcoded role arrays → `ctx.stageDef.roles`.
3. stage-06b recipe: remove the demo-project filename and the backend assumption; route
   by provenance (per 1) with the documented three-path behavior preserved. The #106
   regression tests must keep passing with the project-specific strings gone.
4. Add one recipe-hygiene meta-test: no recipe source contains a filename that exists
   only in `examples/` (cheap grep-style guard against the next overfit).

**Tests:** a frontend-owned a11y blocker in a non-demo fixture routes to frontend; the
provenance path covers multi-workstream FAILs; #106 and #109 regressions green.

---

## 6.5 Small parity items (one PR)

1. **Pricing warning on single-role stages** [verify-first]: the unpriced-model WARN
   lives only in `mergeWorkstreamGates`; single-role stages stamp without merging and
   still under-count silently. Emit the same WARN on the single-role stamp path.
2. **`hosts/generic/capabilities.json` omits `goalLoop`** — violates the v0.6.0
   "explicit false, never ambiguous" principle adopted for gemini. Add
   `"goalLoop": false` with the same comment style, and extend the adapter-contract
   test that pinned gemini's declaration to require the key on every host.
3. **codex/gemini adapter dedup (third deferral — do it now):** the two adapters remain
   ~95% identical (165/166 LOC, 4 comment-only hunks). Extract a shared base in
   `core/adapters/` consumed by both; the in-file NOTE pointing at the Phase-3 plan is
   the marker to delete. Adapter-contract byte-equivalence tests are the safety net.

**Tests:** per item; adapter outputs byte-identical pre/post dedup.

---

## Sequencing & exit criteria

6.1 → 6.2 (depends on host-neutral budgets for its checker rule) → 6.4 → 6.3 → 6.5.

**Phase exit:** no shipped doc/fragment describes behavior the code lacks (spot-audit
G10/C3 claims against code); the doctrine exception is closed or explicitly labeled;
recipes contain no demo-project knowledge; the budget/brief contradiction class is
checker-enforced.
