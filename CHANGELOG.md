# Changelog

All notable changes to Stagecraft.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org).

---

## [Unreleased]

### Added

- **G2 — Closed-loop AC → exec spec → tests (stage-03b).** New stage between clarification (stage-03) and build (stage-04) that translates each numbered acceptance criterion (`AC-N` in `pipeline/brief.md`) into one Gherkin Scenario in `pipeline/spec.feature`, tagged `@AC-N`. The .feature file becomes the canonical contract that QA's tests must map to. Drift across the chain — brief.md ↔ spec.feature ↔ test-report.md — is caught structurally rather than by hope. New `core/spec/gherkin.js` parses Feature: / Scenario: / Scenario Outline: / Given|When|Then|And|But / tags (including inline `@AC-N` in scenario names as a fallback). New `core/spec/verify.js` extracts AC-Ns from brief.md (tolerant of bullet markers, optional colon/dash, indentation), AC refs from test-report.md, and computes a drift report with five distinct error classes: `orphan_criteria` (AC in brief, no scenario), `orphan_scenarios` (scenario in spec, no AC tag or AC not in brief), `duplicate_criteria` (same AC-N twice), `orphan_in_tests` (AC in brief, no test reference), `unknown_in_tests` (test references AC not in brief); plus informational `multi_mapped_criteria` (one AC, many scenarios) which `--strict` mode promotes to drift. New `devteam spec verify [--strict] [--json]` CLI runs the drift detector and exits non-zero on any drift; `devteam spec generate [--feature "..."] [--force]` scaffolds the .feature file from brief.md with one tagged `Scenario:` per AC and TODO Given/When/Then placeholders. Gate (`core/gates/schemas/stage-03b.schema.json`) carries `criteria_count`, `scenarios_count`, the full `criteria_to_scenario_mapping` array, `all_criteria_mapped`, `orphan_scenarios`, `orphan_criteria`, `drift`. QA's stage-06 schema extended with `scenarios_total`, `scenarios_covered`, `all_scenarios_have_tests` so the spec-to-test side of the chain is also enforceable. PM role brief gets a new "On an Executable-Spec Request" section walking the procedure; QA role brief instructed to read spec.feature as the canonical behaviour list. New `skills/spec-authoring/SKILL.md` walks five phases (load context → scaffold → fill in Given/When/Then → verify drift → write gate) with a drift-cause table and Given/When/Then guidance. New `templates/spec-template.feature` carries the Feature/Scenario scaffold; `templates/brief-template.md` updated to use numbered AC-N entries (the load-bearing contract); `templates/test-report-template.md` updated to a 4-column `AC | Scenario | Test | Result` mapping table. Tracks: `full` + `quick` (the tracks with a requirements stage to derive ACs from); skipped on `hotfix`/`nano`/`config-only`/`dep-update`. No new role added — the PM that authored ACs is the right brain to translate them; same brain = no translation drift. Auto-picked-up adapter contract assertions in `tests/contract.test.js` covered the new stage + schema + role updates without modification. 36 new tests in `tests/spec-g2.test.js` (Gherkin parser edge cases, AC extraction, drift detection across every error class, generateScaffold, verify(cwd) file-based, stage shape + ordering + track inclusion, schema fields, template/skill/role shape, CLI verify exit codes + JSON output, generate scaffold + --force, install roundtrip, stage prompt rendering). 4 new `tests/tracks.test.js` cases. 4 existing `tests/next.test.js` cases updated to seed the new `stage-03b` gate alongside `stage-03`. Strategic value: the brief is in prose, tests are in code, and the gap between them is where regression hides. Gherkin is the contract that keeps both sides honest — and the verifier is what makes the contract enforceable rather than wishful.

- **B5 — Migration safety stage (stage-04d).** New conditional safety stage between red-team (4c) and peer-review (5). Fires when `stage-04a`'s pre-review heuristic flags data-layer changes — schema files, migration directories, ORM migrations, or files containing DDL fragments (`ALTER/CREATE/DROP TABLE`, `ADD/DROP COLUMN`, `RENAME`, index DDL). The heuristic (`core/guards/migration-heuristic.js`) does path-pattern matching plus optional content scanning for DDL inside non-obvious paths. New `migrations` role brief (read-only on code), new `skills/migration-safety/SKILL.md` walking six questions per migration: what does it do? is it breaking? does it need a backfill? a dual-write window? what's the rollback plan? was it tested? Gate schema (`core/gates/schemas/stage-04d.schema.json`) enforces non-empty `rollback_plan`. **Has veto power** like stage-04b security: empty rollback plan, untested rollback on a breaking change, or missing backfill strategy when backfill is required each auto-veto. Peer-review approvals CANNOT override a veto — the migrations role must personally re-review. Included in `full` + `hotfix` + `config-only` tracks (the tracks where schema changes can plausibly land); skipped on `quick` / `nano` / `dep-update`. Template `templates/migration-safety-template.md` mirrors the six-question structure. ROLE_FRONTMATTER entry on claude-code; codex / gemini-cli / generic auto-discover via `core/roles.listRoles()`. 20 new tests in `tests/migration-safety.test.js` (heuristic patterns + DDL content scan + stage definition + ordering + schema + role brief + skill + template + adapter integration + install roundtrip + render check) plus 4 new `tests/tracks.test.js` cases. Strategic value: data-layer changes are the bug class that bites hardest in production; this stage forces the backfill + rollback plan to exist + be tested BEFORE peer review, with veto teeth.

- **F4 — CI runner integration (GitHub Actions).** New reusable workflow template at `templates/ci/github-actions/stagecraft-pr-checks.yml` that validates `pipeline/gates/*.json` with Stagecraft's validator and posts each gate as a GitHub check run on the PR head via `scripts/pr-publish.js`. Includes an advisory `devteam reproduce` drift check (continue-on-error). Skips cleanly when the PR doesn't touch `pipeline/`. New CLI: `devteam ci install [--ci github-actions] [--out <dir>] [--force]` drops the template into the target project's `.github/workflows/`; `devteam ci show` previews. The deliberate shape: the workflow does NOT run the LLM pipeline itself in CI (cost prohibitive, defeats the human-in-the-loop design). It surfaces gates that local runs produced — reviewers see "10/12 stages passing" in the PR status bar with click-through. Required GitHub permissions are scoped to the workflow run (`checks: write` for posting, no PAT needed). 12 tests in `tests/ci.test.js` covering template shape, action version pinning, install, --force overwrite, --out redirect, --ci unknown error path, `ci show`, usage. GitLab / Buildkite / CircleCI templates are BACKLOG follow-ups — the Stagecraft side is CI-agnostic; only template files needed. See `docs/ci.md` for the full rationale.

- **E6 — `devteam replay <stage-id>`.** Re-runs a recorded stage against the CURRENT configuration, writes the new gate to `pipeline/gates/replay/<stage-id>.<timestamp>.json` (subdirectory, deliberately outside what the validator scans), and diffs the original vs the replay across status / blockers / cost / tokens / duration / reproducibility fields. `--dry-run` prints the plan + prompt-hash drift check without invoking the host. `--json` for tooling. Detects "host exited 0 but wrote nothing" by capturing the original gate's mtime before invoking and requiring it to advance — a real bug caught during testing. Pairs with C4: C4 records what ran, E6 re-runs and surfaces drift. The drift surface is the audit-grade output (six months later, "would replay match?" is a one-command question). Per-invocation param overrides at the host CLI level (pinning model_version / temperature / seed during replay) remain a C4 follow-up — replay uses current config and makes the drift visible rather than pretending to recreate the original environment. 7 tests in `tests/replay.test.js` covering usage, missing gates, dry-run (drift + match), JSON shape, no-gate-written detection, and end-to-end replay with a synthetic host. See `docs/reproducibility.md` § Replay.

- **C4 — Reproducible runs (recording half).** Every gate can now carry an audit-complete record of how an AI decision was made: optional fields `model_version`, `temperature`, `seed`, `max_tokens`, `system_prompt_hash`, `tools_hash`. `core/reproducibility.js` ships `sha256`, `hashSystemPrompt` (trailing-whitespace-normalized so the same logical prompt hashes the same across line-ending platforms), `hashTools` (sorted + deduped so tool order doesn't change the hash), `reproducibilityFingerprint`, `compareFingerprints`, and `replayReadiness` (classifies a gate as `full` / `partial` / `incomplete`). All three host adapters compute the system-prompt-hash inline during `renderStagePrompt` and embed it in the gate skeleton hint, so the agent stamps it verbatim instead of re-computing. New `devteam reproduce <stage-id>` subcommand reads a gate, prints recorded fields + readiness classification, and (when possible) re-renders the current prompt to surface hash drift — the answer to "would the same prompt render today?". **Config-side pinning** (`.devteam/config.yml reproducibility.model_pins`) and **actual replay** (E6) are deferred to follow-up commits; this lands the recording layer that both will read from. Strategic value: the gate JSON is now what SOC 2 / EU AI Act compliance reviews ask for — a complete record of what configuration produced each artifact. 24 new tests in `tests/reproducibility.test.js` covering hash determinism + normalization, fingerprint extraction, drift detection, readiness classification, CLI surface, and schema declarations. See `docs/reproducibility.md` for the honest framing of what "reproducible LLM run" actually means (recording vs. determinism).

---

## [0.3.0] — 2026-05-29

Twenty commits since `v0.2.0`. All four "differentiating bets" from `docs/BACKLOG.md` are now operational — this release marks the line between "structured AI dev pipeline" and "structured AI dev pipeline that learns, remembers, and includes an adversary."

| Bet | What ships it (✓ across all four) |
|---|---|
| **Diversity beats monoculture** | G1 (peer-review fanout, v0.2.0) + **G4 (red team, this release)** + **D4/D5 (adaptive routing, this release)** |
| **Evals are the rate-limit** | D1 (OTel, v0.2.0) + D2 (dashboards, v0.2.0) + **D6 (cost telemetry, this release)** |
| **Memory + persistence** | D7 (per-project, v0.2.0) + **D3 (cross-project) + G8 (architecture continuity, this release)** |
| **The unit is the team, not the model** | **G4 sharpens it (this release)** + the whole architecture |

The arc of this release: measure what each model costs (D6) → score which model is best at which role (D4) → recommend config swaps (D5) → add an adversary that breaks what was just built (G4) → share architectural decisions across projects (D3) → make the architect remember (G8). No new breaks to gate JSON shape, host adapter contract, or `.devteam/config.yml` schema — additive throughout. Public surfaces unchanged from 0.2.0.

### Added

- **D3 + G8 — Cross-project memory + architecture continuity.** Two BACKLOG items shipped together because G8 reads from the foundation D3 lays.
  - **D3 — Org-shared memory.** New store rooted at `~/.stagecraft/memory/` (overridable via `STAGECRAFT_ORG_MEMORY_DIR`). New `core/memory/index.js` exports `promote`, `queryOrg`, `statsOrg`, `clearOrg`. CLI: `devteam memory promote [<kinds...>]` (default `adr` + `lessons-learned`); `--org` flag on `query`, `stats`, `clear` targets the shared pool. Org records carry `project_cwd` attribution so query results name their source project. Idempotent promote, embedder-mismatch guard, explicit opt-in (nothing flows automatically). The per-project store from D7 is unchanged; sharing is additive and deliberate.
  - **G8 — Architecture continuity.** Principal role brief now instructs querying org memory for prior ADRs before drafting a new design — prior ADRs are binding commitments unless explicitly superseded via a new ADR with a `Supersedes:` field + rationale. ADR template gains `Supersedes:` + a "Prior commitments considered" section. design stage's gate optionally records `adrs_consulted` + `adrs_superseded` arrays (audit trail). New `devteam architecture lookup "<topic>"` subcommand — friendlier wrapper around `memory query --org --kind adr` that the role brief points at. Strategic outcome: the "architect always remembers" bet from BACKLOG is operational; architecture doesn't drift because every new design opens with org-memory consultation. 14 new tests across `tests/memory.test.js` (D3 promote/query/stats/clear) and `tests/architecture-continuity.test.js` (G8 role brief, ADR template, gate fields, subcommand, end-to-end cross-project lookup).

- **G4 — Red team role (stage-04c).** New adversarial-by-design role and stage between security-review (4b) and peer-review (5). Always-on for `full` + `hotfix` tracks; skipped on lighter tracks. Walks 10 attack surfaces — input boundaries, state, sequence, integrations, auth edges, resource exhaustion, failure modes mid-operation, abuse cases, downstream effects, observability gaps — and produces **concrete reproducers** (not vibes). Findings are triaged by severity × likelihood × scope; the `must_address_before_peer_review` array blocks Stage 5 until the implementer addresses each item by re-running build. New `roles/red-team.md` (read-only on code, like `reviewer`); new `skills/red-team/SKILL.md` with the methodology and a "diversity matters — route to a different host than the build agents" recommendation; new stage entry in `core/pipeline/stages.js`; new `core/gates/schemas/stage-04c.schema.json`; new `templates/red-team-report-template.md`. claude-code adapter gets a ROLE_FRONTMATTER entry for `red-team`; codex / gemini-cli / generic pick it up automatically via `core/roles.listRoles()`. 10 new tests in `tests/red-team.test.js` + 3 new `tests/tracks.test.js` cases for track inclusion. Distinct from stage-04b security review (narrower remit, conditional, has veto) and stage-05 peer review (general code review).

- **The "routing-learns-itself" arc — D6 + D4 + D5.** Three commits realize the BACKLOG's "diversity beats monoculture" bet: the system measures which (role, host) combinations work best and recommends config changes.
  - **D6 — Cost telemetry.** New optional gate fields (`tokens_in`, `tokens_out`, `cost_usd`, `model`, `duration_ms`). New `core/pricing.js` with $/Mtok pricing tables for Claude / GPT / Gemini families. New `--view cost` flag on `scripts/dashboard.js` (`npm run dashboard:cost`) rolling up tokens / dollars / duration per host / role / stage. `mergeWorkstreamGates` sums per-workstream cost into stage totals. Adapters' renderStagePrompt asks agents to fill in cost fields when measurable. See `docs/cost.md`.
  - **D4 — Per-role per-model performance scores.** New `scripts/performance.js` (`npm run performance`). For each `(role, host)` pair: dispatches, first-try pass rate, mean retries, mean cost, **cost per pass** (unit-cost of a successful dispatch), mean duration, distinct models seen. Headlines pairwise comparisons. Multi-project rollup. The data layer feeding D5.
  - **D5 — Adaptive routing.** New `scripts/routing-suggest.js` (`npm run routing:suggest`). Reads the same gate history, compares against the current `.devteam/config.yml`, proposes role-level routing swaps. Minimum-dispatch threshold (5 default) + minimum pass-rate delta (10pp default) prevent noisy recommendations. YAML-diff output by default; `--apply` rewrites the config after a confirmation prompt (or `--apply --yes` for CI). Honest about insufficient-data cases. End-to-end demo: synthetic history of backend on codex (100% first-try @ $0.24) vs backend on claude-code (33% @ $1.71) produces a clean `backend: codex # was: claude-code` patch.
- **Self-audit dogfood** — full audit run of Stagecraft using the new `/audit` feature, committed at `docs/audit/00-project-context.md` through `10-roadmap.md` + `status.json`. Acts as a reference artifact (users see what audit output actually looks like) and surfaced the follow-up work below. Notable finding: Phase 2.1 promoted a UI path-traversal concern (S5) based on signature reasoning, then RETRACTED it after a live curl exploit attempt returned HTTP 404 — codified as a "verify before promoting" discipline in `skills/audit/SKILL.md`. Referenced from `docs/user-guide.md` § Auditing a codebase as a concrete example of the output.

### Changed (audit follow-up work)

- **Validator `node:` import prefix** (`core/gates/validator.js`). Was the only file using bare `require("fs")` / `require("path")` instead of the `node:` form. Consistency fix.
- **`docs/TESTING.md` test-count freshness.** Rewrote the summary line to stop quoting a specific number (the count drifts every commit); now says "~380 tests across 25+ files (exact counts in `npm test` output)."
- **`tests/consistency-meta.test.js`** — meta-test that spawns `node scripts/consistency.js` and asserts exit 0. Ensures `npm test` alone catches contract drift, not just CI.
- **`AGENTS.md` — documented two unstated conventions:** `node:` prefix on built-in imports, and stdout/stderr separation (stdout for primary output, stderr for warnings + framing + logs). The framing-on-stderr norm is load-bearing — `devteam stage ... > prompt.md` works correctly because of it.
- **`skills/audit/SKILL.md` § Process discipline.** New section codifying "verify before promoting": any finding past LOW confidence must be backed by direct evidence (live exploit attempt, code path trace, test run, git log) — not signature-only reasoning. References the actual S5 retraction in the self-audit as a worked example.
- **`tests/visualize.test.js`** (4 tests) — `scripts/visualize.js` had no direct coverage. Tests default rendering, `--track nano` produces smaller graph, `--tracks` renders multiple, unknown track is handled.
- **`tests/pr-pack.test.js`** (8 tests) — `scripts/pr-pack.js`'s `buildPRBody` helper now has unit tests: empty pipeline placeholder, brief H1 → PR title, brief §Problem → Summary, per-role pr-*.md sections, merged stage-04 workstreams table, stage-06 test results, design-spec mention, determinism modulo timestamp.
- **`devteam stage --headless --timeout-ms N`** — caps each workstream's wall-clock (default 600000ms / 10 min; pass 0 to disable). SIGTERM with a 5s grace window, then SIGKILL. Result reports "TIMEOUT after Nms" vs "exit N, Nms". Closes the "hung host CLI hangs CI indefinitely" risk. 2 new tests in `tests/headless.test.js`.
- **Asymmetric template-doc coverage documented** in `docs/concepts.md`. Per-template annotation guides (`docs/<artifact>-template.md`) exist for brief / design-spec / runbook because humans read them end-to-end; the other 9 templates are agent-facing and don't need separate annotation. Made explicit instead of inferred.
- **Inline comments** on `workstreamId()` (`core/orchestrator.js`) and `KNOWN_HOSTS` (`core/hooks/approval-derivation.js`) — small clarity improvements in hot files. `KNOWN_HOSTS` comment now spells out the sync requirement (adding a host adapter requires adding to the set, otherwise fanout review gates collide across hosts).
- **Adapter de-duplication — single source of truth for the role list.** New `core/roles.js` exports `listRoles()` which scans `roles/*.md`. The codex and gemini-cli adapters now derive their `ROLES` array from there; claude-code keeps `ROLE_FRONTMATTER` (per-role model / tools / permissionMode metadata) but warns at install if a brief exists without a corresponding entry. Adding a new role brief is now a single edit — every host picks it up automatically.
- **Adapter de-duplication — shared install helpers.** New `core/adapters/base-install.js` exports `installRules` / `installSkills` / `uninstallRules` / `uninstallSkills` — the install logic that was character-identical across all three adapters. Per-host work (claude-code's `installCommands` + `installSettings`, each adapter's `installRoles`) stays in the adapter. LOC reduction: claude-code 404→369 (-35), codex 233→172 (-61, -26%), gemini-cli 234→173 (-61, -26%). Net 871→823 LOC of pure duplication eliminated. The next adapter add (BACKLOG A2) should be ~150 lines instead of ~250.

### Added

- **Codebase audit feature** (`docs/BACKLOG.md` E8). Read-only end-to-end analysis pass with prioritized roadmap output — separate from the 13-stage pipeline (which builds features; the audit analyzes existing code). New `skills/audit/SKILL.md` defines 4 phases (Bootstrap → Health Assessment → Deep Analysis → Roadmap) producing 11 output files in `docs/audit/00-project-context.md` through `docs/audit/10-roadmap.md`. New `roles/auditor.md` (read-only by design — never writes source). New `/audit` and `/audit-quick` slash commands installed by the claude-code host adapter; the audit skill + auditor role brief also install for codex and gemini-cli hosts (no slash commands there, but the skill is invocable). 11 phase output templates in `templates/audit/` as framework-side reference. Resume capability via `docs/audit/status.json`. Monorepo-aware. Extensible via `docs/audit-extensions.md` for project-specific checks (compliance frameworks, custom security policies, team conventions). 9 new tests in `tests/audit.test.js`; 15 new consistency checks in `scripts/consistency.js`. Fixes the dangling `scripts/audit.js` reference in `ARCHITECTURE.md` that's been wrong since v0.1.0.

- **Documentation uplift across three tiers.** Major rewrite of seven docs to bring Stagecraft to parity with claude-dev-team's documentation quality. New: `docs/presentation-notes.md` (13-slide deck + speaker notes, ~22KB, with timing references and Q&A primers), `docs/brief-template.md`, `docs/design-spec-template.md`, `docs/runbook-template.md` (section-by-section "what to write, why, what to skip" guides for the three load-bearing artifacts). Rewritten: `docs/concepts.md` (restructured around a 6-primitives table), `docs/user-guide.md` (14KB → 26KB, adds "shape of one run" diagram + "Your three moments of control" framing + sections on UI / memory / OTel / fanout), `docs/adoption-guide.md` (10KB → 16KB, deeper Q&A answers + 12-month success milestones), `docs/faq.md` (10KB → 22KB, +25 questions across 6 new topic groups), `EXAMPLE.md` (adds a hotfix-track walkthrough as a second worked example), `README.md` (problem-first hook + "First 30 minutes" checklist + documentation map). New BACKLOG entry E7 for `/goal` integration.

- **`devteam stage` onboarding framing.** In user-driven mode (the default), the rendered stage prompt is now wrapped with a preamble that names the stage, explains that `devteam` does not call a model, and lists the three ways to feed the prompt to a host (Claude Code paste, `/devteam stage <name>` slash command, or `--headless` to drive `claude --print` automatically). A postamble points at the next concrete action (`devteam next` after the gate is written). Framing is suppressed under `--headless` (the prompt is piped to the host CLI) and reserved-suppressed under `--json`. Closes the #1 first-run footgun where new users ran `devteam stage` and got a raw prompt block with no context. 3 new tests in `tests/cli.test.js`.
- **Un-initialised target warning.** `devteam stage` now stderr-warns when the target directory has no `.devteam/config.yml`, with the exact `devteam init --host claude-code --cwd "..."` command to fix it. The warning fires before the prompt renders, so users see the fix path before they see a prompt that references files that don't exist. 1 new test in `tests/cli.test.js`.
- **Quickstart section in `devteam help`.** Five numbered steps from `init` through the first `devteam next`, plus a one-line statement of the model-agnostic invariant ("devteam never calls a model itself").
- `tests/headless.test.js` (8 tests) — covers `core/adapters/headless.js`: command resolution, env override, missing-command rejection, exit-code propagation, spawn-ENOENT error, gatePath detection, EPIPE swallowing, whitespace splitting.
- `tests/release.test.js` (7 tests) — covers `scripts/release.js notes`: `[Unreleased]` default, middle section, last-section (no trailing header to anchor to — the regression that bit v0.1.0's tag), missing-version error, blank-line preservation, trailing `---` stripping.
- `tests/ui.test.js`: 4 new tests for the non-loopback bind guard — accepts loopback (`127.0.0.1`, `localhost`) without opt-in, rejects non-loopback bind with `EREMOTEBIND` unless `STAGECRAFT_UI_ALLOW_REMOTE=1` is set, allows non-loopback with a stderr warning when opt-in is given.

### Changed

- `core/gates/validator.js`: lifted `GATES_DIR` / `LESSONS_FILE` from module-load constants to `gatesDir()` / `lessonsFile()` functions. The validator is normally spawned as a subprocess (each invocation has a fresh cwd), so behavior is unchanged in production; the lazy resolution makes the module require()-able from tests and other callers that chdir().
- `scripts/release.js notes`: strips the trailing `---` separator from extracted sections. CHANGELOG uses `---` between sections structurally, but it was bleeding into annotated tag messages. Annotated tags built from `release:notes <version>` now end cleanly at the section body.
- `docs/TESTING.md`: rewritten to reflect current reality (362 tests / 24 files / 81 suites / ~1.5s, tiers 1+2 shipped) instead of the original strategy-doc framing where tiers 1 and 2 were aspirational.
- `docs/GAP-ANALYSIS.md`: rewritten as a historical-then-current doc. Migration is complete; most listed gaps are closed. The load-bearing section now is the feature inventory of what Stagecraft has that the forks didn't (contracts A/B/C/F, conditionalOn, stage-04b/06b/06c, OTel, memory, fanout, dashboards, PR integration, web UI, secret scanning, consistency lint). For active gap tracking, see `docs/BACKLOG.md`.
- Schema `$id` URLs: switched from the placeholder `https://example.local/ai-dev-team/<name>.schema.json` to `urn:stagecraft:schema:<name>`. Internal identifiers; the URN form avoids claiming a DNS namespace we don't own. `tests/schemas.test.js` and `scripts/consistency.js` updated to assert the new form.
- `core/ui/server.js`: refuses to bind to non-loopback hosts unless `STAGECRAFT_UI_ALLOW_REMOTE=1` is set. The UI has no auth, no rate limits, and exposes full pipeline state — making a remote bind a conscious opt-in instead of a typo-distance default. Loopback bind (`127.0.0.1`, `::1`, `localhost`) is unaffected. When opt-in is given, a loud stderr warning prints at startup.
- OpenTelemetry dependency pins: `^x.y.z` → `~x.y.z` for all `@opentelemetry/*` packages. Pre-1.0 OTel SDK packages have historically shipped breaks in minor releases; tilde restricts to patch-only updates.

### Security

- **GHSA-q7rr-3cgh-j5r3 resolved by removing the vulnerable package.** `@opentelemetry/sdk-node` was a convenience wrapper that we only used to wire `OTLPTraceExporter` + `Resource` onto a tracer provider — work that `NodeTracerProvider` (from `@opentelemetry/sdk-trace-node`, already in our deps as stable 1.x) does directly. `core/observability.js` now uses `NodeTracerProvider` + `BatchSpanProcessor` explicitly, and `@opentelemetry/sdk-node` is removed from `package.json`. `npm install` drops 51 transitive packages (including the vulnerable Prometheus exporter). `npm audit` reports `found 0 vulnerabilities` post-change. Production tracing behavior is unchanged: same span shape, same OTLP/HTTP transport, same shutdown flush on `beforeExit` / `SIGINT` / `SIGTERM`.

---

## [0.2.0] — 2026-05-27

Ten priority BACKLOG items shipped in a row, plus the rename from `ai-dev-team` to **Stagecraft**. The CLI binary remains `devteam`; only the project identity changed. Public surfaces unchanged from 0.1.0: gate JSON shape, host adapter contract, `.devteam/config.yml` schema. Additive features only — no breaking changes.

### Added

- **OpenTelemetry tracing** (`docs/BACKLOG.md` D1). Every pipeline operation emits spans: `pipeline.stage`, `pipeline.workstream`, `pipeline.stage.headless`, `pipeline.merge`, `pipeline.next`, `adapter.renderStagePrompt`, `adapter.invoke`. Opt-in via the standard `OTEL_EXPORTER_OTLP_ENDPOINT` env var; no-op tracer when unset (zero overhead). Ships spans via OTLP/HTTP to Jaeger, Tempo, Honeycomb, Datadog Agent, etc.
- `core/observability.js` — tracer bootstrap + `withSpan` helper.
- `docs/observability.md` — setup cookbooks for Jaeger / Honeycomb / Datadog.
- `tests/observability.test.js` — 9 tests asserting expected spans + attributes using `InMemorySpanExporter`.
- **Secret scanning PreToolUse hook** (`docs/BACKLOG.md` C2). Blocks `Write` / `Edit` operations that introduce AWS keys, GitHub / Anthropic / OpenAI / Google / Slack / Stripe credentials, private keys, JWTs, or postgres URLs with embedded passwords. Built-in regex patterns; no external scanner required. Path allowlist (`.env.example`, `docs/`, `examples/`, tests, snapshots). Magic-comment override `devteam-allow-secret:` for verified false positives. Findings are redacted before being echoed back. `DEVTEAM_SECRET_SCAN_ALLOW` env var accepts additional path-regex allowlist entries.
- `core/hooks/secret-scan.js` — hook script + exported `scanContent()`.
- `tests/secret-scan.test.js` — 32 tests across pattern detection, false-positive guards, magic-comment override, path allowlist, end-to-end PreToolUse stdin parsing, and snippet redaction.
- **Gemini CLI host adapter** (`docs/BACKLOG.md` A1). Third real host alongside claude-code and codex. Symmetric to codex (no hooks, no slash commands, headless via `gemini`). Installs roles → `.gemini/prompts/roles/<role>.md`, rules → `.devteam/rules/` (shared), skills → `.gemini/skills/<name>/`. Tri-host install (`devteam init --host claude-code,codex,gemini-cli`) lays down all three side-by-side with shared rules deduped automatically.
- **Accessibility audit stage** (`docs/BACKLOG.md` B1). New `stage-06b` between QA and sign-off, role: `qa`. Gate carries `audit_method` (axe-core / pa11y / lighthouse / manual), `wcag_level` (A / AA / AAA), `violations` (critical / serious / moderate / minor counts), `components_audited`, and an `audit_skipped_reason` escape for backend-only changes. PASS requires zero critical AND zero serious; moderate/minor flow through as WARN. Included in `full`, `quick`, `hotfix` tracks (skipped on `nano`, `config-only`, `dep-update`). `skills/accessibility-audit/SKILL.md` walks through tool choice, procedure, triage, gate writing, and gotchas (Storybook-passes-route-fails, color-contrast in real browsers, manual audit for hover/focus/error states).
- **Observability gate** (`docs/BACKLOG.md` B4). New `stage-06c` between accessibility-audit and sign-off, role: `platform`. Verifies that every metric / log / trace the brief's §9 "Observability requirements" promised is actually emitted by the shipped code. Gate carries `metrics`, `logs`, `traces` each with `{required[], verified[], gap[]}` plus a `verification_method` enum (`code-grep` → `runtime-probe`). PASS requires every gap empty; weak verification methods PASS with WARN ("recommend runtime-probe post-deploy"). Non-empty gap → FAIL with missing signals as blockers. Included in `full` + `hotfix` tracks (the tracks where brief §9 is mandatory). `skills/observability-verification/SKILL.md` walks through extraction, naming conventions to match (`_` ↔ `.` ↔ `-`), grep patterns per signal type, and the decision matrix.
- **Gate-pass-rate dashboards** (`docs/BACKLOG.md` D2). `scripts/dashboard.js` aggregates `pipeline/gates/` across one or more projects and produces a per-stage / per-host / per-role / per-status pass-rate report. Default: Markdown with ASCII stacked-bar charts (`▰` PASS, `▱` WARN, `▨` FAIL, `▩` ESCALATE); `--json` for tooling integration. `--from p1,p2,...` for multi-project rollups, `--since YYYY-MM-DD` for time-windowed views. Expands merged stage gates into their constituent workstreams so per-host / per-role attribution is correct (e.g. a stage-04 merged gate counts as 4 rows in the host breakdown, one per workstream). `npm run dashboard` exposes it. Foundation for the not-yet-built D4 (per-role per-model performance scores) and D5 (adaptive routing).
- `scripts/dashboard.js` + `tests/dashboard.test.js` (14 tests).
- **GitHub PR integration** (`docs/BACKLOG.md` F1). `scripts/pr-publish.js` uses the `gh` CLI to publish pipeline state to a PR. Two modes: `body` (replace PR description with pr-pack output — idempotent; re-run after each pipeline change to keep the PR in sync) and `checks` (post each gate as a GitHub check run on the PR head commit — PASS→success, WARN→neutral, FAIL/ESCALATE→failure, with blockers + warnings + workstreams in the check run's summary text). Auto-detects repo from git remote and PR from current branch; `--dry-run` previews what would happen (works without `gh` configured when `--pr` and `--repo` are supplied). `npm run pr-publish` exposes it. Auth via `gh` — we never handle tokens directly.
- `scripts/pr-publish.js` + `tests/pr-publish.test.js` (12 tests — gate-to-check-run translation, including PASS/WARN/FAIL/ESCALATE conclusion mapping, workstream gate naming, blockers/warnings/workstreams in output text, edge cases).
- **Web UI for pipeline runs** (`docs/BACKLOG.md` E2). `devteam ui` starts a local HTTP server (default http://127.0.0.1:3737/). Single-page UI shows the active track + pipeline state (one row per stage, expandable workstreams for multi-role stages, status icons + colors), gate detail on click (status, identity fields, blockers, warnings, workstreams table, raw JSON), and live updates via Server-Sent Events backed by `fs.watch` on `pipeline/gates/`. Zero build step (vanilla HTML / CSS / JS); zero new dependencies. `--open` launches the default browser; `--port N` overrides; loopback-only by default. Path-traversal-safe static serving.
- `core/ui/server.js` + `core/ui/static/{index.html, app.js, styles.css}` + `tests/ui.test.js` (14 tests covering pure helpers, route correctness, security, and SSE plumbing).
- **Multi-model adversarial peer review** (`docs/BACKLOG.md` G1). New `routing.review_fanout: [host, host, ...]` config field. When set, stage-05 (peer-review) workstreams duplicate across all listed hosts — 4 areas × 3 hosts = 12 parallel reviews. Each host produces its own review file (`pipeline/code-review/by-<host>.md`); the approval-derivation hook recognizes host-based filenames and writes gates to a new 3-segment path (`pipeline/gates/stage-05.<area>.<host>.json`). `mergeWorkstreamGates` reads all expected fanout gates and aggregates pessimistically (any FAIL anywhere → merged FAIL). Adapter contract, host install payload, and gate JSON schema unchanged — fanout is pure composition of existing infrastructure. Default `review_fanout: []` (off); opt-in via config.
- `core/orchestrator.js`: new `computeDispatchPlan(stageDef, config)` helper that computes the full set of `(role, hostName, workstreamId, gateFile)` entries the orchestrator should dispatch — one per role normally, N×M when fanout is active.
- `core/hooks/approval-derivation.js`: new `hostFromPath()` helper + `KNOWN_HOSTS` export; `applyVerdict` accepts an optional `host` param that flips gate naming to 3-segment.
- `tests/fanout.test.js` (16 tests covering dispatch plan correctness for fanout / non-fanout / non-peer-review stages, end-to-end runStage producing N×M workstream prompts, mergeWorkstreamGates aggregation across all 12 gates, missing-gate detection, hostFromPath recognition, and approval-derivation end-to-end with host-based review files).
- **Persistent project memory** (`docs/BACKLOG.md` D7, v1). Per-project semantic memory under `.devteam/memory/`. `devteam memory ingest` indexes briefs / design specs / ADRs / clarification logs / runbooks / test reports / accessibility / observability / security reviews / retrospectives / lessons-learned by splitting at level-2 markdown headings and embedding each chunk. `devteam memory query "text"` returns top-K matches by cosine similarity, ranked, with source path + section heading + snippet + similarity score. Local-default embedder (`Xenova/bge-small-en-v1.5` via `@huggingface/transformers`, ~33MB model lazy-downloaded to `~/.cache/huggingface/`, fully offline thereafter). JSON-backed storage (git-friendly); `MemoryStore` interface ready for the sqlite-vec backend planned for v0.3. Opt-out per artifact via the `stagecraft-no-memory` marker. Re-ingest replaces existing chunks (no duplicate rows). Cross-project import is deferred per D7 decision 3.
- `core/memory/{embed,chunker,store,index}.js` + `tests/memory.test.js` (22 tests using `DEVTEAM_EMBEDDING_PROVIDER=stub` to keep CI fast and offline; live BGE smoke-tested separately against the example project).
- Dependency: `@huggingface/transformers ^3.x` (the v3 successor to `@xenova/transformers`).
- `tests/budget.test.js` (7 tests covering `parseBudgetMd` round-trip, config parsing, init/update/check round-trip, and the contract-F gate emitted on escalation).

### Changed

- **Project rename** `ai-dev-team` → **Stagecraft** (marketing / identity surface only). The CLI binary, config dir (`.devteam/`), gate-file paths, and ORCHESTRATOR_ID prefix (`devteam@<version>`) are all unchanged. README, ARCHITECTURE, AGENTS, CONTRIBUTING, and docs/* reflect the new name and tagline.
- **Budget tracking relocated** from `core/guards/budget.js` → `scripts/budget.js`. It was never wired into the orchestrator as a runtime guard — it's an out-of-band tracker fed by external telemetry. New `npm run budget` exposes it. Fixed a latent contract-F violation: the gate it writes on escalation now carries `orchestrator: "devteam@<version>"` instead of the legacy `agent:` field. The exported `root()` is now lazy so the script's pure-logic exports can be called from tests after `chdir()`.

---

## [0.1.0] — 2026-05-26

First tagged release. This is the unification of `claude-dev-team` and `codex-dev-team` into a single model-agnostic core with per-host adapters. The 0.x signals that the public surface — gate JSON shape, host adapter contract, CLI subcommands, `.devteam/config.yml` schema — may break before 1.0. 1.0.0 is reserved for a substantial future release (see `docs/BACKLOG.md`).

### Added

#### Core architecture
- **Model-agnostic core (`core/`)** that never invokes a model — emits stage prompts and validates gate JSON.
- **Host adapter contract** (`core/adapters/host-adapter.md`) — minimum surface a host must implement: `capabilities`, `install`, `renderStagePrompt`, `status`, `uninstall`, optional `invoke`.
- **Router** (`core/router.js`) — adapter discovery + per-(stage, role) resolution with precedence `routing.stages > routing.roles > routing.default_host`.
- **Orchestrator** (`core/orchestrator.js`) — `runStage`, `runStageHeadless`, `mergeWorkstreamGates`, `next`, `summary`. Decomposes multi-role stages into per-workstream dispatches.
- **Config** (`core/config.js`) — loads `.devteam/config.yml` (js-yaml), resolves host per workstream, generates default config for `devteam init`.
- **Stage definitions** (`core/pipeline/stages.js`) — 11 stages, 6 tracks, role-keyed gate skeletons, per-role allowedWrites overrides, conditional dispatch.

#### Pipeline stages
- Stage 1–9 with sub-stages 4a (pre-review) and **new 4b (security review, conditional)**.
- Conditional dispatch via `conditionalOn: { stage, field, equals }` — generic mechanism, currently used by security-review.
- Per-workstream gates (`pipeline/gates/<stage>.<workstream>.json`) for multi-role stages, merged into stage gate (`pipeline/gates/<stage>.json`) by the orchestrator with aggregate status `ESCALATE > FAIL > WARN > PASS`.

#### Host adapters
- `hosts/claude-code/` — full capabilities (hooks, subagents, slashCommands, worktrees, headless). Installs subagents to `.claude/agents/<name>.md` with YAML frontmatter, rules to `.devteam/rules/`, skills to `.claude/skills/<name>/`, slash command to `.claude/commands/devteam.md`, hooks (Stop/SubagentStop/PostToolUse) to `.claude/settings.local.json`.
- `hosts/codex/` — moderate capabilities (no hooks, no subagents, headless via `codex exec`). Installs roles to `.codex/prompts/roles/<role>.md`, rules to `.devteam/rules/`, skills to `.codex/skills/<name>/`.
- `hosts/generic/` — zero in-host integration. Proves the contract is genuinely host-neutral; install is a no-op.

#### CLI (`bin/devteam`)
- `init --host <list> [--force]` — install one or more adapters into a target project; write `.devteam/config.yml`; create `pipeline/gates/`.
- `stage <name> [--feature "..."] [--headless] [--force]` — render prompts (or drive headlessly); stoplist-guarded on lighter tracks unless `--force`.
- `next [--json]` — read pipeline state, decide what to do next (run/continue/merge/fix/escalate/complete).
- `merge <stage>` — aggregate per-workstream gates into stage gate.
- `validate` — run the gate validator against `pipeline/gates/`. Exit codes propagate (0 PASS/WARN, 1 malformed, 2 FAIL, 3 ESCALATE).
- `summary [--json]` — one-screen pipeline-state report.
- `doctor` — pre-flight check: framework install, target project layout, config validity, per-adapter status, host CLIs on PATH.
- `stages`, `hosts`, `help`.

#### Guards
- `core/guards/stoplist.js` — phrase-based safety guard; wired into `devteam stage` for STOPLIST_GUARDED_TRACKS (`quick`, `nano`, `config-only`, `dep-update`).
- `core/guards/budget.js` — token + wall-clock budget tracking (lifted, not yet wired into the CLI).
- `core/guards/security-heuristic.js` — file-path patterns that trigger Stage 4b security review.

#### Hooks
- `core/gates/validator.js` — gate validator; wired into Claude Code's Stop + SubagentStop events.
- `core/hooks/approval-derivation.js` — Stage 5 PostToolUse hook that parses per-area `REVIEW:` markers in `pipeline/code-review/by-<reviewer>.md` files and upserts the per-area workstream gates.
- `core/adapters/headless.js` — shared helper for adapter `invoke()` implementations.

#### Schemas
- `core/gates/schemas/gate.schema.json` — base schema with **contract F** identity fields: `stage`, `status`, `orchestrator`, `track`, `timestamp`, `blockers`, `warnings`, plus `workstream` and `host` (workstream gates only) and `workstreams[]` (merged stage gates only). **Legacy `agent` field is removed.**
- Per-stage schemas `stage-01` through `stage-09`, plus `stage-04a` (pre-review) and `stage-04b` (security review).

#### Single-source content
- `roles/` — 8 host-neutral role briefs (pm, principal, backend, frontend, platform, qa, reviewer, security).
- `rules/` — 10 pipeline rules docs (gates, pipeline, escalation, retrospective, orchestrator, coding-principles, compaction, pipeline-build, pipeline-core, pipeline-tracks).
- `skills/` — 6 task-oriented helpers (api-conventions, code-conventions, implement, pre-pr-review, review-rubric, security-checklist).
- `templates/` — 12 artifact templates (brief, design-spec, build, clarification, pr-summary, pre-review, review, runbook, test-report, retrospective, adr).
- `core/deploy/` — 4 deploy adapter docs (docker-compose, kubernetes, terraform, custom) + README.

#### Documentation
- `README.md` — concise entry point.
- `ARCHITECTURE.md` — design model + 11 locked decisions.
- `AGENTS.md` — host-neutral context for LLMs working on this repo.
- `CONTRIBUTING.md` — recipes to add a host adapter, stage, role, or skill.
- `EXAMPLE.md` — end-to-end walkthrough of one pipeline run with real CLI captures.
- `docs/concepts.md` — one-sentence definitions of every primitive.
- `docs/GAP-ANALYSIS.md` — comparison vs claude-dev-team / codex-dev-team.
- `docs/TESTING.md` — testing strategy.
- `docs/BACKLOG.md` — bucketed roadmap with impact/effort scores + innovation bets.
- `docs/walkthroughs/stage-04-split-host.md` — stress-test trace that locked the multi-workstream contract.

#### Tests
- 113 tests across 8 files: contract, config, router, adapter-contract, gate-validator, orchestrator, next, install-roundtrip, approval-derivation. `npm test` passes in ~500ms.

### Locked design decisions

11 decisions in `ARCHITECTURE.md` — most consequential:

1. The core never spawns a model. Emits prompts and validates JSON.
2. Gate JSON is the stable seam. Identity fields `stage`, `status`, `orchestrator`, `host`, `workstream` (no more `agent`).
3. Role briefs have one source (`roles/*.md`); adapters render into host-expected paths at install time.
4. **Per-workstream host selection.** A single pipeline can route different roles to different hosts; merged via the gate seam.
5. Multi-host install is the default code path. Single-host is a list of length 1.
6. Capability negotiation per adapter — declares `hooks`, `subagents`, `slashCommands`, `worktrees`, `headless`, plus an `enforces` map.

### Differences from claude-dev-team and codex-dev-team

- No fork to maintain — one core, three host adapters.
- Contract F applied everywhere: `agent` field replaced with `orchestrator` + `host` + `workstream`.
- WARN status added (PASS-with-warnings, non-blocking).
- Generic `conditionalOn` mechanism for conditional stages.
- Per-role `roleWrites` map narrows allowed writes per workstream in multi-role stages (backend's prompt no longer lists `src/frontend/`).
- `stage.subagent` override lets multi-workstream stages dispatch all workstreams to a single named subagent (used by peer-review).
- Multi-host install (`devteam init --host claude-code,codex`) is first-class.

### Migration history

Land in 5 logical commits then iterate (see `git log`):

1. `scaffold` — architecture, host-adapter contract, stress-test walkthrough.
2. `core` — templates, schemas, validator, guards, stages.js (contracts A/F applied).
3. `roles + rules` — single source of truth, host-neutral paths.
4. `orchestrator + CLI + generic adapter + init command` (contract B merge).
5. `claude-code adapter` (agents + slash command + rules install).

Then iteratively: codex adapter, `next`, hooks wiring, headless `invoke()`, track filtering, per-role allowedWrites, peer-review structural fix, conditional security review, skills, version-note cleanup, role-brief refinements, README/LICENSE/gap-analysis/testing, tier-1 doc + test + CLI set.
