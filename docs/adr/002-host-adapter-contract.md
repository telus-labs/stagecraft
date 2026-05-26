# ADR 002 — Host adapter contract

**Status:** Accepted
**Date:** 2026-05-25
**Authors:** Mumit Khan

## Context

[ADR-001](001-unification-vs-fork.md) committed us to a model-agnostic core plus per-host adapters. The contract between core and adapter is the load-bearing interface — get it wrong and either every host needs custom orchestrator code, or every adapter has to reimplement core logic.

Constraints the contract must satisfy:

1. **Heterogeneous hosts.** Claude Code has hooks, subagents, slash commands, worktrees, headless mode. Codex has none of those the same way — just role prompts and headless invoke. The contract can't assume capabilities that all hosts have.
2. **Optional surface.** Some hosts will have no install payload (a "generic" no-host mode that just prints prompts to the terminal). The contract must support zero-install adapters as a valid implementation.
3. **The orchestrator must not call models.** That's a core-level invariant — the orchestrator emits prompts and validates JSON, period. Adapters are the only place that knows how to drive a host CLI.
4. **Per-workstream routing.** A single pipeline run may dispatch different workstreams to different adapters. The contract has to support being invoked from a router, not assume it's the only adapter.

## Decision

A host adapter is a directory under `hosts/<name>/` with:

- `capabilities.json` — declarative metadata about what the host supports.
- `adapter.js` — a Node module exporting the contract methods.
- `install/` (optional) — install-payload files the adapter copies into target projects.

The required surface is small. Required methods on the adapter module:

```js
{
  capabilities,                          // loaded from capabilities.json
  install(targetDir, opts),              // lay down host-specific files
  renderStagePrompt(descriptor, ctx),    // produce the text the host's session consumes
  status(targetDir),                     // verify the install
  uninstall(targetDir),                  // undo install
  invoke?(descriptor, ctx),              // optional; only if capabilities.headless = true
}
```

`capabilities.json` declares what the host supports (booleans: `hooks`, `subagents`, `slashCommands`, `worktrees`, `headless`; plus `enforces` map for `allowed_writes` and `stoplist` — values: `tool-call-time` / `post-hoc-audit` / `prompt-only`). The orchestrator branches on these — e.g., skips post-hoc audits when the host already enforces a rule at tool-call time.

## Consequences

**Positive:**

- Adding a host is a focused task — implement five methods + declare capabilities. Three adapters exist today (claude-code, codex, generic); a fourth would be the same shape.
- Capabilities declaration lets the orchestrator degrade gracefully. The `enforces` map specifically lets us skip redundant work when the host already enforces a rule.
- The contract is testable: `tests/adapter-contract.test.js` asserts every adapter exports the required surface (20 tests, 5 checks × 3 hosts + headless invoke check).
- Generic adapter as a third host (zero install, prints prompts) is a forcing function — if the contract works for generic, it's genuinely host-neutral.

**Negative:**

- Adapters duplicate some setup boilerplate (each rolls its own `installRoles`, `installRules`, `installSkills`). Could be factored into a base class. Deferred — the duplication is mechanical and the variations between hosts are real enough that a base class would have many escape hatches.
- The `install/` payload directory mixes file types (slash commands, agent files, hook scripts). A more structured contract would name each (e.g., `install/commands/`, `install/hooks/`) — done by convention but not enforced.

**What now needs to be true:**

- The contract is documented in `core/adapters/host-adapter.md`. Updates there must be reflected in `tests/adapter-contract.test.js` in the same commit.
- Adapter `install()` must be idempotent: re-running with the same opts writes nothing new (asserted by `tests/install-roundtrip.test.js`).
- Adapter `status()` must accurately report install health (it's what `devteam doctor` consults).

## Alternatives considered

1. **A plugin class with inheritance.** Considered but feels heavy. Adapter behavior is more "a few short pure functions" than "a stateful object with overrideable methods." Module export pattern matches Node conventions and is easier to reason about.

2. **A capabilities array of strings (`["hooks", "subagents", "headless"]`) instead of a flag map.** Simpler at first but loses the per-rule `enforces` semantics — we need to express *where* a host enforces a rule (tool-call-time vs post-hoc vs prompt-only), not just whether it does at all.

3. **Adapters that directly subscribe to orchestrator events.** Reactive style, would have been cleaner for hooks-style automation. But makes the contract harder to test and forces every adapter to think about event ordering. Pull model (orchestrator calls adapter methods at fixed points) was simpler.

4. **No optional methods — make `invoke()` mandatory and have headless: false adapters throw.** Considered. Decided that "you can't drive me headlessly" is a legitimate adapter state, and forcing them to define a throwing method is just ceremony. Optional method + capabilities check is cleaner.

5. **Per-host config files instead of one `.devteam/config.yml` with routing.** Considered briefly but ruined the multi-host story: you'd have `.claude/config.yml` AND `.codex/config.yml`, each fighting for ownership of the routing decision. Single config in a host-neutral path keeps the orchestrator as the authority on routing.
