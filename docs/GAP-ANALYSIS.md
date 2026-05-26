# Gap analysis vs claude-dev-team and codex-dev-team

What the predecessor forks have that ai-dev-team doesn't — yet. Useful for prioritizing documentation, tooling, and CI work after the core migration is complete.

## Documentation gaps

The claude-dev-team repo carries ~10 docs in `docs/` plus four root-level files (CHANGELOG, CONTRIBUTING, EXAMPLE, AGENTS.md) that ai-dev-team is missing.

| Doc | claude-dev-team | codex-dev-team | ai-dev-team | Worth porting? |
|---|---|---|---|---|
| `README.md` | 566 lines (heavy) | ~150 lines (light) | ✅ just written (concise) | done |
| `LICENSE` | MIT | MIT | ✅ MIT | done |
| `ARCHITECTURE.md` | — | — | ✅ ours | unique to us |
| `CHANGELOG.md` | 14.5 KB, detailed | 10.7 KB | ❌ | **yes** — once we tag the first release |
| `CONTRIBUTING.md` | 6.7 KB | 6.2 KB | ❌ | **yes** — adapter/role/stage extension guide |
| `EXAMPLE.md` | 14.5 KB end-to-end walkthrough | 18 KB | ❌ | **yes** — best onboarding tool by a wide margin |
| `AGENTS.md` (host-neutral context for the repo itself) | 11.3 KB | 4.1 KB | ❌ | **yes** — defines what an LLM working on _this_ repo should know |
| `docs/user-guide.md` | 1076 lines — comprehensive | — | ❌ | partially; we can be much terser |
| `docs/adoption-guide.md` | 372 lines — "how to roll this out in your org" | — | ❌ | **yes** — different from user guide; targets a decision-maker |
| `docs/concepts.md` | 47 lines — one-sentence definitions | — | ❌ | **yes** — quick reference |
| `docs/faq.md` | 222 lines | — | ❌ | grow organically as questions come |
| `docs/presentation-notes.md` | 406 lines — talk script | — | ❌ | **yes** if you'll demo this; defer otherwise |
| `docs/tracks.md` | 114 lines — what each track means | — | ❌ | **yes** — operational reference users need |
| `docs/brief-template.md`, `design-spec-template.md`, `runbook-template.md` | template *explanations* (not the templates themselves) | — | ❌ | **yes** — docs about how to fill out each artifact |
| `docs/walkthroughs/stage-04-split-host.md` | — | — | ✅ ours | unique to us |
| `docs/BACKLOG.md` | — | — | ✅ ours | unique to us |
| `docs/GAP-ANALYSIS.md` | — | — | ✅ this file | unique to us |
| `docs/TESTING.md` | — | — | ✅ companion (see below) | unique to us |
| `docs/adr/` | per-decision ADRs | — | ❌ | grow organically; first one could explain "why ai-dev-team" |
| `docs/audit/` | audit artifacts | — | ❌ | unique to claude's workflow; skip |
| `docs/migration/v1-to-v2.md` | historical | — | ❌ | irrelevant (we don't have v1) |
| `docs/parity/` | claude-codex parity tracking | — | ❌ | obsolete (we eliminated the fork) |
| `docs/releases/` | release notes | — | ❌ | adopt when we cut a release |

**Suggested next docs (priority order):**

1. **`EXAMPLE.md`** at the root — end-to-end walkthrough of one pipeline run. Highest learning ROI per word.
2. **`AGENTS.md`** at the root — host-neutral context file for the repo itself (so an LLM working _on_ ai-dev-team knows the structure).
3. **`CONTRIBUTING.md`** — how to add a host adapter, a stage, a role, or a skill. Concrete recipes.
4. **`docs/concepts.md`** — one-sentence definitions of stage / role / workstream / gate / track / adapter / host. The thing you skim before reading anything else.
5. **`docs/user-guide.md`** — long-form how-to. Lift selectively from claude-dev-team's version, adapt for the multi-host model.
6. **`docs/tracks.md`** — what each track skips and why. Operational reference.
7. **`CHANGELOG.md`** — start tracking from `0.1.0`.
8. **`docs/adoption-guide.md`** — for team leads deciding whether to use this. Defer until there's a v1 release to point at.

## Functionality gaps (beyond docs)

Things the forks have implemented that ai-dev-team's MVP doesn't:

| Capability | claude-dev-team | codex-dev-team | ai-dev-team | Notes |
|---|---|---|---|---|
| Bootstrap script (idempotent project initializer) | `bootstrap.sh` + `scripts/bootstrap.js` | same | `devteam init` covers this | DONE (different surface) |
| Audit workflow (codebase-wide health scan) | `/audit`, `/audit-quick`, `/health-check`, `/roadmap` slash commands | `.codex/skills/audit/` | ❌ | Backlog G/B item |
| Roadmap workflow | `/roadmap` + `docs/audit/10-roadmap.md` | — | ❌ | Backlog |
| Visualize | `scripts/visualize.js` — DOT/Mermaid of stage graph | same | ❌ | Backlog (low-effort) |
| `pr-pack` (bundle PR summaries) | `scripts/pr-pack.js` | same | ❌ | Backlog |
| `release` workflow | `scripts/release.js check / notes` | same | ❌ | Backlog (needed for cutting a release) |
| `parity-check` | yes — checks claude/codex divergence | yes | ❌ | obsolete by design (no fork) |
| `consistency` (cross-artifact lint) | `scripts/consistency.js` | same | ❌ | **worth porting** — catches drift between stages.js + schemas + docs |
| `lessons.js` (lessons-learned ops) | yes | yes | ❌ | Backlog (depends on D7 persistent memory) |
| `budget` tracking at runtime | yes — `npm run budget` | yes | ❌ | `core/guards/budget.js` lifted; not yet wired into CLI |
| Checkpoint auto-pass (A/B/C) | yes — async-friendly checkpoints | yes | ❌ | Backlog |
| `claude-team checkpoint <stage>` / status / next / summary CLI subcommands | yes — many | yes | `next`, `merge`, `validate`, `stage`, `hosts`, `init` | partial coverage — `status`, `summary` worth adding |
| `summary` command | yes — markdown summary of a pipeline run | yes | ❌ | Backlog (high value, low effort) |
| Worktree-based parallel build | yes — `git worktree` per dev | yes | ❌ | Backlog (`isolation: isolated` mode in config) |
| Stoplist enforcement at runtime | yes — `scripts/stoplist.js` invoked by CLI | yes | guard exists, not wired | Wire into `devteam stage <name>` |

**Recommended fill-in priority:**

1. `devteam summary` — print a one-screen status report of a pipeline run. Lifted from `scripts/status.js` + `summary.js` in the forks. Small lift, high feedback value.
2. `devteam doctor` — pre-flight check (verifies install, hosts on PATH, target project layout). Already in the BACKLOG.
3. Wire stoplist into `devteam stage` — refuse to run lighter tracks when the change description matches a safety keyword.
4. `devteam visualize` — render stage graph + current state.
5. `consistency.js` port — catch drift between `stages.js` / schemas / role briefs / rules.

## Test gaps

This is the biggest gap.

| | claude-dev-team | codex-dev-team | ai-dev-team |
|---|---|---|---|
| Test count | 26 | 20 | **0** |
| Test runner | `node --test` (built-in) | same | (none) |
| CI integration | implied | implied | (none) |

Every contract we've stress-tested in the conversation is verified by manual smoke tests, not locked in. A test suite is the single biggest robustness gap. See `docs/TESTING.md` for the proposed strategy.

## Misc artifacts the forks have

- **`AGENTS.md` at root** — the agents/CLAUDE.md context file for the repo itself. We've standardized on `AGENTS.md` as host-neutral but don't have one for `ai-dev-team`'s own repo. An LLM working on this codebase right now has no "Read first" context.
- **`VERSION` file at root** — a one-line version stamp. claude-dev-team's bootstrap reads this to stamp `.claude/VERSION` into target projects. We use `package.json#version` instead; should pick one.
- **`.github/`** — neither fork has CI YAML committed, but the convention is there.
- **`examples/` directory** — claude-dev-team has one example project. Useful for `devteam init` to point at as a known-good fixture.
- **`schemas/_framework-contract.js`** — claude-dev-team has a JS module that asserts cross-doc consistency (matched stage numbers, matched rule files, matched skill names). Underpins their `contract.test.js`. Worth porting.

## What ai-dev-team has that the forks don't

For symmetry — things we did that they didn't:

- A single core with per-host adapters (the whole reason this repo exists).
- `core/adapters/host-adapter.md` — the formal contract.
- `core/adapters/headless.js` — shared headless-invoke helper.
- `docs/walkthroughs/stage-04-split-host.md` — a contract stress-test trace.
- `docs/BACKLOG.md` — explicit roadmap with impact/effort scores.
- Contract F applied across schemas, role briefs, and the validator: `agent` field removed; `orchestrator` + `host` + `workstream` identity.
- Generic adapter as a third host — proves the contract is genuinely portable.
- `conditionalOn` mechanism for conditional stages (currently used by security-review; reusable).
- Per-role `roleWrites` override in multi-role stages.
- `stage.subagent` override letting all workstreams of a stage dispatch to a single named subagent (used by peer-review).

## Summary: what to do next

Tight three-tier picture:

**Tier 1 — ship-blocker for "1.0"**:
- AGENTS.md, EXAMPLE.md, CONTRIBUTING.md, docs/concepts.md
- A minimum test suite (see docs/TESTING.md tier 1)
- `devteam doctor` and `devteam summary`
- Wire stoplist into `devteam stage`

**Tier 2 — for a public release**:
- docs/user-guide.md, docs/tracks.md
- CHANGELOG.md, examples/ directory
- consistency.js port
- CI workflow (GitHub Actions) running the test suite

**Tier 3 — nice to have**:
- docs/adoption-guide.md, docs/presentation-notes.md, docs/faq.md
- visualize, pr-pack, release tooling
- ADR directory for design decisions going forward
