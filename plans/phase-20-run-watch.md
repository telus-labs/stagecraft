# Phase 20 — Autonomous Run Watch Mode

**Status:** Complete. Merged in PR #268.
**Source:** ADR-007 section 5 and GitHub #145's explicitly ungated UX follow-up.
**Purpose:** make long foreground autonomous runs observable without changing driver
decisions, stall thresholds, or process-lifecycle policy.

## Contract

`devteam run --watch` consumes the driver's existing `onEvent` stream and renders a
rolling status block on interactive stderr. The Tier 1 stall probe emits callback-only
progress samples so the display can show log growth without polling files. Redirected
or non-TTY output falls back to the existing line-per-event progress format with no ANSI
sequences. `--watch` and `--json` are mutually exclusive.

## Work item 20.1

- Add deterministic TTY rendering for stage, dispatch elapsed time, latest log-growth
  rate, heartbeat age, and observed stall status.
- Restore cursor visibility and clear the refresh timer on success and error paths.
- Preserve current line progress for non-TTY consumers and every existing exit code.
- Keep progress samples out of `run-log.jsonl`; durable stall evidence remains limited
  to actual `stall-detected` events.
- Update CLI, feature, operator, ADR, backlog, and roadmap documentation.

## Deliberate limits

Watch mode does not terminate stalled processes, change Tier 1 detection, infer a new
stall threshold, or open GitHub #145. Active response remains gated on real stall data.
