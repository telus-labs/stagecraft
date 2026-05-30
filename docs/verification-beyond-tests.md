# Verification beyond tests

Stage 6d. Runs after QA passes on the `full` track only. The `verifier` role applies three methods to the changed code to make "tests pass" a floor rather than a ceiling.

---

## What it does

The verifier reads the changed code and applies up to three formal verification methods:

### Property-based testing

Tools: fast-check (JS/TS), hypothesis (Python), proptest (Rust).

Generates large numbers of random inputs and checks that stated properties (invariants) hold across all of them. Catches entire classes of bugs that example-based tests don't find — the author's tests only cover cases the author thought of; the property harness doesn't share that bias.

The verifier identifies candidates in the changed code: pure functions with stateable invariants, data transformations, parsers, serializers, algorithms with mathematical properties.

### Mutation testing

Tools: Stryker (JS/TS), mutmut (Python), mull (Rust/C++).

Introduces deliberate bugs ("mutants") into the changed code — flipped comparisons, removed return values, swapped operands — and checks whether the test suite catches each one. A surviving mutant means the test suite has a gap: the bug was silently present and untested.

### Formal verification

Tools: TLA+ (concurrent systems), Alloy (structural properties), Lean (mathematical proofs).

Optional. Used when correctness is non-negotiable: cryptographic operations, consensus algorithms, financial invariants, safety-critical state machines.

---

## Gate fields

| Field | Type | Notes |
|---|---|---|
| `methods_attempted` | string[] | Methods that ran or were attempted |
| `methods_skipped` | `{method, reason}[]` | Methods not run; reason is required |
| `candidates_inventoried` | number | Code paths assessed for verification |
| `property_based` | object | `candidates`, `properties_written`, `counterexamples` |
| `mutation` | object | `mutants_generated`, `mutants_killed`, `mutants_survived`, `score_pct` |
| `formal` | object | `models_written`, `properties_checked`, `counterexamples` |
| `findings_count` | number | Total blocking findings |
| `blocking_findings` | string[] | Items that fail the stage |

**FAIL conditions:**

- A surviving mutant on a critical code path
- A property counterexample to a stated invariant
- A formal counterexample to a safety property

Any of these populates `blocking_findings[]` and gates at FAIL.

**Skipped methods:**

Tooling not installed is recorded as `attempted_but_blocked:<method>` — a WARN, not a FAIL. "Didn't have time" is not an accepted skip reason.

---

## Track inclusion

`full` only. The `quick`, `nano`, `hotfix`, `config-only`, and `dep-update` tracks rely on stage-06 example tests as their verification floor — they opt into speed over rigour. The `full` track opts into rigour.

---

## References

- Role brief: `roles/verifier.md`
- Skill: `skills/verification-beyond-tests/SKILL.md` — five-phase procedure
- Related: [docs/FEATURES.md](FEATURES.md) § Advanced AI capabilities
