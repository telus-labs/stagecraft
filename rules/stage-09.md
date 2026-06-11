# Stage 9 — Retrospective (Principal)

Invoke: `principal` agent.
Input: all pipeline artifacts, `pipeline/lessons-learned.md`.
Output: `pipeline/retrospective.md`, updated `pipeline/lessons-learned.md`.

Synthesize the run, promote durable lessons, retire or age out stale ones,
and harvest patterns from Stage 5 review files. Informational gate — status
is PASS unless synthesis itself failed.

See `rules/retrospective.md` for the full protocol (age-out rule,
promotion criteria, lessons-learned format).

## Production deltas vs. brief SLOs (G3)

When `pipeline/production-feedback.md` is present (operator-created post-deploy),
read it **before** writing the synthesis block. Add a `## Production Deltas` section
to `pipeline/retrospective.md` that:

1. States which brief SLOs were met, missed, or not yet measurable.
2. Lists any incidents from the feedback file and their severity.
3. Flags any delta that suggests a lesson worth promoting (e.g. a missed SLO
   that a more conservative design choice would have avoided).

Set `production_feedback_reviewed: true` in the gate when you have done this.
Set `production_feedback_reviewed: false` if the file exists but synthesis time
ran out (rare; leave a `SUGGESTION:` in the retro for the next run).
Set `production_feedback_reviewed: "absent"` (or omit) when the file does not exist.

## Gate

Gate file: `pipeline/gates/stage-09.json`.

```json
{
  "stage": "stage-09",
  "status": "PASS",
  "track": "full",
  "timestamp": "<ISO 8601>",
  "orchestrator": "devteam@<version>",
  "blockers": [],
  "warnings": [],
  "severity": "green | yellow | red",
  "lessons_promoted": ["L007 — clarify notify channel in brief"],
  "lessons_retired": ["L002 — prefer offset pagination"],
  "aged_out": ["L019 — avoid trailing slash in URLs"],
  "patterns_harvested": 3,
  "contributions_written": [
    "pm", "principal",
    "dev-backend", "dev-frontend", "dev-platform", "dev-qa"
  ],
  "production_feedback_reviewed": "absent"
}
```

**Field semantics:**
- `severity` — `green` (smooth run), `yellow` (minor issues), `red` (significant problems)
- `aged_out` — rules retired via the age-out rule (not reinforced in 10 runs +
  current `Reinforced` is 0). Distinct from `lessons_retired`, which is for rules
  explicitly proven wrong or internalised.
- `patterns_harvested` — count of `PATTERN:` entries the Principal pulled from
  Stage 5 review files during synthesis, before selection for promotion.
- `contributions_written` — typically includes all dev roles; the security-engineer
  contributes when Stage 4b fired.
- `production_feedback_reviewed` — G3 seam: `true` when `pipeline/production-feedback.md`
  was read and a "Production Deltas" section written; `false` if present but skipped;
  `"absent"` (or null) when the file was not present. Optional field.
