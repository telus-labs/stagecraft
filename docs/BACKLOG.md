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
| D3 | **Lessons-learned across projects (org-shared)** | 5 | 4 | The `pipeline/lessons-learned.md` from each project flows to a shared pool. Future runs in other projects can pull relevant lessons by embedding similarity. Network effect. |
| D4 | **Per-role per-model performance scores** | 5 | 3 | Track which (role, host) combinations produce gates that pass first-try most often. Surfaces "Codex is better than Claude at backend; Claude is better at design." Drives D5. |
| D5 | **Adaptive routing** | 5 | 3 | Routing config auto-updates from D4 telemetry. The system learns which model is best at which role. (Builds on D4.) |
| D6 | **Cost telemetry** | 4 | 2 | Per-run cost breakdown by stage, by host. Pairs with D2/D5 to optimize the cost-per-shipped-feature ratio. |
| D7 | **Persistent project memory (embeddings index)** | 5 | 4 | Beyond lessons-learned: index every brief, design-spec, ADR, retrospective into a vector store. Future PM can pull "similar past briefs"; future Principal can pull "similar past ADRs." |

## E. Developer experience

| # | Idea | I | E | Notes |
|---|---|---|---|---|
| E1 | **`devteam status` rich CLI output** | 3 | 1 | One screen showing where the current pipeline is, what gates passed, what's next. Already half-built via `next`. |
| E2 | **Web UI for pipeline runs** | 4 | 4 | Local server (`devteam ui`) showing live progress, gate contents, role briefs. Single biggest accessibility win for non-CLI users. |
| E3 | **VS Code extension** | 3 | 3 | Sidebar with stage status, "run next stage" button, gate viewer. |
| E4 | **Live streaming output** | 3 | 2 | Currently `--headless` waits for the host CLI to finish. Stream the LLM's output to the user's terminal as it happens. |
| E5 | **Pre-flight check** (`devteam doctor`) | 3 | 1 | Verifies devteam install + each declared host is reachable + roles/rules/skills laid down correctly. Catches misconfig before it bites mid-pipeline. |
| E6 | **`devteam replay <run-id>`** | 3 | 3 | Re-run a past pipeline run from its gate artifacts. Useful for debugging, demos, and (with D1's traces) deterministic reproductions. |

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

### G1. Multi-model adversarial review
For high-stakes changes (auth, payments, IaC), peer-review runs **in parallel** across three different model families, each asked to find the strongest objection. A synthesis pass resolves disagreements. The diversity of model architectures catches things single-family review misses.

### G2. Closed-loop acceptance criteria → exec spec → tests
PM writes natural-language criteria. The orchestrator generates an executable spec (Gherkin or similar). QA generates tests from the spec. All three artifacts are co-generated and versioned together — drift is structurally impossible.

### G3. Production feedback loop
Post-deploy, monitor error rate / latency / conversion for N days. Synthesize observations back into the brief for the next iteration. The retrospective stage no longer asks "what did we learn building it?" — it asks "what happened in prod?"

### G4. Red-team role between build and peer-review
A dedicated subagent whose job is to break what was just built. Inputs: the spec + the impl + sandbox access. Outputs: attack scenarios the spec didn't cover. Backend must address before peer-review. Adversarial-by-design.

### G5. Multi-modal stages
Design specs include architecture diagrams (images). Stage 2 (design) and Stage 5 (review) accept image inputs. Principal can output a system diagram, not just prose. Visual reasoning is no longer a separate workflow.

### G6. Stage shopping (AI-inferred tracks)
User describes change → orchestrator picks a stage list. Doesn't have to be one of 6 hardcoded tracks; can be bespoke: "skip clarification, double up security, add accessibility audit." Tracks become inferred per change.

### G7. Verification beyond tests
Stage 6 can run property-based testing (Hypothesis), mutation testing (Stryker), or formal verification (TLA+, Lean) as sub-stages. Gate carries which methods were applied. "Tests pass" becomes a floor, not a ceiling.

### G8. Long-context architecture continuity
Principal session has access to the full history of past ADRs across all projects in an org. New design decisions are constrained by prior commitments unless explicitly superseded. The architecture doesn't drift because the architect always remembers.

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
8. **E2 — Web UI for pipeline runs** (4 / 4) — accessibility win for non-CLI users; broadens audience.
9. **D7 — Persistent project memory (embeddings)** (5 / 4) — enables continuity across runs; foundation for G8.
10. **G1 — Multi-model adversarial review** (5 / 3) — one of the few items that is *qualitatively* better than what a single team can do.

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
The wager underneath all of this: a coordinated team of specialized agents — each with a role, a tool budget, a gate contract, and shared memory — outperforms a single brilliant model. The model is a substrate. The team is the product. ai-dev-team is a bet on that shape.
