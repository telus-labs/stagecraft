# Phase 4 — Ground truth check (item 4.0)

**Date:** 2026-06-11  
**Branch:** docs/phase-4-ground-truth  
**Scope:** read-and-report only; no code changes.

---

## Convergence: implemented vs. spec (file:line)

### What the spec says

`docs/autonomous-execution-design.md §2.5` (the "Grounding correction") describes the intent:
a **progress-based** breaker that trips on *lack of change* (blockers 5→3→3, not a count
that kills a converging run). The correction notes that this breaker is not implemented; what
exists is a **count-based ceiling** on `retry_number` (`autonomy.max_retries`, default 2).
`§4.1` preserves that framing: "honor the count-based retry ceiling (§2.5 — progress-based
detection is deferred, pending gate archiving)."

### What is actually implemented today

**Two separate ceilings exist, on diverging paths:**

#### Interactive path — `devteam next` / `orchestrator.js`

`core/orchestrator.js:801–811` reads `gate.retry_number`, a **model-written field** stamped
into the gate JSON by the agent:

```
const retryNumber = typeof gate.retry_number === "number" ? gate.retry_number : 0;
if (retryNumber >= maxRetries) {
  return { action: "resolve-escalation", failure_class: "convergence-exhausted", … };
}
```

Inputs trusted: entirely the model-written `gate.retry_number`. No disk state, no archiving.
Comment at the call site: *"This is a count-based ceiling on retry_number; progress-based
detection is a follow-up (needs gate archiving to compare blocker counts across attempts)."*

`this_attempt_differs_by` (gate schema field, `gate.schema.json:72–83`) is not consulted by
`next()` — the validator only enforces it is non-empty when `retry_number ≥ 1`; it is never
compared against prior content.

#### Driver path — `devteam run` / `driver.js`

`core/driver.js:376–386` uses its own `state.fixRetries[r.name]` counter, persisted to
`run-state.json`, incremented independently of the model-written `gate.retry_number`:

```
const attempts = state.fixRetries[r.name] || 0;
if (attempts >= maxRetries) {
  summary.halt_failure_class = "convergence-exhausted";
  …break;
}
```

The driver comment explicitly notes: *"Bounded by a driver-side retry ceiling, the authoritative
backstop (next()'s convergence-exhausted relies on the agent bumping retry_number, which the
driver does not control)."*

#### The two paths differ — and the divergence matters for 4.2

| | Interactive `next()` | Driver `run()` |
|---|---|---|
| Counter source | `gate.retry_number` (model-written) | `state.fixRetries` (driver-owned, `run-state.json`) |
| Agent-falsifiable? | **Yes** — agent controls the field | No |
| Survives restart/resume? | No — gate is overwritten each retry | Yes — `run-state.json` persists |
| Looks at archive? | No | No |

### Gate archiving (commit `3d0b16f`)

`core/gates/archive.js` (new file) — `archiveGate(gatesDir, stageId, attempt)` copies the
current stage gate to `pipeline/gates/archive/<stage>.attempt-N.json` before the driver clears
it. Called at `driver.js:391` immediately before `clearGates`. `listArchives()` returns
attempts sorted ascending.

**This is the data layer, not the decision layer.** The commit message states explicitly:
*"Convergence stays COUNT-based for now: this layer only archives; no behavior change to
retry/escalate."* The runbook limitation at `docs/runbooks/autonomous-run.md:113–115` confirms:
*"Convergence is count-based. The driver-side ceiling counts re-dispatches; true
progress-based detection (blocker counts decreasing) is not yet implemented."*

### `bf048a9` — what "no-progress fix cycles" actually means

The commit title ("halt on no-progress fix cycles") refers to a specific guard in
`driver.js:398–409`:

```
if (cleared.length === 0 && toClear.length > 0) {
  // recipe named gate files to delete, but none of them existed on disk
  halt with structural-input
}
```

**This is not progress-based convergence.** It answers: *"can the recipe even execute?"* — if
the gate files the recipe wants to remove are already gone (or never existed), re-running will
return the same fix-and-retry forever. The guard trips immediately rather than burning retries
on a guaranteed loop.

The "no progress" is about recipe effectiveness (zero gates cleared), not blocker-set
comparison across attempts. The new `computeFixSteps` code in the same commit (`orchestrator.js:897–926`)
adds detection of missing per-area peer-review workstream gates — also not progress-based;
it is structural diagnosis of a missing input.

### Summary: what remains count-based vs. what is implemented

| Feature | Status |
|---|---|
| Count-based ceiling on `next()` (reads model-written `retry_number`) | ✅ implemented |
| Driver-side count ceiling (agent-independent counter) | ✅ implemented |
| Per-attempt gate archiving (the prerequisite) | ✅ implemented (`3d0b16f`) |
| Guard: halt when recipe can clear no gates (structural) | ✅ implemented (`bf048a9`) |
| Progress-based comparison (blocker-set delta across archived attempts) | ❌ not implemented |
| Interactive path derives attempt count from archive (not `retry_number`) | ❌ not implemented |
| Operator surface: "blocker X identical across attempts 2, 3" in halt output | ❌ not implemented |

**4.2 scope is as large as the roadmap planned.** The archiving prerequisite is satisfied; the
comparison, interactive-path parity, and operator surface remain entirely unbuilt.

---

## Backlog deltas

### Open top-tier items

**G10 is confirmed as the only open top-tier item.** All other top-tier items are ✅ landed:

| # | Status |
|---|---|
| B8 — Cross-artifact consistency analyze | ✅ landed |
| C7 — eslint-plugin-security | ✅ landed |
| C5 — Capability-required permissions | ✅ landed |
| E7 — /goal integration | ✅ landed |
| C3 — License compatibility gate | ✅ landed |
| B9 — Bounded workspace deltas | ✅ landed |
| C6 — Tamper-evident gate chain | ✅ landed (PR-D1 + PR-D2) |
| **G10 — MCP-based role tool budgets** | **OPEN** |
| H1 — Typed failure model | ✅ landed |

### All open items (not ✅)

**A-bucket:**
- A2 — Cursor/Windsurf/Aider/Cline adapters (consciously deprioritized)
- A3 — Cloud-runner adapter
- A4 — Pluggable adapter discovery
- A5 — API-direct adapter
- A6 — Windows native port (decided POSIX-only in Phase 3.5; noted as revisit-if-adoption-grows)

**B-bucket:**
- B3 — Cost gate at deploy
- B6 — Documentation gate (consciously deprioritized)
- B7 — Multi-language QA

**C-bucket:**
- C9 — Verify-before-promoting enforcement in audit skill (`[hist-c]`)

**D-bucket:**
- D5 maturation — continuous adaptive routing (D5 itself ✅ landed; the "mature form" — auto-re-routing the next run — is a distinct follow-up)

**E-bucket:**
- E3 — VS Code extension (consciously deprioritized)
- E4 — Live streaming output
- E9 — Conversational stage mode

**F-bucket:**
- F2 — Jira/Linear ticket integration (consciously deprioritized)
- F3 — Slack/Discord notifications (consciously deprioritized)
- F5 — Pre-commit hook integration (consciously deprioritized)

**G-bucket:**
- G3 — Production feedback loop (effort-1 procedure change; not yet started)
- G5 — Multi-modal stages
- G9 — Self-modifying pipeline (consciously deprioritized)
- **G10 — MCP-based role tool budgets** (OPEN top-tier)

**H-bucket:**
- H3 — Recipe factory (gated on evidence of recurring-failure volume; H1+H2 landed)

### Relevant to 4.1 / 4.3 that landed since plans were written

- **For 4.1 (G10):** No partial implementation found. The seam exists (`assertCapabilities()` in `orchestrator.js`, host `capabilities.json` files, `ROLE_FRONTMATTER` in `adapter.js`) but no `tools:` block in role frontmatter, no MCP server declarations, no tool-budget enforcement. The implementation surface identified in the roadmap (`hosts/claude-code/adapter.js:34-119`, `capabilities.json`, `tests/adapter-contract.test.js`) is intact and unchanged.
- **For 4.3 (G3):** No partial implementation. No `pipeline/production-feedback.md` template, no `production_feedback_reviewed` field in stage-09 gate schema, no `devteam next` mention in pipeline-complete output.
- **Phase 3 items that landed (Phase 3 completion PRs #79–#89):** test coverage for a11y-fixer and preflight (PR #88–#89), and `bf048a9` / `3d0b16f` landed as capability work. CHANGELOG fragments (C8) landed in Phase 2.4. The POSIX-only decision (A6) was formalized in Phase 3.5.

---

## Open questions status

From `docs/autonomous-execution-design.md §7`:

### Q1 — Grant model (standing `--auto-rule` grants)

**Still open.** `--auto-rule` is CLI-only and per-run; the BACKLOG H2 entry confirms *"CLI-only
allowlist; no config persistence."* The driver reads `opts.autoRule` at startup and stores
nothing. No `pipeline/` or `.devteam/config.yml` schema exists for standing grants. ADR-005
is the planned resolution (4.4).

**Partial movement:** C6 tamper-evident authority chaining (PR-D1) and PR-D2 (binding
`resolved_by` onto the chained gate) are the infrastructure that a standing-grant design must
plug into — the audit record shape is established. But the standing-grant mechanism itself is
entirely unbuilt.

### Q2 — Track inference under autonomy

**Still open.** G6 (`devteam assess`) landed and writes `custom_stages` to config when
`--apply` is used — but the autonomy question is distinct: when is `devteam run` allowed to
trust that inferred track *without* a human confirming first? There is no current answer in
code or config; the driver's `resolveTrack()` at `driver.js:166–171` reads whatever is in
config/opts, with no autonomy gate on how it got there.

**Partial movement (Phase 1.1 stoplist):** the stoplist (`core/guards/stoplist.js`) enforces a
safety floor — if the resolved track is lighter than `full` and the description matches a
high-risk pattern, the run halts. This is the floor the ADR must describe as "given." The
ceiling (autonomous trust of `assess` without human confirmation) is the open question for
ADR-006 (4.4).

### Q3 — Heartbeat / liveness signal

**Still open.** `docs/runbooks/autonomous-run.md:122–124` (Phase-2 rewrite) explicitly flags
this as an honest limitation: *"No heartbeat. A hung dispatch (waiting on a model API) is
invisible to the driver until it exits."* No liveness event in `run-log.jsonl`, no
`devteam run --watch` subcommand, no gate-mtime poll. ADR-007 is the planned resolution (4.4).

### Q4 — `pipeline-complete` exit semantics with pending advise blockers

**Still open.** `docs/runbooks/autonomous-run.md:70–73` shows exit code `0` for
`pipeline-complete` with no qualification for pending `advise` items. The driver sets
`summary.completed = true` on `pipeline-complete` and returns cleanly; `bin/devteam` maps
completed=true to exit 0. No `advise` sweep happens post-complete (despite design doc §4.1
step 9 saying "run a final `advise` sweep"). ADR-008 is the planned resolution (4.4).

---

## Corrections to phase-4 plan items

### 4.0 premise correction

The roadmap asks: "Progress-based convergence may be partially landed." **It is not partially
landed.** The two commits post-dating the review are:

- `bf048a9`: a structural guard (recipe cannot clear gate files → halt immediately); the phrase
  "no-progress" means the fix recipe cannot make any filesystem change, not that blockers are
  unchanged across attempts.
- `3d0b16f`: archives each attempt's gate to `pipeline/gates/archive/` — the prerequisite for
  progress-based comparison, not the comparison itself.

The 4.2 scope is unchanged from what the roadmap anticipated.

### 4.2 scope confirmation and refinements

All four items in the roadmap are confirmed unimplemented:

1. **Progress metric definition** — unbuilt. `listArchives()` exists in `core/gates/archive.js`
   to enumerate archived gates by stage; the blocker-set comparison logic does not exist.

2. **Interactive-path parity** — `orchestrator.js:801` reads model-written `gate.retry_number`.
   The archive accumulates as `attempt-N.json` files; counting them (i.e., `listArchives().length`)
   would give an agent-independent attempt count on both paths. Neither path does this today.

3. **Operator surface** — unbuilt. The halt path for `convergence-exhausted` (both driver and
   `next()`) reports only the count and the blockers list from the current gate; it does not
   say what didn't change across attempts.

4. **Docs update** — the design doc §4.1 comment *"pending gate archiving"* is now stale (archiving
   landed). That line and the runbook limitation bullet should be updated as part of 4.2, once
   the comparison is implemented.

### 4.4 ADR prerequisites confirmed open

All four §7 questions remain fully open; no ADR has been started. The roadmap's ADR-005 through
ADR-008 briefs are still valid starting points.

### 4.3 (G3) — no conflicts

G3 is untouched; the stage-09 gate schema, retrospective role brief, and `devteam next`
pipeline-complete output are all unchanged. No scope conflict with anything that landed.

### H3 gate criterion unchanged

The BACKLOG's H3 note says: *"remaining gate is evidence of recurring-failure volume."* No
`run-log.jsonl` corpus from real autonomous runs exists yet to provide that evidence. H3 gate
is correctly preserved.
