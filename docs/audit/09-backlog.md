# 09 — Prioritized audit backlog

## Systemic themes

1. **Trust boundaries must include presentation.** Gate validation, command execution,
   and filesystem scope are rigorous, but the dashboard treats model-authored gate
   data as trusted HTML.
2. **Portability needs an evidence ladder.** Windows implementation has landed, yet
   docs say POSIX-only and CI never runs on Windows. Implemented, simulated, and
   supported need explicit promotion criteria.
3. **Delivery velocity outran lifecycle reconciliation.** The backlog, feature
   catalog, concepts, guides, contributor counts, comments, and comparative analysis
   disagree about shipped behavior.
4. **Bounded autonomy is now a structural subsystem.** The 897-line `driver.run()`
   concentrates the product's state-transition risk despite strong tests.
5. **Evidence-gated learning remains correct.** D5, H3, ADR-005, and ADR-007 Tier 2
   need real-run evidence, not calendar-driven implementation.

## P0 — Fix now

No P0 findings. The build is not broken, no critical/high dependency or secret issue
was found, and no data-corruption path was verified.

## P1 — Quick wins

### P1-1 — Make dashboard rendering text-safe

- **Theme:** Trust boundaries must include presentation.
- **Sources:** S-1, T-2, Q-2.
- **Description:** Replace raw gate-string interpolation with text nodes or escaping,
  add a hostile-gate browser/DOM test, and set a restrictive CSP.
- **Affected components:** `core/ui/static/app.js`, `core/ui/server.js`, UI tests.
- **Effort:** S.
- **Risk of change:** medium.
- **Risk of NOT changing:** high.
- **Dependencies:** none.
- **Confidence:** HIGH.

### P1-2 — Add a native Windows smoke lane

- **Theme:** Portability needs an evidence ladder.
- **Sources:** T-1, D-5.
- **Description:** Run Node 22 on `windows-latest` for CLI loading, init/doctor,
  command parsing, and process termination. Promote Windows from experimental to
  supported only after this lane is stable.
- **Affected components:** `.github/workflows/test.yml`, portability tests, docs.
- **Effort:** S.
- **Risk of change:** low.
- **Risk of NOT changing:** medium.
- **Dependencies:** none.
- **Confidence:** HIGH.

### P1-3 — Reconcile shipped facts and stale commentary

- **Theme:** Delivery velocity outran lifecycle reconciliation.
- **Sources:** C-1, C-2, D-1 through D-5, D-7, D-8.
- **Description:** Move B3/B6 to shipped, reframe A6, correct tool-budget authority and
  `checks_performed`, normalize test-count language, fix plan links, and remove
  expired phase/version promises.
- **Affected components:** current product/contributor docs, `plans/`,
  `core/driver.js`, `core/config.js`, `core/memory/embed.js`.
- **Effort:** M.
- **Risk of change:** low.
- **Risk of NOT changing:** medium.
- **Dependencies:** P1-2 determines final Windows wording.
- **Confidence:** HIGH.

### P1-4 — Close the UI heartbeat lifecycle

- **Theme:** Trustworthy long-lived tooling.
- **Source:** R-2.
- **Description:** retain and clear the heartbeat timer on server close/listen failure;
  add a lifecycle assertion.
- **Affected components:** `core/ui/server.js`, `tests/ui.test.js`.
- **Effort:** XS.
- **Risk of change:** low.
- **Risk of NOT changing:** low.
- **Dependencies:** bundle with P1-1.
- **Confidence:** HIGH.

## P2 — Targeted improvements

### P2-1 — Bound transcript memory while preserving durable logs

- **Theme:** Trustworthy long-lived tooling.
- **Source:** R-1.
- **Description:** stream host output to disk and keep a bounded tail in memory, or
  enforce a byte ceiling with an explicit truncation marker.
- **Affected components:** `core/adapters/headless.js`, headless/log tests.
- **Effort:** M.
- **Risk of change:** medium.
- **Risk of NOT changing:** medium.
- **Dependencies:** none.
- **Confidence:** HIGH.

### P2-2 — Decompose the autonomous driver by transition

- **Theme:** Bounded autonomy has become a structural subsystem.
- **Source:** Q-1.
- **Description:** characterize the state machine, then extract pure action handlers
  with a common transition result. Keep locking, loop ownership, and final persistence
  in `run()`; do not mix behavior changes into extraction PRs.
- **Affected components:** `core/driver.js`, driver/repair/convergence tests.
- **Effort:** L.
- **Risk of change:** high.
- **Risk of NOT changing:** medium and rising.
- **Dependencies:** P1-3 comment correction; freeze new driver features during work.
- **Confidence:** HIGH.

### P2-3 — Extend consistency to stable schema/support facts

- **Theme:** Delivery velocity outran lifecycle reconciliation.
- **Source:** Q-3.
- **Description:** check documented gate vocabulary against schemas and centralize
  support-state metadata. Remove volatile test counts or retain one approximation;
  do not generate them everywhere.
- **Affected components:** `scripts/consistency.js`, meta tests, current docs.
- **Effort:** M.
- **Risk of change:** low.
- **Risk of NOT changing:** medium.
- **Dependencies:** P1-3 establishes the corrected baseline.
- **Confidence:** HIGH.

## P3 — Strategic investments

### P3-1 — Build a real-run evidence acquisition loop

- **Theme:** Evidence-gated learning remains the right strategic posture.
- **Sources:** GitHub #142, #143, #144, #145.
- **Description:** provide an opt-in, privacy-reviewed evidence bundle and a command
  reporting gate-condition readiness, then retain privacy-bounded per-workstream
  dispatch observations during normal autonomous runs and explicitly bind human
  acceptance to successful fix/retry events. This makes thresholds visible and
  collectible; it does not bypass them or implement gated capabilities.
- **Affected components:** run-log/gate archive tooling, docs, privacy model.
- **Effort:** L.
- **Risk of change:** medium.
- **Risk of NOT changing:** high strategically.
- **Dependencies:** redaction, consent, and project-identity proposal.
- **Confidence:** MEDIUM.
- **Status:** Phase 16 delivered readiness/export; Phase 17 delivered durable dispatch
  history; Phase 18 delivered H3 accepted-resolution evidence in PR #262. Real-project
  collection and human review remain outstanding.

### P3-2 — Evaluate an upstream conversational refinement contract

- **Theme:** Competitive differentiation without losing the gate seam.
- **Source:** BACKLOG E9 and refreshed comparative analysis.
- **Description:** prototype a host-neutral session capability for requirements/design/
  clarification that ends in the same artifact and gate contract. Validate whether it
  improves brief quality rather than duplicating host-native chat.
- **Affected components:** adapter contract, upstream commands, evaluation plan.
- **Effort:** XL.
- **Risk of change:** high.
- **Risk of NOT changing:** low.
- **Dependencies:** five user reports of upstream rigidity; ADR for contract changes.
- **Confidence:** MEDIUM.

## Parked

- **Evidence-gated implementations:** D5, H3, ADR-005, and ADR-007 Tier 2 remain
  parked behind GitHub #142–#145. `devteam run --watch` is separable UX.
- **Coverage threshold:** revisit after three stable snapshots or an escaped regression.
- **Split `core/orchestrator.js`:** prior >1,000-line trigger is met, but named
  functions remain coherent; driver decomposition has higher value.
- **Onboarding video/GIF:** CI-executed text onboarding remains stronger.
- **Hash-verify Hugging Face downloads:** revisit after an incident or adopter demand.
- **SQLite/vector memory backend:** revisit above measured 100ms query latency.
- **Real-contention approval test:** revisit after an observed corruption incident.

## Current GitHub state (2026-06-19)

| Issue | Audit disposition |
|---|---|
| #145 ADR-007 Tier 2 | Parked until real stall events satisfy criteria |
| #144 ADR-005 standing grants | Parked until repair/ceiling evidence exists |
| #143 D5 adaptive routing | Parked until comparative real-run telemetry exists |
| #142 H3 recipe factory | Parked until recurring, accepted, mostly derivable cross-project resolutions exist |

## Prior-audit closure record

- Replay refactor closed by CLI/gate extraction and restore mode (`f3d87ca`,
  `79429aa`).
- Log JSON schema closed by `docs/observability.md` “Pipeline log JSON”.
- Backlog noise closed by `f6b5a3c`, which created the Shipped table.
- Prior parked items remain represented above.

## Project-Specific — pre-2026-06-18 observations

- `eslint-plugin-security` → **closed:** shipped in v0.6.0; lint passes.
- Changelog fragments → **closed:** `changelog.d` and CI guard shipped in v0.6.0;
  PR #222's failure demonstrated enforcement.
- Enforce “verify before promoting” → **closed:** direct `verified_by` evidence and
  structural tests shipped in `6b4e100`; this audit follows that contract.

No `docs/audit-extensions.md` file is present.
