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
| stage-01  | requirements              | pm         | 11,785      | 8,832        | 20,617     | 5155    |
| stage-02  | design                    | principal  | 11,785      | 12,736       | 24,521     | 6131    |
| stage-03  | clarification             | pm         | 11,785      | 8,832        | 20,617     | 5155    |
| stage-03b | executable-spec           | pm         | 11,785      | 8,832        | 20,617     | 5155    |
| stage-04  | build                     | backend    | 11,785      | 7,530        | 19,315     | 4829    |
| stage-04  | build                     | frontend   | 11,785      | 6,295        | 18,080     | 4520    |
| stage-04  | build                     | platform   | 11,785      | 2,400        | 14,185     | 3547    |
| stage-04  | build                     | qa         | 11,785      | 2,718        | 14,503     | 3626    |
| stage-04a | pre-review                | platform   | 11,785      | 2,400        | 14,185     | 3547    |
| stage-04b | security-review           | security   | 11,785      | 7,303        | 19,088     | 4772    |
| stage-04c | red-team                  | red-team   | 11,785      | 13,675       | 25,460     | 6365    |
| stage-04d | migration-safety          | migrations | 11,785      | 8,272        | 20,057     | 5015    |
| stage-05  | peer-review               | reviewer   | 11,785      | 6,330        | 18,115     | 4529    |
| stage-06  | qa                        | qa         | 11,785      | 2,718        | 14,503     | 3626    |
| stage-06b | accessibility-audit       | qa         | 11,785      | 2,718        | 14,503     | 3626    |
| stage-06c | observability-gate        | platform   | 11,785      | 2,400        | 14,185     | 3547    |
| stage-06d | verification-beyond-tests | verifier   | 11,785      | 9,089        | 20,874     | 5219    |
| stage-06e | performance-budget        | qa         | 11,785      | 2,718        | 14,503     | 3626    |
| stage-07  | sign-off                  | pm         | 11,785      | 8,832        | 20,617     | 5155    |
| stage-07  | sign-off                  | platform   | 11,785      | 2,400        | 14,185     | 3547    |
| stage-08  | deploy                    | platform   | 11,785      | 2,400        | 14,185     | 3547    |
| stage-09  | retrospective             | principal  | 11,785      | 12,736       | 24,521     | 6131    |

## Top 5 heaviest framework files

| File                | Bytes  | Tokens~ |
| ------------------- | ------ | ------- |
| roles/red-team.md   | 13,675 | 3419    |
| roles/principal.md  | 12,736 | 3184    |
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
stage-01,20617
stage-02,24521
stage-03,20617
stage-03b,20617
stage-04,19315
stage-04a,14185
stage-04b,19088
stage-04c,25460
stage-04d,20057
stage-05,18115
stage-06,14503
stage-06b,14503
stage-06c,14185
stage-06d,20874
stage-06e,14503
stage-07,20617
stage-08,14185
stage-09,24521
-->
<!-- /generated -->
