# Spec authoring — closed-loop AC → spec → tests

Stage 3b (executable-spec) and the `devteam spec` commands. The pipeline enforces an unbroken chain from acceptance criteria in the brief to Gherkin scenarios in a feature file to test rows in the test report.

- [The chain](#the-chain)
- [Writing acceptance criteria](#writing-acceptance-criteria)
- [Scaffolding the spec file](#scaffolding-the-spec-file)
- [Stage 03b gate](#stage-03b-gate)
- [Checking for drift](#checking-for-drift)
- [QA gate requirement](#qa-gate-requirement)
- [References](#references)

---

## The chain

```
pipeline/brief.md          AC-1, AC-2, AC-3  (PM writes at requirements stage)
        │
        ▼  stage-03b (executable-spec)
pipeline/spec.feature      @AC-1 Scenario: ...
                           @AC-2 Scenario: ...
                           @AC-3 Scenario: ...
        │
        ▼  stage-06 (QA)
pipeline/test-report.md    test row → @AC-1
                           test row → @AC-2
                           test row → @AC-3
```

Each acceptance criterion must map to exactly one Gherkin scenario. Each scenario must map to exactly one test row. The pipeline enforces both constraints.

---

## Writing acceptance criteria

In `pipeline/brief.md`, the PM writes numbered acceptance criteria in this format:

```markdown
## Acceptance criteria

AC-1: Given a user with SMS opted in, when they complete checkout, they receive a confirmation SMS within 30 seconds.
AC-2: Given a user with SMS opted out, when they complete checkout, no SMS is sent.
AC-3: Given an invalid phone number, when opt-in is attempted, the form shows an inline error and does not submit.
```

Rules:
- Use `AC-N` (capital AC, hyphen, integer, no padding). Numbers start at 1.
- Each criterion must be testable — it describes an observable outcome.
- Out-of-scope items go in a separate `## Out of scope` section, not as criteria.

---

## Scaffolding the spec file

After requirements, scaffold the `.feature` file from the brief:

```bash
devteam spec generate
```

This reads `pipeline/brief.md`, extracts `AC-N` lines, and writes `pipeline/spec.feature` with one tagged Scenario per criterion:

```gherkin
Feature: SMS notification opt-in

  @AC-1
  Scenario: confirmation SMS sent on checkout with opt-in
    Given TODO
    When TODO
    Then TODO

  @AC-2
  Scenario: no SMS sent on checkout with opt-out
    Given TODO
    ...
```

The PM fills in the Given/When/Then steps at the executable-spec stage. The `TODO` placeholders make incomplete scenarios easy to spot.

---

## Stage 03b gate

The executable-spec stage gate (`stage-03b.json`) carries:

| Field | Type | Notes |
|---|---|---|
| `criteria_count` | number | AC count from `pipeline/brief.md` |
| `scenarios_count` | number | Scenario count in `pipeline/spec.feature` |
| `criteria_to_scenario_mapping` | object[] | One entry per AC: `{ac, scenario_title, tag}` |
| `all_criteria_mapped` | boolean | Whether every AC has a scenario |
| `drift` | boolean | Whether brief and spec are out of sync |

**PASS requires** `drift: false` AND `all_criteria_mapped: true`.

---

## Checking for drift

At any point in the pipeline:

```bash
devteam spec verify
```

This compares the three sources — `pipeline/brief.md`, `pipeline/spec.feature`, and `pipeline/test-report.md` — and reports:

- **Orphan ACs** — in brief but missing from spec.feature
- **Orphan scenarios** — in spec.feature with no corresponding AC in brief
- **Duplicate AC numbers** — `AC-1` appears more than once
- **Unknown AC refs in tests** — test report references `@AC-N` that doesn't exist in brief
- **Untested scenarios** — scenario in spec.feature with no test row

Run `devteam spec verify` before the QA stage to catch drift early.

---

## QA gate requirement

The stage-06 (QA) gate must include `criterion_to_test_mapping_is_one_to_one: true` for PASS. QA is responsible for writing tests that map 1:1 to the scenarios in `pipeline/spec.feature`. The gate validator rejects a PASS gate that claims `all_acceptance_criteria_met: true` without the 1:1 mapping flag.

---

## References

- Stage: `core/gates/schemas/stage-03b.schema.json`
- Commands: `devteam spec generate`, `devteam spec verify`
- Related: [docs/FEATURES.md](FEATURES.md) § Advanced AI capabilities — Closed-loop AC → spec → tests
- Related: [docs/user-guide.md](user-guide.md) § Per-stage details — Stage 3b
