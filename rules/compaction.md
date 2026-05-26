# Compaction Instructions

When Claude Code compacts this conversation, preserve:

1. The current pipeline stage being executed
2. The list of gate files written and their statuses
3. Any open escalations (status: ESCALATE in any gate file)
4. Any open QUESTION or CONCERN entries in pipeline/context.md awaiting resolution
5. Which dev agents have completed their Stage 4 build tasks
6. Which reviewer agents have written their Stage 5 review files
7. The Stage 5 review round count per area — how many CHANGES REQUESTED →
   fix cycles have completed for each area (required for the 2-round limit;
   losing this count after compaction allows the unbounded review loop to
   resume)
8. The current retry count for any stage on its Nth retry
8. Which agents have written their Stage 9a contribution sections
9. Whether Stage 9b synthesis has completed and which lessons were promoted/retired

Do NOT preserve:
- Full file contents (re-read from disk as needed — including
  `pipeline/lessons-learned.md`, which is re-read at each stage boundary)
- Intermediate reasoning steps
- Tool call outputs that are already written to pipeline/ files
