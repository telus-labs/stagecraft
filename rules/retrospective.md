# Retrospective Rules

Stage 9 runs after every pipeline completes (deploy succeeded *or* pipeline
halted with an unresolved escalation). Its purpose is to capture **what
almost went wrong** so the next run is cheaper, not to grade performance.

## Artefacts

Two files, different lifetimes:

| File | Lifetime | Purpose |
|---|---|---|
| `pipeline/retrospective.md` | Per run (overwritten each `/reset`) | Full retro record for this feature |
| `pipeline/lessons-learned.md` | Persistent (survives `/reset`) | Durable rules the team carries into every future run |

`pipeline/lessons-learned.md` is the one that actually changes behaviour. The
per-run retro is the raw material; lessons-learned is the refined output.

## Inputs (orchestrator gathers before invoking agents)

- `pipeline/brief.md` — what we set out to build
- `pipeline/design-spec.md` + `pipeline/adr/` — how we decided to build it
- `pipeline/context.md` — including every `QUESTION:`, `PM-ANSWER:`,
  `CONCERN:`, `ESCALATE:`, `## Assumptions`, `## User Decisions`
- `pipeline/pr-{area}.md` for each area — what was built
- `pipeline/code-review/by-{area}.md` — what review caught
- `pipeline/test-report.md` — what tests caught
- `pipeline/deploy-log.md` — how deploy went (or why it didn't)
- All `pipeline/gates/stage-*.json` — retry counts, escalations, FAILs

## Stage 9 — Retrospective (post-deploy)

### Step 9a — Contribution pass (parallel)

Invoke in parallel: `pm`, `principal`, `dev-backend`, `dev-frontend`,
`dev-platform`, `dev-qa`. When the Stage 4.5b security gate fired,
`security-engineer` also contributes. Each agent appends **its own
section** to `pipeline/retrospective.md` using the anchor pattern:

```markdown
## <agent-name>
### What worked
- …

### What I got wrong (and how I noticed)
- …

### Where the pipeline slowed me down
- …

### One lesson worth carrying forward
- **Rule:** …  
  **Why:** …  
  **How to apply:** …
```

Writing order matters only for deduplication: agents read any sections
already present before writing their own. If another agent already named a
lesson, acknowledge it (`+1 with <agent>'s lesson on X`) instead of restating.

The "one lesson" is required — no opting out. If an agent genuinely has
nothing new, they write `- (no new lesson this run; strongest existing rule
reinforced: <quoted rule from lessons-learned.md>)`.

### Positive-signal PATTERN tag (v2.5+)

Reviewers can also flag things that went *especially well* during Stage
5 using a `PATTERN:` line inside a review-file section:

```markdown
## Review of backend
<comments>

PATTERN: dependency injection lifecycle is explicit and testable —
candidate for the team's default pattern

REVIEW: APPROVED
```

The Principal collects PATTERN entries across reviews during Step 9b
synthesis. PATTERN entries compete with lessons for promotion into
`lessons-learned.md`. A PATTERN can promote when:
- It names a concrete, repeatable practice (not a vibe — "good naming"
  is not a pattern)
- It generalises beyond this feature
- Doesn't duplicate an existing rule

Promoted PATTERN entries go under `lessons-learned.md` with the same
schema as a regular lesson, but phrased as a positive rule ("Use
constructor injection for service dependencies …") rather than a
corrective one. The 2-per-retro promotion cap still applies.

### Step 9b — Synthesis (Principal chairs)

Invoke: `principal` agent.  
Input: `pipeline/retrospective.md` + current `pipeline/lessons-learned.md`  
Output:

1. Append a dated summary block to the top of `pipeline/retrospective.md`:
   ```markdown
   ## Synthesis — <YYYY-MM-DD> — feature: <brief title>
   - **Severity:** green | yellow | red
   - **Top theme:** one sentence
   - **Lessons promoted:** [list of rule titles added to lessons-learned.md]
   - **Lessons retired:** [list of rule titles removed — with reason]
   ```
2. Update `pipeline/lessons-learned.md`:
   - **Promote** a new rule only if it's concrete, generalises beyond this
     feature, and doesn't duplicate an existing rule. Max **2 promotions per
     retro** — force selection, prevent bloat.
   - **Retire** a rule if:
     - This run proved it wrong
     - It's been reinforced ≥5 times without a related defect
       (internalised — no longer needs to be written)
     - **Auto age-out (v2.5+):** it hasn't been reinforced in **10**
       runs AND its current `Reinforced` counter is 0. Rules that
       nobody has hit in 10 runs are noise. Before retiring on this
       rule, confirm the principal has not recently opened an ADR
       that cites it — if so, keep it one more cycle.
   - Each rule in `lessons-learned.md` uses this shape. The `**Reinforced:**`
     line MUST match the inspector parser contract — see `src/backend/app/parser.py`
     `_REINFORCED_INLINE_RE`. Two forms only: `**Reinforced:** 0` when never
     reinforced (omit the `(last: …)` suffix entirely — do NOT use a placeholder
     like `—` or `N/A`), or `**Reinforced:** <N> (last: YYYY-MM-DD)` when N ≥ 1.
     ```markdown
     ### L<NNN> — <short title>
     **Added:** YYYY-MM-DD (run: <feature>)
     **Reinforced:** 0                           # first-time promotion: no (last:) suffix
     **Rule:** one sentence.
     **Why:** the incident or pattern that produced it.
     **How to apply:** when and where this kicks in.
     ```
     Reinforcement form (count ≥ 1):
     ```markdown
     **Reinforced:** 2 (last: 2026-05-14)
     ```

3. Write `pipeline/gates/stage-09.json` — informational, always `"status": "PASS"`
   unless synthesis itself failed. Includes `lessons_promoted` and
   `lessons_retired` arrays.

### Severity rubric

- **green** — zero escalations, zero retries, zero BLOCKERs caught after Stage 4
- **yellow** — at least one retry, one post-build BLOCKER, or one ESCALATE
  that resolved without user intervention
- **red** — a user-visible defect shipped, a gate was bypassed, or the
  pipeline halted unresolved

## When lessons-learned.md gets read

- **Start of Stage 1** — PM reads it before writing a brief; it may change
  how acceptance criteria are phrased.
- **Start of Stage 2** — Principal reads it before drafting the design spec.
- **Start of Stage 4** — every dev reads it before writing code.
- **Start of Stage 5** — every reviewer reads it before reviewing.

The file is part of every agent's standing context. The orchestrator
surfaces it at each of those stages.

## When to run retro outside Stage 9

- After any **red** halt (unresolved escalation, failed deploy) — run retro
  immediately, even if the feature didn't ship. Failed runs teach more.
- After a `/hotfix` — abbreviated single-section retro from whoever ran the
  hotfix. Skip the parallel contribution pass.

## What not to do in retro

- **No blame.** Agents are roles, not people. "dev-backend made a mistake"
  is useless; "the spec was ambiguous about pagination and dev-backend
  guessed wrong" is the lesson.
- **No re-litigating technical decisions** that went through an ADR. The ADR
  is the decision record; if it was wrong, open a new ADR, don't relitigate
  in retro.
- **No generic platitudes.** "Communicate better" is not a lesson.
  "When the brief uses 'notify', clarify channel (email/push/inline) in
  Stage 1" is a lesson.
