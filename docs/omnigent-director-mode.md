# Omnigent Director-Mode Design

Director mode is an experimental Omnigent topology where one Omnigent session
coordinates several Stagecraft workstreams for a single stage. It does not
replace Stagecraft's pipeline core, gate validator, merge behavior, or
host-neutral gate schemas.

## Boundary

The director is a host-side execution strategy only:

- Stagecraft still computes the dispatch plan.
- Stagecraft still knows every expected workstream gate path before invocation.
- Stagecraft still validates every child gate with the existing schemas.
- Stagecraft still merges child gates into the stage gate with the existing
  `mergeWorkstreamGates()` path.
- Stagecraft still blocks on missing, malformed, FAIL, or ESCALATE child gates.

The director may coordinate multiple role prompts inside Omnigent, but it must
produce the same files that independent Stagecraft fan-out would have produced.

## Experimental Flag

Any prototype must be disabled by default and guarded by an explicit config flag:

```yaml
hosts:
  omnigent:
    director_mode:
      enabled: true
      stages:
        - build
        - peer-review
```

The flag is intentionally nested under `hosts.omnigent` because this is an
adapter behavior, not a new Stagecraft track or stage contract. The first
prototype should reject director mode unless the stage is listed in
`director_mode.stages`.

## Gate Production

Before invoking Omnigent, Stagecraft already has a dispatch plan:

```text
stage-04.backend -> pipeline/gates/stage-04.backend.json
stage-04.frontend -> pipeline/gates/stage-04.frontend.json
stage-04.platform -> pipeline/gates/stage-04.platform.json
stage-04.qa -> pipeline/gates/stage-04.qa.json
```

In director mode, Stagecraft would pass that complete plan to one Omnigent
director prompt. The director must write each expected child gate at the exact
path in the plan. It must not write a replacement stage-level gate as a shortcut.

After the director exits, Stagecraft runs the same read/validate/merge sequence
used today:

1. Read every expected child gate path.
2. Validate each child gate against the existing per-stage schema.
3. Block the stage if any child gate is missing or malformed.
4. Preserve FAIL, WARN, PASS, and ESCALATE semantics exactly as today.
5. Merge valid child gates with the existing merge behavior.

This means director mode cannot silently hide a missing workstream. If
`pipeline/gates/stage-04.qa.json` is absent, Stagecraft reports the same missing
workstream gate halt as normal fan-out.

## Schema Rules

Director mode must not add Omnigent-specific fields to gate JSON. Gate identity
continues to use only the host-neutral fields:

- `stage`
- `workstream` or `orchestrator`
- `host`
- `status`
- `track`
- `timestamp`

Any Omnigent session IDs, conversation IDs, policy summaries, or director
coordination metadata belong in adapter-private sidecars such as
`pipeline/logs/<workstreamId>.omnigent.json`, not in gate schemas.

## Write Audit

Allowed writes stay per workstream. A director prototype must compute the union
of all selected workstream write allowlists for the process-level post-hoc audit,
then still rely on each child gate to prove the role-specific work completed.

If one director session writes outside the union, Stagecraft records the write
audit violation and fails the relevant run just as it does for one-workstream
Omnigent execution.

## Prompt Shape

A director prompt should include:

- the stage objective
- one section per planned workstream
- the role prompt path for each workstream
- the artifact path and allowed writes for each workstream
- the exact child gate path each workstream must produce
- the instruction that all child gates are validated independently after exit

The prompt should avoid asking the director to invent a new orchestration model.
Its job is to coordinate execution inside Omnigent while preserving Stagecraft's
observable outputs.

## Prototype Tests

A prototype should add tests that prove:

- the experimental flag is required
- unlisted stages reject director mode
- expected child gate paths are computed before invocation
- missing child gates block exactly as normal fan-out
- malformed child gates block exactly as normal fan-out
- no Omnigent-specific gate fields are accepted or required

Until those tests exist, director mode remains a design only.
