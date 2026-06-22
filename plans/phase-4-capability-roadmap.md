# Phase 4 — Capability Roadmap

**Goal:** resume the planned capability work from docs/BACKLOG.md and ADR-003, in priority
order. Unlike Phases 1–3, these items involve **design judgment**. The pattern for each:
**ADR first, implementation second.** Have Sonnet draft the ADR from the brief below, get human
review/approval of the ADR, *then* hand Sonnet the implementation. Do not let an implementation
session start without an approved ADR — wrong-design autonomy is this phase's failure mode, and
the project's own design doc says it best: "Wrong-track autonomy is a 10× cost error."

**Prerequisites:** Phases 1–2 complete. Phase 3 can proceed in parallel.

---

## 4.0 Ground truth check (do this first, half a day)

Recent work may have moved the targets. Before any 4.x item:

1. **Progress-based convergence may be partially landed.** Commit `bf048a9`
   ("fix(driver,orchestrator): surface missing peer-review workstreams; halt on no-progress fix
   cycles") post-dates the review's source documents. Read that diff (`git show bf048a9`),
   plus docs/autonomous-execution-design.md §4.1 ("Grounding correction" — the doc previously
   stated the progress-based breaker "is *not* actually implemented") and the per-attempt gate
   archiving feature (`3d0b16f`). Write down exactly what exists: what counts as "progress",
   where it's computed, what's still count-based. Item 4.2's scope is the delta.
2. Re-read docs/BACKLOG.md's open items — confirm G10 is still the only open top-tier item and
   that none of 4.3/4.4's targets landed meanwhile.
3. Confirm the four open questions in docs/autonomous-execution-design.md §7 are still open
   (standing grants, track inference for autonomy, heartbeat/liveness, exit-code semantics when
   advise still reports blockers).

Output: a short `plans/phase-4-ground-truth.md` notes file. Adjust the items below against it.

---

## 4.1 G10 — MCP-based role tool budgets (the open top-tier backlog item)

**What BACKLOG.md says:** per-role tool budgets via MCP; flagged "waiting costs position."

**ADR brief (draft `docs/adr/004-role-tool-budgets.md`):**
- **Problem:** roles currently differ only in prompt + model + allowedWrites. A QA role and a
  backend role on claude-code both get the host's full tool surface. Tool-level least-privilege
  (e.g. reviewer gets read-only tools; QA gets shell but no write outside test dirs) is the
  natural next enforcement ring around allowedWrites.
- **Design questions the ADR must answer:**
  1. Declaration: where does a role's tool budget live? (Proposal: a `tools:` block in the role
     frontmatter that hosts/claude-code/adapter.js already manages via `ROLE_FRONTMATTER` —
     claude-code subagents support tool pinning today, so claude-code is the reference
     implementation.)
  2. Cross-host degradation: codex/gemini/generic can't enforce tool budgets. Follow the
     established C1 pattern — declare enforcement level per host in capabilities.json
     (`enforces.tool_budget: "native" | "prompt-only"`), surface the level in the dispatch
     plan, and have `assertCapabilities` warn (not block) on prompt-only hosts.
  3. MCP specifically: is MCP the mechanism (a stagecraft MCP server mediating tool access) or
     just the inspiration (budgets expressed in MCP-tool vocabulary)? The ADR must pick.
     Recommendation to evaluate first: start with **host-native tool pinning** (claude-code
     subagent `tools:` frontmatter — near-zero new machinery) and defer an MCP mediation layer
     until a second host can enforce it; ship the contract, not the server.
  4. Gate visibility: dispatched tool budget recorded on the workstream gate (like host/model
     are today) so the audit trail shows what the role *could* do.
- **Implementation sketch (post-ADR):** extend role frontmatter table
  (hosts/claude-code/adapter.js:34-119), capabilities.json schema + `assertCapabilities`,
  dispatch-plan rendering, gate field + schema, contract tests in
  tests/adapter-contract.test.js, docs (FEATURES.md, concepts.md role row).

**Sizing:** ADR 1 session; implementation 2–3 PRs (claude-code native, capability plumbing,
docs/tests).

---

## 4.2 Progress-based convergence (complete the design-doc spec)

**Scope = the delta found in 4.0.** The design intent (autonomous-execution-design.md §4.1):
the fix-and-retry breaker should trip on **no progress** (same blockers recurring across
attempts), not just attempt count. Per-attempt gate archiving (`3d0b16f`) landed as the
prerequisite; `bf048a9` added a "halt on no-progress fix cycles" — 4.0 determines how much of
the spec it implements.

**Likely remaining work (validate against 4.0 notes):**
1. **Progress metric definition:** compare consecutive archived attempt gates for the same
   stage: blocker-set delta (normalized text or stable IDs if blockers carry them), AC-mapping
   delta, test pass-count delta from the orchestrator-stamped fields (the stamped fields are
   trustworthy by construction — prefer them over model-asserted ones).
2. **Interactive-path parity:** the driver compensates for trusting `gate.retry_number`
   (model-written) with its own counter, but interactive `devteam next` still reads the
   model-written field (orchestrator.js:1228 region). Derive attempt count from the archive
   (count archived gates for the stage) instead — removes an agent-falsifiable input from the
   convergence decision on *both* paths.
3. **Operator surface:** when the breaker trips, `fix_steps`/halt output should say *what
   didn't change* ("blocker 'X' identical across attempts 2,3") — that's the escalation
   evidence the Principal needs (feed it into the escalation context the same way existing
   halts do).
4. Update docs/autonomous-execution-design.md §4.1 to describe the implemented state, and
   autonomous-run.md limitations (which Phase 2 rewrote) accordingly.

**Tests:** archive fixtures with identical/different blocker sets across attempts → breaker
trips/doesn't; interactive parity test (attempt count from archive, ignoring a falsified
`retry_number`).

**Sizing:** 1–2 PRs. No ADR needed — ADR-003 already covers the design; this is completion.

---

## 4.3 G3 — production feedback loop (effort-1 per BACKLOG)

**What exists:** template-only (per BACKLOG.md G3 note). The idea: retrospective (stage-09)
should ingest *production* signals (incidents, metric regressions vs the brief's SLOs), closing
the loop the brief opened (the sms-opt-in example brief already declares named metrics + SLOs).

**Keep it effort-1 — resist scope creep into an integrations platform (BACKLOG explicitly
deprioritized F2/F3/F5 integrations; honor that):**
1. Define `pipeline/production-feedback.md` (template + conventions entry): operator-curated,
   freeform sections keyed by brief metric/SLO names plus an incidents list. No automated
   ingestion — the file *is* the integration point; Jira/Datadog automation can write it later
   without framework changes.
2. Stage-09 (retrospective) `readFirst` includes it when present; rules/stage-09 retrospective
   guidance gains a "production deltas vs brief SLOs" section; retrospective gate gains an
   optional `production_feedback_reviewed: true|false|"absent"` field.
3. `devteam next` on a completed pipeline: if the file is absent, mention it in the
   pipeline-complete output as an optional follow-up (one line, not a nag).
4. Docs: conventions.md entry, FEATURES.md row, open-followups runbook cross-link.

**Sizing:** 1 PR. No ADR (template + one gate field; reversible).

---

## 4.4 ADRs for the four open questions (pre-work for any Phase-3-of-ADR-003 autonomy)

Each is a standalone ADR session — draft from the design doc's §7 framing plus the operational
experience accumulated since:

1. **ADR-005 Standing grants:** can `--auto-rule` classes / `--allow-stage` be granted
   persistently (config) rather than per-invocation? The C6 authority-binding work
   (`1647d5d`) records per-run authority on chained gates — a standing grant must produce the
   same per-decision audit record. Must answer: where grants live, how they're revoked, how a
   grant appears on the gate chain.
2. **ADR-006 Track inference under autonomy:** when is `devteam run` allowed to trust
   `devteam assess`'s inferred track without a human confirming? (Interacts with the Phase 1.1
   stoplist work — the stoplist is the floor; this ADR is about the ceiling.)
3. **ADR-007 Liveness/heartbeat:** unattended runs need a stall detector distinct from the
   wall-clock timeout (model producing output but no gate progress). Define heartbeat events in
   run-log.jsonl + a `devteam run --watch`/status surface.
4. **ADR-008 Exit semantics:** what exit code does a "successful" run return when `advise`
   still reports blockers? (Affects CI consumers of `devteam run`.)

**H3 (recipe factory) stays gated** — ADR-003's own criterion is "evidence of recurring-failure
volume," and the BACKLOG's caveat stands: "a learned recipe is a cached judgment… or it
amplifies stale judgment." Do not start H3 until run-log corpora from real usage show the same
failure class recurring ≥N times; revisit after ADR-005/006 land and the framework has
accumulated actual autonomous runtime.

---

## Explicitly not on this roadmap (decided, don't relitigate)

Per docs/BACKLOG.md's own deprioritizations, which the review endorsed: IDE/VS Code adapters
(A2/E3 — "maintenance treadmill"), Jira/Slack/pre-commit integrations (F2/F3/F5 — "none changes
what Stagecraft can do"; G3's file-contract covers the need), self-modifying pipeline (G9 —
"premature"), documentation gate (B6). The moat is the gate-JSON state contract + the verification
spine; breadth of integrations is not.

## Sequencing & exit criteria

4.0 → 4.2 (completes shipped-but-unfinished work; highest trust ROI) → 4.1 (the position-
sensitive bet) → 4.3 → 4.4 (ADRs, interleaved as discussion bandwidth allows).

**Phase exit:** G10 shipped with per-host enforcement levels declared; convergence breaker
progress-based on both paths with no agent-falsifiable inputs; production feedback contract shipped;
four ADRs accepted or explicitly rejected. H3 remains gated on evidence, by design.
