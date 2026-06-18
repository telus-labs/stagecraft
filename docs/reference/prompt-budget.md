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
| stage-01  | requirements              | pm         | 11,945      | 8,832        | 20,777     | 5195    |
| stage-02  | design                    | principal  | 11,945      | 13,129       | 25,074     | 6269    |
| stage-03  | clarification             | pm         | 11,945      | 8,832        | 20,777     | 5195    |
| stage-03b | executable-spec           | pm         | 11,945      | 8,832        | 20,777     | 5195    |
| stage-04  | build                     | backend    | 11,945      | 7,530        | 19,475     | 4869    |
| stage-04  | build                     | frontend   | 11,945      | 6,295        | 18,240     | 4560    |
| stage-04  | build                     | platform   | 11,945      | 2,400        | 14,345     | 3587    |
| stage-04  | build                     | qa         | 11,945      | 2,718        | 14,663     | 3666    |
| stage-04a | pre-review                | platform   | 11,945      | 2,400        | 14,345     | 3587    |
| stage-04b | security-review           | security   | 11,945      | 7,303        | 19,248     | 4812    |
| stage-04c | red-team                  | red-team   | 11,945      | 13,675       | 25,620     | 6405    |
| stage-04d | migration-safety          | migrations | 11,945      | 8,272        | 20,217     | 5055    |
| stage-05  | peer-review               | reviewer   | 11,945      | 6,330        | 18,275     | 4569    |
| stage-06  | qa                        | qa         | 11,945      | 2,718        | 14,663     | 3666    |
| stage-06b | accessibility-audit       | qa         | 11,945      | 2,718        | 14,663     | 3666    |
| stage-06c | observability-gate        | platform   | 11,945      | 2,400        | 14,345     | 3587    |
| stage-06d | verification-beyond-tests | verifier   | 11,945      | 9,089        | 21,034     | 5259    |
| stage-06e | performance-budget        | qa         | 11,945      | 2,718        | 14,663     | 3666    |
| stage-07  | sign-off                  | pm         | 11,945      | 8,832        | 20,777     | 5195    |
| stage-07  | sign-off                  | platform   | 11,945      | 2,400        | 14,345     | 3587    |
| stage-08  | deploy                    | platform   | 11,945      | 2,400        | 14,345     | 3587    |
| stage-09  | retrospective             | principal  | 11,945      | 13,129       | 25,074     | 6269    |

## Top 5 heaviest framework files

| File                | Bytes  | Tokens~ |
| ------------------- | ------ | ------- |
| roles/red-team.md   | 13,675 | 3419    |
| roles/principal.md  | 13,129 | 3283    |
| roles/verifier.md   | 9,089  | 2273    |
| roles/pm.md         | 8,832  | 2208    |
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
stage-01,20777
stage-02,25074
stage-03,20777
stage-03b,20777
stage-04,19475
stage-04a,14345
stage-04b,19248
stage-04c,25620
stage-04d,20217
stage-05,18275
stage-06,14663
stage-06b,14663
stage-06c,14345
stage-06d,21034
stage-06e,14663
stage-07,20777
stage-08,14345
stage-09,25074
-->
<!-- /generated -->
