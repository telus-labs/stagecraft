# Phase 9 — Evidence-Gated Capabilities

**Goal:** resume capability work in the ADR-first pattern, now that the gates ADR-003 set
have started to open: real pipeline runs exist, their failure data is on disk, and the
deferred autonomy questions (heartbeat, standing grants, exit semantics) are blocking
further autonomy expansion. Workflow per item: ground-truth/ADR → human approval →
implementation. Never implement against an unapproved ADR.

Prerequisites: Phases 5–6 merged (state integrity and promise integrity are the
foundation everything here builds on). Phase 8's release is independent.

---

## 9.1 ADR-007 — Liveness/heartbeat (draft first; implement after approval)

**Why first:** unattended runs are now real, and the gap is admitted in
`docs/runbooks/autonomous-run.md`: "A hung dispatch … is invisible to the driver until
it exits." Every further autonomy investment compounds on a loop that can silently hang.

**ADR brief (docs/adr/007-liveness-heartbeat.md):** read the driver loop, the headless
invoke timeout machinery (`core/adapters/headless.js` SIGTERM→SIGKILL), and
run-log.jsonl event shapes first. The ADR must define: *stall* (host process alive and
producing output but no gate progress) as distinct from the wall-clock timeout; a
heartbeat event the driver emits per iteration plus a dispatch-progress probe (e.g. log
file growth vs gate mtime); the operator surface (`devteam run --watch` or a `status`
read of run-state + last heartbeat age); and what the driver does on stall detection
(classify as transient vs structural — reuse the existing dispatch classifier
vocabulary). Status: Proposed; end the draft session with the questions a human must
rule on.

**Implementation (post-approval, 1–2 PRs):** heartbeat events in run-log.jsonl; stall
detector with a conservative default threshold; runbook updates (autonomous-run halt
table + troubleshooting index row); tests with injected clocks/sleeps per the driver's
existing injection seams.

---

## 9.2 H3 — Recipe factory, ground-truth first

**The gate has evidence now.** ADR-003 gated H3 on "evidence of recurring-failure
volume." The five post-release fix fragments (#106, #108/#109, stale-log,
06d-no-dispatch, no-source-change) ARE recurring derivable failures, and run-log.jsonl +
`pipeline/gates/archive/` are the corpus. Nobody has connected them.

**9.2a Ground-truth (read-and-report, one session):** inventory what the corpus actually
contains across the real runs to date: how many distinct failure classes, how many
recurrences each, what fraction of fix-retry cycles a recipe already handled vs halted
for a human. Output `plans/h3-ground-truth.md`. If the honest answer is "one project,
too few runs," H3 stays gated — say so and stop; the BACKLOG caveat stands ("a learned
recipe is a cached judgment… or it amplifies stale judgment").

**9.2b ADR-009 — recipe suggestion, not recipe learning (only if 9.2a justifies):** the
shape that honors the caveat: a `devteam recipes suggest` analyzer that mines run-logs +
archives for recurring (failure-class, resolution) pairs and emits a *proposed recipe
diff* for `core/pipeline/fix-recipes.js` — a PR for human review, never auto-applied,
never runtime-learned. The ADR must define the mining heuristics, the evidence threshold
for a proposal, and why suggestion-not-application is the permanent boundary (or argue
otherwise). Implementation only after approval.

---

## 9.3 ADR-005 (standing grants) and ADR-008 (exit semantics) — drafts

Both briefs survive verbatim in `plans/phase-4-capability-roadmap.md` §4.4 and the
prompt templates in `plans/prompts/ALL-PROMPTS.md` (Phase 4 §4.4) — use them as written,
with one update each:
- **ADR-005:** must now also cover standing grants for **tool budgets** (G10 landed
  since the brief was written) — a persistent budget override is the same auditability
  problem as a persistent `--auto-rule` class.
- **ADR-008:** the ground-truth Q4 finding still holds ([verify-first] re-confirm):
  `devteam run` exits 0 on `pipeline-complete` with pending advise blockers. The ADR
  decides the contract; the implementation is a small follow-up PR.

ADR-005 implementation is expected to be non-trivial (config schema + chain-bound audit
records) — scope it in the ADR; ADR-008 implementation is one PR.

---

## 9.4 D5 maturation — continuous adaptive routing (strategic bet, last)

The surviving long-horizon BACKLOG bet. Do not start until: ADR-007 is implemented
(routing experiments need trustworthy run telemetry), and there are enough real runs for
per-(role, host) pass-rate data to be signal rather than noise — the framework's own
stated uncertainty ("converges with small samples or just chases noise") is the
acceptance question. First deliverable is an evidence review, not code: does
`routing:suggest` on the accumulated data produce recommendations a human agrees with in
hindsight? Write that up; let it decide whether continuous routing gets an ADR.

---

## Sequencing & exit criteria

9.1 ADR draft immediately (it blocks autonomy work); 9.2a ground-truth in parallel
(read-only). Implementations strictly post-approval. 9.3 drafts as review bandwidth
allows; 9.4 last and evidence-gated.

**Phase exit:** heartbeat shipped (no invisible hangs); H3 either implemented as
suggestion-only or explicitly re-gated with the evidence written down; ADRs 005/008
decided (accepted or rejected — either closes the question); the adaptive-routing bet
has its evidence review. At that point the ADR backlog from the original
autonomous-execution design is fully dispositioned.
