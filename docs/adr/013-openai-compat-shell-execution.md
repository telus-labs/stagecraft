# ADR 013 — openai-compat shell execution: native bash tool

**Status:** Accepted
**Date:** 2026-06-24
**Authors:** Mumit Khan

## Context

The `hosts/openai-compat/` adapter (introduced alongside this ADR) routes Stagecraft roles to any provider that exposes an OpenAI-compatible Chat Completions endpoint — OpenAI, OpenRouter, Fireworks AI, Fuel iX, hosted open-weight providers, or internal gateways — without requiring a dedicated CLI. Invocation is HTTP-native: `invoke()` drives the model through an agentic tool-call loop rather than spawning a subprocess.

Five pipeline stages declare `requiredCapabilities: { shell: true }`:

| Stage | ID | Role | Shell use |
|-------|-----|------|-----------|
| pre-review | stage-04a | platform | lint, tests, `npm audit`, license check |
| qa | stage-06 | qa | acceptance test suite |
| verification-beyond-tests | stage-06d | verifier | property-based, mutation, formal verification |
| performance-budget | stage-06e | qa | Lighthouse, bundle diff, k6 load test |
| deploy | stage-08 | platform | execute `pipeline/runbook.md` |

With `enforces.shell: false` in the adapter's `capabilities.json`, the orchestrator throws a hard capability error before dispatching any of these stages. This prevents openai-compat from being used as the sole host on any pipeline track that includes pre-review or deploy.

The question is how to give openai-compat shell execution without introducing a CLI dependency or a separate subprocess wrapper.

## Decision

Add a `bash(command)` function tool to `hosts/openai-compat/tools.js` and set `enforces.shell: true` in `capabilities.json`.

The model calls `bash` the same way it calls `write_file` — as a function call in the chat-completions tool-call protocol. For scanner compatibility and command-injection resistance, the command string is parsed into argv and is never passed through a shell. The executor rejects pipes, redirects, background jobs, command substitution, env-prefix assignments, path-qualified executables, and non-allowlisted command names. Execution uses Node.js `child_process.spawn()` with a detached process group, captures stdout and stderr, kills the process group on timeout, and returns a structured result string (exit code + stdout + stderr, truncated to 8 KB each). The 40-iteration tool-call loop in `invoke.js` already provides the re-try / convergence behaviour that claude-code's goal-loop provides externally.

`bash` is included in the tool set when the role's `toolBudget` contains `"Bash"` (from `core/roles.js::ROLE_TOOLS`). Roles without `Bash` in their budget (pm, reviewer) do not receive the tool.

## Consequences

- All 18 pipeline stages can now route to openai-compat; no fallback to claude-code, codex, or gemini-cli is required.
- The security posture is narrower than `claude --dangerously-skip-permissions` because shell syntax and non-allowlisted executables are rejected, but allowlisted commands still run in the project working directory with the same OS permissions as the invoking process. Operators who require stronger sandboxing should wrap the Node.js process in a container.
- Bash failures and tool errors log to stderr in quiet mode; verbose mode logs every tool call and result summary.
- Timeouts: each `bash` call accepts an optional `timeout_ms` argument; the default is 60 s. The outer `ctx.timeoutMs` caps the full dispatch, so run-away loops are bounded at two levels.

## Alternatives considered

**Per-stage host overrides via `routing.stages`** — route shell-dependent stages to claude-code while everything else uses openai-compat. Works today with zero code changes, but requires claude-code to be installed and defeats the "no external CLI" goal.

**Thin `stagecraft-shell` CLI wrapper** — a small Node.js script that accepts a prompt on stdin, calls an OpenAI-compatible API, runs the tool-call loop (including bash), and exits. Stagecraft treats it as a `headlessCommand`. This is architecturally equivalent to running `invoke.js` as a subprocess; it duplicates the logic and adds a binary to install.

**Project-configured allow-list model** — declare a `hosts.openai-compat.allowed_commands` list in `.devteam/config.yml`. The shipped implementation uses a built-in allowlist instead, so the default posture is scanner-friendly without adding per-project setup.

**OpenHands / external agent runtime** — route shell stages to a sandboxed Docker-backed agent (OpenHands). Appropriate for security-critical production environments but introduces a running-service dependency and requires a different API client; the overhead far exceeds what five stages need.
