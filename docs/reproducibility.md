# Reproducibility (C4)

Stagecraft records exactly what produced each gate — model version, temperature, seed, max_tokens, a hash of the system prompt, a hash of the tool surface. Six months later, the gate JSON tells you not just *that* a change was made, but *what configuration* made it.

This is the **C4** BACKLOG item. It pairs with E6 (replay, not yet built) and matters concretely for any audit that asks "show me how this change was developed" — SOC 2, EU AI Act, internal compliance reviews.

## What "reproducible" honestly means with LLMs

Let me say what reproducibility is **not** before saying what it is:

- **Not strict determinism.** Even at `temperature: 0`, most LLM APIs are nondeterministic across serving updates. Vendors change underlying infrastructure; the same prompt today and tomorrow can produce different outputs without warning.
- **Not a guarantee.** Recording `seed: 42` only matters if the host honors seeded sampling. Anthropic's API does at temperature 0; not all hosts implement it consistently.

What it **is**:

- **Auditability.** Six months from now, you can answer "what model, what temperature, what prompt, what tools" with the gate JSON alone. No guessing, no chasing config history.
- **Drift detection.** Re-render the prompt today, hash it, compare to the gate's hash. Drift means the prompt changed (role brief edited, skill updated, rules file revised). Visible at a glance.
- **Replay readiness.** With enough recorded fields, replay (E6, future) can recreate the same model invocation. The model itself may still drift, but the *configuration* is preserved.

## The recorded fields

Optional additions to every gate, defined in `core/gates/schemas/gate.schema.json`:

| Field | What | Source |
|---|---|---|
| `model` | Adapter-namespaced model id (`claude-opus-4-7`) | D6 (cost telemetry) — already on the gate |
| `model_version` | Vendor's exact version (`claude-opus-4-7-20251104`) | Agent fills in |
| `temperature` | Sampling temperature used (number, 0–2) | Agent fills in |
| `seed` | RNG seed when supported by the host | Agent fills in |
| `max_tokens` | max_tokens parameter passed to the model | Agent fills in |
| `system_prompt_hash` | sha256 of the rendered system prompt (normalized) | **Computed and embedded by the adapter** when rendering — the agent stamps it verbatim |
| `tools_hash` | sha256 of the sorted, deduplicated tool-name list | Agent fills in if known |

All optional. Agents fill them in when they know; missing fields show up as `null` in fingerprints (distinguishable from "field was zero").

## How fields land in the gate

Three paths:

1. **Orchestrator-computed.** `system_prompt_hash` is computed by the adapter at prompt-render time. The hash is embedded directly in the gate skeleton hint the agent sees — the agent stamps it verbatim into the gate JSON.

2. **Agent-self-reports.** `model_version`, `temperature`, `seed`, `max_tokens`, `tools_hash` are filled in by the agent when it knows them. Claude Code subagents have access to their own `model:` frontmatter; headless invocations get them from the CLI flags they were invoked with.

3. **Post-hoc tools** (future). A `devteam gate-stamp` subcommand could parse host CLI logs (e.g. Claude's `--output-format json` response payload) and back-fill the recorded fields. Not yet built.

## Using the recorded fields

### `devteam reproduce <stage-id>`

The audit-facing tool. Reads `pipeline/gates/<stage-id>.json`, prints what was recorded, classifies replay readiness, and (if the stage is still defined) re-renders the current prompt to compare hashes.

```
$ devteam reproduce stage-04.backend
Reproducibility report — pipeline/gates/stage-04.backend.json

Recorded by orchestrator: devteam@0.2.0
Recorded at:              2026-05-15T14:32:11Z
Stage / workstream / host: stage-04 / backend / codex

Replay readiness: FULL — all reproducibility fields recorded

Recorded fields:
  model                claude-opus-4-7
  model_version        claude-opus-4-7-20251104
  temperature          0.0
  seed                 42
  max_tokens           8000
  system_prompt_hash   sha256:9f86d081…
  tools_hash           sha256:ef537f25…

Drift check (current rendered prompt vs gate hash):
  ⚠️  DRIFT — the rendered prompt has changed since this gate was written.
     gate:    sha256:9f86d081…
     current: sha256:abc12345…
     Likely causes: role brief, skill, or rules file edits.
```

JSON mode (`--json`) emits the same info as a structured object for tooling.

### `core/reproducibility.js` API

Programmatic use:

```js
const {
  hashSystemPrompt,
  hashTools,
  reproducibilityFingerprint,
  compareFingerprints,
  replayReadiness,
} = require("./core/reproducibility");

// Hash a prompt (the adapter does this for you in renderStagePrompt):
hashSystemPrompt(promptText)      // → "sha256:..."

// Hash a tools list (order- and duplicate-invariant):
hashTools(["Read", "Write", "Edit"])  // → "sha256:..."

// Reduce a gate to its reproducibility-relevant fields:
const fp = reproducibilityFingerprint(gate);

// Diff two fingerprints:
compareFingerprints(beforeFp, afterFp)
// → [{ field, before, after, kind: "drift" | "absent" | "match" }]

// Classify how reproducible a gate is:
replayReadiness(gate)
// → { level: "full" | "partial" | "incomplete", reason, missing_required, missing_helpful }
```

## Replay readiness levels

- **`full`** — every reproducibility field is recorded. Could plausibly replay the run from the gate alone.
- **`partial`** — required fields present (`model` + `system_prompt_hash`) but some helpful ones missing. Audit-complete; replay would be approximate.
- **`incomplete`** — at least one required field is missing. Pre-D6 gates fall here; gates whose agent forgot to stamp `system_prompt_hash` fall here.

## What this enables now vs later

**Now (this commit):**
- Audit: "what configuration produced this artifact?" — answer is in the gate.
- Drift detection: "would the same prompt render today?" — `devteam reproduce` compares hashes.
- Compliance evidence: SOC 2 / EU AI Act ask for records of how AI decisions were made. The gate JSON + this tool together are that record.

**Soon (planned):**
- Config-side pinning: `.devteam/config.yml` `reproducibility.model_pins: { stage-04: claude-opus-4-7-20251104 }`. Adapter reads it and passes to the host. Not yet built (per-host adapter work).
- Replay (E6): `devteam replay <run-id>` — re-invoke the same stage with the recorded parameters. Depends on this commit's recording layer.
- Cross-host hash stability: `system_prompt_hash` is host-specific today (each adapter renders slightly differently). A host-neutral prompt hash would let drift detection work across host migrations.

## Caveats — be honest about what's recorded

- **Cached prompt segments.** Anthropic and OpenAI both support prompt caching (cached portions of the input don't count toward billing the same way). `system_prompt_hash` covers the full prompt; cache state isn't reflected. Two runs with identical hashes may still have different cache hits and different cost profiles. Cost (D6) and prompt hash (C4) are independent dimensions.
- **Multimodal inputs.** If a stage's prompt includes images (G5, not yet shipped), the hash treats them as opaque base64 — the image bytes are part of the hash. Re-encoding the same image differently would change the hash.
- **Tool surface drift.** `tools_hash` captures the *names* of available tools, sorted. Two hosts with the same tool names but different tool *implementations* will hash identically. This is honest about what the model could call, not how the call resolves.
- **Time of day, region, vendor's serving state.** Not captured by any hash. These can affect output without leaving a trace. Reproducibility at the framework layer doesn't fix vendor-side nondeterminism.

## See also

- [`core/reproducibility.js`](../core/reproducibility.js) — implementation.
- [`core/gates/schemas/gate.schema.json`](../core/gates/schemas/gate.schema.json) — the optional fields.
- [`docs/cost.md`](cost.md) — D6 cost telemetry, the sibling "recorded on the gate" feature.
- [`docs/observability.md`](observability.md) — OTel spans, the runtime-side complement.
- [`docs/BACKLOG.md`](BACKLOG.md) C4 — the BACKLOG entry this implements; E6 (replay) is the natural follow-up.
