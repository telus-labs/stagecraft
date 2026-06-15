## feat(track-provenance): pipeline/track.json + confidence guard (ADR-006, Phase 11.3)

**`devteam assess` writes `pipeline/track.json`** (per-run inference record) by default.
`--confirm` sets `source:"human"`. `--apply` continues to write `custom_stages` to
`.devteam/config.yml` (no breaking change).

**`resolveTrack`** now reads `pipeline/track.json` in precedence:
```
--track  >  pipeline/track.json  >  custom_stages  >  default_track  >  "full"
```
Returns `{track, source, confidence}` so the confidence guard below can apply.

**`autonomy.require_confirmed_track`** (new config flag, default `false`): when on,
an inferred `pipeline/track.json` at medium or low confidence produces an
`unconfirmed-track` halt requiring `--track` or `--force`. High confidence proceeds.
When off (default), an inferred track emits a warn-once line to stderr, never blocks.
The flag is NOT keyed on `CI=true` (which is already overloaded by the validator and
verify runner) — CI pipelines opt in explicitly.

**`run-log.jsonl`** gains a `run-start` event at the top of every run, carrying
`track_source` and `track_confidence` for provenance auditing. A
`track-confidence-check` event is logged whenever the guard runs.

Honest scope note: the guard covers `pipeline/track.json`-based provenance. A run
with no `track.json` falls through to `custom_stages` / `default_track` (source:
`"config"`) — those are explicit project-wide choices and not subject to the
confidence guard.
