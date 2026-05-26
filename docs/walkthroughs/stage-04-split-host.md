# Walkthrough: Stage-04 split host

Stress-test of the per-stage routing contract by running one feature through the full pipeline with multiple hosts.

## Setup

**Feature:** "Add SMS notification opt-in to user settings."

**Track:** `full`

**Routing (`.devteam/config.yml`):**

```yaml
routing:
  default_host: claude-code
  roles:
    pm: claude-code
    principal: claude-code
    backend: codex            # ← the interesting split
    frontend: claude-code
    platform: claude-code
    qa: claude-code
    security: claude-code
    reviewer: claude-code
```

**Host capabilities (abbreviated):**

| Host          | hooks | subagents | worktrees | headless     |
|---------------|-------|-----------|-----------|--------------|
| `claude-code` | true  | true      | true      | `claude --print` |
| `codex`       | false | false     | partial   | `codex exec` |

**Isolation mode:** `isolated` (Stage 0 creates a worktree on the project).

## Trace

### Stage 01 — Requirements (PM, `claude-code`)

`devteam stage requirements "Add SMS notification opt-in"` →

1. Router resolves: `routing.roles.pm = claude-code`. ✅
2. `renderStagePrompt` from the claude-code adapter emits a prompt that says "Use the `pm` skill from `.claude/skills/pm/SKILL.md`. Read CLAUDE.md, .claude/rules/pipeline.md, .claude/rules/gates.md, pipeline/context.md. Write pipeline/brief.md and pipeline/gates/stage-01.json."
3. User runs `/devteam:stage requirements` inside Claude Code. PM writes `brief.md`, then `stage-01.json`.
4. Claude Code hook fires on `Stop` event → calls `devteam status --advance` → orchestrator validates gate → marks complete.

**Verdict:** clean.

### Stage 02 — Design (Principal, `claude-code`)

Same path as Stage 01. Principal writes `design-spec.md` + ADRs. Hook auto-advances.

**Verdict:** clean.

### Stage 03 — Clarification (PM, `claude-code`)

Same. PM writes `clarification-log.md`. Hook auto-advances.

**Verdict:** clean.

### Stage 04 — Build — ⚠️ THE CRACK

Stage 04 has *four roles in parallel*: Backend, Frontend, Platform, QA. The current `STAGES` table treats stage-04 as one stage with one gate (`stage-04.schema.json`) whose `workstreams: []` list reports per-role status.

But routing is keyed by role, and the four roles route to two different hosts. Concretely:

- Backend → `codex` (no subagents, no hooks)
- Frontend → `claude-code` (subagents available)
- Platform → `claude-code`
- QA → `claude-code`

The orchestrator can't dispatch "stage-04" as a single unit anymore. It has to:

1. **Decompose stage-04 into per-role workstream invocations.** Today the stage is monolithic; the orchestrator needs to know which roles a stage has and dispatch each to its routed host.
2. **Collect a per-workstream gate, then aggregate into the stage-04 gate.** Each adapter writes (or contributes to) its workstream's entry in `stage-04.json`. The orchestrator owns the merge — adapters don't see each other's output.
3. **Reconcile capability asymmetry:** Claude Code can run Frontend+Platform+QA as subagents in one session (one user invocation, three workstreams complete). Codex has to run Backend in its own session. So the user runs `/devteam:stage build` in Claude Code once *and* `devteam stage build --role backend` for codex separately. That's two distinct invocations from the user's seat for one logical stage.
4. **Decide when stage-04 is complete:** when all routed-role gate entries are PASS. Hooks help when the host has them (claude-code triggers a check on Stop); for codex the orchestrator must poll the gate file.

**Verdict: contract needs a change here.** See "Required contract changes" §1 below.

### Stage 04.5a — Pre-review (Platform, `claude-code`)

Platform reads `pr-*.md` and `build-plan.md` written in Stage 04 — including the ones Codex produced. This works *only if Codex wrote them in the conventional location*. Risk: Codex's adapter may not enforce the same `allowedWrites` constraint as the claude-code adapter (which has hooks for it).

**Verdict:** works, but exposes the enforcement asymmetry. See §3.

### Stage 04.5b — Security review (Security, `claude-code`)

Security heuristic scans `src/backend/auth*` etc. against the trigger paths in `.devteam/config.yml`. This is a pure file-system scan — host-agnostic. ✅

### Stage 05 — Peer review (`claude-code`)

Backend reviewer reviews Backend's PR. Backend was written by Codex; review happens in Claude Code. The gate file from Codex's Stage 04 workstream is read here. Cross-host artifact handoff works because the gate JSON is the seam.

**Verdict:** clean — this is the seam paying off.

### Stage 06 — Tests (QA, `claude-code`)

QA reads the test-report template, runs the actual test suite (a shell command — host-agnostic), writes `test-report.md` and `stage-06.json`. ✅

### Stage 07 — Sign-off

Aggregate check across prior gates. Pure orchestrator logic; no host involved. ✅

### Stage 08 — Deploy (Platform, `claude-code`)

Deploy adapter (docker-compose / kubernetes / terraform) runs as a Node script. The role is Platform, which is on Claude Code — but the deploy script itself doesn't care which host invoked it; it shells out to `docker compose` / `kubectl` / `terraform`. ✅

### Stage 09 — Retro

`claude-code` writes `lessons-learned.md`. Same shape as Stage 01. ✅

## Contract creaks (summary)

Numbered in order of severity.

### 1. Stage-04 is multi-role; routing is keyed per role; the orchestrator can't dispatch stage-04 as a unit anymore.

**Today:** stage-04 has one gate with workstream entries; today's claude-team.js iterates roles within a single host session.

**With routing:** the orchestrator must decompose stage-04 into per-workstream dispatches, possibly to different adapters, and merge results. Same problem applies to any future multi-role stage (peer-review may also fan out by area).

### 2. Auto-advance is per-stage, not global.

Stage-02 finished on claude-code with hooks → auto-advance. Stage-04 backend finished on codex with no hooks → must poll. The orchestrator's "what's next" logic already exists; it just needs to know per-stage whether the advance trigger is event-driven (hooks) or polled.

### 3. Allowed-writes enforcement asymmetry.

Claude Code can enforce allowed-writes via hooks (block writes outside the allowed list at tool-call time). Codex doesn't have an equivalent. With Codex, allowed-writes is *advisory in the prompt* and *audited after the fact in the gate validator* — not enforced at write time. Need to make the enforcement guarantee explicit per adapter: "best-effort prompt instruction + post-hoc audit" vs "blocked at tool-call time".

### 4. `readFirst` paths are host-specific.

`CLAUDE.md` vs `AGENTS.md`. `.claude/rules/*` vs `.codex/rules/*`. The orchestrator builds `readFirst` lists — but the right paths depend on which host is consuming them. Need either (a) standardize on `AGENTS.md`-style neutral docs as the source, with adapters generating host-specific copies, or (b) let `renderStagePrompt` rewrite the paths.

### 5. Worktree isolation can't always survive a host switch.

If stage-02 ran in a Claude Code-managed worktree and stage-04 backend dispatches to Codex, Codex needs to see that same working tree. Claude Code worktrees *are* plain git worktrees, so this works — but only if the orchestrator owns the worktree path, not Claude Code. Same likely true for Codex `app_worktree`. Materialize the worktree at the orchestrator layer; adapters operate on a path the orchestrator gives them.

### 6. Gate JSON `agent` field is host-flavored today.

`"agent": "claude-team"` vs `"agent": "codex-team"`. With per-stage routing, the same pipeline run produces gates from multiple agents. Standardize: `"orchestrator": "devteam"`, `"host": "claude-code"`, drop `agent` (or rename to `role` since that's what it usually means semantically anyway).

### 7. Budget tracking across hosts.

Token counts aren't comparable across model families. Sum-across-hosts gives a number that means little. Track per-host token totals with separate budgets, OR track wall-clock as the host-neutral metric and treat tokens as per-host advisory.

## Required contract changes

To address the creaks above:

### A. Stage descriptor gains a `roles` array, not a single `role` string.

`core/pipeline/stages.js`:

```js
"build": {
  stage: "stage-04",
  roles: ["backend", "frontend", "platform", "qa"],   // was: role: "Backend | Frontend | Platform | QA"
  // ...
}
```

The orchestrator dispatches once per role, routing each via `routing.roles[role]`. Single-role stages (stage-01: `roles: ["pm"]`) are the trivial case.

### B. Gate schemas get per-workstream entries.

Already partially present (`workstreams: []`). Formalize: each role-routed workstream writes a single workstream entry. The stage gate's status is `PASS` only when every entry is PASS. The orchestrator merges; adapters don't see each other.

### C. Adapter contract gains `enforces:` declarations.

```json
{
  "name": "claude-code",
  "enforces": {
    "allowed_writes": "tool-call-time",   // hooks-based
    "stoplist": "tool-call-time"
  }
}
```

```json
{
  "name": "codex",
  "enforces": {
    "allowed_writes": "post-hoc-audit",
    "stoplist": "prompt-only"
  }
}
```

Lets the orchestrator decide whether to skip post-hoc audits (host already enforced) or run them (host can't).

### D. Standardize host-neutral context files.

Adopt `AGENTS.md` (the convention both Codex and Claude Code already understand) as the canonical project context file. The claude-code adapter generates `CLAUDE.md` as a symlink or a thin pointer at install time.

Rule docs (`pipeline.md`, `gates.md`) move under `.devteam/rules/` — host-neutral. Adapters that want host-flavored paths (some Claude Code skills look for `.claude/rules/`) symlink at install.

### E. Worktree ownership moves to the orchestrator.

`devteam stage build` decides the working tree path; adapters get it as part of `PipelineContext.cwd`. No adapter creates worktrees on its own.

### F. Gate JSON `agent` field gets renamed and split.

```json
{
  "stage": "stage-04",
  "workstream": "backend",
  "orchestrator": "devteam@1.0",
  "host": "codex",
  "status": "PASS"
}
```

### G. Budget tracking becomes per-host with optional aggregate.

```yaml
budget:
  enabled: true
  wall_clock_max_minutes: 90       # cross-host, comparable
  per_host:
    claude-code:
      tokens_max: 300000
    codex:
      tokens_max: 200000
```

## What this walkthrough did NOT find

Areas that held up cleanly and need no contract change:

- The gate JSON as a stable seam (Stage 05 reading Stage 04 across hosts) — confirmed valuable.
- Capability negotiation as a JSON declaration — works; we just need to add `enforces`.
- Per-stage routing resolution order (`stages` → `roles` → `default_host`) — clean.
- Deploy adapters being model-agnostic — confirmed; they shell out to real tools.
- Multi-host install as `list of length N` (single-host is N=1) — clean.
- Two invocation modes (`user-driven` vs `cli-driven`) — both fit the lifecycle without changes.

## Recommended next step

Apply contract changes A–G above to `ARCHITECTURE.md` and `core/adapters/host-adapter.md`, then start migration step 1 (land `core/`).
