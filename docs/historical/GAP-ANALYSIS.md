# Gap analysis — historical

This doc was written during migration planning to track what the predecessor forks (`claude-dev-team`, `codex-dev-team`) had that the freshly-spun Stagecraft repo didn't. **The migration is complete.** Most of the gaps listed here are closed.

For active gap tracking, see [`docs/BACKLOG.md`](BACKLOG.md). This file is retained for historical context and as a feature inventory of what Stagecraft has that the forks didn't.

---

## Status of original gaps (as of v0.2.0)

### Documentation — all closed

| Doc | Status |
|---|---|
| `README.md`, `LICENSE`, `ARCHITECTURE.md` | ✅ shipped |
| `CHANGELOG.md` | ✅ shipped — currently `[Unreleased]` + `[0.2.0]` + `[0.1.0]` sections |
| `CONTRIBUTING.md`, `EXAMPLE.md`, `AGENTS.md` | ✅ shipped at root |
| `docs/concepts.md`, `docs/tracks.md`, `docs/user-guide.md`, `docs/adoption-guide.md`, `docs/faq.md` | ✅ shipped |
| `docs/walkthroughs/` | ✅ shipped (stage-04 split-host walkthrough) |
| `docs/observability.md`, `docs/memory.md` | ✅ shipped (new — didn't exist in forks) |
| `docs/adr/` | ✅ shipped (`001-unification-vs-fork`, `002-host-adapter-contract`) |
| `docs/presentation-notes.md`, `docs/audit/`, `docs/migration/`, `docs/parity/`, `docs/releases/` | Not ported — fork-specific or obsolete |

### Functionality — almost all closed

| Capability | Status |
|---|---|
| Bootstrap script | ✅ `devteam init` |
| Audit workflow / roadmap workflow | Not ported — backlog G/B item |
| `scripts/visualize.js` | ✅ shipped |
| `scripts/pr-pack.js` | ✅ shipped |
| `scripts/release.js` (check / notes) | ✅ shipped, tested |
| `scripts/consistency.js` (cross-artifact lint) | ✅ shipped, 170 checks |
| `scripts/lessons.js` | Not ported — depends on D7 memory follow-on |
| `scripts/budget.js` | ✅ shipped at scripts/, exposed via `npm run budget` (out-of-band tool) |
| Checkpoint auto-pass | Not ported |
| `next`, `summary`, `stages`, `hosts`, `init`, `validate`, `merge`, `doctor`, `ui`, `memory`, `help` | ✅ all shipped |
| Worktree-based parallel build | ✅ available via `isolation: isolated` in config (host-dependent) |
| Stoplist enforcement | ✅ wired into `devteam stage` |
| `parity-check` | Obsolete by design |

### Tests — closed

| Metric | claude-dev-team | codex-dev-team | Stagecraft (v0.2.0) |
|---|---|---|---|
| Test count | 26 | 20 | **362** |
| Test runner | `node --test` | same | same |
| CI integration | none committed | none committed | ✅ `.github/workflows/test.yml` against Node 20/22/24 |

See [`docs/TESTING.md`](TESTING.md) for the current suite breakdown.

### Misc closed

- `AGENTS.md` at root ✅
- `examples/` directory ✅ (17 example artifacts)
- `schemas/_framework-contract.js` equivalent — covered by `tests/contract.test.js` + `scripts/consistency.js` ✅
- `.github/` ✅ (test workflow)
- `VERSION` file — not adopted; we use `package.json#version` as the single source of truth (read by the ORCHESTRATOR_ID at runtime: `devteam@<version>`)

---

## What Stagecraft has that the forks didn't

This section is the load-bearing part of this doc — it's the **feature inventory** that makes the rewrite worth it. Use it when explaining why Stagecraft is more than just a rename of the forks.

### Architecture

- **Single model-agnostic core** with per-host adapters. No more dual-fork drift. The orchestrator never invokes a model; the adapter is the only place that knows about host invocation primitives.
- **Formal host-adapter contract** (`core/adapters/host-adapter.md`) — interface declared, capabilities negotiated, gate JSON used as the stable contract between hosts. Adapters can be added without forking core.
- **Generic adapter** (`hosts/generic/`) — a third reference host with no in-host integration. Proves the contract is genuinely host-neutral rather than Claude/Codex-shaped.
- **Per-(stage, role) routing** (`routing.stages > routing.roles > routing.default_host`) — a single pipeline run can dispatch different roles in the same stage to different hosts.
- **Shared headless-invoke helper** (`core/adapters/headless.js`) — every adapter with `capabilities.headless: true` wires `invoke()` to the same code path.

### Contracts (in code, tested)

- **Contract A** — per-role `allowedWrites` overrides in multi-role stages.
- **Contract B** — per-workstream gate decomposition for multi-role stages; pessimistic merge (`ESCALATE > FAIL > WARN > PASS`).
- **Contract C** — `capabilities.enforces` map declaring where host enforces a core rule (`tool-call-time` vs `post-hoc-audit` vs `prompt-only`). Orchestrator skips audits the host already enforces.
- **Contract F** — gate identity (`stage`, `workstream`, `orchestrator`, `host`, `status`); legacy `agent` field removed; `orchestrator: "devteam@<version>"` carried on every gate.
- **`conditionalOn`** — generic mechanism for conditional stages (`{ stage, field, equals }`); currently used by stage-04b security review; reusable.
- **`stage.subagent` override** — lets all workstreams of a stage dispatch to a single named subagent (used by peer-review).

### Stages added beyond the forks

- **Stage 4b security review** (conditional, `qa` role)
- **Stage 6b accessibility audit** (`qa` role, WCAG-level scoring)
- **Stage 6c observability gate** (`platform` role, brief §9 verification)

### Tooling new to Stagecraft

- **OpenTelemetry tracing** on every pipeline operation (opt-in via `OTEL_EXPORTER_OTLP_ENDPOINT`).
- **Persistent semantic memory** (`devteam memory ingest|query|stats|clear|reindex`) with local-default embedder.
- **Multi-model adversarial peer review** (`routing.review_fanout: [host, host, ...]`) — opt-in N×M fanout for stage-05.
- **Gate-pass-rate dashboards** (`scripts/dashboard.js`) with multi-project rollup and time windowing.
- **GitHub PR integration** (`scripts/pr-publish.js`) — PR body sync or one check run per gate.
- **Web UI** (`devteam ui`) — SSE-backed pipeline state view, gate detail on click.
- **Secret scanning hook** (`core/hooks/secret-scan.js`) — PreToolUse block on Write/Edit for credentials.
- **Cross-artifact consistency lint** (`scripts/consistency.js`) — 170 structural checks.

---

## Closing note

The gap-analysis-vs-forks framing is no longer the load-bearing question for Stagecraft. The forks aren't being maintained; they served their purpose as the source material for the unification. The active question is "what do we want next" — that lives in [`docs/BACKLOG.md`](BACKLOG.md).
