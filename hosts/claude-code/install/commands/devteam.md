---
description: >
  Run a stage of the ai-dev-team pipeline. Wraps the `devteam` CLI so you
  can dispatch a stage (PM brief, design, build, review, QA, deploy, etc.)
  from inside Claude Code. The CLI emits the role-specific prompt; you
  invoke the matching subagent (under .claude/agents/) to do the work.
---

# /devteam

Drive the ai-dev-team pipeline.

## Input

The text after `/devteam` is interpreted as a subcommand. Examples:

- `/devteam stage requirements` — render the PM stage prompt
- `/devteam stage build` — render all four build workstream prompts
- `/devteam merge build` — merge per-workstream gates into the stage gate
- `/devteam stages` — list known stages
- `/devteam hosts` — list installed host adapters

If the input is empty, ask the user which stage they want to run, then
re-invoke with `stage <name>`.

## Behavior

1. Run `devteam <subcommand>` in a Bash tool call. (Install `devteam`
   globally with `npm link` from the ai-dev-team repo if it's not on the
   user's PATH.)
2. The CLI prints one stage prompt per workstream (one for single-role
   stages, N for multi-role stages like `build`).
3. For each printed prompt:
   - Identify the named subagent from the prompt (`.claude/agents/<name>.md`).
   - Invoke that subagent with the prompt's body.
   - Wait for it to write the workstream gate at
     `pipeline/gates/<workstream-id>.json`.
4. For multi-role stages, after all workstream gates exist, run
   `devteam merge <stage>` to produce the stage-level merged gate.
5. Report status back to the user and ask whether to proceed to the
   next stage.

## Gate identity (per ai-dev-team contract F)

Workstream gates carry: `stage`, `workstream`, `status`, `track`,
`timestamp`, `blockers`, `warnings`, plus stage-specific fields.
The orchestrator adds `orchestrator` and `host` at write/validation time.
Do NOT write `agent` — it has been removed.
