# Methodology

Stagecraft enforces **ATDD with phase-gate progression and adversarial review**. Every feature traces from an acceptance criterion through a Gherkin scenario through a named test — and can't move to the next phase until the gate for the current one passes. Adversarial roles (red-team, peer-review) are structurally guaranteed to run, not left to chance.

---

## 1. Acceptance-test-driven development

The PM role writes numbered acceptance criteria (`AC-1`, `AC-2`, …) in `pipeline/brief.md` at Stage 1. Stage 3b translates each `AC-N` line into one Gherkin scenario tagged `@AC-N` in `pipeline/spec.feature`. Stage 6 (QA) verifies that every scenario has a corresponding test. The gate at each stage carries the mapping; `devteam spec verify` detects drift at any time.

This gives the pipeline a closed loop:

```
AC-N in brief.md
  → @AC-N scenario in spec.feature   (Stage 3b)
  → test tagged @AC-N                (Stage 4: build)
  → scenario verified ✓              (Stage 6: QA)
```

If a criterion has no scenario, Stage 3b's gate fails. If a scenario has no test, QA's gate fails. Neither can be skipped without a `FAIL` or `ESCALATE` halting the pipeline.

The `full` and `quick` tracks run this loop. `nano` and `hotfix` skip requirements and spec stages — acceptance criteria are assumed known; QA still verifies whatever tests exist.

See [`docs/spec-authoring.md`](spec-authoring.md) for the authoring procedure and [`docs/concepts.md`](concepts.md) → *Executable spec* for the stage mechanics.

---

## 2. Phase-gate progression

Every stage writes a machine-readable gate to `pipeline/gates/`. The orchestrator reads the gate before dispatching the next stage. A `FAIL` gate stops forward progress; an `ESCALATE` gate halts the entire pipeline until a human resolves it.

The practical effect: **the methodology is enforced by the pipeline, not by convention.** You can't skip design review by forgetting to look at the design doc — the `stage-02.json` gate must be present and `PASS` before Stage 3 runs. You can't merge until sign-off gates exist for both PM and Platform roles.

Two stages hold veto power that peer-review approvals cannot override:

- **Security review** (Stage 4b, conditional) — fires when pre-review flags sensitive paths. A `FAIL` from security blocks sign-off regardless of peer-review outcome.
- **Migration safety** (Stage 4d, conditional) — fires on data-layer diffs. An empty rollback plan, an untested rollback on a breaking change, or a missing backfill strategy auto-vetoes. The migrations role must re-review after any fix.

See [`docs/concepts.md`](concepts.md) → *Gate* and [`docs/migration-safety.md`](migration-safety.md) for the veto criteria.

---

## 3. Adversarial layers

Two roles exist specifically to find problems, not build features:

**Red-team (Stage 4c)** — runs after build, before peer-review. Walks 10 attack surfaces (input boundaries, state machines, sequence assumptions, integrations, auth edges, resource exhaustion, failure modes, abuse cases, downstream effects, observability gaps) and produces concrete reproducers. Items listed under `must_address_before_peer_review` block Stage 5 until the implementer addresses them. Always-on for `full` and `hotfix` tracks. Route to a different host than the build agents — diversity of model matters.

**Peer-review (Stage 5)** — four area-specific reviewers (`reviewer-backend`, `reviewer-frontend`, `reviewer-platform`, `reviewer-qa`) each produce an independent review. With multi-model fanout enabled, Stage 5 duplicates across N hosts and aggregates pessimistically. Patterns that survive all reviewers are promoted to `pipeline/lessons-learned.md` at retrospective; the Principal then decides whether to encode them as pipeline rules.

The adversarial structure is not a prompt technique — it's a role topology. The red-team role is constitutionally separate from the build roles and has no incentive to approve its own work.

See [`docs/red-team.md`](red-team.md) for the attack-surface methodology.

---

## 4. Four coding principles

Every agent in the build phase follows four behavioural rules:

| Principle | Rule |
|---|---|
| **Think Before Coding** | Surface assumptions and ambiguities in `pipeline/context.md` before the first edit. A `QUESTION:` line means "implementing the conservative interpretation while I wait." |
| **Simplicity First** | Minimum code that satisfies the spec. No speculative features, premature abstractions, or half-implementations. |
| **Surgical Changes** | Touch only what the spec calls for. Every changed hunk traces to a line in `brief.md`, `design-spec.md`, or a `PM-ANSWER:` in `context.md`. |
| **Goal-Driven Execution** | Every build task starts with a plan in `pipeline/pr-{area}.md` mapping each step to a concrete, observable verification. |

Reviewers apply the same rules in reverse: missing traceability, overcomplication, or an unverifiable step are blockers, not suggestions.

Full detail: [`rules/coding-principles.md`](../rules/coding-principles.md).

---

## How it fits together

```
Requirements (Stage 1)   AC-N criteria established
      ↓
Design (Stage 2)         Architecture locked before any code
      ↓
Executable spec (Stage 3b) Gherkin scenarios, 1:1 with AC-N
      ↓
Build (Stage 4)          Four workstreams; four coding principles enforced
      ↓
Red-team (Stage 4c)      Adversarial attack; blockers stop peer-review
      ↓
Peer-review (Stage 5)    Independent multi-role (optionally multi-model) review
      ↓
QA (Stage 6)             Verifies every AC-N scenario has a passing test
      ↓
Sign-off → Deploy → Retro
```

The gate at each arrow is a `PASS/WARN/FAIL/ESCALATE` record on disk. The pipeline is reconstructable — and auditable — from the gate files alone.
