# ADR 004 — Role tool budgets

**Status:** Accepted
**Date:** 2026-06-11
**Authors:** Mumit Khan

**Amended 2026-06-14:** The host-neutral `ROLE_TOOLS` table in `core/roles.js` is now
the canonical declaration. Claude Code's `ROLE_FRONTMATTER` retains only host-specific
subagent metadata and renders the canonical budget into `tools:` frontmatter. This
amendment supersedes the original declaration-location decision below; enforcement,
degradation, and audit-trail decisions are unchanged.

## Context

Every role in a Stagecraft pipeline today has three control surfaces: a role brief (the
prompt), a model selection, and an `allowedWrites` path allowlist. The host's full tool
surface is otherwise unrestricted per role — a QA agent on claude-code gets the same
Read/Write/Edit/Glob/Grep/Bash set as the backend agent that should own `src/backend/`.

Tool-level least-privilege is the natural next enforcement ring around `allowedWrites`.
The BACKLOG item G10 frames this as "MCP-based role tool budgets":

> Roles gain explicit, negotiated tool surfaces via MCP (Model Context Protocol).
> Adapters' `capabilities.json` declares which MCP servers they expose; role briefs list
> permitted MCP servers by name (`filesystem-readonly`, `database-staging-ro`,
> `kubectl-dryrun`); `assertCapabilities()` extends to MCP server availability at dispatch
> time. … Claude Code's MCP support is mature in 2026, making this a near-term item
> rather than speculative.

Three facts in the existing codebase shape the decision space:

**Fact 1 — The mechanism already exists for claude-code.** `hosts/claude-code/adapter.js`
carries a `tools:` entry in every `ROLE_FRONTMATTER` record (lines 34–119). Claude Code
renders this as a `tools:` line in the subagent YAML frontmatter, which the host enforces
at the tool-call boundary. The mechanism is in production use today; what is absent is a
formal contract, cross-host plumbing, and audit-trail visibility.

**Fact 2 — The C1 capability-enforcement pattern exists.** Under C1
(`docs/BACKLOG.md` item), `hosts/*/capabilities.json` already declares enforcement levels
for analogous concerns: `enforces.allowed_writes` (`"tool-call-time" | "post-hoc-audit"
| "prompt-only"`) and `enforces.stoplist` (`"tool-call-time" | "prompt-only"`).
`assertCapabilities()` in `core/orchestrator.js:61` reads these at dispatch time and
throws when a required capability is absent. The same pattern is the natural extension
point for tool budgets.

**Fact 3 — The gate schema already records what the role could do.** The base gate schema
(`core/gates/schemas/gate.schema.json`) carries a `tools_hash` field (C4 reproducibility
— SHA-256 of the tool names available at dispatch). The hash detects drift across runs;
what is missing is a human-readable record of the *declared* budget for audit legibility.

The roadmap (plans/phase-4-capability-roadmap.md §4.1) identifies four design questions
this ADR must answer and recommends that an MCP mediation server be deferred in favour of
host-native tool pinning first ("ship the seam, not the server").

## Decision

### 1. Declaration: host-neutral role table

Tool budgets are declared in the `ROLE_TOOLS` table in `core/roles.js`. The orchestrator
resolves the budget before host routing and carries it on the dispatch descriptor. Claude
Code renders that list into the subagent's `tools:` YAML field; prompt-only adapters render
the same host-neutral list as advisory instructions. Current entries:

| Role | Declared tool budget |
|---|---|
| pm | Read, Write, Glob |
| principal | Read, Write, Glob, Grep, Bash |
| reviewer | Read, Write, Glob, Grep |
| security | Read, Write, Glob, Grep, Bash |
| backend | Read, Write, Edit, Glob, Grep, Bash |
| frontend | Read, Write, Edit, Glob, Grep, Bash |
| platform | Read, Write, Edit, Glob, Grep, Bash |
| qa | Read, Write, Edit, Glob, Grep, Bash |
| auditor | Read, Glob, Grep, Bash, Write |
| red-team | Read, Glob, Grep, Bash, Write |
| migrations | Read, Glob, Grep, Bash, Write |
| verifier | Read, Glob, Grep, Bash, Write |

The dispatch descriptor's `toolBudget` field is the canonical cross-host representation.
This avoids coupling every adapter's budget behavior to Claude Code internals while
preserving its native enforcement mechanism (see §2).

### 2. Cross-host degradation: follow the C1 enforcement-level pattern

Each `hosts/*/capabilities.json` gains a `"tool_budget"` entry under `"enforces"`:

| Host | `enforces.tool_budget` | Enforcement mechanism |
|---|---|---|
| claude-code | `"native"` | Subagent `tools:` YAML line — enforced at tool-call boundary by the host |
| codex | `"prompt-only"` | Budget injected as a list in the role prompt preamble |
| gemini-cli | `"prompt-only"` | Budget injected as a list in the role prompt preamble |
| generic | `"prompt-only"` | Budget appears in the printed prompt text; no runtime check |

`assertCapabilities` is extended to check `tool_budget` enforcement. **Unlike `shell` /
`network` capabilities — which throw hard on mismatch because a stage cannot run without
them — a `prompt-only` tool budget is a warn, not a block.** Routing a budget-carrying
role to a non-native host is a degraded but valid configuration (cost trade-off, multi-host
comparison runs, host unavailability). The degradation is surfaced in the dispatch plan so
operators can see the enforcement level before committing to a run.

### 3. MCP: vocabulary, not mediation server

The BACKLOG frames G10 as "MCP-based" because Claude Code's 2026 MCP support makes the
tool-naming model familiar and forward-compatible. This ADR adopts MCP-style **named-tool
vocabulary** but does not build an MCP mediation server as the enforcement layer.

The reasoning: claude-code subagent tool pinning already enforces natively and requires
zero new machinery. An MCP server that mediates tool access would add:

- A running sidecar process per dispatch
- A Stagecraft-to-sidecar protocol between the orchestrator and the sidecar
- Per-host adapter wiring to route tool calls through the sidecar

None of that is warranted today: claude-code enforces at the host boundary natively, and
codex/gemini-cli/generic have no native enforcement point an MCP server could improve.
Adding a sidecar would create new failure modes (crash, timeout, port conflicts) while
providing no meaningful additional enforcement on the hosts that actually need it.

**Position adopted: ship the seam, not the server.** The canonical `toolBudget` on the
dispatch descriptor and the `dispatched_tool_budget` on the workstream gate are the seam.
Any future host with native MCP enforcement can plug into that seam without requiring an
ADR revision.

**MCP mediation revisit criterion:** if a second host appears with host-native MCP tool
enforcement (e.g., an IDE adapter with a tool-permission API) and both hosts need a shared
enforcement contract (not just shared vocabulary), open an ADR-00X to design the sidecar
at that time.

### 4. Audit trail: dispatched_tool_budget on workstream gates

The base gate schema gains one new optional field on workstream gates:

```jsonc
"dispatched_tool_budget": {
  "type": ["array", "null"],
  "items": { "type": "string" },
  "description": "Tool names declared available to this role at dispatch time, drawn
    from core/roles.js. null means no budget was
    declared (full host surface applies). Present on workstream gates; absent on
    merged stage gates."
}
```

The orchestrator stamps this field when building the workstream gate, reading from
`descriptor.toolBudget`. The existing `tools_hash` (C4 reproducibility) remains; the two
fields are complementary — `tools_hash` detects cross-run drift via hashing; the budget
list names what was declared for audit legibility.

Under C6 (tamper-evident gate chain), `dispatched_tool_budget` on a workstream gate
inherits chain coverage. Retroactive budget falsification on a landed gate breaks the
chain and is detectable by `devteam verify-chain`.

## Consequences

**Positive:**

- Closes the gap between role description and enforced behavior on claude-code. Today the
  reviewer's description says "READ-ONLY during a review invocation" (`adapter.js:51`);
  nothing prevents a Bash call. Under this ADR the `tools:` line enforces that boundary.
- One host-neutral budget table drives every adapter while Claude Code retains its native
  `tools:` enforcement mechanism.
- The dispatch plan and audit trail gain a new column: what the workstream was *permitted*
  to do, not just what it wrote. Combined with C6 and C4, this is a materially more
  complete audit record.
- The gate schema addition is strictly additive (`additionalProperties: true` on the base
  schema); no existing gate files break and no schema migration is needed.

**Negative / costs:**

- **Prompt-only hosts cannot enforce.** This is the honest limitation. For codex and
  gemini-cli, the declared budget is advisory. A model that ignores the prompt instruction
  will not be stopped. Stagecraft's `allowed_writes` post-hoc audit (C1) can detect file
  violations after the fact, but it cannot detect tool-call violations beyond what the
  model self-reports in its output.
- Tool names originate in Claude Code's vocabulary. Translating a list ("Read, Glob") into
  a meaningful instruction for codex or gemini-cli is host-specific and imprecise — those
  hosts do not expose the same named-tool API, so the prompt injection says "these are
  your tools" without any guarantee the model maps the names correctly.
- `assertCapabilities` today throws hard. The soft-warn path for `tool_budget` is a new
  code branch that needs tests and clear semantics (warn to where? — dispatch plan, log,
  gate warning field). The distinction between hard-throw capabilities and soft-warn ones
  should be documented at the call site to avoid accidental hardening in a future edit.

**What now needs to be true:**

- Every role that participates in dispatch has an entry in `core/roles.js`.
- `capabilities.json` for all four hosts declares `enforces.tool_budget`.
- The orchestrator populates `descriptor.toolBudget` from `core/roles.js` before routing.
- The orchestrator stamps `dispatched_tool_budget` on every workstream gate.
- `assertCapabilities` emits a plan-time warning (not a throw) when a budget-carrying
  descriptor is routed to a prompt-only host.
- `tests/adapter-contract.test.js` asserts every adapter's `capabilities.json` carries
  `enforces.tool_budget`.
- Contract tests verify that rendering a budget-carrying role through the claude-code
  adapter produces a `tools:` line in the subagent YAML matching the declared list.

## Alternatives considered

1. **MCP server as the enforcement layer (the literal G10 reading).** A Stagecraft MCP
   sidecar would intercept every tool call and allow/deny per the declared budget,
   providing truly host-neutral enforcement. Rejected for the first implementation: adds
   a running process, a new protocol, and new failure modes, while providing no meaningful
   improvement for codex/gemini-cli/generic (which have no native enforcement hook
   regardless). Deferred until a second enforcing host justifies the shared layer.

2. **Skip role frontmatter; express budgets at the host level in capabilities.json.**
   This would make budgets per-host rather than per-role. Rejected: the requirement is
   that a reviewer gets fewer tools than a backend builder *on the same host*. Per-role
   declaration is the invariant.

3. **Hard-block on prompt-only hosts (analogous to the shell/network capability check).**
   Rejected: operators have legitimate reasons to route a budget-carrying role to gemini-cli
   or codex — cost, parallel comparison runs, host unavailability. A hard block would make
   the feature more disruptive than the problem it solves for those use cases. The
   enforcement level is surfaced in the dispatch plan; operator responsibility covers the
   enforcement gap.

4. **Separate tool budget file (`roles/<role>.tools.yaml`).** Rejected because a file per
   role would create synchronization overhead. A single host-neutral table in
   `core/roles.js` was later adopted by the 2026-06-14 amendment after cross-host rendering
   made Claude-specific authorship untenable.

5. **Named profiles instead of explicit tool lists** (`read-only`, `full`, `shell-free`).
   Simpler operator interface, but less precise. The existing ROLE_FRONTMATTER uses
   explicit lists; named profiles would require a mapping table and a convention that
   diverges from the working pattern. Explicit lists are also more legible in gate files
   and dispatch plans.

6. **Do nothing; rely on allowedWrites to constrain damage.** `allowedWrites` constrains
   *where* a role can write, not *how* it can act. A reviewer with no Bash budget can
   still run arbitrary shell commands under the current system; allowedWrites catches the
   writes but not the execution. Tool budgets close the gap at the action level, not just
   the output level.

## Implementation sketch (post-ADR; no code in this draft)

Files and their roles in the implementation. Sized as two PRs: (a) claude-code native +
capability plumbing; (b) docs and contract tests.

1. `hosts/claude-code/capabilities.json` — add `"tool_budget": "native"` to `enforces`.
2. `hosts/codex/capabilities.json` — add `"tool_budget": "prompt-only"` to `enforces`.
3. `hosts/gemini-cli/capabilities.json` — add `"tool_budget": "prompt-only"` to `enforces`.
4. `hosts/generic/capabilities.json` — add `"tool_budget": "prompt-only"` to `enforces`.
5. `core/gates/schemas/gate.schema.json` — add `dispatched_tool_budget` property (additive).
6. `core/orchestrator.js` — populate `descriptor.toolBudget` from `core/roles.js`; stamp
   `dispatched_tool_budget` on workstream gates; extend
   `assertCapabilities` with warn-not-throw for `tool_budget` and document the distinction.
7. `hosts/claude-code/adapter.js` — expose `toolBudget` on the descriptor in
   `buildDescriptor` / `frontmatterFor` (the `tools:` field is already rendered; this
   makes the split list available to the orchestrator without re-parsing the YAML string).
8. `tests/adapter-contract.test.js` — assert `enforces.tool_budget` present on all adapters;
   assert correct `tools:` line in rendered claude-code subagent YAML for each role.
9. `docs/FEATURES.md` — add "Role tool budgets" row.
10. `docs/concepts.md` — add tool budget column to the role table.

## Original review questions

1. **Warn vs block for prompt-only hosts.** This ADR recommends a warn (not block) when
   a budget-carrying role is routed to codex or gemini-cli. Is that the right default, or
   should the project require an explicit opt-in flag (`--allow-budget-degradation`) before
   routing a budget-carrying role to a prompt-only host? The flag adds friction for
   legitimate cross-host runs but makes the degradation harder to accidentally ignore.

2. **Cross-host budget translation.** For codex and gemini-cli the budget is injected as
   prompt text ("Your available tools are: Read, Glob, Grep"). The tool names are
   Claude Code names, not codex/gemini-cli API names. Should the adapter translate names
   (e.g. "Bash" → the codex shell tool name), emit them verbatim and trust the model to
   map, or omit the budget from the prompt for hosts where the names don't correspond?
   This requires knowledge of each host's tool-naming convention that may not be stable.

3. **Scope of ROLE_FRONTMATTER as the canonical source.** Resolved by the 2026-06-14
   amendment: budgets live in `core/roles.js`; `ROLE_FRONTMATTER` remains Claude-specific
   rendering metadata.
