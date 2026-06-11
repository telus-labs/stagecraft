# Stagecraft vs adjacent AI-assisted-engineering control planes — 2026

**Date:** 2026-06-07 *(updated from original 2026-06-03 — see §7 for change log)*
**Comparators:** BMAD-METHOD, GitHub Spec Kit, Agent OS, OpenSpec, AWS Kiro, AI-DLC. Stagecraft is the comparison target.
**Focus:** process orchestration, spec-driven development, and automated gating.

This document is a synthesis of two independently-written comparative analyses plus a 2026-06-07 refresh. The original analyses agreed on the strongest framing of the space (four "schools of thought") and on Stagecraft's three distinctive claims. They diverged on framework coverage and evolution opportunities; the synthesis carries forward the best of each, with concrete file references where verifiable. The 2026-06-07 refresh updates the Stagecraft deep-dive and the evolution-opportunities section to reflect features shipped in the four days since the original analysis.

---

## 1. The four schools of thought

The AI-development-framework space in 2026 has cleaved into four operational paradigms. Treating these as direct alternatives to each other mis-shapes the analysis — they optimize for different things.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              FOUR SCHOOLS                               │
└─────────────────────────────────────────────────────────────────────────┘
   ├─► 1. Process & Gate Orchestrators        [ Stagecraft, AI-DLC ]
   │      Sequential phases with system-verified status gates.
   │      The orchestrator is the source of truth, not the chat.
   │
   ├─► 2. Spec-Driven & Executable Blueprints [ GitHub Spec Kit, OpenSpec ]
   │      Specification is the long-lived executable asset.
   │      Code is a derivative artifact, regenerated as the spec evolves.
   │
   ├─► 3. Agile & Persona Cooperatives        [ BMAD-METHOD ]
   │      Role-isolate AI agents to prevent context drift and token rot.
   │      Conversational scaffolding across PM / Architect / Dev / UX personas.
   │
   └─► 4. Context & Convention Extraction     [ Agent OS, AWS Kiro ]
          Descriptive analysis of existing codebase patterns,
          injected into the agent's working context.
```

Frameworks straddle schools. BMAD has spec-driven elements; Kiro has gate-like Agent Hooks; Stagecraft has a spec-feature stage (3b). The taxonomy is for orientation, not labelling.

### A complementary lens — the layered stack

The schools-of-thought view sorts frameworks by *operational philosophy*. A complementary view sorts them by *functional layer in the overall AI-engineering stack* — five distinct concerns that production AI-assisted teams eventually need to address:

```
  Layer 5  Deployment Runtime          ─ where does the agent's output run?
  Layer 4  Context & Persona Interface ─ how does the agent think about the codebase?
  Layer 3  Spec-First Blueprinting     ─ what is the long-lived design asset?
  Layer 2  Process & Gating Control    ─ in what sequence, with what verification?
  Layer 1  Runtime Sandbox & Safety    ─ where does the agent run safely?
```

Of the seven frameworks compared here, **Stagecraft sits squarely at Layer 2** (Process & Gating Control), with BMAD and AI-DLC. Layer 3 (Spec-First Blueprinting) is occupied by Spec Kit, OpenSpec, and Kiro. Layer 4 (Context & Persona) is Agent OS's home. Layers 1 and 5 (sandbox and deployment) aren't covered by any framework in this comparison — they're real concerns but a different tool category. The composability section below explores how stacks of multiple layers compose.

---

## 2. Master comparison matrix

| Dimension | **Stagecraft** | **BMAD-METHOD** | **GitHub Spec Kit** | **Agent OS** | **OpenSpec** | **AWS Kiro** | **AI-DLC** |
|---|---|---|---|---|---|---|---|
| **School** | Process & Gate | Agile Persona | Spec-Driven | Convention Extraction | Spec-Driven (workspace-bounded) | Convention + IDE | Process & Gate (adaptive) |
| **Primary primitive** | Stage (18 stages × 6 named tracks; `devteam assess` also infers a custom track from description + file heuristics) | Agent role (12+ domain experts) | Spec → Plan → Tasks cascade | Extracted codebase standard | Spec delta in `openspec/changes/<id>/` | Steering file + Agent Hook | Adaptive pathway through 3 macro-phases |
| **Unit of "done"** | Signed-off gate JSON file | Human-approved conversational milestone | Spec passes `/speckit.analyze` consistency | Standard matches legacy code | Merged change workspace + spec delta | Hook UI passes on file save | Audit-logged operational verification |
| **What it mandates** | 18 stages, gate-status before advance, `## Verify` forcing function, per-area review matrix; `devteam assess` for track recommendation; bounded workspaces via `pipeline.isolation = "bounded"` | Role separation, scale-adaptive depth, conversational handoffs between phases | Constitution → spec → plan → tasks → implementation; cross-artifact consistency check | Codebase standards extracted + injected into context | Bounded workspace per change; `/openspec:explore` Q&A before proposal | Steering files (`product.md`, `structure.md`, `tech.md`); file-save Agent Hooks | Inception → Construction → Operations with Mob Elaboration / Mob Construction rituals |
| **Host integration** | **Multi-model dispatch.** Different stages run on different host CLIs (claude-code / codex / gemini-cli / generic) within one pipeline run | **Single-host clustering.** Cross Platform Agent Team v6+ selects one host per session | **Universal agnostic.** "30+ AI coding agents" (Claude Code, Cursor, Codex, Gemini, Copilot, Mistral Vibe…) | **Context injection.** Standards injected into prompts for Cursor / Claude Code / Antigravity / others | **Universal CLI.** Slash commands in local workspaces, host-agnostic | **Native IDE fork.** VS Code OSS fork; CLI + autonomous-agent forms; Bedrock-backed (Claude Sonnet + Nova) | **Agentic engine.** Open-sourced workflow rules (`awslabs/aidlc-workflows`); ties to Amazon Q Project Rules |
| **Output shape** | Files on disk: `pipeline/brief.md`, `design-spec.md`, `gates/*.json`, `test-report.md`, `runbook.md`, retro | Specs + role-produced artifacts; chat history as primary record | Spec markdown + generated code + tasks file | Standards files + per-agent injected context | Per-change workspace + spec delta describing ADDED/MODIFIED/REMOVED requirements | Spec + steering files + auto-generated tests; PRs from autonomous agent | Adaptive workflow logs + Mob session decisions + IaC + audit trail |
| **Architectural moat** | Schema-validated gate JSON as the sole orchestrator state; reconstructable from `pipeline/gates/` alone | Conversational scaffolding across role-isolated agents; "Party Mode" | Spec as the compiled source truth; code is the derivative | Static discovery of undocumented team conventions | Bounded workspaces protect token efficiency; spec deltas prevent global-spec churn | Real-time Agent Hooks on file events; deep AWS-ecosystem integration | Dynamic complexity scoring that selects pathways adaptively |
| **Prior art** | CI/CD, gate-stage manufacturing | Agile/Scrum, CrewAI, SDLC | TDD, design-by-contract, Spec-First | Static analysis, linters, context engineering | Git branch isolation, IaC | VS Code OSS + custom workspace hooks | Classic SDLC, DevSecOps, mob programming |
| **Maturity signal** | v0.5.0, ~23k LOC, ~1 100 tests, 12 days since first commit | 46.2k GitHub stars; v6.6.0 (April 2026); 5,400+ forks | 106k+ stars (launched mid-2025) | Concept-led; lower-profile star count | Y Combinator launch; "lightweight SDD framework" framing | Production at `kiro.dev`; AWS-announced as Amazon Q Developer's successor | Open-sourced via `awslabs/aidlc-workflows`; AWS re:Invent 2025 reveal |
| **Best for** | Teams shipping high-stakes production features needing an audit trail across multiple hosts | Solo devs / agile squads who want conversational AI scaffolding | Codebases where the spec is the long-lived asset; brownfield modernization toward a spec | Teams managing brownfield systems with strong existing conventions | Rapidly iterating developers who hit token rot on big repos | Cloud-native teams already in the AWS / Bedrock ecosystem | Enterprises requiring audited compliance + dynamic process adaptation |

---

## 3. Deep-dive per framework

### 3.1 Stagecraft (the comparison target)

Stagecraft treats software delivery as an industrial assembly line: up to 18 sequential stages, each producing an artifact and a machine-readable gate. The orchestrator (`core/orchestrator.js`) reads gates to decide what runs next; the LLM chat log is **not** the source of truth — the `pipeline/` directory is.

**The gating mechanism is non-cooperative.** For stages 04a (pre-review) and 06 (QA), the orchestrator runs the configured lint / test commands itself (`core/verify/runner.js`) and stamps the gate with what it actually observed. Field overrides — where the model's claim disagreed with the orchestrator's truth — are recorded in an `_orchestrator_stamped` audit block. The model can't talk its way past these gates.

**Multi-model dispatch.** Routing precedence is `routing.stages[stage] → routing.roles[role] → routing.default_host`. Different stages — and different roles within a multi-role stage — can land on different host CLIs in the same pipeline run. Multi-model peer review (`routing.review_fanout: [host, host, host]`) takes this further: Stage 5's 4 area workstreams duplicate across N hosts → 4×N parallel reviews; pessimistic merge across all of them. No other framework here goes this far on heterogeneous model dispatch.

**Downstream-of-build coverage.** 12 stages downstream of code generation (pre-review, security-review, red-team, migration-safety, peer-review, QA, accessibility-audit, observability-gate, verification-beyond-tests, performance-budget, sign-off, deploy, retrospective). Several have veto-capable roles (security, migrations); one is adversarial-by-design (red-team); the performance-budget stage (stage-06e, shipped 2026-06-07) adds Lighthouse Web Vitals, bundle-size delta, and load-test throughput against configured thresholds. Most spec-driven tools stop at "implementation passes tests"; Stagecraft assumes you stop at "the change has been adversarially reviewed, hardened, observability-instrumented, performance-gated, signed off, and the rollback was tested."

**Cross-artifact consistency.** `devteam consistency analyze [--strict]` (shipped 2026-06-03) checks the full pipeline chain — brief ACs → spec scenarios → `pr-*.md ## Verify` bullets → red-team `must_address` → test-report rows → gate-field reality (e.g., `stage-01.acceptance_criteria_count` vs actual AC count in brief.md). Five drift classes; any drift exits non-zero. This goes materially beyond `devteam spec verify`, which was the narrower brief↔spec↔test-report check — and beyond Spec Kit's `/speckit.analyze`, which doesn't have the gate-vs-artifact reality dimension because Spec Kit has no gate JSON.

**Bounded workspace isolation.** `pipeline.isolation = "bounded"` (shipped 2026-06-06) writes all stage artifacts under `pipeline/changes/<change-id>/` instead of the global `pipeline/`. Context for feature A doesn't leak into feature B's red-team prompt. Concurrency-safe; the orchestrator threads `ctx.changeId` throughout dispatch, headless adapter, and gate validator.

**AI-inferred track selection.** `devteam assess [--description "..."] [--apply] [files...]` (shipped 2026-06-07) recommends a track from keyword patterns and path/content heuristics (security-heuristic.js, migration-heuristic.js). `--apply` writes `pipeline.custom_stages` to `.devteam/config.yml`; `next()` and `summary()` consume it transparently. This closes the gap with AI-DLC's dynamic pathway selection — not yet a complexity-scoring approach, but rule-based assessment that removes the stage manager's track-picking judgment call in the common cases.

**Standards discovery.** `devteam standards discover` (shipped 2026-06-07) scans a project's file system across seven detection passes — tech stack, module system, file layout, naming conventions, tooling, test config, common imports — and writes `docs/project-conventions.md`. Add this file to `readFirst` lists in per-stage prompts to inject discovered conventions into agent context. This is the Agent OS-inspired preprocessing described in E-5 of the evolution opportunities below.

### 3.2 BMAD-METHOD

[github.com/bmad-code-org/BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) · 46.2k stars · v6.6.0 (April 2026)

**Blueprint.** BMAD structures AI-assisted coding around specialized agent personas. Rather than a generalist LLM, it splits work among role-based agents (Product Manager, Architect, Developer, UX Designer, …) that collaborate interactively. "Party Mode" runs them as a chat panel rather than a sequential pipeline.

**Adaptive depth.** BMAD calculates project complexity and scales planning depth: a lightweight loop for bug fixes, full persona assembly for enterprise features. This is the same intent as Stagecraft's track system — but BMAD's pathway is computed dynamically, while Stagecraft's tracks are hardcoded enumerations in `core/pipeline/stages.js`.

**Persona moat.** BMAD's strength is conversational scaffolding — the PM agent talks through the brief with you, the Architect agent argues for or against design choices. The trade-off: the audit trail is conversational and chat-dependent rather than file-and-schema-enforced. If you want to know what the PM agent decided three weeks ago, you read the chat log; if you want to know what Stagecraft's PM stage decided three weeks ago, you read `pipeline/gates/stage-01.json`.

**Cross Platform Agent Team (v6+).** Same agent team operates across Claude Code, Cursor, Codex, and others with a unified config. **One host per session, though.** Stagecraft's per-stage routing is a sharper claim than BMAD's cross-platform team.

### 3.3 GitHub Spec Kit

[github.com/github/spec-kit](https://github.com/github/spec-kit) · 106k+ stars · launched mid-2025

**Blueprint.** Spec Kit is the standard-bearer for Spec-Driven Development. Strict sequence: **Constitution → Specification → Plan → Tasks → Implementation.** Each step has a slash command (`/speckit.constitution`, `/speckit.specify`, `/speckit.plan`, `/speckit.tasks`, `/speckit.implement`).

**The flip — spec as the executable artifact.** Code is the derivative. You modify the markdown spec; the toolkit generates implementation updates. This is the cleanest version of the "treat spec as source-of-truth" argument in the public framework space.

**Consistency audits.** `/speckit.analyze` is a multi-file consistency sweep across constitution, spec, plan, tasks, and code — designed to catch drift where the AI agent (or a developer) introduced an unapproved side effect. **This is the single most concrete idea Stagecraft should absorb** — Stagecraft today has `devteam spec verify` (brief.md ↔ spec.feature ↔ test-report.md), which is narrower than Spec Kit's analyze.

**Where it stops.** Spec Kit's flow ends at Implementation. No peer-review, no red-team, no sign-off, no deploy. For greenfield projects with long-lived specs, this is clean; for shipping production features through multiple review gates, it's incomplete.

### 3.4 Agent OS

[github.com/buildermethods/agent-os](https://github.com/buildermethods/agent-os)

**Blueprint.** Extraction-first standardization. Four operations: **Discover Standards** (parse the codebase), **Deploy Standards** (surface them by context), **Shape Spec** (improve specifications), **Index Standards** (keep them searchable). The output is markdown standard files that get injected into the agent's prompt context for Cursor, Claude Code, Antigravity, and others.

**Legacy specialization.** Agent OS is the framework here you'd reach for when Stagecraft, BMAD, or Spec Kit feels too heavy. It doesn't impose stages or roles; it just keeps your AI-assisted work consistent with patterns that already exist in your codebase. Low friction threshold, low ceiling.

**Comparison to Stagecraft.** Different philosophy entirely. Stagecraft is **prescriptive** about the shape of work (18 stages, gates, role-by-area review matrix). Agent OS is **descriptive** about the style of work (extract what you already do, inject it back). Natural pairing: Agent OS feeding Stagecraft's per-stage prompts and role briefs with project-specific conventions. Stagecraft today has `docs/conventions.md` (a marker catalogue) and per-host rules in `rules/`. An Agent OS-style "discover" pass could populate or refresh those.

### 3.5 OpenSpec

[openspec.dev](https://openspec.dev/) · Y Combinator launch in 2025 · "lightweight spec-driven framework"

**Blueprint.** OpenSpec localizes all active tasks, designs, and specifications inside isolated change workspaces under `openspec/changes/<change-id>/`. Each feature gets a proposal document, broken-down implementation tasks, technical design decisions, and a **spec delta** showing how requirements will change.

**Spec deltas — ADDED / MODIFIED / REMOVED.** Rather than mutating a global specification document, OpenSpec produces a delta capturing the diff between current state and proposed change. The benefit: token efficiency. The full spec doesn't have to enter the agent's context every time you change one requirement.

**Explore mode.** `/openspec:explore` opens an interactive Q&A loop where the agent researches the codebase and interviews the developer through clarifying questions before generating a structured change proposal. This is the inverse of "the agent guesses and you correct" — the agent surfaces ambiguity *before* writing the proposal.

**The token-rot angle is novel here.** Stagecraft and BMAD assume the agent has the whole project's context. OpenSpec assumes — correctly, for large codebases — that this scales badly. Bounded workspaces are an architectural choice that affects everything downstream.

### 3.6 AWS Kiro

[kiro.dev](https://kiro.dev/) · AWS-announced as Amazon Q Developer's successor (effective May 2026)

**Blueprint.** An agentic, AI-native IDE built as a fork of VS Code (Code OSS). Three forms: **Kiro IDE** (the editor), **Kiro CLI** (terminal/SSH/scripted), **Kiro Autonomous Agent** (background — picks up tasks, opens PRs without a human in the loop). Backed by Amazon Bedrock: Claude Sonnet for reasoning, Amazon Nova for high-throughput code generation.

**Steering files.** Three system-level files inside `.kiro/steering/`:
- `product.md` — what you're building
- `structure.md` — how the codebase is organized
- `tech.md` — the technical conventions

These steer Kiro's autonomous agents the way Stagecraft's role briefs steer per-stage prompts. Conceptually similar; mechanically different (Kiro injects into IDE-resident agents; Stagecraft renders into per-stage dispatched prompts).

**Event-driven gating (Agent Hooks).** Mapped to system file events. Saving a file can trigger automated unit tests, linting, security sweeps. This is **gating as an editor event** rather than gating as a pipeline step. Closer to how a linter integrates than how a CI gate does — but the mechanism is "agent runs checks autonomously" rather than "check is hand-configured."

**Deep AWS integration.** CodeCatalyst for repositories + CI/CD, Bedrock for model access, IAM Identity Center for enterprise auth, MCP servers for AWS-specific domains (CDK, CloudFormation, pricing, HealthOmics). For AWS-shop teams, this is the path of least resistance.

### 3.7 AI-DLC

AWS methodology · [`awslabs/aidlc-workflows`](https://github.com/awslabs/aidlc-workflows) · re:Invent 2025 reveal

**Blueprint.** AI-driven Development Life Cycle. Three macro-phases:
1. **Inception** — AI transforms business intent into requirements, stories, units.
2. **Construction** — AI proposes architecture, domain models, code, tests.
3. **Operations** — AI manages IaC and deployments.

Each phase evaluates the depth at which it should execute, **dynamically constructing the pathway** based on the change's complexity. Minor defects skip the heavy design phase; infrastructure changes mandate threat modeling.

**Mob Elaboration / Mob Construction.** Human-in-the-loop checkpoints where the entire team explicitly validates AI's proposals before execution proceeds. Mob Elaboration is in Inception (validate requirements); Mob Construction is in Construction (validate architectural choices). The ritual is borrowed from Mob Programming.

**The adaptive-pathway angle.** AI-DLC is the framework here that most directly criticizes static enumerations of stages. Stagecraft's tracks (`full`, `quick`, `nano`, `config-only`, `dep-update`, `hotfix`) cover six pre-defined shapes; AI-DLC computes the shape from the change's structural impact. AWS reports 10-15× productivity gains from internal customers (Wipro, Dun) — claim made by AWS marketing; not independently benchmarked here, treat with the usual skepticism toward vendor numbers.

---

## 4. Where Stagecraft sits — strengths and limits

### 4.1 The three claims Stagecraft can defend

**Claim 1 — Gate JSON as the executable state seam.**

No other framework in this comparison has anything quite like Stagecraft's gate JSON contract. BMAD's phase milestones are conceptual; Spec Kit's spec is markdown, the analyze pass is an inspection, not a per-stage gate; AI-DLC's compliance logs accumulate but aren't an executable state. The gate JSON does three things at once: tells `devteam next` what to do; enables `devteam reproduce` / `replay` (drift detection across runs); makes the pipeline reconstructable from `pipeline/gates/` alone — *the orchestrator never holds state outside of those files*. That last property is unique here and is the load-bearing claim behind "auditable, resumable, not in a chat log."

**Claim 2 — Heterogeneous multi-model dispatch is a sharper claim than cross-platform agent team.**

BMAD's Cross Platform Agent Team selects one host per session. Stagecraft's routing lets different roles **within the same pipeline run** land on different hosts. Per `01-architecture.md`: "Different roles can run on different models — Claude for design, Codex for backend, Gemini for QA, Claude for review. The gate JSON is the seam." Multi-model peer review takes this further with N-way fanout. No other framework here goes this far.

**Claim 3 — Downstream-of-build coverage.**

Spec Kit's flow stops at Implementation. OpenSpec's spec deltas don't prescribe what happens after the code is generated. BMAD's lifecycle covers deployment but is conversational rather than gate-enforced. AI-DLC's Operations phase is closer in shape, but it's a single phase rather than the 12 distinct Stagecraft stages downstream of build, each with its own gate and (sometimes) veto capability. For shipping production features, this is the most material differentiator.

### 4.2 Three honest cases where Stagecraft is *not* the best fit

1. **Solo developer / small personal project.** Use **Agent OS** for convention consistency. The 18-stage pipeline is overkill below team-of-three scale.
2. **Greenfield product where the spec is the long-term asset.** Use **Spec Kit** or **OpenSpec**. Stagecraft can be made to work (brief.md is the spec) but its center of gravity is the gate, not the spec.
3. **Teams already deep in the AWS / Bedrock ecosystem.** Use **AWS Kiro** + **AI-DLC**. Kiro's autonomous-agent + steering-files + Agent Hooks model integrates more tightly than anything Stagecraft offers, and AI-DLC layers compliance / audit on top.

These aren't graceful concessions — they're real cases where the alternative is genuinely better. The judgment of when Stagecraft *is* the right fit is sharper when you can articulate when it isn't.

---

## 5. Evolution opportunities for Stagecraft

Six concrete absorptions from this comparison, ranked by effort × impact. Each cites the framework it's borrowed from.

### High leverage

**E-1 — Cross-artifact consistency analyze (from Spec Kit). ✅ Shipped 2026-06-03 as `devteam consistency analyze`.**

`devteam consistency analyze [--strict] [--json]` checks the full pipeline chain in one pass — five drift classes: brief ACs ↔ spec.feature scenarios, ACs ↔ test-report rows, ACs ↔ `pr-*.md ## Verify` bullets, red-team `must_address` ↔ stage-05 PASS, and gate fields ↔ artifact reality (e.g., `stage-01.acceptance_criteria_count` vs actual AC count). This goes beyond the narrower `devteam spec verify` (brief ↔ spec ↔ test-report only) and has a dimension Spec Kit's `/speckit.analyze` cannot match: gate-vs-artifact reality, which only exists because Stagecraft has machine-readable gate JSON as the inter-stage contract. New module `core/spec/analyze.js` (~280 lines).

**E-2 — Bounded workspace deltas (from OpenSpec). ✅ Shipped 2026-06-06 as `pipeline.isolation = "bounded"`.**

Setting `pipeline.isolation: bounded` in `.devteam/config.yml` causes all stage artifacts (gates, logs, prompts) to land under `pipeline/changes/<change-id>/` instead of the global `pipeline/`. Context for feature A can't leak into feature B's red-team prompt. The `changeId` is derived from the feature name slug (≤64 chars, lowercase-hyphenated); `core/paths.js` is the new path-helper; `ctx.changeId` threads throughout orchestrator, headless adapter, render-helpers, and gate validator. `changeId = null` is a strict no-op (in-place mode requires zero conditional changes in callers). 35 tests.

### Medium leverage

**E-3 — Adaptive pathways (from AI-DLC and BMAD). ✅ Partially shipped 2026-06-07 as `devteam assess`.**

`devteam assess [--description "..."] [--apply] [files...]` recommends a track from keyword patterns and path/content heuristics (`security-heuristic.js`, `migration-heuristic.js`). Priority order: hotfix keywords → dep-file paths → config-file paths → nano keywords → quick keywords → full (default). Heuristic overrides: migration-required bumps lighter tracks to full; security-required bumps nano to quick. `--apply` writes `pipeline.custom_stages` to `.devteam/config.yml`; `next()`, `summary()`, and `runStage()` consume it transparently. `orderedStageNamesForTrack()` accepts custom stage arrays in addition to named tracks. 38 tests.

What's not yet done: AI-DLC's true complexity scoring (structural impact analysis, surface area measurement) — the current approach is rule-based, not learning-based. The gap matters if real workloads commonly land between two tracks where heuristics pick wrong. The stage manager escape hatch is `--apply` + manual edit of `pipeline.custom_stages`. Track toward a feedback loop from gate-pass-rate data (D4/D5 analytics) to make the assessment data-driven.

**E-4 — Conversational stage mode (from BMAD).** BMAD's Party Mode is more accessible for non-engineers than Stagecraft's run-stage / read-gate / decide loop. Optional `devteam stage requirements --interactive` could open a chat with the PM subagent — refine the brief through Q&A before producing the artifact. Architecture supports it (host adapters could expose a streaming-conversation interface alongside the one-shot render). **Effort:** M (~1 week, mostly per-host adapter work). **Impact:** medium — would broaden the stage manager audience for requirements / design / clarification stages specifically. Worth doing only if user feedback says the gate-driven loop is too cold for those upstream stages.

**E-5 — Discover Standards preprocessing (from Agent OS). ✅ Shipped 2026-06-07 as `devteam standards discover`.**

`devteam standards discover [--cwd <dir>] [--json] [--dry-run] [--force]` runs seven static-analysis passes — tech stack (JS/TS/Python/Go/Rust via manifests), module system (ESM/CJS/mixed), file layout (top-level + source subdirs), naming style (kebab/PascalCase/camelCase/snake_case), tooling (TypeScript/ESLint/Prettier/Biome/Husky/EditorConfig), test config (framework, co-location, pattern), and common imports (top-10 non-relative sources by frequency) — and writes `docs/project-conventions.md`. Add this file to each stage's `readFirst` list in per-stage prompts; Stage-04 build agents then see project-specific import styles, naming patterns, and test framework choices before generating files. `--dry-run` prints without writing; `--json` emits the structured result. 67 tests. `core/standards/discover.js` (~565 lines).

The full Agent OS vision (continuous re-discovery, convention drift detection) is still open — `standards discover` is a one-shot preprocessing command, not a live extraction pass. The natural next step is integrating it as a pre-requirements setup hook so it runs automatically on first `devteam stage requirements` invocation in a new project.

### Lower leverage / wait-and-see

**E-6 — Steering files + Agent Hooks (from Kiro).** Kiro's `.kiro/steering/{product,structure,tech}.md` is conceptually the same as Stagecraft's existing per-stage role briefs + `AGENTS.md` + `docs/conventions.md` — but tighter and centralized. Agent Hooks on file events are closer to Stagecraft's PostToolUse hooks but more sophisticated. **Effort:** S (~1-2 days). **Impact:** low — Stagecraft's existing pieces cover the same ground; the consolidation might be desirable but isn't load-bearing.

**E-7 — Mob Construction rituals (from AI-DLC).** AI-DLC's named ceremonies (Mob Elaboration in Inception, Mob Construction in Construction) formalize the human-in-the-loop checkpoints. Stagecraft's escalation runbook + `devteam ruling` command cover similar ground but informally. Codifying named ceremonies could help for teams that want explicit ritual structure. **Effort:** S (mostly docs). **Impact:** low — the mechanism already exists; the formalization is mostly nomenclature.

### What Stagecraft should *not* absorb

- **Spec-as-source-truth.** This is a deliberate design choice. Spec Kit's flip is clean for greenfield long-lived specs; Stagecraft optimizes for shipped features with auditable trails. Both choices are valid; picking one is forced.
- **IDE-resident agent.** Stagecraft is a CLI orchestrator that drives host CLIs. Becoming an IDE fork the way Kiro is would lose the multi-host strength. Kiro is a great IDE; Stagecraft is a great pipeline; these aren't the same thing.

---

## 6. Composability — high-efficiency tool stacking

These frameworks compose. The most powerful pipelines combine layers from different schools.

```
                  ┌─────────────────────────────────────┐
                  │              Kiro IDE               │  Developer workspace +
                  │      (VS Code fork interface)       │  steering files + Agent Hooks
                  └──────────────────┬──────────────────┘
                                     │
                  ┌──────────────────▼──────────────────┐
                  │             OpenSpec                │  Bounded change workspaces +
                  │     (Spec deltas + Explore loop)    │  interactive Q&A pre-proposal
                  └──────────────────┬──────────────────┘
                                     │
                  ┌──────────────────▼──────────────────┐
                  │            Stagecraft               │  18-stage pipeline + multi-model
                  │      (Gate-controlled delivery)     │  dispatch + downstream-of-build
                  └──────────────────┬──────────────────┘
                                     │
                  ┌──────────────────▼──────────────────┐
                  │             AI-DLC                  │  Adaptive pathway selection +
                  │   (Compliance + Mob rituals)        │  Mob Construction validation
                  └─────────────────────────────────────┘
```

- **Developer workspace (Kiro + OpenSpec).** Developer works inside Kiro IDE with Bedrock-backed autonomous agents. `/openspec:explore` interactively refines a feature proposal into a localized, bounded change workspace.
- **Engineering pipeline (Stagecraft).** Stagecraft consumes the OpenSpec proposal as its starting `pipeline/brief.md`. The 18-stage pipeline runs across multiple model hosts — different stages on different LLMs to exploit per-model strengths. Bounded workspace isolation (`pipeline.isolation = "bounded"`) keeps each OpenSpec change workspace's artifacts separate inside `pipeline/changes/<id>/`.
- **Enterprise compliance layer (AI-DLC).** AI-DLC scores Stagecraft's gate outputs, validates compliance logs, organizes Mob Construction reviews before final deployment.

This four-layer stack is theoretical — the integration points aren't all shipped today. The most natural integrations:
- **Spec Kit → Stagecraft**: Spec Kit's `tasks.md` becomes Stagecraft's `pipeline/brief.md`. One-way handoff at the spec-to-implementation boundary.
- **Agent OS → Stagecraft**: The structural equivalent (`devteam standards discover`, shipped 2026-06-07) is now native. Agent OS-style extraction produces `docs/project-conventions.md`; Stagecraft stage prompts reference it via `readFirst` to inject discovered conventions.
- **OpenSpec → Stagecraft**: Stagecraft's bounded workspace isolation (`pipeline.isolation = "bounded"`, shipped 2026-06-06) is the native equivalent of OpenSpec's bounded change workspaces. When consuming an OpenSpec proposal, its change ID can map directly to Stagecraft's `changeId` slug, keeping artifacts isolated.

---

## 7. Method note

This comparison was synthesized from three independently-written analyses, then refreshed on 2026-06-07:

1. **First**, generated in Claude Code on 2026-06-03. Covered BMAD-METHOD, Spec Kit, and Agent OS via WebFetch summaries of their GitHub repos.
2. **Second**, contributed by the user (origin not stated; structure suggests Claude Chat or similar). Introduced OpenSpec, AWS Kiro, and AI-DLC as comparators and offered a cleaner four-school taxonomy.
3. **Third (v2)**, contributed by the user as a refinement of the second. Introduced the 5-layer functional stack as an alternative lens and a sharpened "Discover Standards" preprocessing opportunity (E-5).
4. **2026-06-07 refresh**, generated in Claude Code against the current repo state. Updated §2 (matrix), §3.1 (Stagecraft deep-dive), §4.1 Claim 3, and §5 (evolution opportunities) to reflect features shipped between the original analysis and the refresh date: `devteam consistency analyze` (E-1 / B8), bounded workspace isolation (E-2 / B9), `devteam assess` (E-3 / G6), `devteam standards discover` (E-5 / B10), and `stage-06e` performance-budget (B2). Stage count updated 17 → 18; downstream-of-build count updated 11 → 12; maturity signal updated to ~23k LOC / ~1 100 tests / 12 days. No external frameworks were re-verified in this refresh — other-framework descriptions are unchanged from the 2026-06-03 analysis.

The synthesis adopts:
- The four-school taxonomy from the second analysis (cleaner than the first's five-category split).
- The 5-layer functional stack from the third as a complementary lens in §1.
- All seven public/methodology frameworks as comparators. (Earlier drafts also covered three internal frameworks at non-Layer-2/3 layers; per user direction those were removed to keep this comparison tight on the process-and-spec axis.)
- The "prior art built on" and "architectural moat" columns from the second analysis's matrix.
- The "where Stagecraft is not the best fit" honesty section and "what should Stagecraft learn — with effort estimates" structure from the first analysis.
- The "Discover Standards preprocessing" evolution opportunity (E-5) sharpened from the third analysis.
- The four-layer composability stack diagram from the second analysis.

Where the analyses diverged on facts, framework descriptions were verified against current web sources (June 2026) before adoption. All three additional frameworks (OpenSpec, AWS Kiro, AI-DLC) check out — descriptions align with their public docs.

**This is a documentary comparison, not an empirical one.** No benchmarks were run; no frameworks were installed or test-driven. Where claims about distinctive shape are made, those are grounded in repo file references or vendor docs. Where value judgments appear ("X is more complete than Y for shipping production features"), those are stage-manager-flavored opinions that should be tested against your team's actual needs. AWS's 10-15× productivity claim for AI-DLC is repeated above without endorsement — it's a vendor number, not an independent measurement.

## 8. References

### Frameworks compared

- **Stagecraft** (this repository) — [`README.md`](../README.md), [`docs/concepts.md`](concepts.md), [`docs/methodology.md`](methodology.md), [`ARCHITECTURE.md`](../ARCHITECTURE.md).
- **BMAD-METHOD** — [github.com/bmad-code-org/BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD). 46.2k stars, v6.6.0 (April 2026).
- **GitHub Spec Kit** — [github.com/github/spec-kit](https://github.com/github/spec-kit). 106k+ stars (launched mid-2025).
- **Agent OS** — [github.com/buildermethods/agent-os](https://github.com/buildermethods/agent-os).
- **OpenSpec** — [openspec.dev](https://openspec.dev/), [Y Combinator launch page](https://www.ycombinator.com/launches/Pdc-openspec-the-spec-framework-for-coding-agents).
- **AWS Kiro** — [kiro.dev](https://kiro.dev/), [AWS Kiro docs](https://aws.amazon.com/documentation-overview/kiro/).
- **AI-DLC** — [awslabs/aidlc-workflows](https://github.com/awslabs/aidlc-workflows), [AWS DevOps Blog announcement](https://aws.amazon.com/blogs/devops/ai-driven-development-life-cycle/).

### Broader-market context

- [Spec-Driven Development: The Definitive 2026 Guide (BCMS)](https://thebcms.com/blog/spec-driven-development).
- [BMAD vs Spec Kit vs OpenSpec (Medium, Reenbit, May 2026)](https://medium.com/@reenbit/bmad-vs-spec-kit-vs-openspec-choosing-your-spec-driven-ai-framework-in-2026-a6996b3ebb8d).
- [Goodbye Vibe Coding: SDD Framework Survey (Pasquale Pillitteri)](https://pasqualepillitteri.it/en/news/158/framework-ai-spec-driven-development-guide-bmad-gsd-ralph-loop).
- [How to build reliable AI workflows with agentic primitives (GitHub Blog)](https://github.blog/ai-and-ml/github-copilot/how-to-build-reliable-ai-workflows-with-agentic-primitives-and-context-engineering/).

### Frameworks NOT covered — worth a future pass

The space has grown to dozens of entries in 2026. The following came up in the broader-market sources but weren't deeply analyzed here:

- **Tessl** — referenced in the 2026 SDD landscape; not explored.
- **Google Antigravity** — referenced as host target for Agent OS and others; not explored.
- **Superpowers** — named in Rick Hightower's March 2026 four-framework SDD comparison; not explored.
- **GSD (Goodbye Sublime Development)** — surveyed alongside BMAD and Ralph-Loop; not explored.
- **Compound Engineering** (Every Inc.) — distributed as a Claude Code plugin in some stacks; not explored as a standalone framework.

Audit #3 — or whichever future pass refreshes this doc — could deepen any of these to round out the spec-driven cluster specifically.
