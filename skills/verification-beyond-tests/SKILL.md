---
name: verification-beyond-tests
description: G7 — apply property-based testing, mutation testing, and formal verification as a stage-06d sub-stage. "Tests pass" becomes the floor; this skill raises the ceiling. Use after stage-06 PASS, when the diff contains pure functions / critical business logic / state machines worth verifying beyond examples.
---

# Verification beyond tests — five phases

Unit tests prove the cases the author thought of. The cases nobody thought
of remain unverified. This skill applies systematic verification methods
to make the unverified surface smaller — without pretending to verify
things that aren't verifiable.

## When to use

You're authoring `stage-06d` (verifier role). Stage-06 (qa) already
returned PASS — the floor is in place. The track is `full`, so the
expectation is rigour over speed. Your task: pick the right method per
candidate, apply it, surface findings.

## Phase 1 — Inventory candidates

Scan the diff. For each function/module, classify against the methods:

| Code shape | Method |
|---|---|
| Pure functions over structured data — parsers, validators, codecs, transforms, sort/dedupe, math, normalisation | **Property-based** |
| Critical business logic with example tests — auth, billing, anything with a real test suite | **Mutation** |
| Concurrent state machines, distributed protocols, consistency invariants, security properties | **Formal** |
| Glue, UI, CRUD with thin logic | **Skip with reason** |

Write the inventory as a table in the report. Be honest about glue —
applying mutation to a thin CRUD wrapper produces theatre, not signal.

## Phase 2 — Pick methods

For each method you'll attempt, plan it concretely *before* running:

### Property-based — pick the property shape

| Shape | Form | Example |
|---|---|---|
| Round-trip | `decode(encode(x)) == x` | JSON serialisation, URL encoding, compression |
| Idempotence | `f(f(x)) == f(x)` | normalisation, dedup, canonicalisation |
| Commutativity | `f(x, y) == f(y, x)` | set union, max, merge-when-claimed |
| Associativity | `f(f(x,y),z) == f(x,f(y,z))` | concat, reducers |
| Monotonicity | `x <= y → f(x) <= f(y)` | ordering-preserving transforms |
| Invariant preservation | every transition preserves `inv(state)` | state machines, mutable data structures |
| Reference implementation | `optimised(x) == naive(x)` | algorithmic optimisations |
| Oracle | `parse(generate(model)) == model` | parser ↔ generator pairs |

A scenario without a property in this list usually needs example tests,
not property-based. Pick the shape that maps to the function's claim;
don't invent properties to look thorough.

### Mutation — pick the target + threshold

- Target = the module the implementer just changed, with its example
  tests. Run the mutator against the source; have it run the existing
  test suite.
- Threshold: 80% kill ratio is a defensible starting line for new code;
  95%+ is a strong claim. 100% is suspicious (probably tautological
  tests). Record the threshold you'll demand BEFORE seeing results.

### Formal — pick the property + tool

- TLA+ for distributed-system / consensus / replication properties.
- Alloy for relational structure / configuration validity.
- Lean/Coq for proof obligations on data structures.
- Lightweight (fast-spec, fitch, jsmt) for invariant assertions you can
  re-check in CI.

If the tool isn't installed in the project: mark the method
`attempted_but_blocked` with the install command. Don't fake.

## Phase 3 — Apply

### Property-based example (fast-check)

```js
// src/tests/property/url-codec.property.test.ts
import * as fc from 'fast-check';
import { encode, decode } from '../../url-codec';

test('round-trip: decode(encode(x)) == x for arbitrary unicode strings', () => {
  fc.assert(
    fc.property(fc.string({ minLength: 0, maxLength: 200 }), (s) => {
      expect(decode(encode(s))).toBe(s);
    }),
    { numRuns: 5000 },
  );
});
```

Capture: properties asserted, cases tried, counterexamples found. If
fast-check shrinks a counterexample, paste the shrunk form verbatim.

### Mutation example (Stryker)

```
$ npx stryker run --mutate "src/billing/**/*.ts"
...
Ran 142 tests for each mutant
138/142 mutants killed (97.18%)
4 survivors:
  src/billing/tax.ts:42:14    +   → -
  src/billing/tax.ts:55:8     >=  → >
  ...
```

Each surviving mutant is a test gap. Inspect: does the test simply not
assert on the affected output, or is the mutation semantically
equivalent? Equivalent mutants are a known false-positive class — note
them in the report rather than counting them against the score.

### Formal example (TLA+)

```tla
---- MODULE TwoPhaseCommit ----
VARIABLES rmState, tmState, tmPrepared, msgs
...
SAFE == \A rm : rmState[rm] = "committed" => tmState = "committed"
====
```

Run TLC with bounded depth. Capture the depth explored. If a
counterexample trace appears, paste it verbatim — readers will need to
trace through the state transitions.

## Phase 4 — Triage

For each finding, decide:

- **blocking** — a property counterexample to a stated invariant, a
  surviving mutant that kills the test's claim, a formal counterexample
  to a safety property. Goes in `blocking_findings[]`. Sign-off cannot
  proceed.
- **non-blocking** — known gap; ticketed; out-of-scope edge case at the
  limit of the spec. Goes in `non_blocking_findings[]`.
- **methodology** — flaky property, too-narrow generator, equivalent
  mutant, formal-tool config issue. Fix the verification, re-run.

When in doubt, mark blocking. A blocking finding that turns out to be
non-blocking is a 5-minute conversation; a non-blocking finding that
turns out to be a real bug is an incident.

## Phase 5 — Write the report + gate

Report follows `templates/verification-report-template.md`:
1. **Summary** — one paragraph: what was verified, what was found.
2. **Candidate inventory** — the Phase 1 table.
3. **Property-based** — properties asserted, cases tried, results,
   counterexamples (if any).
4. **Mutation** — target, threshold, results, surviving mutants (with
   file:line and the mutation operator).
5. **Formal** — spec written, tool, depth, counterexample (if any).
6. **Skipped methods** — each with reason.
7. **Triage** — blocking / non-blocking / methodology lists.
8. **Recommendations** — what should be added to the regular test suite
   based on what we learned.

Gate per `core/gates/schemas/stage-06d.schema.json`. PASS requires
`blocking_findings: []`. A method genuinely skipped with reason is
fine; a method `attempted_but_blocked` records a warning.

## What this skill does NOT do

- **Doesn't replace stage-06.** Run only after stage-06 PASS. Tests are
  the floor.
- **Doesn't write production fixes.** Findings → report → implementer
  fixes → re-run.
- **Doesn't fake runs.** If the tool isn't installed, that's a finding;
  don't invent a 97% mutation score.
- **Doesn't apply to every diff.** Glue/UI/CRUD often correctly skips
  every method with reason. A short report with skips is fine. A long
  report with theatre is not.

## Failure modes to avoid

- **Properties that just re-state the implementation.** "Property: my
  add function adds two numbers" is just a unit test in property
  clothes. The property should be a claim the implementation must
  satisfy that isn't obvious from reading the implementation.
- **100% mutation score on first run.** Almost always means the
  test suite is tautological — tests that pass regardless of behaviour.
  Investigate the suite before celebrating the score.
- **Formal proofs of trivialities.** If the property fits in a
  one-line assertion, write the assertion, don't fire up TLA+.
- **Counterexample dismissal.** "The fuzzer found x=NaN breaks it, but
  no real user would send NaN" is exactly how production incidents
  start. Either the spec excludes NaN (so the input validator rejects
  it) or the implementation handles it. Pick one.
