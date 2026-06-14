- **Fix (6.4): de-overfit fix recipes — provenance-based blocker routing replaces regex heuristics.**
  Three overfit sources removed:

  1. **`_wsFromText` regex demoted to last-resort fallback.** Recipe routing now reads workstream attribution from blocker fields (`assigned_to`, `workstream`) directly — provenance first, regex only when no structured attribution exists (emits a WARN). A new `_wsFromProvenance()` helper encodes this priority.

  2. **`mergeWorkstreamGates` preserves workstream on object blockers.** The merge previously flattened all workstream gate blockers into a single array without recording their source. Object blockers now carry `workstream: role` when merged, enabling provenance-based routing downstream.

  3. **stage-06b recipe: backend hardcoding and demo-project comment removed.** The old recipe unconditionally routed A11Y blockers to the backend workstream (based on a demo-project CSS filename). The updated recipe routes to whichever workstream `assigned_to`/`workstream` fields identify; falls back to regex then to all build roles when blockers carry no structured attribution.

  4. **Hardcoded `["backend","frontend","platform","qa"]` fallback arrays → `_buildRoles()`.** Two last-resort fallbacks in stage-04c and stage-06d that listed build roles explicitly now derive them from the build stage definition (`getStage("build").roles`), so they stay correct if the build stage's role list changes.

  **Tests added:** frontend-owned A11Y blocker (assigned_to: frontend) routes to frontend, not backend; multi-workstream A11Y blockers clear all attributed gates; soc2 scenario (string blockers) uses general build dispatch; recipe-hygiene meta-test ensures no recipe source quotes a filename that exists only under `examples/`.

  Honest scope note: string blockers without `assigned_to` still fall back to regex then to clearing all build workstream gates — these are safe but may over-clear. Adding `assigned_to` to A11Y blockers in the gate schema is the long-term fix.
