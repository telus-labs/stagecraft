# ADR 011 — Authenticated gate chain

**Status:** Accepted
**Date:** 2026-06-19
**Authors:** Mumit Khan, Codex

## Context

The existing gate chain records a canonical SHA-256 hash of each predecessor.
That detects an isolated edit, but an actor who can rewrite the gate directory
can recompute every downstream hash. The chain is tamper-evident only while a
trusted copy of a later hash exists outside the rewritten directory.

Stagecraft needs a stronger local and CI control without making a cloud key
provider part of the host-neutral core. Existing unsigned projects must remain
readable, and secrets must not appear in config files, command-line arguments,
gate JSON, or logs.

## Decision

When `DEVTEAM_SIGNING_SECRET` is a non-empty string, every automatic or manual
chain stamp adds:

```json
{
  "mac_algo": "hmac-sha256-canonical-json",
  "mac": "hmac-sha256:<hex>"
}
```

The HMAC-SHA256 payload is sorted-key canonical JSON of the complete gate,
including `chain.prev_hash`, `chain.algo`, and `chain.mac_algo`, and excluding
only `chain.mac`. The shared secret is sourced exclusively from the environment.
Stamping refuses to overwrite an already authenticated gate when the secret is
unavailable, preventing an accidental downgrade during a later local run.

Verification always rejects a malformed, unsupported, or mismatched MAC when a
secret is available. With no secret, signed gates are reported as unverified.
Unsigned gates are warnings by default for compatibility. Operators opt into a
strict anti-downgrade policy with `devteam verify-chain --require-signed` or
`pipeline.require_signed_gates: true`; strict mode rejects unsigned, unstamped,
or unverifiable gates.

Asymmetric signing through KMS is deferred behind a future provider-neutral
signer contract. Provider identifiers, key references, and credentials must not
be added directly to the base gate schema.

## Consequences

An actor without the shared secret cannot alter a gate and produce a valid MAC.
Recomputing the ordinary hash chain does not satisfy signed-only verification.
CI can therefore protect history by holding the secret outside the repository
and requiring signed verification before promotion.

HMAC does not distinguish among principals that know the shared secret. Secret
custody, rotation, log masking, and access to trusted stamping jobs remain part
of the deployment security boundary. Rotation requires deliberately re-signing
the retained chain or retaining the old secret for old evidence.

The gate shape changes only through optional provider-neutral fields, preserving
legacy compatibility. JSON verification output gains additive arrays for
unsigned gates, invalid MACs, and signatures that could not be verified.

## Alternatives considered

**Keep hash-only chaining.** Rejected because a cascading rewrite can produce a
self-consistent chain without possessing any external trust material.

**Require signatures immediately.** Rejected because existing projects and
local workflows do not have key provisioning. Explicit strict mode provides a
safe migration path.

**Add a cloud KMS provider directly.** Deferred because the current chain API is
synchronous and provider-neutral. Selecting one vendor would leak network,
credential, retry, and key-reference concerns into the core contract before a
general signer interface exists.
