<!-- generated: do not hand-edit -->
<!-- To regenerate: npm run docs:generate (source: core/pipeline/stages.js + rules/ + roles/) -->

# Prompt Budget Reference

Framework prose loaded by every model dispatch — derived from `readFirst` arrays in
`core/pipeline/stages.js`. **Token estimate: bytes ÷ 4** (conservative floor; GPT/Claude
tokenizers average ~3.5–4 bytes/token for English prose).

**Included:** `AGENTS.md`, `rules/` files mapped from `.devteam/rules/`, and the role brief
for each dispatched role.
**Excluded:** `pipeline/*` artifacts (project-dependent, unknown at analysis time).

Run `npm run docs:generate` to regenerate after editing stages.js, rules/, or roles/.

## Per-dispatch framework cost

Multi-role stages appear once per dispatched role. The CI advisory
(`npm run consistency`) warns when any stage's max-dispatch bytes grow >10%.

| Stage     | Name                      | Role       | Framework B | Role brief B | Dispatch B | Tokens~ |
| --------- | ------------------------- | ---------- | ----------- | ------------ | ---------- | ------- |
| stage-01  | requirements              | pm         | 11,940      | 9,629        | 21,569     | 5393    |
| stage-02  | design                    | principal  | 11,940      | 14,066       | 26,006     | 6502    |
| stage-03  | clarification             | pm         | 11,940      | 9,629        | 21,569     | 5393    |
| stage-03b | executable-spec           | pm         | 11,940      | 9,629        | 21,569     | 5393    |
| stage-04  | build                     | backend    | 11,940      | 7,530        | 19,470     | 4868    |
| stage-04  | build                     | frontend   | 11,940      | 6,295        | 18,235     | 4559    |
| stage-04  | build                     | platform   | 11,940      | 2,400        | 14,340     | 3585    |
| stage-04  | build                     | qa         | 11,940      | 2,718        | 14,658     | 3665    |
| stage-04a | pre-review                | platform   | 11,940      | 2,400        | 14,340     | 3585    |
| stage-04b | security-review           | security   | 11,940      | 7,303        | 19,243     | 4811    |
| stage-04c | red-team                  | red-team   | 11,940      | 13,675       | 25,615     | 6404    |
| stage-04d | migration-safety          | migrations | 11,940      | 8,272        | 20,212     | 5053    |
| stage-05  | peer-review               | reviewer   | 11,940      | 6,330        | 18,270     | 4568    |
| stage-06  | qa                        | qa         | 11,940      | 2,718        | 14,658     | 3665    |
| stage-06b | accessibility-audit       | qa         | 11,940      | 2,718        | 14,658     | 3665    |
| stage-06c | observability-gate        | platform   | 11,940      | 2,400        | 14,340     | 3585    |
| stage-06d | verification-beyond-tests | verifier   | 11,940      | 9,089        | 21,029     | 5258    |
| stage-06e | performance-budget        | qa         | 11,940      | 2,718        | 14,658     | 3665    |
| stage-07  | sign-off                  | pm         | 11,940      | 9,629        | 21,569     | 5393    |
| stage-07  | sign-off                  | platform   | 11,940      | 2,400        | 14,340     | 3585    |
| stage-08  | deploy                    | platform   | 11,940      | 2,400        | 14,340     | 3585    |
| stage-09  | retrospective             | principal  | 11,940      | 14,066       | 26,006     | 6502    |

## Top 5 heaviest framework files

| File                | Bytes  | Tokens~ |
| ------------------- | ------ | ------- |
| roles/principal.md  | 14,066 | 3517    |
| roles/red-team.md   | 13,675 | 3419    |
| roles/pm.md         | 9,629  | 2408    |
| roles/verifier.md   | 9,089  | 2273    |
| roles/migrations.md | 8,272  | 2068    |

## Advisory file-size ceilings

`scripts/consistency.js` emits advisories when these ceilings are exceeded.
Advisories are non-blocking (they print but do not fail CI).

| File class         | Ceiling |
| ------------------ | ------- |
| Role brief         | 16 KB   |
| Stage rule file    | 8 KB    |
| AGENTS.md          | 10 KB   |

<!-- budget-data
stage-01,21569
stage-02,26006
stage-03,21569
stage-03b,21569
stage-04,19470
stage-04a,14340
stage-04b,19243
stage-04c,25615
stage-04d,20212
stage-05,18270
stage-06,14658
stage-06b,14658
stage-06c,14340
stage-06d,21029
stage-06e,14658
stage-07,21569
stage-08,14340
stage-09,26006
-->
<!-- /generated -->
