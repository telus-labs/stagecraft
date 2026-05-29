# Backlog

A living list of work beyond the initial migration. Organized into seven buckets, each item carrying a rough impact (1–5) and effort (1–5) score so we can pick by ratio.

**How to read the scores.** Impact 5 = changes what users can do, not just how. Effort 5 = multi-week, touches several components, needs experimentation. Priority isn't strictly impact÷effort — high-impact items are often worth doing even when expensive — but the ratio is a useful first filter.

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
| B5 | **Migration safety stage** (if data layer touched) | 5 | 3 | Conditional like security-review. Backfill plan, dual-write strategy, rollback path. |
| B6 | **Documentation gate** | 3 | 2 | Public API changed → README/CHANGELOG must reflect it. Mechanical but catches a common drift. |
| B7 | **Multi-language QA** | 4 | 4 | Stage 6 currently assumes one test framework. Real projects have JS + Python + Go. Per-language test runners with a merged report. |

## C. Quality & safety — enforcement, sandboxing, scanning

| # | Idea | I | E | Notes |
|---|---|---|---|---|
| C1 | **Filesystem-level `allowedWrites` enforcement** | 4 | 4 | Run each workstream in a sandboxed FS (overlay, chroot, container) where writes outside the allowlist literally cannot happen. Removes "honour system" risk. |
| C2 | ~~**Secret scanning hook**~~ ✅ landed (Unreleased) | 4 | 1 | ~~Blocks the write if a secret is detected.~~ Built-in regex patterns for AWS / GitHub / Anthropic / OpenAI / Google / Slack / Stripe / private keys / JWTs / postgres URLs. Path allowlist for `.env.example`, `docs/`, `examples/`, tests. Magic-comment override (`devteam-allow-secret:`) for verified false positives. Wired into claude-code's PreToolUse `Write|Edit`. |
| C3 | **License compatibility gate** | 3 | 1 | Already half-present in pre-review's SCA. Make it explicit and per-license, not just "high/critical found". |
| C4 | **Reproducible runs** | 4 | 4 | Pin model versions per-stage; record temperature, seed, system prompt hashes in the gate. Replay-able pipeline runs. Becomes critical for audits. |
| C5 | **Capability-required permissions** | 3 | 2 | Adapter declares `enforces.network`, `enforces.shell`, etc. Orchestrator refuses to run a stage that needs network if the routed host denies network access. |
| C6 | **Tamper-evident gate chain** | 3 | 3 | Each gate carries a hash of its prerequisites. Mutating an old gate breaks the chain. Audit-friendly. |

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
| E6 | **`devteam replay <run-id>`** | 3 | 3 | Re-run a past pipeline run from its gate artifacts. Useful for debugging, demos, and (with D1's traces) deterministic reproductions. |
| E7 | **`/goal` integration for convergence-shaped stages** | 3 | 2 | Claude Code (v2.1.139+) and Codex both ship a `/goal <condition>` slash command — a session-level objective the host loops on until a Haiku-evaluator hook says the condition holds. Orthogonal to Stagecraft's decomposition primitive (`--feature` → 13 stages), but useful inside convergence-shaped stages where "done" is a condition, not an artifact: stage-04 build (`tests pass and lint clean`), stage-06 QA (`all_acceptance_criteria_met: true`). Implementation: add a `capabilities.goalLoop: true` flag to the claude-code adapter; have `runStageHeadless()` emit a `/goal "<condition derived from stage's gate schema>"` invocation before kicking off the work; read the gate when the host clears the goal. Opt-in per stage via a `goalCondition` field in `stages.js`. Trades multiple framework-driven retries for one host-driven loop; potentially cheaper, definitely faster on convergence stages. Not yet built. |
| E8 | ~~**Codebase audit feature**~~ ✅ landed (Unreleased) | 5 | 3 | Read-only end-to-end analysis pass with prioritized roadmap output. New `skills/audit/SKILL.md` defines 4 phases (Bootstrap → Health Assessment → Deep Analysis → Roadmap) with 11 output files in `docs/audit/00-project-context.md` through `docs/audit/10-roadmap.md`. New `roles/auditor.md` (read-only by design). New `/audit` and `/audit-quick` slash commands in the claude-code host install. Non-Claude-Code hosts get the skill rendered into `.codex/skills/audit/` and `.gemini/skills/audit/`. Phase outputs are consumed by the `implement` skill for downstream work. Resume via `docs/audit/status.json`. Monorepo-aware. Extensible via `docs/audit-extensions.md` for project-specific checks (compliance frameworks, etc.). 11 phase templates in `templates/audit/` as framework-side reference. |

## F. Integrations — where the team plugs in

| # | Idea | I | E | Notes |
|---|---|---|---|---|
| F1 | ~~**GitHub PR integration**~~ ✅ landed (Unreleased) | 4 | 3 | `scripts/pr-publish.js` uses `gh` CLI to post pipeline state. Two modes: `body` (replace PR description with pr-pack output) and `checks` (post each gate as a GitHub check run on the PR head — PASS→success, WARN→neutral, FAIL/ESCALATE→failure). Auto-detects repo + PR from current branch; `--dry-run` for previewing without API calls. |
| F2 | **Jira/Linear ticket integration** | 3 | 2 | `devteam stage requirements --ticket FOO-123` pulls the ticket as the feature brief input. Gates link back to the ticket. |
| F3 | **Slack/Discord notifications** | 3 | 1 | Pipeline events (stage start, fail, escalate) post to a channel. Triggers for human checkpoints. |
| F4 | **CI runner integration** | 4 | 3 | GitHub Actions / GitLab CI jobs that run a stage in CI (e.g. nano track on every PR). Bring the pipeline into existing CI infra. |
| F5 | **Pre-commit hook integration** | 3 | 1 | Optional pre-commit hook that runs the relevant track for the change (nano if config-only, full if otherwise). |

## G. Innovation bets — speculative, future-oriented

These don't fit neatly in impact/effort because their value depends on bets about how the field will evolve. They are the things that would meaningfully differentiate this tool from "just another AI dev pipeline."

### G1. Multi-model adversarial review ✅ landed (Unreleased)
For high-stakes changes (auth, payments, IaC), peer-review runs **in parallel** across three different model families, each asked to find the strongest objection. A synthesis pass resolves disagreements. The diversity of model architectures catches things single-family review misses.

### G2. Closed-loop acceptance criteria → exec spec → tests
PM writes natural-language criteria. The orchestrator generates an executable spec (Gherkin or similar). QA generates tests from the spec. All three artifacts are co-generated and versioned together — drift is structurally impossible.

### G3. Production feedback loop
Post-deploy, monitor error rate / latency / conversion for N days. Synthesize observations back into the brief for the next iteration. The retrospective stage no longer asks "what did we learn building it?" — it asks "what happened in prod?"

### G4. Red-team role between build and peer-review ✅ landed (Unreleased)
A dedicated `red-team` role and `stage-04c`. Walks 10 attack surfaces (input boundaries, state, sequence, integrations, auth-edges, resource exhaustion, failure modes mid-operation, abuse cases, downstream effects, observability gaps) and produces concrete reproducers — not vibes. Triages findings by severity × likelihood × scope; the `must_address_before_peer_review` array is the gate's `blockers`, blocking Stage 5 until cleared. Always-on for `full` + `hotfix` tracks; skipped on lighter tracks. New skill `skills/red-team/SKILL.md` carries the methodology. Schema `core/gates/schemas/stage-04c.schema.json` enforces the gate shape. ROLE_FRONTMATTER entry on claude-code; codex / gemini-cli / generic pick the role up automatically via `core/roles.listRoles()`. Diversity-aware: the role brief and skill recommend routing red-team to a DIFFERENT host than the build agents for maximum independence.

### G5. Multi-modal stages
Design specs include architecture diagrams (images). Stage 2 (design) and Stage 5 (review) accept image inputs. Principal can output a system diagram, not just prose. Visual reasoning is no longer a separate workflow.

### G6. Stage shopping (AI-inferred tracks)
User describes change → orchestrator picks a stage list. Doesn't have to be one of 6 hardcoded tracks; can be bespoke: "skip clarification, double up security, add accessibility audit." Tracks become inferred per change.

### G7. Verification beyond tests
Stage 6 can run property-based testing (Hypothesis), mutation testing (Stryker), or formal verification (TLA+, Lean) as sub-stages. Gate carries which methods were applied. "Tests pass" becomes a floor, not a ceiling.

### G8. Long-context architecture continuity ✅ landed (Unreleased)
Operationalizes the "the architect always remembers" bet on top of D3. Principal role brief instructs querying `devteam memory query --org --kind adr "<topic>"` (or `devteam architecture lookup`) BEFORE drafting a design. Prior ADRs become binding commitments — either honored (cited in the new spec's "Prior commitments considered" section) or **explicitly superseded** via a new ADR with a `Supersedes:` field + rationale. Silent disagreement with prior ADRs is forbidden by the role brief. Design stage's gate gains `adrs_consulted` and `adrs_superseded` arrays (optional) capturing the audit trail. ADR template gains a `Supersedes:` field + a "Prior commitments considered" section that records what was queried (even an empty result is recordable). New `devteam architecture lookup "<topic>"` subcommand — friendlier wrapper around the org-memory ADR query, name-matched to the role brief's instruction. The architecture-continuity story now has measurement (gate fields), enforcement (role brief), and a low-friction tool (the lookup subcommand).

### G9. Self-modifying pipeline
Retrospective stage proposes changes to `stages.js` / `roles/` / `rules/` based on what worked. Proposals queue for human approval. The pipeline learns its own shape from operation.

### G10. Tool-depth-first agents
Agents that compose deeper tool stacks beat ones that just write code. Roles gain explicit tool budgets — Principal may grep the entire org's codebase, Backend may query the staging DB read-only, Platform may run `kubectl --dry-run`. Each role's tool surface is part of the contract.

---

## Top-10 priority queue (cross-bucket)

By impact/effort ratio, with bias toward high-impact even when expensive:

1. ~~**D1 — OpenTelemetry tracing per stage** (5 / 3)~~ — ✅ landed (Unreleased).
2. ~~**C2 — Secret scanning hook** (4 / 1)~~ — ✅ landed (Unreleased).
3. ~~**A1 — Gemini CLI adapter** (4 / 2)~~ — ✅ landed (Unreleased).
4. ~~**B1 — Accessibility audit stage** (4 / 2)~~ — ✅ landed (Unreleased).
5. ~~**B4 — Observability gate** (4 / 2)~~ — ✅ landed (Unreleased).
6. ~~**D2 — Gate-pass-rate dashboards** (4 / 2)~~ — ✅ landed (Unreleased).
7. ~~**F1 — GitHub PR integration** (4 / 3)~~ — ✅ landed (Unreleased).
8. ~~**E2 — Web UI for pipeline runs** (4 / 4)~~ — ✅ landed (Unreleased).
9. ~~**D7 — Persistent project memory (embeddings)** (5 / 4)~~ — ✅ landed v1 (Unreleased).
10. ~~**G1 — Multi-model adversarial review** (5 / 3)~~ — ✅ landed (Unreleased).

---

## Staying ahead of the curve — bets

Six bets about where software development is going, and how this project should position against them.

### 1. Models keep getting smarter, cheaper, faster.
Don't optimize for today's model limits. Design the contract assuming 10× capability in 2 years. The schema (gate JSON), the seam (per-workstream gates merged to stage), and the routing layer should outlive the specific models we route to.

### 2. Diversity beats monoculture.
Single-model agentic systems are giving way to multi-model coordinated systems. The right answer for any non-trivial task involves 2–3 different model families. Our routing layer is already built for this; the next step is *making diversity load-bearing* (G1 adversarial review, D4/D5 adaptive routing).

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
