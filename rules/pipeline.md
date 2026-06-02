# Pipeline Rules — Index

The pipeline rules are split across three files for clarity and to let
agents load only the subset relevant to their stage. The split landed in
the audit-driven 2026-05-07 work (item B-21).

| File | Covers | Read this when |
|---|---|---|
| **`pipeline-tracks.md`** | Stage 0: budget gate, track routing, safety stoplist, async-friendly checkpoints | The orchestrator chooses a track or evaluates a checkpoint, or any caller checks the stoplist. |
| **`pipeline-core.md`** | Stages 1 (Requirements), 2 (Design), 3 (Pre-Build Clarification), 9 (Retrospective), and Stage Duration Expectations | PM, Principal, or the retro flow. |
| **`pipeline-build.md`** | INDEX for stages 4–8. Each stage's rules live in its own `stage-NN.md` (e.g. `stage-04.md`, `stage-05.md`, `stage-08.md`). | Look up which file each build-half stage lives in. Then read just the relevant `stage-NN.md`, not all nine of them. |

References elsewhere in the framework that say "see `.devteam/rules/pipeline.md`
Stage X" are accurate at the conceptual level — Stage X exists in one of the
files named above. The orchestrator reads `pipeline-tracks.md`,
`pipeline-core.md`, and the `pipeline-build.md` index at startup; it loads
specific `stage-NN.md` files on demand as it dispatches each stage.

For convenience, agent prompts and slash-command rules that cite specific
stages were left as-is during the splits (they describe stages, not file
paths). New documentation should cite the specific stage file when
possible (`stage-05.md`, not `pipeline.md §Stage 5`).

## Related rules

- `.devteam/rules/gates.md` — JSON schema for every gate file
- `.devteam/rules/orchestrator.md` — orchestrator startup and routing
- `.devteam/rules/escalation.md` — escalation protocol
- `.devteam/rules/coding-principles.md` — four binding dev principles
- `.devteam/rules/retrospective.md` — Stage 9 protocol details
- `.devteam/rules/compaction.md` — context compaction instructions
