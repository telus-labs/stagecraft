# Verification Beyond Tests — Report

## Summary

<!-- One paragraph: what was verified, what was found, what's blocking. -->

## Candidate Inventory

<!--
  Phase 1 output. One row per function/module in the diff worth
  classifying. "None — skip with reason" rows are valid and expected.
-->

| File / Module | Code shape | Method chosen | Rationale |
|---|---|---|---|

## Property-Based Testing

### Properties asserted

<!--
  For each property: name, formal shape, generator(s), runs count.
  Use the property-shape vocabulary (round-trip, idempotence, etc.).
-->

| Property | Shape | Generator | Cases tried |
|---|---|---|---|

### Counterexamples

<!--
  Paste the shrunk minimal counterexample verbatim. Do not summarise.
  Each counterexample gets its own subsection.
-->

### Tool / version

## Mutation Testing

### Target + threshold

- **Target**:
- **Pre-declared kill-ratio threshold**:
- **Tool / version**:

### Results

| Metric | Value |
|---|---|
| Mutants generated |  |
| Mutants killed |  |
| Mutants survived |  |
| Mutants timed-out |  |
| Score (killed / (generated - timed-out)) |  |

### Surviving Mutants

<!--
  One subsection per survivor. file:line, mutation operator, expected
  catch site, classification (real gap / equivalent mutant / known
  limitation).
-->

## Formal Verification

### Property modeled

### Spec

<!-- Paste / reference the .tla / .als / .lean / etc. -->

### Tool, depth, runtime

### Counterexample trace

<!-- Paste verbatim if any. -->

## Skipped Methods

| Method | Reason |
|---|---|
| property |  |
| mutation |  |
| formal |  |

<!-- Examples of fine reasons:
       "no pure functions in diff"
       "no test suite covering the changed module"
       "no state machine / protocol in scope"
       "tooling not installed in project (npm install --save-dev stryker)"
     Examples of NOT fine reasons:
       "didn't have time"
       "don't know the tool"
-->

## Triage

### Blocking findings

<!-- Each must be addressed before sign-off proceeds. -->

### Non-blocking findings

### Methodology issues

<!-- Flaky properties, equivalent mutants, tool config — re-run. -->

## Recommendations

<!--
  What should be added to the regular test suite based on what
  verification found? (E.g., "add example tests for the NaN input
  path"; "raise mutation threshold to 90% in CI"; "model the failover
  state machine in TLA+ before next migration".)
-->

## Approval line

<!--
  ✅ APPROVED — no blocking findings; methods applied per inventory.
  ⚠️ APPROVED WITH WARNINGS — non-blocking findings worth tracking.
  ❌ CHANGES REQUESTED — blocking findings; implementer must address.
-->
