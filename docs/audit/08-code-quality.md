# 08 — Code quality

## Summary

Code quality is high. The codebase is small (9.2K JS LOC), recently refactored (P1 / P2 audit items landed), and consistent in style. Hot files have grown but not bloated. Dead code is absent (the recent budget-relocation cleanup removed the previously-dead `core/guards/budget.js`).

The findings below are minor — a few opportunities for DRY-ing duplicated host-adapter logic, two large-ish functions that could be split, and a couple of inline-comment gaps.

## Rating scales

- **Effort:** small (one PR, <1 day) / medium (a few PRs, days) / large (epic, weeks)
- **Impact:** high / medium / low
- **Confidence:** HIGH / MEDIUM / LOW

## Findings

### Duplication

#### Finding Q1: host adapters duplicate role-list management

- **Where:**
  - `hosts/claude-code/adapter.js:27-90` — `ROLE_FRONTMATTER` object with 9 entries (one per role) carrying Claude-specific frontmatter (tools, model, permissionMode).
  - `hosts/codex/adapter.js:34` — `const ROLES = [...]` array.
  - `hosts/gemini-cli/adapter.js:35` — `const ROLES = [...]` array.
- **Issue:** adding a new role requires editing three adapters. The recent `auditor` role addition surfaced this — it had to be added to all three lists manually (and one consistency check was added to catch future drift).
- **Effort:** small (~half day).
- **Impact:** medium — every new role pays the friction tax.
- **Confidence:** HIGH.
- **Suggested fix:** lift a single `roles/_manifest.json` (or scan `roles/*.md` at adapter init) that's the source of truth. Per-host frontmatter (Claude's `model`, `tools`, etc.) stays per-adapter; the *list of roles* becomes shared.

#### Finding Q2: install-roundtrip pattern repeated across 3 adapters

- **Where:** each adapter's `install()` function follows the same shape: copy roles → copy rules → copy commands (claude-code only) → copy skills → write settings (claude-code only). The function bodies share ~70% of their structure.
- **Issue:** when the install protocol grows (e.g. adding a new artifact type to install, like the audit templates if we ever did install them), three adapters need parallel edits.
- **Effort:** medium (extracting a shared installer base while preserving per-adapter customization is non-trivial).
- **Impact:** medium.
- **Confidence:** HIGH.
- **Suggested fix:** extract `core/adapters/base-install.js` exposing `installRoles`, `installRules`, `installSkills`, `installCommands` as host-parameterized helpers. The host adapter wires them with its `capabilities.json` paths. Reduces each adapter's `install()` to ~30 lines of capability-specific wiring.

### Complexity hotspots

#### Finding Q3: `core/orchestrator.js` is the natural future split candidate

- **Where:** `core/orchestrator.js` (493 LOC, 13 top-level functions).
- **Issue:** the file does dispatch planning, descriptor building, headless invocation, gate merging, "what's next" inference, and summary rendering. Six distinct concerns, all coherent today but hard to navigate.
- **Effort:** medium (split into `core/dispatch.js`, `core/run.js`, `core/inspect.js`; updating callers; preserving the test surface).
- **Impact:** medium — improves maintainability; no behavior change.
- **Confidence:** HIGH.
- **Suggested split:**
  - `core/dispatch.js` — `computeDispatchPlan`, `buildDescriptor`, `workstreamId`.
  - `core/run.js` — `runStage`, `runStageHeadless`, `mergeWorkstreamGates`.
  - `core/inspect.js` — `next`, `_nextImpl`, `summary`.
- **Already flagged:** in the original v0.1.0 audit as a P2 deferral ("when it next grows"). It hasn't grown materially since (+0 net LOC across the last 10 commits). Defer remains correct.

#### Finding Q4: `core/gates/validator.js` is dense but well-organized

- **Where:** `core/gates/validator.js` (401 LOC, 12 top-level functions).
- **Issue:** large file, but the structure is logical: helpers at top → individual check functions → `main()` orchestrating them. Each function is short and named.
- **Verdict:** not a split candidate. The file is the single subprocess contract; splitting it would fragment the spawned binary's surface.
- **Confidence:** HIGH.

#### Finding Q5: `hosts/claude-code/adapter.js` is 404 LOC

- **Where:** `hosts/claude-code/adapter.js`.
- **Issue:** larger than its peers (codex: 233, gemini-cli: 234) because it manages hooks, slash commands, settings, plus the standard role/rule/skill install. Each is a distinct sub-task in `install()`.
- **Verdict:** acceptable. The file's structure is `ROLE_FRONTMATTER` (data) → `installRoles` / `installCommands` / `installRules` / `installSkills` / `installSettings` (each ~30-40 lines, one per artifact type) → `install` (~20 lines, just composition).
- **Note:** if Finding Q2 (shared installer base) lands, this file drops to ~250 LOC.

### Dead code

#### Finding Q6: no dead code observed

- **Where:** verified via grep for unused imports, unused module exports.
- **Notable:** the previous "dead-on-arrival" budget guard was relocated to `scripts/budget.js` during P0 of the audit cleanup. The codebase has no other known orphans.
- **Confidence:** HIGH.
- **Verdict:** clean.

### Abstraction health

Audit clean. Notable observations:

- **No god classes.** The Node ES-modules style and the deliberate "no framework" choice keep things flat — no class hierarchies, no inheritance.
- **No leaky abstractions.** The host-adapter contract is well-encapsulated; orchestrator doesn't know host details. `core/observability.js` fully encapsulates OTel.
- **No premature abstraction.** The audit feature did NOT introduce a "PhaseRunner" base class or "AuditPipeline" object — instead, the skill defines the phases and the slash command executes them as a sequence of writes. The simplicity is deliberate and load-bearing.

### Naming and clarity

Audit mostly clean. Two minor observations:

#### Finding Q7: `core/orchestrator.js:22-35` — `workstreamId()` could use one example in its docblock

- **Where:** the helper that produces `"stage-04.backend"` from `("stage-04", "backend", 4)` and `"stage-01"` from `("stage-01", "pm", 1)`.
- **Issue:** the role-count parameter's role isn't obvious. A 1-line comment showing both branches would help.
- **Effort:** XS.
- **Impact:** low (readability).

#### Finding Q8: `KNOWN_HOSTS` constant in `approval-derivation.js` — exported but not in module API doc

- **Where:** `core/hooks/approval-derivation.js`.
- **Issue:** `KNOWN_HOSTS` is exported so `hostFromPath()` can match host-named review files (for multi-model fanout). The constant's contract (what counts as a "known host") isn't documented inline.
- **Effort:** XS.
- **Impact:** low (clarity for fanout debugging).

### Dependency health

#### Finding Q9: 8 runtime dependencies, all current

| Package | Version | Latest | Used? | Notes |
|---|---|---|---|---|
| `@huggingface/transformers` | ~4.2.0 | check periodically | yes (lazy, memory only) | recent major (v4) successor to `@xenova/transformers` |
| `@opentelemetry/api` | ~1.9.0 | current | yes | stable 1.x |
| `@opentelemetry/exporter-trace-otlp-http` | ~0.55.0 | current | yes | experimental 0.x — patch-pinned |
| `@opentelemetry/resources` | ~1.28.0 | current | yes | stable 1.x |
| `@opentelemetry/sdk-trace-base` | ~1.28.0 | current | yes | stable 1.x |
| `@opentelemetry/sdk-trace-node` | ~1.30.1 | current | yes | stable 1.x |
| `@opentelemetry/semantic-conventions` | ~1.28.0 | current | yes | stable 1.x |
| `js-yaml` | ^4.1.0 | current | yes | only YAML touch point |

No duplicate functionality. All used. All patch-pinned for the 0.x OTel packages.

## Project-Specific

*(No `docs/audit-extensions.md`.)*
