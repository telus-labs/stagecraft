# Backlog

A living list of work beyond the initial migration. Organized into seven buckets, each item carrying a rough impact (1–5) and effort (1–5) score so we can pick by ratio.

**How to read the scores.** Impact 5 = changes what users can do, not just how. Effort 5 = multi-week, touches several components, needs experimentation. Priority isn't strictly impact÷effort — high-impact items are often worth doing even when expensive — but the ratio is a useful first filter.

**Cross-references.** Items tagged `[cmp-E-N]` were added or refined on 2026-06-03 after the comparative analysis against six adjacent AI-dev frameworks ([`comparative-analysis.md`](comparative-analysis.md)). Items tagged `[hist-N]` came from `audit-archive/HISTORY.md` § Between-cycle observations. Where multiple sources converge on the same idea, that's recorded inline.

---

## A. Reach — more hosts, more deployment targets

| # | Idea | I | E | Notes |
|---|---|---|---|---|
| A1 | ~~**Gemini CLI adapter**~~ ✅ landed (Unreleased) | 4 | 2 | Lifted the multi-model story to three real hosts (claude-code, codex, gemini-cli). Symmetric to codex: no hooks, no slash commands, headless via `gemini`. Installs roles → `.gemini/prompts/roles/`, skills → `.gemini/skills/`. |
| A2 | **Cursor / Windsurf / Aider / Cline adapters** | 3 | 3 | One per IDE-embedded agent. Each is an adapter, mostly install-payload work. |
| A3 | **Cloud-runner adapter** (e.g. AWS Lambda + Bedrock, Replit Agent) | 4 | 4 | Host adapter that runs the stage on a remote worker, not the user's laptop. Enables long-running stages (multi-hour audits, big test suites). |
| A4 | **Pluggable adapter discovery** | 3 | 2 | `npm install @devteam/host-foo` and the orchestrator auto-loads. Makes the ecosystem extensible without forking. |
| A5 | **API-direct adapter** (no host CLI; talks to Anthropic / OpenAI / Google APIs directly) | 3 | 3 | For users who don't want to install claude-code or codex but still want orchestration. Lighter dependency footprint. |

## B. Pipeline depth — more/richer stages

| # | Idea | I | E | Notes |
|---|---|---|---|---|
| B1 | ~~**Accessibility audit stage**~~ ✅ landed (Unreleased) | 4 | 2 | stage-06b after QA; gate carries WCAG critical/serious/moderate/minor counts + audit_method + components_audited. `skills/accessibility-audit/SKILL.md` walks through axe-core / pa11y / Lighthouse. Tracks: full, quick, hotfix. |
| B2 | **Performance budget stage** | 4 | 3 | Lighthouse / k6 / bundle-size budget per change. Gate fails if budgets exceeded. |
| B3 | **Cost gate at deploy** | 4 | 2 | Estimate cloud cost delta from the deploy plan. Block deploys that 10× cost without explicit override. |
| B4 | ~~**Observability gate**~~ ✅ landed (Unreleased) | 4 | 2 | stage-06c, role: platform. Gate carries required/verified/gap arrays for metrics, logs, traces + a verification_method. Tracks: full, hotfix. `skills/observability-verification/SKILL.md` walks through extraction from brief §9, grep patterns per signal type, gap computation, and the WARN-when-weak-verification rule. |
| B5 | ~~**Migration safety stage**~~ ✅ landed (Unreleased) | 5 | 3 | New conditional stage `stage-04d`, fires when stage-04a's heuristic (`core/guards/migration-heuristic.js`) flags data-layer changes — migrations directories, schema files, ORM migration files, or DDL fragments (`ALTER/CREATE/DROP TABLE` etc.) in any file's content. New `migrations` role brief (read-only on code), new `skills/migration-safety/SKILL.md` walking six questions per migration (what does it do? breaking? backfill required? dual-write required? rollback plan? rollback tested?). New schema `core/gates/schemas/stage-04d.schema.json` enforces `rollback_plan` non-empty. **Has veto power** like stage-04b security: empty rollback, untested rollback on a breaking change, or missing backfill strategy when backfill is required each auto-veto and halt the pipeline. Included in `full` + `hotfix` + `config-only` tracks (the ones where schema changes can plausibly land); skipped on `quick` / `nano` / `dep-update`. Template `templates/migration-safety-template.md`. ROLE_FRONTMATTER entry on claude-code; codex / gemini-cli / generic auto-discover via `core/roles.listRoles()`. 20 new tests in `tests/migration-safety.test.js` + 4 new `tests/tracks.test.js` cases for track inclusion + auto-picked-up contract assertions. |
| B6 | **Documentation gate** | 3 | 2 | Public API changed → README/CHANGELOG must reflect it. Mechanical but catches a common drift. |
| B7 | **Multi-language QA** | 4 | 4 | Stage 6 currently assumes one test framework. Real projects have JS + Python + Go. Per-language test runners with a merged report. |
| B8 | ~~**Cross-artifact consistency analyze**~~ ✅ landed `[cmp-E-1]` | 4 | 2 | `devteam consistency analyze` walks brief → spec.feature → pr-\*.md → red-team gate → test-report → gate fields and reports drift in one pass. Exit 0 = clean, exit 1 = drift found. `--json` for tooling. Three drift classes: AC-to-scenario (orphan ACs, orphan scenarios), scenario-to-test (unmapped tests, uncovered scenarios), and red-team-to-build (findings referencing files not touched by any workstream PR). Fix recommendations printed per drift item. Builds on `core/spec/verify.js` (G2) + new `core/spec/analyze.js` (345 lines). |
| B9 | **Bounded workspace deltas** `[cmp-E-2]` | 4 | 3 | Isolate in-flight features under `pipeline/changes/<id>/` instead of mutating the global `pipeline/` directory. Stops context bleed between concurrent features and reduces per-stage token cost. From OpenSpec's `openspec/changes/<id>/` model. Higher leverage as concurrency demand grows; lower urgency today since most users run one feature at a time. |
| B10 | **Discover Standards preprocessing** `[cmp-E-5]` | 3 | 3 | New `devteam standards discover` extracts conventions from the existing codebase (import styles, file structures, linter configs, undocumented patterns) and populates `docs/conventions.md` + per-stage rule files before Stage 1 runs. Brownfield-project win. From Agent OS's extraction-first approach. Complements existing `devteam architecture lookup` (which handles prior-decision continuity, not active-pattern continuity). |

## C. Quality & safety — enforcement, sandboxing, scanning

| # | Idea | I | E | Notes |
|---|---|---|---|---|
| C1 | **Filesystem-level `allowedWrites` enforcement** | 4 | 4 | Run each workstream in a sandboxed FS (overlay, chroot, container) where writes outside the allowlist literally cannot happen. Removes "honour system" risk. |
| C2 | ~~**Secret scanning hook**~~ ✅ landed (Unreleased) | 4 | 1 | ~~Blocks the write if a secret is detected.~~ Built-in regex patterns for AWS / GitHub / Anthropic / OpenAI / Google / Slack / Stripe / private keys / JWTs / postgres URLs. Path allowlist for `.env.example`, `docs/`, `examples/`, tests. Magic-comment override (`devteam-allow-secret:`) for verified false positives. Wired into claude-code's PreToolUse `Write|Edit`. |
| C3 | **License compatibility gate** | 3 | 1 | Already half-present in pre-review's SCA. Make it explicit and per-license, not just "high/critical found". |
| C4 | ~~**Reproducible runs (recording half)**~~ ✅ landed (Unreleased) | 4 | 4 | Optional gate fields: `model_version`, `temperature`, `seed`, `max_tokens`, `system_prompt_hash`, `tools_hash`. New `core/reproducibility.js` with `sha256`, `hashSystemPrompt` (trailing-whitespace-normalized), `hashTools` (sorted + deduped), `reproducibilityFingerprint`, `compareFingerprints`, `replayReadiness` helpers. All three adapters' `renderStagePrompt` computes the system-prompt-hash inline and embeds it in the gate skeleton hint for the agent to stamp verbatim. New `devteam reproduce <stage-id>` subcommand reads a gate, classifies readiness (full / partial / incomplete), prints recorded fields, and (when possible) re-renders the current prompt to surface hash drift. **Config-side pinning** (`.devteam/config.yml reproducibility.model_pins`) and **actual replay** (E6) are deferred to follow-up commits — the recording layer is the foundation. Strategic value: gate JSON is now an audit-complete record of how an AI decision was made, which is what SOC 2 / EU AI Act compliance reviews ask for. See `docs/reproducibility.md`. |
| C5 | **Capability-required permissions** | 3 | 2 | Adapter declares `enforces.network`, `enforces.shell`, etc. Orchestrator refuses to run a stage that needs network if the routed host denies network access. **More relevant now that multi-host routing has landed** — this is what makes per-stage host dispatch safe by construction. |
| C6 | **Tamper-evident gate chain** | 3 | 3 | Each gate carries a hash of its prerequisites. Mutating an old gate breaks the chain. Audit-friendly. |
| C7 | **`eslint-plugin-security`** `[hist-a]` | 3 | 1 | Add the plugin and enable `detect-child-process` (+ a handful of related rules) in `eslint.config.js`. PR 2.1's defer was empirically wrong — three CodeQL alerts in one week (PRs #31, #34, #38) all in the shell-injection-shape class CodeQL catches post-merge. The plugin catches the same class pre-push. |
| C8 | **CHANGELOG-per-PR fragments** `[hist-b]` | 3 | 2 | Replace `[Unreleased]` direct edits with `CHANGELOG.next/<slug>.md` per-PR fragments concatenated at release-time. Dissolves the merge-conflict friction that hit 4+ times across Batch 1 + Batch 2 PRs (#35, #36, #37 specifically). Small tooling change in `bin/devteam release:notes` to do the concatenation. |
| C9 | **Verify-before-promoting enforcement in audit skill** `[hist-c]` | 3 | 2 | The 2026-05-28 audit codified a "verify before promoting" rule (after S5); the 2026-06-03 audit failed to apply it (the C-1 retraction in PR #32). Codifying the rule once textually isn't enough. Add a `verified_by` field requirement to each finding in `skills/audit/SKILL.md` Phase 1/2 — must include the grep/code-inspection command that confirmed the cited symbol exists. Structural enforcement, not textual guidance. |

## D. Observability & learning — telemetry, metrics, persistent learning

| # | Idea | I | E | Notes |
|---|---|---|---|---|
| D1 | ~~**OpenTelemetry tracing per stage**~~ ✅ landed (Unreleased) | 5 | 3 | ~~Every workstream emits spans~~. See `docs/observability.md`. |
| D2 | ~~**Gate-pass-rate dashboards**~~ ✅ landed (Unreleased) | 4 | 2 | `scripts/dashboard.js` aggregates pipeline/gates/ across one or more projects. Per-stage / per-host / per-role / per-status grouping. Markdown report with ASCII bar chart or `--json` for tooling. `--from p1,p2,...` for multi-project, `--since YYYY-MM-DD` for time-windowed views. Expands merged stage gates into workstream rows so host/role attribution is correct. |
| D3 | ~~**Lessons-learned across projects (org-shared)**~~ ✅ landed (Unreleased) | 5 | 4 | Org-shared memory store rooted at `~/.stagecraft/memory/` (overridable via `STAGECRAFT_ORG_MEMORY_DIR`). New `core/memory/index.js` exports `promote`, `queryOrg`, `statsOrg`, `clearOrg`. CLI: `devteam memory promote [<kinds...>]` (default `adr` + `lessons-learned`), `devteam memory query --org`, `devteam memory stats --org`, `devteam memory clear --org`. Org records carry `project_cwd` attribution so query results name their source project. Idempotent promote (re-promoting doesn't duplicate). Embedder-mismatch guard refuses to mix vectors from different models. Foundation for G8. |
| D4 | ~~**Per-role per-model performance scores**~~ ✅ landed (Unreleased) | 5 | 3 | `scripts/performance.js` (`npm run performance`). For each (role, host) pair: total_dispatches, pass_first_try, pass_rate_first_try, mean_retries_to_pass, total_cost_usd, mean_cost_usd, cost_per_pass_usd, mean_duration_ms, distinct models seen. Multi-project rollup via `--from p1,p2,...`. Markdown table + JSON. Headlines pairwise comparisons when 2+ hosts are seen for a role. Drives D5. |
| D5 | ~~**Adaptive routing**~~ ✅ landed (Unreleased) | 5 | 3 | `scripts/routing-suggest.js` (`npm run routing:suggest`). Reads D4 scores, compares against current `.devteam/config.yml` routing, proposes role-level swaps. Minimum dispatch threshold (5 default, `--min-dispatches`) + minimum pass-rate delta (10pp default, `--min-delta`) prevent noisy recommendations. YAML-diff output by default; `--apply` rewrites the config after a confirmation prompt; `--yes` skips the prompt for CI. Honest about "insufficient data" cases — refuses to recommend below threshold. |
| D6 | ~~**Cost telemetry**~~ ✅ landed (Unreleased) | 4 | 2 | Five optional gate fields: `tokens_in`, `tokens_out`, `cost_usd`, `model`, `duration_ms`. `core/pricing.js` pricing table for Claude / GPT / Gemini families with exact + prefix-match lookup. `scripts/dashboard.js --view cost --by host\|role\|stage` (`npm run dashboard:cost`) rolls up tokens / dollars / duration. `mergeWorkstreamGates` sums per-workstream cost into stage-level totals and preserves per-workstream detail in `workstreams[]`. Adapters' renderStagePrompt asks agents to fill in the cost fields when measurable. Foundation for D4 + D5. See `docs/cost.md`. |
| D7 | ~~**Persistent project memory (embeddings index)**~~ ✅ landed v1 (Unreleased) | 5 | 4 | Per-project semantic memory under `.devteam/memory/`. Local-default embedder (`Xenova/bge-small-en-v1.5` via `@huggingface/transformers`, ~33MB lazy download). JSON backend (git-friendly); `MemoryStore` interface ready for the sqlite-vec backend in v0.3. Indexes briefs, design specs, ADRs, retros, lessons, runbooks, accessibility/observability/security reports. CLI: `devteam memory {ingest,query,stats,clear,reindex}`. Cross-project import deferred. |

## E. Developer experience

| # | Idea | I | E | Notes |
|---|---|---|---|---|
| E1 | **`devteam status` rich CLI output** | 3 | 1 | One screen showing where the current pipeline is, what gates passed, what's next. Already half-built via `next`. |
| E2 | ~~**Web UI for pipeline runs**~~ ✅ landed (Unreleased) | 4 | 4 | `devteam ui` starts a local HTTP server on http://127.0.0.1:3737/. Single-page UI shows pipeline state, per-workstream rows, gate detail on click. Live updates via SSE backed by `fs.watch` on `pipeline/gates/`. Zero build step (vanilla HTML/CSS/JS); zero new deps. `--open` launches the browser; `--port N` overrides. |
| E3 | **VS Code extension** | 3 | 3 | Sidebar with stage status, "run next stage" button, gate viewer. |
| E4 | **Live streaming output** | 3 | 2 | Currently `--headless` waits for the host CLI to finish. Stream the LLM's output to the user's terminal as it happens. |
| E5 | **Pre-flight check** (`devteam doctor`) | 3 | 1 | Verifies devteam install + each declared host is reachable + roles/rules/skills laid down correctly. Catches misconfig before it bites mid-pipeline. |
| E6 | ~~**`devteam replay <stage-id>`**~~ ✅ landed (Unreleased) | 3 | 3 | Re-runs a recorded stage with CURRENT config, writes to `pipeline/gates/replay/<stage>.<timestamp>.json`, diffs the new gate against the original (status, blockers, cost/tokens/duration, reproducibility fields). `--dry-run` shows the plan + prompt-hash drift check without invoking the host. mtime check on the gate file distinguishes "host wrote a new gate" from "host exited 0 but did nothing." Pairs with C4 — the drift surface is what makes "would replay match?" auditable. Per-invocation param overrides (model_version / temperature / seed) at the host CLI level remain a C4 follow-up. |
| E7 | **`/goal` integration for convergence-shaped stages** | 3 | 2 | Claude Code (v2.1.139+) and Codex both ship a `/goal <condition>` slash command — a session-level objective the host loops on until a Haiku-evaluator hook says the condition holds. Orthogonal to Stagecraft's decomposition primitive (`--feature` → 17 stages), but useful inside convergence-shaped stages where "done" is a condition, not an artifact: stage-04 build (`tests pass and lint clean`), stage-06 QA (`all_acceptance_criteria_met: true`). Implementation: add a `capabilities.goalLoop: true` flag to the claude-code adapter; have `runStageHeadless()` emit a `/goal "<condition derived from stage's gate schema>"` invocation before kicking off the work; read the gate when the host clears the goal. Opt-in per stage via a `goalCondition` field in `stages.js`. Trades multiple framework-driven retries for one host-driven loop; potentially cheaper, definitely faster on convergence stages. Not yet built. Validated by the comparative analysis: BMAD-METHOD's conversational mode is empirically the right shape for upstream stages where Q&A refinement beats prompt-render. |
| E9 | **Conversational stage mode** `[cmp-E-4]` | 3 | 3 | `devteam stage requirements --interactive` opens a chat with the PM subagent — refines the brief through Q&A before producing the artifact. From BMAD's Party Mode. Most accessible for non-engineers; useful specifically for upstream stages (requirements, design, clarification) where the artifact benefits from refinement before being rendered. Architecture supports it (adapters could expose streaming-conversation alongside one-shot render). Worth doing if user feedback says the gate-driven loop is too cold for upstream stages. Related to E7 but different mechanism (E7 is host-loops-until-condition; E9 is operator-converses-with-agent). |
| E8 | ~~**Codebase audit feature**~~ ✅ landed (Unreleased) | 5 | 3 | Read-only end-to-end analysis pass with prioritized roadmap output. New `skills/audit/SKILL.md` defines 4 phases (Bootstrap → Health Assessment → Deep Analysis → Roadmap) with 11 output files in `docs/audit/00-project-context.md` through `docs/audit/10-roadmap.md`. New `roles/auditor.md` (read-only by design). New `/audit` and `/audit-quick` slash commands in the claude-code host install. Non-Claude-Code hosts get the skill rendered into `.codex/skills/audit/` and `.gemini/skills/audit/`. Phase outputs are consumed by the `implement` skill for downstream work. Resume via `docs/audit/status.json`. Monorepo-aware. Extensible via `docs/audit-extensions.md` for project-specific checks (compliance frameworks, etc.). 11 phase templates in `templates/audit/` as framework-side reference. |

## F. Integrations — where the team plugs in

| # | Idea | I | E | Notes |
|---|---|---|---|---|
| F1 | ~~**GitHub PR integration**~~ ✅ landed (Unreleased) | 4 | 3 | `scripts/pr-publish.js` uses `gh` CLI to post pipeline state. Two modes: `body` (replace PR description with pr-pack output) and `checks` (post each gate as a GitHub check run on the PR head — PASS→success, WARN→neutral, FAIL/ESCALATE→failure). Auto-detects repo + PR from current branch; `--dry-run` for previewing without API calls. |
| F2 | **Jira/Linear ticket integration** | 3 | 2 | `devteam stage requirements --ticket FOO-123` pulls the ticket as the feature brief input. Gates link back to the ticket. |
| F3 | **Slack/Discord notifications** | 3 | 1 | Pipeline events (stage start, fail, escalate) post to a channel. Triggers for human checkpoints. |
| F4 | ~~**CI runner integration**~~ ✅ landed (Unreleased, GitHub Actions only) | 4 | 3 | The shape this landed in: a reusable workflow template (`templates/ci/github-actions/stagecraft-pr-checks.yml`) that **validates + publishes** existing gate JSON on PRs rather than running the pipeline itself. Why: running an LLM pipeline on every PR is expensive + human-in-the-loop by design; surfacing gates produced by local runs as GitHub check runs is the genuinely useful integration. The workflow: checks out the target + Stagecraft (pinned via env vars), validates pipeline/gates/ with Stagecraft's validator, posts each gate as a check run via pr-publish.js, runs `devteam reproduce` as an advisory drift check, and skips cleanly when the PR doesn't touch pipeline/. New `devteam ci install [--ci github-actions] [--out <dir>] [--force]` drops the template into the target's .github/workflows/. `devteam ci show` previews. 12 tests in `tests/ci.test.js`. GitLab CI / Buildkite / CircleCI templates are deferred — the Stagecraft side is CI-agnostic; only the template files need writing. See `docs/ci.md`. |
| F5 | **Pre-commit hook integration** | 3 | 1 | Optional pre-commit hook that runs the relevant track for the change (nano if config-only, full if otherwise). |

## G. Innovation bets — speculative, future-oriented

These don't fit neatly in impact/effort because their value depends on bets about how the field will evolve. They are the things that would meaningfully differentiate this tool from "just another AI dev pipeline."

### G1. Multi-model peer review ✅ landed (Unreleased)
For high-stakes changes (auth, payments, IaC), peer-review runs **in parallel** across three different model families. Each reviewer applies the same four-principles rubric — the diversity is execution-diversity (different training data, different blind spots), not method-diversity. Pessimistic merge: any FAIL anywhere blocks the stage. The diversity of model architectures catches things single-family review misses. (Method diversity — a different role applying a different methodology — is what stage-04c red-team is for.)

### G2. Closed-loop acceptance criteria → exec spec → tests ✅ landed (Unreleased)
PM writes numbered acceptance criteria (`AC-N`) in `pipeline/brief.md`. A new stage `stage-03b` (executable-spec) translates each into one Gherkin scenario in `pipeline/spec.feature`, tagged `@AC-N`. QA's stage-06 then maps each scenario 1:1 to a test in the report. The chain — brief → spec → tests — is drift-checked by `devteam spec verify` (CLI), and structurally enforced by the stage-03b gate (`drift`, `all_criteria_mapped` fields) plus the extended stage-06 gate (`scenarios_total`, `scenarios_covered`, `all_scenarios_have_tests`). New `core/spec/gherkin.js` parser + `core/spec/verify.js` drift detector; `devteam spec generate` scaffolds the .feature file from the brief (one tagged Scenario per AC with TODO Given/When/Then placeholders). New duty on the `pm` role (no new role needed — the PM that wrote ACs is the right brain to translate them); new `skills/spec-authoring/SKILL.md` walks the five-phase procedure with Given/When/Then guidance. Track inclusion: `full` + `quick` (the tracks with a requirements stage); skipped on `hotfix`/`nano`/`config-only`/`dep-update`. Drift types caught: orphan ACs, orphan scenarios, duplicate AC numbers, unknown AC refs in tests. `--strict` mode also fails when one AC is mapped by multiple scenarios.

### G3. Production feedback loop
Post-deploy, monitor error rate / latency / conversion for N days. Synthesize observations back into the brief for the next iteration. The retrospective stage no longer asks "what did we learn building it?" — it asks "what happened in prod?"

### G4. Red-team role between build and peer-review ✅ landed (Unreleased)
A dedicated `red-team` role and `stage-04c`. Walks 10 attack surfaces (input boundaries, state, sequence, integrations, auth-edges, resource exhaustion, failure modes mid-operation, abuse cases, downstream effects, observability gaps) and produces concrete reproducers — not vibes. Triages findings by severity × likelihood × scope; the `must_address_before_peer_review` array is the gate's `blockers`, blocking Stage 5 until cleared. Always-on for `full` + `hotfix` tracks; skipped on lighter tracks. New skill `skills/red-team/SKILL.md` carries the methodology. Schema `core/gates/schemas/stage-04c.schema.json` enforces the gate shape. ROLE_FRONTMATTER entry on claude-code; codex / gemini-cli / generic pick the role up automatically via `core/roles.listRoles()`. Diversity-aware: the role brief and skill recommend routing red-team to a DIFFERENT host than the build agents for maximum independence.

### G5. Multi-modal stages
Design specs include architecture diagrams (images). Stage 2 (design) and Stage 5 (review) accept image inputs. Principal can output a system diagram, not just prose. Visual reasoning is no longer a separate workflow.

### G6. Stage shopping (AI-inferred tracks) `[cmp-E-3]`
User describes change → orchestrator picks a stage list. Doesn't have to be one of 6 hardcoded tracks; can be bespoke: "skip clarification, double up security, add accessibility audit." Tracks become inferred per change. **Cross-confirmed by the comparative analysis** — AI-DLC's dynamic pathway selection and BMAD's scale-adaptive depth both validate this as the 2026 direction. Implementation shape: new `stage-00 complexity-assessment` that runs before the operator's chosen track, optionally overriding it with a computed pathway. Inputs: change description, files touched, security-heuristic matches, migration-heuristic matches, prior pipeline performance for similar shapes. Output: a custom stage list that becomes the run's effective track.

### G7. Verification beyond tests ✅ landed (Unreleased)
New `verification-beyond-tests` stage (stage-06d, full-track-only) that runs AFTER stage-06 (qa) PASS. New `verifier` role applies property-based testing (fast-check / hypothesis / proptest), mutation testing (stryker / mutmut / mull), and/or formal verification (TLA+ / Alloy / Lean) to the changed code. Read-only on production code; writes property tests under `src/tests/property/` and formal specs under `pipeline/formal/`. Gate (`core/gates/schemas/stage-06d.schema.json`) records `methods_attempted[]` (enum: property/mutation/formal/attempted_but_blocked:*), `methods_skipped[{method, reason}]` (reason required, minLength: 1 — "didn't have time" is not a legitimate skip), per-method stats (`property_based` / `mutation` / `formal` objects), `findings_count`, `blocking_findings[]`, `non_blocking_findings[]`. A surviving mutant on a critical path, a property counterexample to a stated invariant, or a formal counterexample to a safety property populates `blocking_findings[]` → stage FAIL → implementer addresses → re-run (analogous to red-team's `must_address_before_peer_review[]`). New `skills/verification-beyond-tests/SKILL.md` walks five phases (inventory candidates → pick methods → apply → triage → write report+gate) with a code-shape → method selection table and the property-shape vocabulary (round-trip / idempotence / commutativity / associativity / monotonicity / invariant preservation / reference-implementation / oracle). New `templates/verification-report-template.md` with sections per method + skipped + triage + recommendations. ROLE_FRONTMATTER entry on claude-code; codex / gemini-cli / generic auto-discover via `core/roles.listRoles()`. The skill is explicit about not faking runs (tool not installed → `attempted_but_blocked` with the install hint), the audit-grade move of pre-declaring a mutation kill-ratio threshold before running, and known failure modes (tautological properties, 100% mutation score = suspicious, counterexample dismissal = how incidents start). Track inclusion: `full` only (heavy methods belong on the track that opted into rigour-over-speed); other tracks rely on stage-06 as their floor.

### G8. Long-context architecture continuity ✅ landed (Unreleased)
Operationalizes the "the architect always remembers" bet on top of D3. Principal role brief instructs querying `devteam memory query --org --kind adr "<topic>"` (or `devteam architecture lookup`) BEFORE drafting a design. Prior ADRs become binding commitments — either honored (cited in the new spec's "Prior commitments considered" section) or **explicitly superseded** via a new ADR with a `Supersedes:` field + rationale. Silent disagreement with prior ADRs is forbidden by the role brief. Design stage's gate gains `adrs_consulted` and `adrs_superseded` arrays (optional) capturing the audit trail. ADR template gains a `Supersedes:` field + a "Prior commitments considered" section that records what was queried (even an empty result is recordable). New `devteam architecture lookup "<topic>"` subcommand — friendlier wrapper around the org-memory ADR query, name-matched to the role brief's instruction. The architecture-continuity story now has measurement (gate fields), enforcement (role brief), and a low-friction tool (the lookup subcommand).

### G9. Self-modifying pipeline
Retrospective stage proposes changes to `stages.js` / `roles/` / `rules/` based on what worked. Proposals queue for human approval. The pipeline learns its own shape from operation.

### G10. Tool-depth-first agents
Agents that compose deeper tool stacks beat ones that just write code. Roles gain explicit tool budgets — Principal may grep the entire org's codebase, Backend may query the staging DB read-only, Platform may run `kubectl --dry-run`. Each role's tool surface is part of the contract.

---

## Priority queue (2026-06-03 — post comparative analysis)

The prior Top-10 has all landed (preserved in the git log of this file). Re-prioritized after cross-referencing the comparative analysis ([`comparative-analysis.md`](comparative-analysis.md)) and the between-cycle observations in [`audit-archive/HISTORY.md`](audit-archive/HISTORY.md). Items where two independent sources converge get higher priority.

### Top-tier — next ~30 days, ~3-5 PRs

By impact ÷ effort, with bias toward (a) items where multiple sources converge, and (b) items whose cost grows with delay:

1. ~~**B8 — Cross-artifact consistency analyze**~~ ✅ landed. `devteam consistency analyze` is live; three drift classes covered; `--json` flag and non-zero exit code for CI.
2. **C7 — `eslint-plugin-security`** `[hist-a]` (3 / 1). Trivial effort, empirically justified by 3 CodeQL alerts in one week. Validates the "add it next time" promise from PR 2.1. **Start here.**
3. **C5 — Capability-required permissions** (3 / 2). Multi-host routing has been shipped; this is the piece that makes it safe by construction. Old BACKLOG item, *more* relevant now than when first written.
4. **E7 — `/goal` integration** (3 / 2). Convergence-shaped stages (build, QA) are exactly where host-driven loops beat framework-driven retries. BMAD's conversational refinement gives empirical cover.
5. **C3 — License compatibility gate** (3 / 1). Smallest unfinished item in the C bucket. Half-present in pre-review's SCA; make it explicit.

### Mid-tier — next quarter, ~5-8 PRs

6. **B9 — Bounded workspace deltas** `[cmp-E-2]` (4 / 3). Structural fix for concurrent-feature context bleed. Retrofitting later is harder than building it now.
7. **C1 — Filesystem-level `allowedWrites` enforcement** (4 / 4). "Honour system" risk in multi-host runs. Container/overlay-based enforcement. Single-focused-week budget.
8. **G6 — Stage shopping (AI-inferred tracks)** `[cmp-E-3]` (4-5 / 4). Two sources converge on adaptive pathways. Build *after* B8 (which gives the artifact graph the analyzer needs).
9. **B10 — Discover Standards preprocessing** `[cmp-E-5]` (3 / 3). Brownfield-project win. Do when Stagecraft gets adopted on a legacy codebase that surfaces the pain.
10. **B2 — Performance budget stage** (4 / 3). Natural pair to accessibility-audit; slots into existing post-build stage shape.

### Strategic bets — year horizon (start, don't delay)

11. **G3 — Production feedback loop**. Closes the dev→prod loop. Requires deploy adapter maturity first.
12. **D5 maturation — continuous adaptive routing**. Today D5 proposes role-level swaps; the mature form re-routes the *next* run based on the prior run's outcomes automatically.
13. **G10 — Tool-depth-first agents**. Role tool budgets — Principal greps the org codebase, Backend queries staging DB read-only, Platform runs `kubectl --dry-run`. Where Stagecraft's role briefs gain real teeth.

### Consciously deprioritized

Five items where the comparative analysis or shifted ground says *don't* invest now:

- **E3 — VS Code extension.** AWS Kiro is going to eat this category. Stagecraft sits above the IDE, not inside it; building an editor extension fights its position.
- **A2 — Cursor/Windsurf/Aider/Cline adapters.** Spec Kit supports 30+ AI agents — that's a treadmill. Better to land **A4 — Pluggable adapter discovery** first and let the long tail be community-built.
- **B6 — Documentation gate.** Mechanically useful but adds operational friction for trivial reward. Defer indefinitely or "do later if a real incident demands."
- **F2 / F3 / F5 — Jira / Slack / pre-commit integration.** Bolt-ons. None changes what Stagecraft can *do*; nice-to-have surface area. Accept community PRs but don't invest core time.
- **G9 — Self-modifying pipeline.** Premature. Wait until 3+ distinct teams use the platform in different shapes before optimizing for any one signal.

---

## Staying ahead of the curve — bets

Six bets about where software development is going, and how this project should position against them.

### 1. Models keep getting smarter, cheaper, faster.
Don't optimize for today's model limits. Design the contract assuming 10× capability in 2 years. The schema (gate JSON), the seam (per-workstream gates merged to stage), and the routing layer should outlive the specific models we route to.

### 2. Diversity beats monoculture.
Single-model agentic systems are giving way to multi-model coordinated systems. The right answer for any non-trivial task involves 2–3 different model families. Our routing layer is already built for this; the next step is *making diversity load-bearing* (G1 multi-model peer review, D4/D5 adaptive routing).

### 3. Evals are the rate-limit.
You can't ship what you can't measure. The pipeline produces structured gate JSON precisely so we can build evals on top. Every refinement should make the gate richer / more measurable. D1/D2/D4 are all expressions of this bet.

### 4. Memory + persistence is the next frontier.
Today's pipeline is mostly stateless within a run; each new run starts fresh. The teams of 2027 will have long-running coordination across projects, learning continuously. D3/D7/G8 are how we get there. (We're currently at the equivalent of stateless web in 1998 — every team will rediscover sessions, then storage, then learned weights.)

### 5. Tool depth beats raw intelligence.
A medium-smart agent with a deep, well-composed tool stack beats a brilliant agent that only writes text. The role briefs are the place to encode tool budgets per role (G10). Skills are early steps toward this; tool *negotiation* is the mature form.

### 6. Compliance and auditability are coming, fast.
EU AI Act, US executive orders, SOC 2 controls — everything wants reproducible runs, audit trails, who-decided-what. C4 (reproducible runs), C6 (tamper-evident gate chain), and D1 (tracing) are the work to be ready when this hits hard.

### The unit is the team, not the model.
The wager underneath all of this: a coordinated team of specialized agents — each with a role, a tool budget, a gate contract, and shared memory — outperforms a single brilliant model. The model is a substrate. The team is the product. Stagecraft is a bet on that shape.
