# 10 — Sequenced roadmap

## Roadmap posture

There is no emergency batch. Highest priority closes a browser trust boundary and
turns recently landed portability work into evidence-backed support. The next
structural investment is the autonomous driver; learning features remain gated on
real operational data.

## Batch 1 — Immediate

No P0 work. PR #232 is the only current merge gate: it resolves GitHub #231 with an
npm deploy adapter and is green. Merge it before overlapping deploy-adapter work.

## Batch 2 — Weeks 1–2

### PR 2.1 — Safe dashboard rendering and lifecycle

- **Items:** P1-1, P1-4.
- **Order:** add text-safe helpers/CSP; convert renderers; add hostile-gate and timer
  lifecycle tests.
- **Parallelism:** atomic internally; can run beside PR 2.2.
- **Verification:** hostile markup remains text, no executable node is created, current
  UI states remain correct, and close clears watcher/clients/timer/server.
- **Infrastructure:** browser/DOM harness only if existing tooling cannot cover it.
- **Estimate:** 1–2 days.

### PR 2.2 — Windows confidence lane

- **Item:** P1-2.
- **Order:** add Node 22 `windows-latest` smoke; fix only failures in the promised
  portability surface; then update support wording.
- **Parallelism:** can run beside PR 2.1.
- **Verification:** quoted executable paths, PATHEXT lookup, timeout tree termination,
  init, doctor, and CLI help pass natively.
- **Infrastructure:** one Windows Actions job, not a full version matrix initially.
- **Estimate:** 1 day plus stabilization.

### PR 2.3 — Current-truth documentation reconciliation

- **Item:** P1-3.
- **Order:** merge PR 2.2 first; correct canonical ownership, schema fields, counts,
  links, comments, and provider errors.
- **Parallelism:** draft beside PR 2.2; merge after it.
- **Verification:** consistency, link scan, lint, and targeted grep for D-1–D-8.
- **Infrastructure:** none.
- **Estimate:** 1 day.

## Batch 3 — Weeks 3–6

### PR 3.1 — Bounded transcript writer

- **Item:** P2-1.
- **Order:** characterize rotation/durability/tee; implement streaming or byte ceiling;
  add high-volume and timeout tests.
- **Parallelism:** can run beside driver-refactor design.
- **Verification:** memory does not scale with transcript size; logs are durable before
  resolution; truncation is explicit; rotation still passes.
- **Estimate:** 2–3 days.

### PRs 3.2a–3.2c — Autonomous-driver transition extraction

- **Item:** P2-2.
- **Order:** characterization/result type; dispatch/transient handlers; then
  fix/ruling/merge handlers. No capability changes.
- **Parallelism:** sequential.
- **Verification:** full CI each step; run-state/run-log outcomes unchanged for every
  halt class; no gate/event vocabulary change.
- **Estimate:** 1–2 weeks including review.

### PR 3.3 — Stable-fact consistency checks

- **Item:** P2-3.
- **Order:** start from PR 2.3's corrected docs; add schema-vocabulary and support-state
  checks with violation/clean/baseline fixtures.
- **Parallelism:** beside driver extraction after PR 2.3.
- **Verification:** seeded drift fails, live repository passes, archives stay excluded.
- **Estimate:** 2–3 days.

## Batch 4 — Month 2+

### Proposal 4.1 — Evidence readiness and export (implemented)

- **Item:** P3-1.
- **Proposal:** local `devteam evidence status` plus an explicitly opt-in, redacted
  export bundle; raw artifacts remain local by default.
- **Validation criterion:** two external projects can assess #142–#145 without manual
  archaeology and exports contain no source, prompts, secrets, or personal text.
- **Estimate:** 2–3 weeks including threat/privacy review.
- **Current status:** Phase 16 implements the approved privacy model, local status,
  separately consented aggregate export, project identity lifecycle, and explicit
  portfolio analysis. Phase 17 adds durable allowlisted dispatch observations so D5
  evidence begins accumulating during normal runs. Phase 18 adds explicit hash-bound
  acceptance for successful fix/retry resolutions so H3 readiness can be measured
  without exporting resolution text. Capability gates remain closed pending real
  evidence and review. See
  [`plans/phase-16-evidence-readiness-and-export.md`](../../plans/phase-16-evidence-readiness-and-export.md)
  [`plans/phase-17-durable-evidence-instrumentation.md`](../../plans/phase-17-durable-evidence-instrumentation.md),
  and [`plans/phase-18-accepted-resolution-evidence.md`](../../plans/phase-18-accepted-resolution-evidence.md).

### Proposal 4.2 — Conversational upstream experiment

- **Item:** P3-2.
- **Proposal:** one adapter-neutral session contract for requirements, producing the
  existing brief/gate pair.
- **Validation criterion:** five real users request it and controlled comparison
  improves AC completeness or reduces clarification retries.
- **Estimate:** discovery first; 3–5 weeks if validated.

## Dependency map

- PR 2.1 and PR 2.2 can run concurrently.
- PR 2.3 waits for Windows wording from PR 2.2.
- PR 3.1 and driver-refactor design can run concurrently.
- PR 3.3 waits for PR 2.3 but can run beside driver extraction.
- Proposals 4.1 and 4.2 are independent and do not bypass issue gates.

## Roadmap risks

- Mixing capability work into driver extraction would destroy behavior-equivalence
  confidence. Fix production bugs first with regression tests, then resume extraction.
- Native Windows CI may expose third-party host CLI defects outside Stagecraft's
  obligation; document them separately.
- Escaping can break intentional badges; keep trusted markup narrow and verify visually.
- Evidence export is harmful without redaction and consent; no implementation proceeds
  before a privacy threat model.
- Competitors add integrations quickly. Refresh quarterly, but re-sequence only when
  user evidence aligns with Stagecraft's gate-controlled, multi-host identity.

## Completion criteria

The roadmap is executable when the audit branch passes lint, consistency, and the full
CI-equivalent suite, and current backlog/comparative docs link here without duplicating
gated GitHub work.

## Project-specific extensions

No `docs/audit-extensions.md` file is present.
