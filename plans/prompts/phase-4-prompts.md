# Phase 4 Prompts — Capability Roadmap (ADR-first)

This phase is different: items involve design judgment. The workflow per capability is
**(a) ground-truth/ADR prompt → (b) HUMAN reviews and approves the ADR → (c) implementation
prompt**. Never run an implementation prompt against an unapproved ADR. Paste the PREAMBLE
from [README.md](README.md) before each prompt; for ADR prompts, also note the preamble's
git rule still applies (branch + commit the ADR draft, no push).

Run order: **4.0 → 4.2 → 4.1(a then c) → 4.3 → 4.4 (interleave as review bandwidth allows)**.

---

## Prompt 4.0 — Ground truth check (run first, output feeds every other prompt)

```
TASK: Execute plans/phase-4-capability-roadmap.md, item 4.0. This is a READ-AND-REPORT
task: you write exactly one file, plans/phase-4-ground-truth.md. No code changes.
Branch: docs/phase-4-ground-truth

1. Run `git show bf048a9` and read the full diff ("halt on no-progress fix cycles").
   Also `git show 3d0b16f` (per-attempt gate archiving). Read
   docs/autonomous-execution-design.md §4.1 including its "Grounding correction", and the
   convergence-related code the diffs touch (driver + orchestrator).
   Write down precisely: what counts as "progress" in the code today, where it is
   computed, which inputs it trusts (especially: anything model-written like
   gate.retry_number), what remains count-based, and whether the interactive
   `devteam next` path differs from the driver path.
2. Read docs/BACKLOG.md end to end. List every OPEN (non-struck) item, confirm G10 is the
   only open top-tier item, and note anything relevant to items 4.1/4.3 that has landed
   since the plans were written.
3. Read docs/autonomous-execution-design.md §7 and confirm the four open questions
   (standing grants, track inference, heartbeat/liveness, exit-code semantics) are still
   open — cite any partial movement.

Output file structure: ## Convergence: implemented vs spec (with file:line) /
## Backlog deltas / ## Open questions status / ## Corrections to phase-4 plan items.
Be precise and cite everything — three later work items scope themselves from this file.
```

---

## Prompt 4.2 — Progress-based convergence (completion)

```
TASK: Implement plans/phase-4-capability-roadmap.md, item 4.2, SCOPED BY
plans/phase-4-ground-truth.md (read both in full; ground-truth wins where they disagree —
implement only the delta it identifies). Branch: feat/progress-based-convergence

Design constraints (from ADR-003; not yours to change):
- The breaker trips on NO PROGRESS across fix attempts, not just attempt count.
- Progress comparison uses the per-attempt ARCHIVED gates (the archiving feature exists).
- Prefer orchestrator-stamped fields (lint/test results, AC mapping — trustworthy by
  construction, see core/verify/stamp.js) over model-asserted fields when computing deltas.
- Remove agent-falsifiable inputs from the convergence decision on BOTH paths: derive
  attempt counts from the archive (count archived gates for the stage) instead of the
  model-written gate.retry_number, in the driver AND in interactive next()
  (orchestrator.js:~1228 region — locate precisely).
- When the breaker trips, the halt/fix_steps output must state WHAT didn't change
  ("blocker 'X' identical across attempts 2,3") and feed it into the escalation context
  the same way existing halts do.

Required tests: archive fixtures with identical vs. differing blocker sets across attempts
→ breaker trips / doesn't; falsified retry_number is ignored on both paths; the
no-progress evidence string appears in the halt output.

Also update docs/autonomous-execution-design.md §4.1 to describe the implemented state
(replace the "Grounding correction" caveat), and the autonomous-run runbook's limitations
list. CHANGELOG entry with Honest scope note for anything still deferred (e.g. targeted
fanout retry stays deferred — do not implement it).

Done means: tests pass; npm test / eslint / npm run consistency green; design doc and
runbook updated; report includes the before/after convergence decision inputs.
```

---

## Prompt 4.1a — Draft ADR-004: role tool budgets (G10)

```
TASK: DRAFT (do not implement) docs/adr/004-role-tool-budgets.md per
plans/phase-4-capability-roadmap.md item 4.1. Branch: docs/adr-004-tool-budgets

Preparation (all required before writing):
- Read two existing ADRs in docs/adr/ and match their structure and status conventions.
- Read plans/phase-4-ground-truth.md for any landed deltas.
- Read: hosts/claude-code/adapter.js ROLE_FRONTMATTER handling (lines ~34-119), each
  hosts/*/capabilities.json, assertCapabilities and the C1 enforcement-level pattern
  (write-audit / capabilities), how host/model are recorded on workstream gates, and
  docs/BACKLOG.md's G10 entry verbatim.

The ADR must take a position on the four design questions in the plan item: (1) where
budgets are declared (the plan recommends role frontmatter via the existing
ROLE_FRONTMATTER mechanism — adopt or argue against), (2) cross-host degradation via
declared enforcement levels following C1 (enforces.tool_budget: native | prompt-only),
(3) MCP as mechanism vs vocabulary — the plan recommends starting with host-native tool
pinning and deferring an MCP mediation layer ("ship the seam, not the server"); if you
agree, the ADR's Decision says so and Consequences names what is deferred; if you
disagree, argue it in Alternatives, (4) recording the dispatched budget on the workstream
gate for the audit trail.

Include: Context, Decision, per-host enforcement table, gate-schema addition, Alternatives
considered, Consequences (including the honest limitation that prompt-only hosts cannot
enforce), and an Implementation sketch section listing the touched files. Status: Proposed.

Done means: the ADR file, committed. NO code. End your report with the 3 questions a human
reviewer most needs to rule on.
```

---

## Prompt 4.1c — Implement ADR-004 (only after human approval)

```
PRECONDITION: docs/adr/004-role-tool-budgets.md exists with Status: Accepted. If its
status is not Accepted, STOP immediately and report. 

TASK: Implement ADR-004 exactly as written, as 2-3 commits on branch feat/role-tool-budgets:
(1) claude-code native enforcement — role frontmatter tools: pinning via the existing
ROLE_FRONTMATTER mechanism in hosts/claude-code/adapter.js, with the warn-on-missing
safety net preserved; (2) capability plumbing — enforces.tool_budget in every
hosts/*/capabilities.json, assertCapabilities warning (not blocking) on prompt-only hosts,
dispatched budget recorded on the workstream gate per the ADR's schema addition, gate
schema + validator updated; (3) tests + docs — adapter-contract tests for budget rendering
per host, gate-schema tests, FEATURES.md row, concepts.md role row, conventions.md if the
ADR added markers.

Where the ADR is silent, follow the nearest existing pattern (C1 write-enforcement is the
template) and list the inference in your report. Where the ADR conflicts with code
reality, STOP and report — do not improvise around an approved design.

Done means: npm test / eslint / npm run consistency green; CHANGELOG entry; report maps
each ADR decision point to the code that realizes it.
```

---

## Prompt 4.3 — G3 production feedback seam

```
TASK: Implement plans/phase-4-capability-roadmap.md, item 4.3. Read it in full; check
plans/phase-4-ground-truth.md for deltas. Branch: feat/production-feedback-seam

SCOPE GUARD — this is deliberately effort-1: a template, a convention, one optional gate
field, one mention in pipeline-complete output. NO integrations, NO automated ingestion,
NO new commands. BACKLOG explicitly deprioritized integration work (F2/F3/F5); the file
IS the integration seam.

1. templates/production-feedback-template.md: operator-curated; sections keyed by the
   brief's metric/SLO names plus an incidents list. Model it on the structure and tone of
   existing templates (read 2-3 first, e.g. retrospective-template.md). Register it
   wherever templates are indexed (templates/README.md).
2. Stage-09 (retrospective): include pipeline/production-feedback.md in readFirst when
   present ([verify-first]: check whether readFirst supports optional entries — look for
   any existing conditional readFirst handling; if unsupported, add an "optional" marker
   handled at render time, smallest possible change). Retrospective rules/role guidance
   gains a short "production deltas vs brief SLOs" section.
3. Retrospective gate: optional field production_feedback_reviewed: true|false|"absent" —
   add to the stage's gate skeleton in stages.js, the gate schema, and the stage's rules
   file gate section.
4. devteam next on pipeline-complete: if pipeline/production-feedback.md is absent, ONE
   line in the output suggesting it as an optional follow-up.
5. Docs: docs/conventions.md entry (matching its catalogue format), FEATURES.md row,
   cross-link from docs/runbooks/open-followups.md.

Tests: template registered (contract tests cover template existence — extend); gate field
validates; pipeline-complete output line present/absent correctly.

Done means: npm test / eslint / npm run consistency green; CHANGELOG entry.
```

---

## Prompt 4.4 — Draft ADRs 005–008 (one session per ADR)

Run as four separate sessions; each uses this template with the bracketed slot filled:

```
TASK: DRAFT (do not implement) docs/adr/00N-<slug>.md for open question [N] from
plans/phase-4-capability-roadmap.md item 4.4. Branch: docs/adr-00N-<slug>

[Slot — pick one:]
[ADR-005 standing grants: read the C6 authority-binding work first (git show 1647d5d,
 a2455b1) — a standing grant must produce the same per-decision audit record on the gate
 chain as a per-invocation grant. Must answer: where grants live (config?), revocation,
 how a grant materializes on the chain.]
[ADR-006 track inference under autonomy: read core/guards/stoplist.js, the assess/track
 inference code, and the Phase-1.1 stoplist-in-driver work. The stoplist is the floor;
 this ADR sets the ceiling: when may `devteam run` trust an inferred track unconfirmed?
 Quote the design doc: "Wrong-track autonomy is a 10× cost error."]
[ADR-007 liveness/heartbeat: read the driver loop and run-log.jsonl event shapes. Define
 stall (output but no gate progress) as distinct from the wall-clock timeout; propose
 heartbeat events + an operator surface (devteam run --watch or status).]
[ADR-008 exit semantics: read how devteam run exits today and what advise reports
 post-run. Decide the exit code for "completed but advise reports blockers" and its CI
 implications. The smallest ADR — keep it one page.]

Requirements for all: read docs/autonomous-execution-design.md §7's framing of this
question first; match the structure of existing ADRs in docs/adr/; Status: Proposed;
include Alternatives and an honest Consequences section; end your report with the
questions a human reviewer must rule on. NO implementation.
```

**H3 (recipe factory): no prompt exists deliberately.** It stays gated on run-log evidence
of recurring failure classes, per ADR-003. Write its prompt only when that evidence exists.
