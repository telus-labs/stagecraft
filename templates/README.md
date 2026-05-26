# Pipeline Artefact Templates

Eleven Markdown scaffolds that agents copy into `pipeline/` (and a couple
into the project root) when first creating an artefact. Templates are
intentionally thin — they hold the structure the rules expect, not the
content. Field semantics live in `.devteam/rules/pipeline.md` and the
per-stage schemas under `schemas/`.

## How templates are used

- An agent copies the template to its destination on first creation, then
  fills in the body. Subsequent edits go directly to the destination, not
  the template.
- The orchestrator and `devteam pipeline:scaffold` know the mapping
  template ↔ destination; an unfamiliar template name in `STAGES`
  (defined in `scripts/devteam`) is a bug, caught by
  `tests/contract.test.js`.
- Bootstrap copies the entire `templates/` directory into target projects.
  Local edits to a template in a target project are preserved across
  re-bootstrap only if `.local.*` semantics apply — they do **not**, so
  customise via project-specific instructions in `AGENTS.md` rather than
  by forking templates.

## The eleven templates

| File | Stage | Authoring agent | Destination | Purpose |
|---|---|---|---|---|
| `brief-template.md` | 1 | `pm` | `pipeline/brief.md` | Feature requirements: problem, user stories, acceptance criteria, out-of-scope, open questions, optional risk sections per track. |
| `design-spec-template.md` | 2 | `principal` | `pipeline/design-spec.md` | Architecture-level design with requirements trace, components, interfaces, data model, risks, ADR links. |
| `adr-template.md` | 2 (or any time) | `principal` | `pipeline/adr/NNNN-title.md` | One Architecture Decision Record per binding ruling: status, context, decision, consequences, alternatives. |
| `clarification-template.md` | 3 | `pm` (clarification mode) | `pipeline/clarification.md` | Open questions table with owners and answers. Mirrors the `QUESTION:` / `PM-ANSWER:` lines in `pipeline/context.md`. |
| `build-template.md` | 4 | dev agents | `pipeline/build-plan.md` (optional aggregate) | Workstream-level plan: which area owns what, status per file/test/check. |
| `pr-summary-template.md` | 4 | dev agents | `pipeline/pr-<area>.md` | Per-area PR summary with the four-step Plan from `coding-principles.md`. |
| `pre-review-template.md` | 4.5a | `dev-platform` | `pipeline/pre-review.md` | Lint, type-check, SCA results table; preconditions for Stage 5. |
| `review-template.md` | 5 | reviewers | `pipeline/code-review/by-<reviewer>.md` | Per-area sections ending in `REVIEW: APPROVED` or `REVIEW: CHANGES REQUESTED`. The approval-derivation hook reads only the markers; everything else is human-readable context. |
| `test-report-template.md` | 6 | `dev-qa` | `pipeline/test-report.md` | Suite summary, criterion-to-test mapping, failure attribution. The 1:1 mapping field gates the Stage 7 auto-fold. |
| `runbook-template.md` | 7→8 | platform / project owner | `pipeline/runbook.md` | Rollback procedure and health signals. Required for Stage 8 PASS — gate-validator escalates if missing. |
| `retrospective-template.md` | 9 | every agent + `principal` (synthesis) | `pipeline/retrospective.md` | Per-agent contribution sections plus a synthesis block. Promoted lessons land in the persistent `pipeline/lessons-learned.md`. |

## Editing or adding templates

If you change a template's structure, also update:

1. The agent prompt(s) that author the artefact (under `roles/`).
2. The corresponding rule in `.devteam/rules/pipeline.md`.
3. The relevant schema under `schemas/` if the change adds a required
   field that ends up in a gate.
4. `tests/contract.test.js` if the template name or stage mapping changes.

If you add a new template, also wire it into `STAGES` in
`scripts/devteam` so `pipeline:scaffold` and the contract test know
about it.
