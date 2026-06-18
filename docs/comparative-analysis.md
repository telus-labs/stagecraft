# Stagecraft vs adjacent AI-assisted engineering control planes — 2026

**Refreshed:** 2026-06-18
**Comparators:** BMAD-METHOD, GitHub Spec Kit, Agent OS, OpenSpec, AWS Kiro,
AI-DLC.
**Focus:** process orchestration, spec-driven development, context systems, and
automated evidence.

This is a documentary comparison, not a benchmark. Stagecraft claims are verified
against this repository; comparator claims use first-party repositories or vendor
documentation current on the refresh date. Star counts and release labels are
deliberately secondary because they age faster than architecture.

## 1. Market map

The tools still cluster into four overlapping schools:

| School | Primary question | Examples |
|---|---|---|
| Process and gate control | What may run next, and what evidence permits it? | Stagecraft, AI-DLC |
| Spec-driven blueprints | What agreed specification should implementation derive from? | Spec Kit, OpenSpec, Kiro specs |
| Persona/workflow cooperation | Which specialist perspective should shape the work? | BMAD |
| Context and convention systems | What project knowledge must every agent carry? | Agent OS, Kiro steering |

The categories are not product boxes. Spec Kit now has workflows/extensions; AI-DLC
ships executable steering rules and evaluators; Kiro spans IDE, CLI, and web. The
useful distinction is the **source of operational truth**:

- Stagecraft: schema-validated gates and on-disk pipeline state.
- Spec Kit/OpenSpec: specifications, plans/tasks, and approved change deltas.
- BMAD/AI-DLC: explicit methodology and role/workflow artifacts.
- Agent OS/Kiro: standards/steering context applied to agent work.

## 2. Current comparison matrix

| Dimension | Stagecraft | BMAD | Spec Kit | Agent OS | OpenSpec | Kiro | AI-DLC |
|---|---|---|---|---|---|---|---|
| Primary primitive | Stage + gate | Agent/workflow | Spec → plan → tasks → implement | Standard + shaped spec | Proposal + spec delta | Spec/steering/hook/agent | Adaptive three-phase workflow |
| Source of truth | Gate/artifact files | Workflow artifacts | Markdown spec chain | Injected standards | Current specs + change folders | Workspace steering/specs | Generated AI-DLC docs/rules |
| Host posture | Per-stage/per-role routing across 4 first-party adapters plus plugins | Installs into multiple tools | 30 integrations + generic | Works alongside major coding agents | Broad slash-command/AGENTS integrations | Native Kiro surfaces | Rules for Kiro, Q, Cursor, Cline, Claude, Copilot |
| Mechanical gating | Strong: schemas, validator overrides, direct lint/test/SCA, chain | Mostly workflow-guided | Analyze/checklists; extensions add governance | Not its center | Format validation and archive flow | Hooks and agent workflow | Evaluator + human approval tenet |
| Post-build depth | Review, red-team, QA, a11y, observability, verification, performance, sign-off, deploy, retro | Method-dependent implementation/testing | Core flow ends at implement | Outside scope | Apply/archive after implementation | Agent/hook dependent | Construction + Operations |
| Isolation | Bounded change roots optional | Project workflow context | Feature directories/presets | Standards workspace | First-class change folders | Workspace/task context | Generated project docs |
| Auditability | Executable gate chain, replay, run log | Artifact/workflow history | Artifact chain | Standards/spec history | Explicit proposed/current/archive states | Task and workspace history | Human approvals + generated workflow docs |
| Best fit | Multi-host, high-assurance delivery control | Guided role-rich product development | Spec-centered greenfield/structured change | Lightweight brownfield alignment | Brownfield spec deltas | Teams choosing an integrated agent environment | Enterprise methodology with explicit human oversight |

## 3. Stagecraft in June 2026

Stagecraft is v0.7.0: 18 ordered stages, 6 tracks, 4 first-party host adapters, 34 CLI
command modules, 50,898 JavaScript lines, 91 test files, and 1,941 passing runtime
tests. The project has moved substantially beyond the v0.5 snapshot in the prior
comparison.

Material capabilities added or matured since that snapshot include:

- bounded autonomous runs with retry classification, rulings, consequence ceilings,
  repair diagnosis, targeted file-owner retries, liveness events, and resumable state;
- mechanical documentation and deploy-cost gates;
- pluggable external host adapters;
- role tool budgets with a host-neutral source of truth;
- git-aware commits, restart/replay repair, changelog-fragment enforcement, and
  stronger consistency generation;
- Windows-oriented command parsing, PATH probing, cleanup, and process termination
  code, pending native CI evidence;
- performance, standards, consistency, bounded-workspace, and inferred-track features
  that were “opportunities” in the previous analysis and are now shipped.

The current differentiator is therefore not “more stages.” It is the combination of:

1. **An executable state seam.** Gate JSON drives deterministic next actions and can be
   mechanically overruled when model claims conflict with observed checks.
2. **Heterogeneous dispatch.** Roles and stages in one run can use different host CLIs,
   including N-way review fanout.
3. **Bounded autonomy with provenance.** Automatic progress is explicitly limited by
   retries, scope, grants, budget, consequence ceilings, and append-only events.
4. **Downstream delivery depth.** Stagecraft treats review, safety, quality,
   operations, deployment, and retrospective as first-class gates.

## 4. Comparator updates

### BMAD-METHOD

BMAD remains the strongest persona/workflow system in this set. Current releases and
documentation emphasize scale-adaptive planning, quick-spec flows, brownfield context
detection, party mode, specialized agents, and installation across coding tools. Its
advantage over Stagecraft is facilitated product/design conversation and a larger
workflow ecosystem. Stagecraft's advantage is deterministic cross-host execution and
mechanically enforced gate state.

### GitHub Spec Kit

Spec Kit now describes a core Spec → Plan → Tasks → Implement process, 30 agent
integrations, and a substantial presets/extensions/workflows ecosystem. That makes the
old description of it as a narrow flow that simply “stops at implementation” too
absolute: community governance and orchestration layers now exist. Its center remains
the specification chain; Stagecraft's remains delivery control and observed evidence.

### Agent OS

Agent OS 3.0 focuses on discovering, deploying, and indexing codebase standards plus
shaping better specs. It is lighter than Stagecraft and complementary rather than a
direct substitute. Stagecraft's one-shot `standards discover` covers part of this
surface but not Agent OS's continuing context-deployment posture.

### OpenSpec

OpenSpec's current framing is brownfield-first: `openspec/specs/` is current truth,
`openspec/changes/` holds proposals/tasks/deltas, and archiving merges approved
changes. It supports a broad set of AI tools and requires no model API. Its explicit
current-vs-proposed spec model is still more mature than Stagecraft's brief/artifact
lineage; Stagecraft adds stronger downstream gates and multi-host execution.

### AWS Kiro

Kiro now spans IDE, CLI, and web, with steering files that work across surfaces and
autonomous tasks that ask clarifying questions up front. It is better viewed as an
integrated agent environment than merely a VS Code fork. Stagecraft should compose
with Kiro as a host/context surface rather than imitate its editor or cloud platform.

### AI-DLC

AI-DLC is now an open workflow-rules repository for multiple coding agents, not only a
method paper tied to Amazon Q. Its evaluator includes golden cases, semantic/code/NFR
evaluation, and CI support; the methodology remains explicit about human approval for
critical decisions. This makes it Stagecraft's closest methodological comparator.
Stagecraft is more executable as a local control plane; AI-DLC is broader as an
adaptive, organization-oriented methodology and evaluation system.

## 5. Where Stagecraft wins, and where it does not

### Defensible strengths

- Machine-readable gates are executable state, not merely reports.
- Per-role/per-stage heterogeneous host routing is unusually deep.
- Mechanical verification can override model assertions.
- Bounded autonomy records why it proceeded, retried, ruled, or halted.
- Delivery coverage after implementation is broader than spec-first cores.

### Better choices in other situations

- **Spec is the long-lived product asset:** choose Spec Kit or OpenSpec first.
- **Interactive product shaping is the primary need:** BMAD has the stronger native
  conversational workflow.
- **Lightweight brownfield convention alignment:** Agent OS imposes less process.
- **One integrated agent workspace and cloud ecosystem:** Kiro is the natural center.
- **Organization-wide methodology and evaluation adoption:** AI-DLC may be easier to
  standardize without adopting a new executable control plane.

## 6. Strategic implications

### Do next

1. **Harden the evidence viewer.** The current audit's dashboard XSS finding weakens
   the auditability claim at its presentation boundary.
2. **Prove portability rather than advertise it.** Add native Windows CI before
   support promotion.
3. **Make real-run evidence attainable.** A privacy-safe readiness/export loop is the
   prerequisite for adaptive routing, learned recipes, standing grants, and active
   stall response.
4. **Protect the autonomy core structurally.** Decompose driver transitions before
   adding another major autonomous capability.

### Validate before investing

- **Conversational upstream stages:** BMAD, Kiro, and OpenSpec all show demand for
  clarification before artifact production. Stagecraft should require user evidence
  and preserve the final artifact/gate seam in any experiment.
- **Continuous standards deployment:** Agent OS shows value beyond one-shot discovery.
  Validate whether Stagecraft users experience convention drift before adding hooks.
- **Evaluation harnesses:** AI-DLC's golden/semantic/NFR evaluator is strategically
  relevant, but Stagecraft first needs a real-run corpus and privacy model.

### Continue to avoid

- Becoming an IDE or model provider.
- Maintaining first-party adapters for every coding agent; use the plugin seam.
- Self-modifying pipeline rules before multi-project evidence exists.
- Learning-based routing or recipes without sufficient comparative observations.

The detailed sequence is in [the current audit roadmap](audit/10-roadmap.md).

## 7. Method and sources

First-party sources checked on 2026-06-18:

- Stagecraft: this repository's `package.json`, `core/`, tests, docs, and current
  [audit](audit/00-project-context.md).
- [BMAD-METHOD repository and releases](https://github.com/bmad-code-org/BMAD-METHOD).
- [GitHub Spec Kit documentation](https://github.github.com/spec-kit/).
- [Agent OS repository](https://github.com/buildermethods/agent-os).
- [OpenSpec repository](https://github.com/Fission-AI/OpenSpec).
- [Kiro documentation](https://kiro.dev/docs/).
- [AI-DLC workflow repository](https://github.com/awslabs/aidlc-workflows) and
  [AWS methodology article](https://aws.amazon.com/blogs/devops/ai-driven-development-life-cycle/).

No framework was installed or benchmarked. Comparative claims describe documented
architecture and workflow, not independently measured productivity or quality.
