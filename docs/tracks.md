# Tracks

A **track** is a named subset of pipeline stages. It tells Stagecraft how much rigor a change requires. The six tracks reflect over a year of operational tuning on which stages are skippable for which change types, carried over from `claude-dev-team`.

- [Pick by what you're shipping](#pick-by-what-youre-shipping)
- [What each track runs](#what-each-track-runs)
- [Safety: the stoplist](#safety-the-stoplist)
- [How `devteam next` honors the track](#how-devteam-next-honors-the-track)
- [Conditional dispatch within a track](#conditional-dispatch-within-a-track)
- [When you've picked the wrong track](#when-youve-picked-the-wrong-track)
- [Choosing a track](#choosing-a-track)
- [Track record (`pipeline/track.json`)](#track-record-pipelinetrackjson)
- [Customizing tracks](#customizing-tracks)

You set the active track in `.devteam/config.yml`:

```yaml
pipeline:
  default_track: full
```

Or override per-invocation: `devteam stage build --track quick`.

## Pick by what you're shipping

| Change type | Track | Why |
|---|---|---|
| Bounded feature or fix with clear requirements and no cross-cutting design concerns | `quick` | Skips design, clarification, pre-review, and red-team; PM brief is still required. Good default for most new features that don't touch the stoplist |
| Complex feature, cross-cutting architecture change, or anything needing formal design or adversarial review | `full` | Full rigor: requirements → design → build → review → tests → sign-off → deploy → retro |
| Mechanical change with obvious scope (rename a function, bump padding) | `nano` | Build + scoped peer-review (1 reviewer, 1 approval) + qa |
| Tweaking config/feature-flag values, no code | `config-only` | Build + pre-review + (security if triggered) + qa + sign-off + deploy |
| Dependency bump or library upgrade | `dep-update` | Build + peer-review + qa + sign-off + deploy |
| Urgent production incident | `hotfix` | Build + pre-review + (security if triggered) + peer-review + qa + sign-off + deploy + retro |

## What each track runs

<!-- generated: do not hand-edit -->
```
              req des cla 3b  bld 4a  4b  4c  4d  5   qa  6b  6c  6d  6e  7   8   9   
full          ✓   ✓   ✓   ✓   ✓   ✓   ✓⁺  ✓   ✓⁺  ✓   ✓   ✓   ✓   ✓   ✓   ✓   ✓   ✓   
quick         ✓           ✓   ✓                   ✓   ✓   ✓           ✓   ✓   ✓   ✓   
nano                          ✓                   ✓ˢ  ✓                               
config-only                   ✓   ✓   ✓⁺      ✓⁺      ✓                   ✓   ✓       
dep-update                    ✓                   ✓   ✓                   ✓   ✓       
hotfix                        ✓   ✓   ✓⁺  ✓   ✓⁺  ✓   ✓   ✓   ✓       ✓   ✓   ✓   ✓   

   Legend:
   ✓⁺ = conditional stage — only runs when stage-04a triggers it
       (security-review: security_review_required; migration-safety: migration_safety_required)
   ✓ˢ = scoped peer-review on nano (single reviewer, required_approvals=1).
       See PEER_REVIEW_SIZING in core/pipeline/stages.js.
   ✓ᵐ = mechanical script (preflight/stage-04e), not an LLM dispatch.
   3b = executable-spec (Gherkin scenarios from acceptance criteria)
   4a = pre-review (lint + dep review + SCA + trigger heuristics)
   4b = security review (conditional; veto power)
   4c = red-team adversarial review
   4d = migration-safety review (conditional; veto power)
   4e = preflight mechanical checks
   6b = accessibility audit (axe-core / pa11y / lighthouse)
   6c = observability gate (verify brief §9 signals ship)
   6d = verification beyond tests (property-based / mutation / formal; full only)
   6e = performance budget (Lighthouse / bundle / load test)
```
<!-- /generated -->

## Safety: the stoplist

Lighter tracks (`quick`, `nano`, `config-only`, `dep-update`) refuse to run when the change description matches the **stoplist**: a list of phrases that flag changes too consequential for an abbreviated pipeline. The list lives in `core/guards/stoplist.js` and triggers on:

- `auth`, `authentication`, `authorization`, `session handling`
- `cryptography`, `key management`, `secret rotation`
- `pii`, `payments`, `regulated data`
- `schema migration`, `destructive data`
- `feature-flag introduction`, `new external dependency`

A match prints the reason and exits 2:

```
$ devteam stage build --feature "add auth middleware to API"
This change matches the safety stoplist. Use /pipeline instead.
Reasons:
  - authentication: matched "auth" in: add auth middleware to API

If this is a false positive, re-run with --force to bypass.
Stoplist defined in .devteam/rules/pipeline.md §Stage 0.
(Active track: nano. Stoplist guarded.)
```

`full` and `hotfix` bypass the stoplist by design. `full` runs everything anyway; `hotfix` has mandatory pre-review, peer-review, and tests.

## How `devteam next` honors the track

`next` walks only the active track's stage list. On `nano`, after `build` passes, `next` advances directly to `qa`, skipping design, clarification, pre-review, and peer-review. On `full`, the walk hits all 18 stages in order.

The active track is read from `.devteam/config.yml` (`pipeline.default_track`), with `--track` as an override.

## Conditional dispatch within a track

`stage-04b` (security review) is in the track lists for `full`, `config-only`, and `hotfix`, but whether it actually runs depends on `stage-04a`'s `security_review_required` flag. The Platform engineer sets that flag at Stage 4a, which triggers or skips the security review.

```
$ devteam next
▶️ run-stage — security-review (stage-04b)
   stage not started
```

vs.

```
$ devteam next
▶️ run-stage — peer-review (stage-05)         # security-review was skipped
   multi-role stage not started
```

The skip is silent. Use `devteam summary` for visibility:

```
✅ pre-review        stage-04a  PASS
⏸  security-review   stage-04b  (skipped — condition not met: stage-04a.security_review_required !== true)
```

## When you've picked the wrong track

The `devteam stage <name>` command warns on stderr (but still runs) when you invoke a stage that's not in the active track:

```
[devteam] note: stage "design" is skipped by track "nano". Running anyway;
if this is unintended, change pipeline.default_track in .devteam/config.yml.
```

This is an escape hatch, not a block.

## Choosing a track

`devteam assess` automates this decision: given a change description and a file list it returns a `recommendedTrack`, a `confidence` level (`high | medium | low`), and the reasons. Running `devteam assess` (no flags) writes the result to `pipeline/track.json` so `devteam run` picks it up automatically. Use `devteam assess --confirm` to set `source:"human"` (operator-confirmed). See [Track record (`pipeline/track.json`)](#track-record-pipelinetrackjson) and [`ADR-006`](adr/006-track-inference-under-autonomy.md).

Decision tree:

1. **Is this a hotfix for a live incident?** → `hotfix`. Pre-review and peer-review are mandatory; urgency is not a reason to skip them.
2. **Does this touch auth, PII, payments, crypto, migrations, or new external deps?** → `full`. Lighter tracks will block on the stoplist anyway.
3. **Is the change just config or feature-flag values, no code logic?** → `config-only`.
4. **Is the change a dependency bump?** → `dep-update`.
5. **Is the change a mechanical edit (rename, format, copy change)?** → `nano`.
6. **Does the change cross multiple systems, require architectural decisions, or carry significant security surface?** → `full`.
7. **Otherwise** → `quick`. This covers most bounded features and fixes: a new endpoint, a new UI component, added business logic, a non-trivial bug fix. Requirements must be clear and design self-contained. When in doubt between `quick` and `full`, start with `quick`; if Stage 2 design review surfaces cross-cutting concerns, restart on `full`.

> **Note on the config.yml default.** The factory default is `pipeline.default_track: full`, which is conservative and always safe. However, `full` runs red-team adversarial review and formal design on every change, which is wasteful when most attack surfaces don't apply. Evaluate the appropriate track for each brief rather than relying on the config default.

## Track record (`pipeline/track.json`)

`devteam assess` writes a per-run inference record to `pipeline/track.json`:

```json
{
  "track": "quick",
  "source": "inferred",
  "confidence": "high",
  "reasons": ["description matches quick-change keywords (minor/small fix)"],
  "assessed_at": "2026-06-15T14:00:00Z",
  "assessed_by": "devteam assess 0.7.0"
}
```

`devteam run` reads this file as part of the track resolution chain:
```
--track  >  pipeline/track.json  >  custom_stages  >  default_track  >  "full"
```

| Field | Meaning |
|---|---|
| `track` | The inferred (or confirmed) track name |
| `source` | `"inferred"` — produced by `devteam assess`; `"human"` — confirmed by `--confirm` |
| `confidence` | `"high"` / `"medium"` / `"low"` — the assess heuristic's certainty |
| `reasons` | Bullet-list of why this track was chosen |
| `assessed_at` | ISO timestamp of the assess run |
| `assessed_by` | The CLI version that wrote the record |

### Writing track.json

```bash
devteam assess                  # writes pipeline/track.json with source:"inferred"
devteam assess --confirm        # writes pipeline/track.json with source:"human"
devteam assess --apply          # writes custom_stages to .devteam/config.yml (project-wide; no track.json)
devteam run --track quick       # bypasses track.json entirely; always source:"human"
```

### Confidence guard (`autonomy.require_confirmed_track`)

By default `devteam run` warns once on an inferred track but never blocks. Set
`autonomy.require_confirmed_track: true` in `.devteam/config.yml` to enable the guard:

| `source` | `confidence` | Flag off (default) | Flag on |
|---|---|---|---|
| `"human"` | any | proceed silently | proceed silently |
| `"inferred"` | `"high"` | warn once | proceed silently |
| `"inferred"` | `"medium"` or `"low"` | warn once | **`unconfirmed-track` halt** |

The guard is keyed on the explicit config flag — not `CI=true` (which is already
overloaded by the validator and verify runner). CI pipelines opt in by setting the
flag, not by inheriting an ambient environment variable. See [ADR-006](adr/006-track-inference-under-autonomy.md).

Override the halt with `--track <name>` (sets `source:"human"`) or `--force` (bypasses).

## Customizing tracks

Tracks live in `core/pipeline/stages.js` under `STAGES_BY_TRACK`. Add a new track:

```js
const STAGES_BY_TRACK = {
  ...
  // For experiments where you want full rigor but no deploy yet
  "experiment": ["requirements", "design", "build", "peer-review", "qa", "retrospective"],
};
```

Then update `TRACKS` (the validation set) and `config-only`/`dep-update`/`hotfix` to leave the new entry untouched. Tests in `tests/contract.test.js` will fail if any track lists an unknown stage; this is intentional.
