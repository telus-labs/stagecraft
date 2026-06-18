# 03 — Convention compliance

## Summary

The documented load-bearing conventions (`AGENTS.md` § Conventions, § Load-bearing contracts) are **almost entirely held**. The cross-artifact consistency check (`npm run consistency`) passes 221/221 checks. Only one documented convention has a real gap, and one set of agent registrations references role briefs that don't exist on disk.

| Convention | Status | Detail |
|---|---|---|
| `node:` prefix on built-in imports | ✅ Held | Only 1 grep hit, and it's a test-fixture string literal (not an actual import). |
| No `agent` field anywhere | ✅ Held | Zero hits in code or schemas. |
| stdout = primary output, stderr = framing | ✅ Held | `bin/devteam` ratio 228 stdout : 139 stderr. `core/gates/validator.js` 25:8 (validator + hooks exception per AGENTS.md). Orchestrator has 0 of either — uses `core/observability.js`. |
| Workstream gate filename `<stage>.<workstream>.json` | ✅ Held | Validator, hook, and adapters all consistent. |
| Idempotent installs (`{written, skipped}`) | ✅ Held | All 4 adapters return the documented shape. |
| No comments-as-documentation in code | ✅ Held | Spot-checks of `core/orchestrator.js`, `core/gates/validator.js` show short "why" comments only; no multi-paragraph docstrings. |
| Single source of truth for roles / rules / skills | ✅ Held (C-1 RETRACTED) | See finding C-1 below — the apparent gap was a false reading. |
| `process.exit(N)` rather than throwing for CLI errors | ✅ Held | 5 `process.exit` calls in `bin/devteam` for the error paths; CLI subcommands consistently exit rather than throw. |
| 11 locked design decisions (ARCHITECTURE.md) | ✅ Held | 99 commits since prior audit, none touched `ARCHITECTURE.md`. Architectural seam stable. |
| Per-PR test in lockstep with contract change | ✅ Held | All recent CLI additions (ruling, derive-approvals, restart, log) shipped with tests. Suite grew 378 → 778 (+400) since prior audit. |

## Findings

### C-1 — Role briefs missing for two registered agents (MEDIUM, HIGH confidence) — **RETRACTED 2026-06-03**

**RETRACTION (added 2026-06-03 during Batch 1 implementation):** This finding was wrong. The premise — that `hosts/claude-code/adapter.js` registers `architect` and `data-engineer` agents — is false. Direct inspection of `ROLE_FRONTMATTER` (the actual structure name; the audit called it `AGENT_DEFS`) shows 12 entries: `pm`, `principal`, `reviewer`, `security`, `backend`, `frontend`, `platform`, `qa`, `auditor`, `red-team`, `migrations`, `verifier`. No `architect`, no `data-engineer`. Both names are word-uses for the concept "architecture," not agent identifiers. The finding was based on a memorized expectation that wasn't verified against the codebase.

Per the "verify before promoting" lesson codified in `skills/audit/SKILL.md` § Process discipline (added after the 2026-05-28 audit's S5 retraction), findings that cite specific symbols must be verified via direct code inspection before promotion past LOW confidence. The 2026-06-03 audit didn't apply that discipline here. Mirrors the S5 pattern — promoted on signature-only reasoning, retracted on verification.

The original-text finding is preserved below for audit-trail integrity. Findings D-4 (`05-documentation.md`) and P1-4 (`09-backlog.md`) + roadmap PR 1.3 (`10-roadmap.md`) are also retracted; see citations there.

---

**Original finding text (now retracted):**

`hosts/claude-code/adapter.js` registers `auditor`, `red-team`, `migrations`, `verifier`, `architect`, `data-engineer` (among others) in its `AGENT_DEFS` table. Two of those agent names — **`architect`** and **`data-engineer`** — have no corresponding role brief file:

```
roles/                 (expected)
├── architect.md       ← MISSING
├── data-engineer.md   ← MISSING
├── auditor.md         ✓
├── backend.md         ✓
├── …                  ✓
```

The convention (AGENTS.md § Adding things, "Add a new role"): "`roles/<role>.md` (host-neutral brief) + add to `ROLE_FRONTMATTER` in each adapter that uses subagents". The role files are the single source of truth that adapters render into host-expected paths at install time. Without a role file, the adapter can register the subagent but has nothing to render — at install, the subagent's instructions are presumably defaulting to whatever the adapter encodes inline, or rendering empty content.

**Impact**: low-functionality but high-discoverability — a user running `devteam doctor` or inspecting `.claude/agents/` after `devteam init` would see entries for `architect` and `data-engineer` that lack the substantive content other agents have. The agents likely don't fire in any pipeline stage today (no stage definition references them), so the gap is dormant rather than actively broken.

**Recommended fix**: either author the two role briefs, or remove the registrations from `hosts/claude-code/adapter.js`. Decision is about whether these roles are intended to be available — `architect` could plausibly be useful (the existing `principal` agent does design work but is more directive than architectural), `data-engineer` is unclear. Worth a 5-minute decision in Phase 3.

### C-2 — Per-stage rules files cover only stages 4–8 (LOW, HIGH confidence)

The refactor that split `rules/pipeline-build.md` into per-stage files (commit `cf3293b`) covered stages 4 (build), 4a (pre-review), 4b (security-review), 5 (peer-review), 6 (qa), 6b (accessibility-audit), 7 (sign-off), 8 (deploy). It did **not** cover:

- Stage 1 (requirements), 2 (design), 3 (clarification), 3b (executable-spec) — pre-build stages
- Stage 4c (red-team), 4d (migration-safety) — conditional Stage 4 sub-stages
- Stage 6c (observability-gate), 6d (verification-beyond-tests) — Stage 6 sub-stages
- Stage 9 (retrospective)

These stages' procedural rules still live in their roles' briefs and in `rules/pipeline.md` / `rules/pipeline-core.md`. The split was scoped to the build-through-deploy portion intentionally (per the CHANGELOG entry's "9 new files, 14–144 lines each — stage-05 is the largest because peer review has the most procedure"). The pre-build stages have less procedural depth (single-role, no decomposition); the conditional stages have more depth but live closer to their role briefs.

**Impact**: minor inconsistency — operators looking at `rules/stage-*.md` see partial coverage and may wonder if stages 1–3b, 4c, 4d, 6c, 6d, 9 are "lighter" or "missing." They're not lighter; they're just not split out.

**Recommended fix**: either complete the split (1–3b + conditionals + 9 → ~9 more files) or document the rationale in `rules/pipeline-build.md` (the now-30-line index) explicitly. The current index just lists stages 4–8 as if they're the only ones split. Probably a 1-line addition to the index: "Stages 1–3b, 4c, 4d, 6c, 6d, 9 are documented in their role briefs under `roles/<name>.md`; only the high-procedure build-through-deploy stages have dedicated rule files."

### C-3 — `console.log` used in `core/orchestrator.js` is 0; logging goes through observability (positive finding, no action)

`core/orchestrator.js` has zero `console.log` or `console.error` calls; all logging routes through `core/observability.js` (OpenTelemetry spans, no-op when endpoint unset). This is correct — the orchestrator is library code; bin/devteam is the surface that emits user-facing output. Worth noting as a positive — the discipline is held cleanly.

### C-4 — `noqa` / lint-suppression sweep (positive finding, no action)

Grep for `# noqa`, `// eslint-disable`, `/* prettier-ignore */`, `// @ts-ignore` returns zero hits across the codebase. Since no lint config exists (no `.eslintrc`, no `.prettierrc`), there's nothing to suppress — but the absence of suppression comments confirms the style is held by convention rather than escape-hatch. (The flip side: no lint config means no automated enforcement; see finding Q-2 in `08-code-quality.md` when Phase 2 lands.)

## Configuration and tooling gaps

These are NOT documented conventions; they're absences worth tracking:

- **No `.editorconfig`.** Indentation, line endings, charset — all by convention. 9k lines of JS, no enforced style. Style is currently consistent (4 hosts, 29 core files, 49 test files all spot-check as 2-space indent, LF endings, UTF-8) but the convention is folkloric.
- **No `.eslintrc.*` or `eslint.config.js`.** Zero JS linting in CI. The CI pipeline is `npm test && npm run consistency && devteam help && doctor` — purely behavioral.
- **No `.prettierrc`.** Format by convention. The codebase reads consistently, but enforcement is the author's eye, not a tool.
- **No `tsconfig.json`.** Pure JS, no TypeScript. Many recent Node projects use TS for type safety; Stagecraft's deliberate non-choice is reasonable for a 9k-LOC tool but means JSDoc and runtime checks are the only contracts on function signatures.
- **No `package.json` `"type"` field.** Defaults to CommonJS (`require()`). All code uses `require`; ESM migration isn't on the table for now.

**Recommended for Phase 3 backlog**: P3 strategic item — add `.editorconfig` (lowest-cost, highest-leverage) and decide whether to adopt ESLint with a minimal config (e.g. `eslint:recommended` + `no-unused-vars`). Doesn't need to be aggressive; the goal is to catch silent style drift as the codebase grows past 1.0.

## Verified by

- `npm run consistency` → 221/221 passing.
- `grep`/`find` audits for documented conventions (commands available in audit transcript).
- Hand-inspection of 4 host adapters for idempotency contract.
- Spot-checks of `core/orchestrator.js`, `core/gates/validator.js`, `bin/devteam` for stdout/stderr discipline.
- 778/778 test pass.
