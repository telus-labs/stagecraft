# ADR 012 — Explicit Resolution Acceptance Evidence

**Status:** Accepted
**Date:** 2026-06-19
**Authors:** Stagecraft contributors

## Context

H3 recipe suggestions require evidence that recurring failures have resolutions a human
actually accepted. A later PASS gate is insufficient: it can prove the stage passed,
but not which retry resolved it, whether the operator accepted that resolution, or
whether an existing deterministic clear-gate recipe could derive it.

The evidence boundary must also exclude blocker text, prompts, responses, paths,
transcripts, and repository identity. Acceptance therefore cannot copy the proposed
resolution into the run log or export bundle.

## Decision

Stagecraft records acceptance only through the explicit command:

```bash
devteam evidence accept-resolution --yes
```

The command selects the latest unaccepted `fix-retry` in the bounded pipeline, requires
its current stage gate to be `PASS`, and appends one `resolution-accepted` event. The
event binds to the retry with a SHA-256 digest over allowlisted typed fields and records
only stage, failure class, stage-schema fingerprint, and whether the retry used an
existing deterministic clear-gate recipe. Acceptance is serialized with an exclusive
lock, and malformed, incomplete, oversized, unreadable, or symlinked logs are refused.

Analysis counts an acceptance only when the referenced retry is present in the same
bounded log and its stage, failure class, and derivability agree. Duplicate references
count once. Export adds optional aggregate `resolutions` rows and an optional durable
dispatch quality counter to schema 1.0 so existing v1 bundles remain readable. Sparse
rows remain suppressed.

Meeting an H3 threshold produces `threshold-met-review-required`; it never creates a
recipe or enables H3 automatically.

## Consequences

- Human acceptance is explicit and attributable to a concrete retry without exporting
  free-form resolution content.
- Old logs remain valid but cannot contribute accepted-resolution evidence.
- The command is a narrow evidence mutation; status and portfolio analysis remain
  read-only and all evidence processing remains offline.
- The digest establishes internal binding, not authorship or protection against a
  malicious local actor who can rewrite the complete log.
- Schema fingerprints separate superficially similar failures whose gate contracts
  differ across Stagecraft versions.

## Alternatives considered

- **Infer acceptance from a later PASS.** Rejected because it does not identify the
  accepted retry or prove a human decision.
- **Store the resolution text.** Rejected because it expands the privacy and secret
  exposure boundary and is unnecessary for readiness measurement.
- **Accept automatically when a run completes.** Rejected because completion is not
  human acceptance and would make the evidence circular.
- **Introduce export schema 2.0.** Rejected because optional aggregate fields preserve
  strict backward compatibility without weakening validation.
