# Sonnet Execution Prompts

**Canonical source: [ALL-PROMPTS.md](ALL-PROMPTS.md).** Every work item across all
phases lives there -- one phase per major section, one item per sub-section, each with
a status chip (executed / ready / blocked) and a paste-ready prompt.

## How to run an item

1. Start a **fresh Sonnet session** in the repo root. One item = one session = one
   branch = one PR. Never reuse sessions across items.
2. Paste the **PREAMBLE** (ALL-PROMPTS.md section 0) plus the item's prompt block as
   one message. Phase 3 and Documentation items have an extra preamble line noted at
   the top of their sections -- include it.
3. When the session ends, check its final report against the item's evidence
   requirements before pushing. A reported **stop condition is a success**, not a
   failure -- bring the finding back for triage instead of retrying.
4. Respect the dependency gates (blocked items name their blockers); run items in
   the order listed within each phase.

The per-phase files in this directory are pointers -- they held the original prompts
and now redirect here. Update ALL-PROMPTS.md only.
