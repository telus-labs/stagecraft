# Pipeline Rules — Index

The pipeline rules are split across three files for clarity and to let
agents load only the subset relevant to their stage. The split landed in
the audit-driven 2026-05-07 work (item B-21).

| File | Covers | Read this when |
|---|---|---|
| **`pipeline-tracks.md`** | Stage 0: budget gate, track routing, safety stoplist, async-friendly checkpoints | The orchestrator chooses a track or evaluates a checkpoint, or any caller checks the stoplist. |
| **`pipeline-core.md`** | Stages 1 (Requirements), 2 (Design), 3 (Pre-Build Clarification), 9 (Retrospective), and Stage Duration Expectations | PM, Principal, or the retro flow. |
| **`pipeline-build.md`** | Stages 4 (Build), 4.5 (Pre-review checks), 5 (Peer Review), 6 (Test), 7 (PM Sign-off), 8 (Deploy) | Devs, reviewers, QA, security-engineer, platform on deploy. |

References elsewhere in the framework that say "see `.devteam/rules/pipeline.md`
Stage X" are accurate at the conceptual level — Stage X exists in one of the
three sub-files, named in the table above. The orchestrator reads all three
on startup.

For convenience, this file used to be the monolith; agent prompts and
slash-command rules that cite specific stages were left as-is during the
split (they describe stages, not file paths). New documentation should
cite the sub-file directly when possible (`pipeline-build.md §Stage 5`,
not `pipeline.md §Stage 5`).

## Related rules

- `.devteam/rules/gates.md` — JSON schema for every gate file
- `.devteam/rules/orchestrator.md` — orchestrator startup and routing
- `.devteam/rules/escalation.md` — escalation protocol
- `.devteam/rules/coding-principles.md` — four binding dev principles
- `.devteam/rules/retrospective.md` — Stage 9 protocol details
- `.devteam/rules/compaction.md` — context compaction instructions
