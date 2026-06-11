# Stage 6d — Verification beyond tests (tracks: full)

Invoke: `verifier` agent. Runs AFTER stage-06 (QA) PASS — tests are the
floor, this stage raises the ceiling.
Input: `pipeline/brief.md`, `pipeline/design-spec.md`, `pipeline/spec.feature`,
`pipeline/test-report.md`, `pipeline/red-team-report.md`.
Output: `pipeline/verification-report.md`.
Gate file: `pipeline/gates/stage-06d.json`. Required keys:
- `methods_attempted`: list of methods used (e.g. `property-based`, `mutation`, `formal`)
- `methods_skipped`: list of `{ method, reason }` objects
- `candidates_inventoried`: count of functions/properties considered for deep verification
- `property_based`: result object or `null`
- `mutation`: result object or `null`
- `formal`: result object or `null`
- `findings_count`: total blocking + non-blocking findings
- `blocking_findings`: list of `{ id, description, location }` objects — each halts sign-off
- `non_blocking_findings`: list of non-blocking observations

PASS when `blocking_findings` is empty. A counterexample from property-based testing,
a surviving mutant on a critical path, or a formal counterexample to a stated safety
property all produce blocking findings. When the changed code has no viable surface for
deep verification (e.g. pure UI styling), the agent sets `methods_skipped` with reasons
and gates PASS.

**Read-only on production code.** Writes only `pipeline/verification-report.md`,
`pipeline/gates/stage-06d.json`, `pipeline/context.md`, `src/tests/property/`, and
`pipeline/formal/` (verification artefacts).

See `skills/verification-beyond-tests/SKILL.md` for the full method catalogue:
property-based testing (fast-check / Hypothesis), mutation testing (Stryker), and
formal methods (TLA+, Alloy), plus the decision matrix for choosing methods given
the change surface.
