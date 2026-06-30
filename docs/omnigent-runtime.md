# Omnigent Runtime Adapter

Stagecraft can use [Omnigent](https://github.com/omnigent-ai/omnigent) as a
host runtime without moving Stagecraft's core orchestration into Omnigent.

The boundary is the existing host adapter contract:

- Stagecraft owns stage order, routing, prompt rendering, gate schemas, gate
  validation, retries, bounded-autonomy state, and gate-chain evidence.
- Omnigent owns the runtime that consumes one workstream prompt: harness/model
  selection, session execution, local or managed sandboxing, and optional
  Omnigent policies.
- The filesystem remains the exchange surface. The agent writes the normal
  Stagecraft artifact and gate JSON files, and Stagecraft validates them after
  the run.

## Shipped Slice

The `omnigent` host adapter installs:

- role prompts under `.omnigent/stagecraft/roles/`
- Stagecraft skills under `.omnigent/stagecraft/skills/`
- shared rules and templates under `.devteam/`
- a default Omnigent agent spec at `.omnigent/stagecraft/agent.yaml`

The headless command is:

```bash
omnigent run .omnigent/stagecraft/agent.yaml --no-session
```

Unlike the existing CLI hosts, Omnigent's one-shot path accepts the prompt as
`-p/--prompt`, so the adapter implements a custom `invoke()` instead of using
the shared stdin-based `runHeadless()` helper.

The installed default agent spec uses Omnigent's Codex harness because that
harness carries its own coding tools. Operators can override the command with
`DEVTEAM_HEADLESS_COMMAND` for experiments, for example:

```bash
DEVTEAM_HEADLESS_COMMAND='omnigent run .omnigent/stagecraft/agent.yaml --no-session --harness claude-sdk' \
  devteam stage build --headless
```

## Capability Posture

The first adapter slice is intentionally conservative:

| Capability | Current posture |
|---|---|
| `headless` | yes, through `omnigent run ... -p` |
| `hooks` | no; Stagecraft polls/validates gate files after the process exits |
| `subagents` | no; Stagecraft still dispatches one workstream per role |
| `slashCommands` | no; users invoke `devteam` directly |
| `worktrees` | no adapter-specific mapping yet |
| `allowed_writes` | `post-hoc-audit` via Stagecraft write audit |
| `stoplist` | `prompt-only` |
| `tool_budget` | `prompt-only` |

This keeps the first release honest: Omnigent is an execution host, not yet a
replacement for Stagecraft dispatch fan-out or policy enforcement.

## Configuration Sketch

Single-host routing:

```yaml
routing:
  default_host: omnigent
```

Mixed routing:

```yaml
routing:
  default_host: claude-code
  roles:
    backend: omnigent
    verifier: omnigent
```

Future work should add a first-class `hosts.omnigent` config block for harness,
model, server URL, sandbox profile, and policy selection instead of relying on
the command string.

## Follow-Up Phases

Parent tracking issue: [#291](https://github.com/telus-labs/stagecraft/issues/291).

1. **Configurable Omnigent launch profile** ([#292](https://github.com/telus-labs/stagecraft/issues/292)). Add `hosts.omnigent.*` config
   fields for harness, model, server, no-session/session mode, and agent spec
   path. Preserve `DEVTEAM_HEADLESS_COMMAND` as the emergency override.
2. **Prompt transport hardening** ([#293](https://github.com/telus-labs/stagecraft/issues/293)). Prefer an upstream Omnigent
   `--prompt-file` or stdin option so long Stagecraft prompts never hit command
   argument limits.
3. **Policy bridge** ([#294](https://github.com/telus-labs/stagecraft/issues/294)). Map Stagecraft `allowedWrites`, shell/network
   requirements, and tool budgets into Omnigent policies where supported.
   Stagecraft's post-hoc audit remains the backstop.
4. **Session evidence** ([#295](https://github.com/telus-labs/stagecraft/issues/295)). Capture Omnigent conversation/session IDs and relevant
   policy verdict summaries in logs or adapter-private metadata without adding
   host-specific fields to gate schemas.
5. **Optional stage consolidation** ([#296](https://github.com/telus-labs/stagecraft/issues/296)). Explore a separate mode where one
   Omnigent director session handles multiple Stagecraft workstreams and writes
   every expected workstream gate. This must preserve the workstream gate
   contract before it can replace Stagecraft fan-out.

## Non-Goals

- Do not move Stagecraft's gate validator or `next()` decision logic into
  Omnigent.
- Do not add Omnigent-specific fields to the host-neutral gate schema.
- Do not claim tool-call-time enforcement until Omnigent policy integration is
  wired and tested through the adapter.
- Do not make Omnigent the only route to multi-model execution; Stagecraft's
  existing per-role host routing remains supported.
