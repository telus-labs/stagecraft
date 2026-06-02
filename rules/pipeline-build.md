# Pipeline Build (Stages 4–8)

The implementation half of the pipeline: build, pre-review, peer code
review, test, sign-off, and deploy. Each stage's rules live in its own
`stage-NN.md` file so the orchestrator (and any agent following a
specific stage) can load only what it needs.

Stages 1–3 + 9 + durations live in `pipeline-core.md`. Track routing
and the safety stoplist live in `pipeline-tracks.md`. The full index is
in `pipeline.md`. Gate schemas (required fields, validator behavior,
retry protocol) live in `gates.md`.

## Stage index

| Stage | File | Role | Summary |
|---|---|---|---|
| 4 | [`stage-04.md`](stage-04.md) | dev-backend, dev-frontend, dev-platform | Parallel build across three worktrees. Each dev writes a per-area PR summary + gate. |
| 4.5a | [`stage-04a.md`](stage-04a.md) | dev-platform | Pre-review: lint + type-check + SCA. Toolchain catches what reviewers shouldn't have to. |
| 4.5b | [`stage-04b.md`](stage-04b.md) | security-engineer | Security review — conditional on the security-trigger heuristic. Has veto. |
| 5 | [`stage-05.md`](stage-05.md) | reviewer × 4 areas | Peer code review. Matrix or scoped shape; per-area gates merged by the orchestrator. |
| 6 | [`stage-06.md`](stage-06.md) | dev-qa | Test execution. Every acceptance criterion maps 1:1 to a test. |
| 6b | [`stage-06b.md`](stage-06b.md) | dev-qa | Accessibility audit. Conditional on UI changes; tracks: full, quick, hotfix. |
| 6c | [`stage-06c.md`](stage-06c.md) | dev-platform | Observability gate — verify brief §9 signals actually emit. Tracks: full, hotfix. |
| 7 | [`stage-07.md`](stage-07.md) | pm | Sign-off. Auto-folds from Stage 6 when the AC→test contract is satisfied. |
| 8 | [`stage-08.md`](stage-08.md) | dev-platform | Deploy. Adapter-driven (docker-compose / kubernetes / terraform / custom). |

## How to use these files

- **Orchestrator agent:** load only the stage rules you're about to
  dispatch. Earlier stages are already complete (their gates are on
  disk); later stages haven't started. Loading the index plus the
  single `stage-NN.md` you're working on is enough.
- **Role briefs:** point at the specific `stage-NN.md` you need rather
  than this index. The role briefs do — see e.g.
  `roles/qa.md` § "On a Test-Execution Task".
- **Reviewers / auditors:** read the relevant stage file plus
  `gates.md` for the gate-field reference.
