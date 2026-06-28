# Phase 23 — Prototype Mode

Status: proposed for implementation

## Problem

The full Stagecraft SDLC path is valuable once a change is settling into durable
software, but it can slow the wrong loop during early product exploration. Many
prototype runs need fast local implementation, quick feedback, and a cheap
discard/iterate/promote decision before requirements, gates, review depth, and
deployment authority are useful.

Using `full`, `quick`, or even `nano` for that work overstates maturity. It also
risks training users to bypass Stagecraft when what they need is a pre-SDLC
learning loop that hands off cleanly into Stagecraft once the idea earns it.

## Decision

Add a first-class `devteam prototype` workflow that lives beside the gated
pipeline rather than inside `STAGES_BY_TRACK`.

Prototype mode is not a seventh delivery track and does not produce production
gate evidence. It creates a lightweight prototype packet under
`pipeline/prototypes/<id>/`:

- `intent.md` — the problem, audience, constraints, and learning goal.
- `build-prompt.md` — a fast-build prompt for a coding agent or human pair.
- `feedback.md` — observations from demo, use, and stakeholder review.
- `promotion.md` — the explicit discard/iterate/promote handoff.
- `prototype.json` — machine-readable metadata for tooling.

Promotion is a deliberate boundary. A promoted prototype feeds a normal
`devteam run --feature-file <promotion.md> --track <full|quick|...>` invocation.
Until then, prototype artifacts are learning records, not delivery evidence.

## Why `prototype`, not `spike`

`spike` is useful for technical feasibility, but the target workflow is broader:
build fast, feel the interaction, share it, gather feedback, and then decide
whether to harden. `prototype` covers technical, product, UX, and workflow
learning without implying the output is production-ready.

## UX

Start a prototype:

```bash
devteam prototype start "dashboard concept" \
  --feature "Try a dense dashboard for pipeline liveness and blockers"
```

Record feedback:

```bash
devteam prototype note dashboard-concept \
  --feedback "The stage list works, but the blocker affordance is buried."
```

Prepare promotion:

```bash
devteam prototype promote dashboard-concept --track full
```

The promote command updates `promotion.md` with the suggested hardening command
and reminds the user that shortcuts, demo-only code, missing tests, data risks,
and design tradeoffs must be made explicit before full delivery work begins.

## Guardrails

Prototype mode should optimize speed, but not normalize unsafe shortcuts:

- No production deploy claim.
- No sign-off/deploy gate bypass.
- No generated gate chain.
- Explicit `known_shortcuts` and `risks_discovered` sections in promotion.
- Strong warning for auth, payments, migrations, secrets, customer data, or
  infrastructure changes: promote to a normal track before broad use.

## Implementation Plan

1. Add `core/cli/commands/prototype.js` with `start`, `note`, and `promote`
   subcommands.
2. Register `prototype` in `bin/devteam` and CLI help.
3. Add tests for packet creation, slug handling, feedback appends, promotion
   command generation, no-overwrite behavior, and JSON output.
4. Document the workflow in README and user guide references.
5. Add consistency/backlog/changelog coverage.

## Non-goals

- Do not add a named `prototype` entry to `STAGES_BY_TRACK` in this phase.
- Do not invoke host CLIs or run autonomous agents directly.
- Do not allow prototype packets to satisfy normal gate validators.
- Do not implement automatic risk classification yet.

## Follow-ups

- `devteam prototype status` for listing active prototype packets.
- Risk-aware prompting that recommends early promotion for sensitive work.
- Optional demo-deploy conventions that clearly separate demo exposure from
  production deployment.
- A report view that shows prototype packets alongside hardened pipeline runs
  without merging their evidence semantics.
