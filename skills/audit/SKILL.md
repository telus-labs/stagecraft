---
name: audit
description: "Run a structured codebase audit — map architecture, assess health (compliance / tests / docs), perform deep analysis (security / performance / code quality), and synthesize a prioritized roadmap. Use this skill when the user says things like 'audit the codebase', 'understand this project', 'find problems', '/audit', or '/audit-quick'. Phases produce machine-friendly markdown outputs under docs/audit/ that downstream commands (like the implement skill) consume to know where to start work."
---

# Audit a Codebase

A four-phase analysis pass over an existing codebase. Different from Stagecraft's 18-stage *pipeline* — the pipeline builds features through staged production; an **audit** is read-only analysis of code that already exists. The output is a prioritized roadmap, not a deployable change.

## When to use this vs the pipeline

- **Audit:** "I want to understand this codebase and find what to fix." Read-only. Produces `docs/audit/00-project-context.md` through `docs/audit/10-roadmap.md`. Use before joining a project, before a refactor, before a security review, or as a periodic health check.
- **Pipeline (`devteam stage <name>`):** "I want to ship a feature through structured production." Writes code. Produces gate JSON and artifacts under `pipeline/`. Use for any change with acceptance criteria.

If the user asks to "fix things found in the audit", that's the `implement` skill against `docs/audit/10-roadmap.md` items — not this skill.

## Two entry points

- **`/audit`** — full audit, Phases 0 through 3. Produces 11 output files. ~30–60 minutes wall-clock on a medium codebase. Includes human checkpoints between phases so you can correct course before deep analysis.
- **`/audit-quick`** — Phases 0–1 only. Produces 6 output files (no security / performance / code-quality / roadmap). ~5–15 minutes wall-clock. Good for fast onboarding or pre-review orientation. The user can run `/audit --resume` later to complete the deep analysis.

Both commands read this file and execute the phases below.

## Inputs

- The target codebase you're auditing (the user's project, not the Stagecraft framework).
- Optional scope constraint: `/audit src/backend/` focuses on one subtree.
- Optional `<target-project>/docs/audit-extensions.md` — project-specific checks appended to each phase. Read once per phase if present. Operators create this in the projects they audit; it does not live in the Stagecraft repo.
- Optional `docs/audit/status.json` — for `--resume`, names the last completed phase.

## Outputs

All under `docs/audit/` in the target project:

| File | Phase | Section |
|---|---|---|
| `00-project-context.md` | 0 | Bootstrap — what this project is |
| `01-architecture.md` | 0 | Bootstrap — component + dependency map |
| `02-git-history.md` | 0 | Bootstrap — churn + co-change patterns |
| `03-compliance.md` | 1 | Health — convention compliance |
| `04-tests.md` | 1 | Health — test coverage + quality |
| `05-documentation.md` | 1 | Health — docs gaps |
| `06-security.md` | 2 | Deep — security review |
| `07-performance.md` | 2 | Deep — performance + reliability |
| `08-code-quality.md` | 2 | Deep — quality + dead code |
| `09-backlog.md` | 3 | Roadmap — prioritized findings |
| `10-roadmap.md` | 3 | Roadmap — sequenced batches |
| `status.json` | all | Phase completion tracker |

The sections to produce in each file are detailed in the phase definitions below. The Stagecraft framework also keeps blank templates under `templates/audit/` as reference — you can look at them if the framework is reachable, but the phase definitions in this skill are sufficient on their own.

## Finding evidence contract

Every Phase 1 and Phase 2 finding must include a `verified_by` field. This field is the structural proof that the finding was checked before it was promoted.

- **Format:** `verified_by: <command, code inspection, test run, or live check>; observed <specific result>`.
- **Direct evidence only:** `verified_by` must name what was checked. Good examples: `rg -n "functionName" src/`, `node --test tests/foo.test.js`, `curl ... returned 403`, or `read src/auth.js:42-91 and traced caller in src/routes.js:18`.
- **Unverified findings stay LOW:** if direct verification is not possible in the current audit, set `verified_by: not verified — <what would be needed>` and keep **Confidence: LOW**.
- **No promotion without proof:** findings above LOW confidence without direct `verified_by` evidence are invalid and must not be promoted to Phase 3 backlog items.
- **Roadmap carry-forward:** when Phase 3 promotes a finding into `09-backlog.md` or `10-roadmap.md`, preserve the source finding ID and its verification evidence in the item notes.

## Status tracking

Write `docs/audit/status.json` at the start of any audit and update it after every phase:

```json
{
  "started": "<ISO 8601>",
  "scope": "full" | "scoped to <subtree>",
  "phases": {
    "phase-0": "pending" | "complete",
    "phase-1": "pending" | "complete",
    "phase-2": "pending" | "complete",
    "phase-3": "pending" | "complete"
  },
  "current_phase": "phase-N",
  "audited_by": "<host name + agent context>"
}
```

`--resume` reads this file and skips completed phases. If the file doesn't exist, start fresh from Phase 0.

---

## Phase 0 — Bootstrap

Establish what the project is. Four steps — start with the archive housekeeping in 0.0, then the three substantive bootstrap steps.

### 0.0 — Archive prior audit if present

Before any new audit work, preserve the prior audit so its findings remain browsable while the new one runs. Skip this step entirely if `--resume` is set (a `--resume` run is *continuing* the existing audit, not starting a new one).

**When to archive:** `docs/audit/status.json` exists AND reports `current_phase: "phase-3"` (a completed audit). If `status.json` is absent (first audit) or reports an incomplete prior run (in-progress; rare — usually means a previous audit crashed), skip the archive and proceed to step 0.1; the new audit will overwrite or finish what's there.

**Archive procedure:**

1. **Resolve the archive directory name** as `<date>-<version>-<context>`:
   - `<date>` — the `started` field from the prior `status.json`, taking only the YYYY-MM-DD prefix.
   - `<version>` — the `version` field from `package.json` at the time of the prior audit. If the package.json version has since changed, use the prior audit's recorded version; if not recorded, ask the operator.
   - `<context>` — a short kebab-case phrase describing what was distinctive about that audit run (e.g. `initial-dogfood`, `post-derive-approvals`, `pre-v1-release`). Ask the operator if unclear.
   - Example: `docs/audit-archive/2026-05-28-v0.4.0-initial-dogfood/`.

2. **Move the prior audit** via `git mv` (preserves git history) into the archive directory:
   ```bash
   mkdir -p docs/audit-archive/<archive-name>/
   git mv docs/audit/00-project-context.md docs/audit/01-architecture.md \
          docs/audit/02-git-history.md docs/audit/03-compliance.md \
          docs/audit/04-tests.md docs/audit/05-documentation.md \
          docs/audit/06-security.md docs/audit/07-performance.md \
          docs/audit/08-code-quality.md docs/audit/09-backlog.md \
          docs/audit/10-roadmap.md docs/audit/status.json \
          docs/audit-archive/<archive-name>/
   ```
   Leave `docs/audit/README.md` in place if present — it's the placeholder pointing at the archive.

3. **Append a row to `docs/audit-archive/HISTORY.md`** with date, version, context, phases completed, and a one-line headline derived from the prior `10-roadmap.md` summary (typically counts of P0/P1/P2/P3 items and a total effort estimate). Create `HISTORY.md` if it doesn't exist — see the existing file for the table shape.

4. **Carry-forward note:** make a mental record of any prior `10-roadmap.md` items that are still open (not yet addressed in subsequent commits). When you write the new `09-backlog.md` and `10-roadmap.md` in Phase 3, you must either close those items out with a citation explaining why, or re-include them alongside the new findings with appropriate priority. The archive directory is the source of truth for what was open.

After archiving, `docs/audit/` should contain only `README.md` (if present). Proceed to step 0.1.

### 0.1 — Project context

Read, in this order:

1. **AI / editor instructions** — `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `.windsurfrules`, `.github/copilot-instructions.md`.
2. **Contributor / process docs** — `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `.github/CODEOWNERS`.
3. **Top-level README** — every project has one; what it says about itself.
4. **Build / dependency config** — `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `Gemfile`, `pom.xml`, `build.gradle`, `CMakeLists.txt`, `Makefile`, `Taskfile`, `docker-compose.yml`, etc.
5. **CI / CD config** — `.github/workflows/`, `.gitlab-ci.yml`, `Jenkinsfile`, `cloudbuild.yaml`, `.circleci/`, etc.
6. **Linter / formatter config** — `eslint`, `prettier`, `ruff`, `rubocop`, `clippy`, `golangci-lint`, `editorconfig`, etc.
7. **Top-level directory structure** — list each major directory.

Produce `docs/audit/00-project-context.md` capturing:

- Languages and frameworks (with versions where pinned).
- Build system and dependency manager.
- Exact commands: install deps, run app, run tests, lint, build.
- Deployment target: cloud, container, serverless, on-prem.
- Documented vs. undocumented-but-implied conventions.
- Codebase size: file count, major directories, number of modules/services.
- Monorepo vs. single app.
- Surprises and open questions.

### 0.2 — Architecture map

Read `docs/audit/00-project-context.md` first, then traverse source directories, entry points, config files, and any architecture docs.

Produce `docs/audit/01-architecture.md` capturing:

1. **Component inventory** — every major module / package / service. Purpose, entry point, internal dependencies.
2. **Dependency graph** — internal dependencies. Flag circular deps and high fan-in components.
3. **External integrations** — third-party libraries, APIs, databases, cloud services. Which components use which. Abstracted (behind a port/adapter) or used directly.
4. **Data flow** — trace primary user-facing flows end to end. Multiple flows if they exist.
5. **Configuration surface** — env vars, config files, secrets, feature flags. Where defined, where consumed.
6. **What's working well** — sound architectural decisions to preserve. (Not just gaps; positive findings have audit value too.)

### 0.3 — Git history

Read `docs/audit/01-architecture.md`, then analyze git history.

Produce `docs/audit/02-git-history.md` capturing:

1. **Churn hotspots** — files / dirs with most commits in last 6 months:
   ```sh
   git log --since="6 months ago" --pretty=format: --name-only | grep -v '^$' | sort | uniq -c | sort -rn | head -30
   ```
2. **Co-change patterns** — files that change together (hidden coupling):
   ```sh
   git log --since="6 months ago" --pretty=format:"---" --name-only | grep -v '^$'
   ```
3. **Recent trajectory** — what's actively evolving vs. stable.
4. **Commit quality** — small / focused or large / unfocused. Review discipline.

If git history is shallow or unavailable (e.g. `--depth=1` clone), note it and skip the analysis. Don't fabricate findings from a partial log.

### End of Phase 0

Update `status.json`: `"phase-0": "complete"`. Print summary:

```
[Phase 0 — Bootstrap] ✅ Complete
  • Project: <language / framework>
  • Size: <N files, M modules/services>
  • Key finding: <one-sentence highlight>
```

If running `/audit` (full), halt for **Checkpoint A** here: ask the user to review `00-project-context.md` and `01-architecture.md` before continuing.

---

## Phase 1 — Health Assessment

Three steps, run in any order (they read the same inputs).

### 1.1 — Convention compliance

Read `docs/audit/00-project-context.md` and `docs/audit/01-architecture.md`.

Audit the codebase against its own stated rules (READMEs, CONTRIBUTING.md, AGENTS.md, linter configs, style guides, ADRs).

If no documented conventions exist: check for internal inconsistency — same thing done multiple ways across the codebase.

For each finding, capture:
- File and line number.
- The convention or dominant pattern.
- How this code deviates.
- Suggested fix.
- `verified_by` evidence from the finding evidence contract.
- **Confidence:** HIGH / MEDIUM / LOW.

Group findings by category: naming, error handling, architecture, logging, dependency usage.

End the file with a "Possibly Intentional Deviations" section — code that breaks a pattern but might do so for a defensible reason. Don't flag those as findings; flag them as questions.

Output: `docs/audit/03-compliance.md`.

### 1.2 — Test health

Read `docs/audit/01-architecture.md`.

Produce `docs/audit/04-tests.md`. Capture:

1. **Coverage map** — table: component | test count | test types (unit / integration / e2e) | notes.
2. **Untested critical paths** — business logic, error handling, integrations with no coverage. Each finding must include `verified_by` evidence.
3. **Test quality issues** — empty assertions, implementation coupling, overbroad mocks, external service calls in tests, missing edge cases, order dependencies. Each finding must include `verified_by` evidence.
4. **Test infrastructure** — runner configured? CI runs tests? Currently passing? Coverage tool wired up?
5. **What's well-tested** — positive examples worth replicating.

### 1.3 — Documentation gaps

Read `docs/audit/01-architecture.md`.

Produce `docs/audit/05-documentation.md`. Capture:

1. **README quality** — complete / partial / missing. Calls out the right entry points?
2. **Component docs** — which sub-modules have docs, which don't.
3. **API documentation** — endpoints / interfaces documented? Accurate vs. the code?
4. **Inline documentation** — complex logic explained? Places you had to read 3× to understand?
5. **Stale docs** — references to things that no longer exist (dangling file refs, removed APIs, old version numbers). Each finding must include `verified_by` evidence.
6. **Onboarding test** — what would a new developer struggle with? Run the install commands from §0.1 mentally and flag friction. Each finding must include `verified_by` evidence.

### End of Phase 1

Update `status.json`: `"phase-1": "complete"`. Print summary:

```
[Phase 1 — Health Assessment] ✅ Complete
  • Convention violations: <N findings, M high-confidence>
  • Test coverage: <brief summary>
  • Documentation: <brief summary>
```

If running `/audit` (full), halt for **Checkpoint B**: ask the user to review the health findings before deep analysis.

For `/audit-quick`, stop here. The user can run `/audit --resume` later to continue.

---

## Phase 2 — Deep Analysis

Three steps. These can produce findings that surprise the user — be specific, cite line numbers, attach confidence ratings.

Every Phase 2 finding must include the `verified_by` field from the finding evidence contract. Do not promote a Phase 2 finding above LOW confidence unless the cited evidence directly verifies the claim.

### 2.1 — Security review

Read `docs/audit/00-project-context.md` and `docs/audit/01-architecture.md`.

Adapt to the project's language and framework. Cover:

1. **Secrets hygiene** — hardcoded keys / tokens / passwords. `.gitignore` coverage of `.env`, `secrets/`, credential files.
2. **Input handling** — validation, injection risks (SQL, command, template, path traversal, XSS, SSRF, deserialization).
3. **Auth & authz** — unprotected endpoints, inconsistent auth, IDOR potential, missing role checks.
4. **Dependency vulnerabilities** — lockfiles present? Update tooling? Known CVEs from `npm audit` / `pip-audit` / `cargo audit` / equivalent.
5. **Data exposure** — PII / credentials in logs, error messages, API responses.
6. **Cryptography** — current algorithms, hardcoded IVs / nonces, weak hashes, homegrown crypto.

Rate each finding:
- **Severity:** critical / high / medium / low.
- **Confidence:** HIGH / MEDIUM / LOW.
- `verified_by` evidence from the finding evidence contract.

Output: `docs/audit/06-security.md`.

### 2.2 — Performance & reliability

Read `docs/audit/01-architecture.md` and `docs/audit/02-git-history.md`.

Focus on highest-churn components and components with the most external integrations. Cover:

1. **Resource lifecycle** — connection / client reuse, leaks, missing cleanup.
2. **Concurrency** — race conditions, blocking calls in async paths, unprotected shared state.
3. **Error handling quality** — swallowed exceptions, catch-alls, leaked internals in error messages, missing retries with backoff.
4. **Timeout discipline** — missing timeouts on external calls. Default timeouts that are too generous.
5. **Scaling concerns** — in-memory state, unbounded queues, O(n²) algorithms on user input, missing pagination.
6. **Observability** — structured logging, metrics, tracing, health checks. (Cross-references Stagecraft's stage-06c observability gate philosophy.)
7. **Graceful degradation** — what happens when a dependency is down? Circuit breakers? Fallback paths?

Rate each finding:
- **Impact:** high / medium / low.
- **Confidence:** HIGH / MEDIUM / LOW.
- `verified_by` evidence from the finding evidence contract.

Output: `docs/audit/07-performance.md`.

### 2.3 — Code quality

Read `docs/audit/01-architecture.md` and `docs/audit/02-git-history.md`.

Focus on highest-churn files first. Cover:

1. **Duplication** — significant duplicated logic. Shared-abstraction candidates. Intentional or accidental.
2. **Complexity hotspots** — deep nesting, high cyclomatic complexity, functions you had to trace 3× to understand.
3. **Dead code** — unused imports, unreachable branches, commented-out blocks, orphaned files. Distinguish "obviously dead" from "possibly used dynamically" (reflection, dynamic dispatch).
4. **Abstraction health** — god classes, leaky abstractions, over-abstraction (single-use helpers, premature inheritance).
5. **Naming and clarity** — misleading names, magic numbers, undocumented constants.
6. **Dependency health** — unused deps in lockfiles, duplicate functionality from multiple packages, very outdated packages.

Rate each finding:
- **Effort to fix:** small / medium / large.
- **Impact if fixed:** high / medium / low.
- **Confidence:** HIGH / MEDIUM / LOW.
- `verified_by` evidence from the finding evidence contract.

Output: `docs/audit/08-code-quality.md`.

### End of Phase 2

Update `status.json`: `"phase-2": "complete"`. Print summary:

```
[Phase 2 — Deep Analysis] ✅ Complete
  • Security: <N findings, M critical/high>
  • Performance: <N findings>
  • Code quality: <N findings>
```

If running `/audit` (full), halt for **Checkpoint C**: ask the user to review the deep-analysis findings before roadmap synthesis.

---

## Phase 3 — Roadmap

Two steps. The synthesis step does the load-bearing work; the sequencing step packages it.

### 3.1 — Synthesis & prioritization

Read all files in `docs/audit/`. If `docs/audit-archive/HISTORY.md` exists, also read **three** sources from it:

1. **The most recent archived audit's `09-backlog.md` and `10-roadmap.md`** — any items there that haven't been closed in subsequent commits must be carried forward (re-prioritized alongside new findings) or closed out with a citation in the new backlog.
2. **The `## Between-cycle observations` section of `HISTORY.md` itself** — informal observations that surfaced between audits, captured as a between-cycle channel. Each observation must be either folded into the new backlog (as a finding with full effort/risk/confidence ratings) or closed out with a citation. Don't ignore them; they're the audit's way of being informed by operational reality between cycles.
3. **Carry-forward is the mechanism that keeps audits cumulative.** Without it, each audit re-discovers the same gaps without acknowledging the prior cycle.

After processing the between-cycle observations, move them from `HISTORY.md` into a `## Project-Specific` block in the new `09-backlog.md` (or annotate them in-place with `→ promoted to P<N>-<id>` / `→ closed: <reason>`), so the `HISTORY.md` section is reset to the most recent audit's date. The convention is "observations live with the audit they informed."

1. Synthesize findings into **3–5 systemic themes** — patterns that recur across multiple files in §03–§08. Themes are higher-level than individual findings.
2. Build a prioritized backlog. For each item, capture:
   - Title (action-oriented — "Add input validation to user endpoints", not "Input validation").
   - Theme it belongs to.
   - Description (2–3 sentences).
   - Affected components.
   - **Effort:** XS / S / M / L / XL.
   - **Risk of change:** low / medium / high.
   - **Risk of NOT changing:** low / medium / high.
   - Dependencies (which items must land first).
   - **Confidence:** HIGH / MEDIUM / LOW.

Categorize items:
- **P0 — fix now.** Critical security, broken builds, data-corruption potential.
- **P1 — quick wins.** Low effort, high impact. Land these in week 1–2.
- **P2 — targeted improvements.** Real value but bigger lift. Land in weeks 3–6.
- **P3 — strategic investments.** Long-term, often paired with mini-proposals.
- **Parked.** Findings that don't justify work right now — include the reasoning so the next audit doesn't re-flag them.

Output: `docs/audit/09-backlog.md`.

### 3.2 — Sequenced roadmap

Read `docs/audit/09-backlog.md`.

Sequence the items into batches:

- **Batch 1 (immediate):** all P0 items, in priority order.
- **Batch 2 (weeks 1–2):** P1 quick wins grouped into logical PRs (don't surface 12 tiny PRs; bundle related ones).
- **Batch 3 (weeks 3–6):** P2 improvements ordered by dependency and risk.
- **Batch 4 (month 2+):** P3 investments with mini-proposals — what's the proposal, what's the validation criterion?

For each batch capture: items in order, what can be parallelized, verification criteria per item, infrastructure changes needed, estimated total effort.

End with a "Roadmap risks" section: what could go wrong with this sequence, what would trigger re-sequencing.

Output: `docs/audit/10-roadmap.md`.

### End of Phase 3

Update `status.json`: `"phase-3": "complete"`. Print the final summary dashboard:

```
Codebase Audit Complete
═══════════════════════════════════════════════════
Phase                    Status     Files
─────────────────────────────────────────────────
0  Bootstrap             ✅         00, 01, 02
1  Health Assessment     ✅         03, 04, 05
2  Deep Analysis         ✅         06, 07, 08
3  Roadmap               ✅         09, 10
─────────────────────────────────────────────────

Themes: <list 3-5 themes from §09>

Roadmap summary:
  P0 (fix now):           <N items>
  P1 (quick wins):        <N items>
  P2 (targeted):          <N items>
  P3 (strategic):         <N items>
  Parked:                 <N items>

Next step: use the implement skill to start on roadmap items, or
read docs/audit/10-roadmap.md for the full sequenced plan.
```

---

## Extensions

If `<target-project>/docs/audit-extensions.md` exists in the target project, read it once at the start of every phase. It contains project-specific checks to run *in addition* to the generic phase steps. Each extension specifies which phase it belongs to and what to append.

Append extension results to the corresponding `docs/audit/<NN>-*.md` file under a `## Project-Specific` heading at the bottom. Don't intersperse them with the generic findings — keep them clearly delineated so the next audit can tell which findings came from the standard pass and which from local conventions.

## Monorepo handling

If Phase 0 reveals this is a monorepo with multiple apps / services:

1. Complete Phase 0 for the whole repo (whole-monorepo context, architecture, git history).
2. Ask the user: "This is a monorepo with N services. Run Phases 1–2 across everything, or focus on a specific subsystem?"
3. If focused: run Phases 1–2 on the chosen subsystem only, then ask about the next.
4. Run Phase 3 across all collected findings regardless of subsystem.

Per-subsystem audit outputs go in `docs/audit/<service-name>/` rather than the top level. Phase 3's roadmap consolidates across them.

## Process discipline — verify before promoting

A finding's severity / confidence / "needs fix" status is a **claim about reality**, and claims about reality have to be checked. This is especially true in Phase 2 (security, performance, code quality) where it's tempting to reason from a function signature, a route definition, or a regex pattern without actually running the code.

The structural enforcement for this discipline is the `verified_by` field required on every Phase 1 and Phase 2 finding. A finding above LOW confidence without that field is incomplete.

**Discipline:**

- Any finding promoted past **LOW confidence** must be verified by direct evidence, not signature-only reasoning. Acceptable evidence:
  - **Live exploit attempt** for security findings (curl the endpoint, write the malicious input, see what the system actually does).
  - **Code path trace** read end-to-end, not just at the entry point.
  - **Test run** that exercises the alleged failure mode.
  - **`git log` / `git blame`** when the finding rests on history.
- If you can't verify, mark **LOW confidence** and say what you'd need to escalate. "I'd want to attempt the traversal against a running UI" is more useful than promoting on speculation.
- If verification contradicts the initial finding, **retract it explicitly** in the same phase output — don't silently delete. The reader needs to see the chain (concern → verification → resolution) so they can trust the rest of the report.

This isn't a hypothetical. The Stagecraft self-audit (2026-05-28, see `docs/audit/06-security.md` Finding S5) initially promoted a UI path-traversal concern to "medium severity / needs fix" based on the route definition alone. A live exploit attempt against the running UI returned HTTP 404 because the helper functions validate input with regexes the audit hadn't read. The finding was retracted with the verification trace preserved. **Future audits should not repeat the mistake.**

## What not to do

- **Don't audit Stagecraft itself with this skill** unless that's literally what you've been asked to do. The audit targets the project Stagecraft was installed into.
- **Don't fix things you find.** This skill is read-only. Findings go in the markdown files; fixes belong to the `implement` skill or a `devteam stage` invocation.
- **Don't invent severity ratings.** If you can't confidently rate a finding HIGH / MEDIUM / LOW, mark it LOW with a note about why you're uncertain.
- **Don't audit dependencies' internals.** External libraries are external; flag them if they're outdated or vulnerable but don't audit their code as if it were the project's.
- **Don't promote opinion to finding.** "I'd prefer dependency injection here" is opinion; "the lifecycle of X is unclear because the constructor mutates global state Y" is a finding.
