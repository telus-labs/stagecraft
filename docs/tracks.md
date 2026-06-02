# Tracks

A **track** is a named subset of pipeline stages. Picking a track is how you tell Stagecraft how much rigor a change needs. The six tracks reflect a year+ of operational tuning over which stages are skippable for which change types — they were lifted verbatim from `claude-dev-team`.

You set the active track in `.devteam/config.yml`:

```yaml
pipeline:
  default_track: full
```

Or override per-invocation: `devteam stage build --track quick`.

## Pick by what you're shipping

| Change type | Track | Why |
|---|---|---|
| New customer-facing feature | `full` | Full rigor: requirements → design → build → review → tests → sign-off → deploy → retro |
| Small fix or copy change | `quick` | Skip design + clarification + pre-review; PM brief is still required |
| Mechanical change with obvious scope (rename a function, bump padding) | `nano` | Build + scoped peer-review (1 reviewer, 1 approval) + qa |
| Tweaking config/feature-flag values, no code | `config-only` | Build + pre-review + (security if triggered) + qa + sign-off + deploy |
| Dependency bump or library upgrade | `dep-update` | Build + peer-review + qa + sign-off + deploy |
| Urgent production incident | `hotfix` | Build + pre-review + (security if triggered) + peer-review + qa + sign-off + deploy + retro |

## What each track runs

```
                            req  des  cla  bld  4a  4b  5    qa  6b  6c   7    8    9
   full                     ✓    ✓    ✓    ✓    ✓   ✓⁺  ✓    ✓   ✓   ✓    ✓    ✓    ✓
   quick                    ✓              ✓              ✓    ✓   ✓        ✓    ✓    ✓
   nano                                    ✓              ✓ˢ   ✓
   config-only                              ✓    ✓   ✓⁺           ✓             ✓    ✓
   dep-update                               ✓              ✓    ✓             ✓    ✓
   hotfix                                   ✓    ✓   ✓⁺  ✓    ✓   ✓   ✓    ✓    ✓    ✓

   Legend: ✓⁺ = stage-04b (security review) is conditional — only runs
   when stage-04a reports security_review_required: true.
   ✓ˢ = scoped peer-review (single reviewer, required_approvals=1)
        on nano. See PEER_REVIEW_SIZING in core/pipeline/stages.js.
   6b = accessibility audit (axe-core / pa11y / lighthouse). See
        skills/accessibility-audit/SKILL.md.
   6c = observability gate (verify the brief's promised metrics/logs/
        traces actually ship). full + hotfix only. See
        skills/observability-verification/SKILL.md.
```

## Safety: the stoplist

Lighter tracks (`quick`, `nano`, `config-only`, `dep-update`) refuse to run when the change description matches the **stoplist** — a list of phrases that flag changes too consequential for an abbreviated pipeline. The list lives in `core/guards/stoplist.js` and triggers on:

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

`full` and `hotfix` bypass the stoplist by design — full runs everything anyway; hotfix has its own safety story (mandatory pre-review + peer-review + tests).

## How `devteam next` honors the track

`next` walks **only** the active track's stage list. So on `nano`, after `build` is PASSED, `next` advances directly to `qa` (skipping design/clarification/pre-review/peer-review). On `full`, the walk hits all 17 stages in order.

The active track is read from `.devteam/config.yml` (`pipeline.default_track`), with `--track` as an override.

## Conditional dispatch within a track

`stage-04b` (security review) is in the track lists for `full`, `config-only`, and `hotfix` — but whether it actually runs depends on `stage-04a`'s `security_review_required` flag. The Platform engineer setting that flag at Stage 4a is what triggers (or skips) the security review.

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

The skip is silent — see `devteam summary` for visibility:

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

It's an escape hatch, not a block.

## Choosing a track

Decision tree:

1. **Is this a hotfix for a live incident?** → `hotfix`. Don't skip pre-review and peer-review just because you're in a hurry; the stoplist won't save you.
2. **Does this touch auth, PII, payments, crypto, migrations, or new deps?** → `full`. Lighter tracks will block on the stoplist anyway.
3. **Is the change just config or feature-flag values, no code logic?** → `config-only`.
4. **Is the change a dependency bump?** → `dep-update`.
5. **Is the change a mechanical edit (rename, format, copy change)?** → `nano`.
6. **Is the change a small but real feature with obvious requirements?** → `quick`.
7. **Otherwise** → `full`.

## Customizing tracks

Tracks live in `core/pipeline/stages.js` under `STAGES_BY_TRACK`. Add a new track:

```js
const STAGES_BY_TRACK = {
  ...
  // For experiments where you want full rigor but no deploy yet
  "experiment": ["requirements", "design", "build", "peer-review", "qa", "retrospective"],
};
```

Then update `TRACKS` (the validation set) and `config-only`/`dep-update`/`hotfix` to leave the new entry untouched. Tests in `tests/contract.test.js` will fail if any track lists an unknown stage — that's intended.
