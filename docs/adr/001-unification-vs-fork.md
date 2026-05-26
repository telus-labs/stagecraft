# ADR 001 — Unification: one core, per-host adapters

**Status:** Accepted
**Date:** 2026-05-25
**Authors:** Mumit Khan

## Context

Two predecessor tools, `claude-dev-team` and `codex-dev-team`, implemented the same software-development pipeline (PM → Principal → Build → Review → QA → Deploy → Retro) for two different AI coding tools. The implementations diverged ~10% — same templates, same schemas, same ~80% of scripts — and were slowly drifting:

- Templates: 12 files, identical except one README.
- Schemas: 11 files, mostly identical (claude had one extra: stage-04a).
- Scripts: same names (`bootstrap.js`, `gate-validator.js`, `stoplist.js`, `budget.js`, …), differing only in path strings (`.claude/` vs `.codex/`) and the orchestrator entrypoint (`claude-team.js` vs `codex-team.js`).
- Role briefs: duplicated under `.claude/agents/` and `.codex/prompts/roles/`, drifting on each edit (subagent's analysis showed 150–300 lines of diff per role, most cosmetic but real).

Maintenance burden was N×2 for every change. A "parity-check" script existed in both repos precisely to flag drift. Adding a third host (Gemini CLI, Cursor, etc.) would have meant a third fork.

## Decision

Replace both forks with a **single model-agnostic core** plus **per-host adapters**.

- `core/` owns the shared logic: stage definitions, gate schemas, validator, guards, orchestrator, configuration, routing. The core never invokes a model.
- `hosts/<name>/` owns the host-specific surface: how to install into a target project, how to render a stage prompt for this host, optionally how to drive the host CLI headlessly.
- Shared content (`roles/`, `rules/`, `skills/`, `templates/`) lives once at the repo root. Adapters render these into host-expected paths at install time.

A single `.devteam/config.yml` in the target project routes each (stage, role) workstream to a host. A single pipeline run can dispatch different workstreams to different hosts; the gate JSON seam makes the handoff safe.

## Consequences

**Positive:**

- One source of truth. No more parity-check; drift becomes structurally impossible because there's nothing to drift between.
- Adding a host is a self-contained task: implement the contract in `hosts/<new>/adapter.js`. Estimated 200-300 lines.
- Multi-host installs (`devteam init --host claude-code,codex`) are first-class — you can route backend to one host and frontend to another in the same pipeline run.
- The gate JSON contract becomes the stable seam — versionable, testable, documentable. Anything host-specific lives in the adapter.

**Negative:**

- The contract layer (`core/adapters/host-adapter.md`) is real machinery to maintain — every host change is constrained by it.
- Some host-specific elegance is given up. Claude Code's hooks and subagents can do things Codex can't; the adapter layer has to degrade gracefully when the routed host lacks a capability.
- Migration cost: 7 distinct migration steps from the existing forks (scaffold → core → roles/rules → orchestrator → claude-code adapter → codex adapter → polish). Did this in 22 commits over the conversation it took to land.

**What now needs to be true:**

- Every host adapter conforms to the contract in `core/adapters/host-adapter.md` (asserted by `tests/adapter-contract.test.js`).
- All shared content is host-neutral (paths like `.devteam/rules/` not `.claude/rules/`; identity uses `AGENTS.md` not `CLAUDE.md`).
- The gate JSON identity uses `orchestrator`/`host`/`workstream` — the legacy `agent` field is gone (contract F, asserted across schemas + validator + tests).

## Alternatives considered

1. **Keep two forks, automate parity.** Tried in both repos with `scripts/parity-check.js`. Doesn't solve drift; only flags it. Maintenance still N×2.
2. **Single fork; add a `--mode codex` flag.** Conflates two concerns (which host to install + which host to invoke) into one global mode. Doesn't enable multi-host routing per workstream.
3. **Single fork; abstract via subclass/interface inheritance.** Tried in initial sketches. Heavyweight for what's mostly a small per-host invocation difference. The adapter-as-module pattern (function exports, capabilities JSON) is lighter and matches Node conventions.
4. **Single fork with both `.claude/` and `.codex/` install payloads always laid down.** Wasteful, confusing for users who only use one host, and the routing question doesn't go away — config.yml still has to express "this role uses this host."

The unification + adapter pattern is the only design that solves drift AND enables multi-host routing AND keeps the adapter surface small.
