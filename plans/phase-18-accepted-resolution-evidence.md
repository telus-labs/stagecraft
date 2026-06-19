# Phase 18 — Accepted Resolution Evidence

**Status:** Item 18.1 implemented; pending merge.
**Roadmap item:** Audit P3-1 follow-through / GitHub #142 evidence acquisition.
**Decision:** [ADR-012](../docs/adr/012-explicit-resolution-acceptance.md).
**Purpose:** make H3's human-accepted, derivable-resolution threshold measurable without
learning or applying recipes.

---

## 1. Why this phase exists

Phase 17 made D5 dispatch history durable. It intentionally left H3's accepted-resolution
signal unavailable because a later PASS cannot prove what a human accepted. Phase 18
adds the smallest explicit operator action needed to establish that fact while keeping
free-form resolution content local and outside evidence exports.

## 2. Work items

### 18.1 — Explicit acceptance and portfolio readiness

- Add `devteam evidence accept-resolution --yes` with bounded isolation support.
- Bind acceptance to one present `fix-retry` and require its current stage gate to PASS.
- Record only allowlisted categories, hashes, and a derivability boolean.
- Aggregate accepted resolutions by stage, failure class, and gate-schema fingerprint.
- Require two projects, at least three accepted observations of one cross-project
  signature, and at least 80% derivability before H3 reports threshold met.
- Preserve strict schema 1.0 compatibility through optional aggregate fields.
- Keep recipe creation and lookup disabled pending evidence review.

### 18.2 — Real-project collection and review (operational, not code)

1. Run at least five autonomous fix/retry flows in each of two independent projects.
2. After reviewing a successful retry, explicitly record acceptance with `--yes`.
3. Retain the ignored run log and periodically inspect local evidence status.
4. Export one consented bundle per project and run portfolio analysis.
5. Review GitHub #142 only when the portfolio reports
   `threshold-met-review-required`; do not infer readiness from local counts alone.

## 3. Acceptance criteria

1. Acceptance cannot be recorded without an unaccepted retry and a current PASS gate.
2. The analyzer ignores orphaned, duplicate, or field-mismatched acceptance records.
3. No blocker, reason, prompt, response, path, transcript, feature text, credential, or
   repository identity enters the event or bundle.
4. Existing v1 bundles remain valid and analyzable.
5. H3 remains disabled after thresholds are met until a separate human review and
   implementation decision.
6. Full tests, lint, consistency, and changelog guard pass.

## 4. Capability posture after Phase 18

H3 evidence is now collectible. H3 itself remains parked behind GitHub #142. D5,
standing grants, and active stall response remain independently gated by #143–#145.
