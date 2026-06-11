# Stage 9 — Retrospective (Principal)

Invoke: `principal` agent.
Input: all pipeline artifacts, `pipeline/lessons-learned.md`.
Output: `pipeline/retrospective.md`, updated `pipeline/lessons-learned.md`.

Synthesize the run, promote durable lessons, retire or age out stale ones,
and harvest patterns from Stage 5 review files. Informational gate — status
is PASS unless synthesis itself failed.

See `rules/retrospective.md` for the full protocol (age-out rule,
promotion criteria, lessons-learned format).

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
  ]
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
