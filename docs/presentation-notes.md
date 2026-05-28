# Presentation speaker notes

A 30–45 minute talk on Stagecraft. 13 slides. Each section has a slide outline (what's on screen), speaker notes (what to say), and a transition line.

The tone is conversational, second-person, problem-first. The pitch isn't "look at this cool framework"; it's "you've felt this pain, here's the shape of an answer." Cut anything that feels like marketing.

**Timing reference at the bottom of the doc** — total wall-clock varies with how much demo time you take.

---

## Slide 1 — Title

```
        Stagecraft

        Run your AI coding tool through a structured pipeline
        — model-agnostic, gate-enforced, auditable.

        <your name>
        <date>
```

**Speaker notes.**

Open with a question, not a statement. Something like:

> "How many of you have had a Claude session go sideways? Context resets, the agent forgets your architecture, you're three hours in and you don't have a brief or a design — just a chat log. Hands up."

Let hands go up. Then:

> "Same. This talk is about a framework I've been building — Stagecraft — that's a response to exactly that pain. The pitch fits on one line: **run your AI coding tool through a structured pipeline, with a machine-readable gate at every stage.** I'll show you what that means concretely. There's a working demo at the end."

Don't lead with "AI dev team" or "multi-agent orchestrator." Those phrases make people glaze over. Lead with the pain.

**Transition.** Let's name the problem precisely before we look at the answer.

---

## Slide 2 — The problem

```
  When an AI coding tool runs unsupervised on non-trivial work:

  • Context drifts.            The model forgets your architecture mid-session.
  • Scope drifts.              "Quick fix" turns into 600 changed lines.
  • Review is unstructured.    Approvals live in chat, not on disk.
  • Tests follow the code.     Acceptance criteria, if any, are an afterthought.
  • There's no audit trail.    Six months later, you can't reconstruct what shipped.

  None of these are model problems. They're orchestration problems.
```

**Speaker notes.**

The bullets matter less than the last line. Read them; pause; deliver the punchline:

> "None of these are model problems. They're orchestration problems. Claude is fine. Codex is fine. Gemini is fine. The gap is between the model and your codebase — there's no structure, no gates, no record of who did what. We've spent years building this kind of structure for human teams: PRs, code review, CI, design docs, runbooks. We have none of it for AI work."

This frames Stagecraft as "the missing layer," which is much more useful than "another AI tool."

**Transition.** I'm going to show you the shape of an answer in one diagram, then we'll dig in.

---

## Slide 3 — Before and after

```
  BEFORE                                       AFTER (Stagecraft)
  ────────────────────────────────             ──────────────────────────────────────
  one chat log per feature                     13 staged artifacts + gates per feature
  approvals in messages                        approvals in pipeline/gates/stage-05.json
  scope = "what the agent did"                 scope = pipeline/brief.md, version-controlled
  review = "looks good 👍"                     review = REVIEW: APPROVED / CHANGES REQUESTED, per area
  tests written if remembered                  tests gated: no PASS without 1:1 criterion mapping
  one model end-to-end                         different model per role, by config
  audit = scrollback search                    audit = `cat pipeline/gates/*.json`
```

**Speaker notes.**

This is the slide that wins skeptics. Walk it row by row, but spend extra time on three:

1. **"different model per role, by config"** — this is the multi-host story. "Claude is excellent at design. Codex is fast at backend implementation. Gemini is cheap at QA pattern-matching. The pipeline lets you route different roles to different models in the same run. The seam between them is JSON, not a model API."

2. **"approvals in pipeline/gates/stage-05.json"** — pull up a real gate JSON for 5 seconds. Show the `workstreams: [{ role, host, status, ... }]` array. "This is what review looks like as data. Not a thumbs-up emoji."

3. **"no PASS without 1:1 criterion mapping"** — "Stage 6's gate requires `all_acceptance_criteria_met: true` and a one-to-one mapping between acceptance criteria from the brief and tests from QA. If the model writes the gate without that, the validator rejects it. It's not a guideline. It's an enforced contract."

**Transition.** Let me show you what one of those gates actually looks like.

---

## Slide 4 — What a gate looks like

```json
{
  "stage": "stage-04",
  "status": "PASS",
  "orchestrator": "devteam@0.2.0",
  "track": "full",
  "timestamp": "2026-05-28T14:32:11Z",
  "blockers": [],
  "warnings": [],
  "workstreams": [
    { "workstream": "backend",  "host": "codex",       "status": "PASS" },
    { "workstream": "frontend", "host": "claude-code", "status": "PASS" },
    { "workstream": "platform", "host": "claude-code", "status": "WARN", "warnings": ["runbook references stale endpoint"] },
    { "workstream": "qa",       "host": "claude-code", "status": "PASS" }
  ]
}
```

**Speaker notes.**

Don't read the JSON. Point at three regions:

> "Top: every gate carries the same identity — stage, status, orchestrator version, track, timestamp. So six months from now, if you're auditing a deploy, you know which version of the framework produced the artifact."

> "Middle: blockers and warnings. If `status: FAIL`, blockers tell you what's wrong. The validator enforces that a FAIL gate must have at least one blocker. No silent failures."

> "Bottom: workstreams. This is a multi-role stage — build has four workstreams. Backend ran on Codex; the other three on Claude Code. They each wrote their own gate, and the orchestrator merged them into this one. The aggregate status is **pessimistic**: any FAIL → merged FAIL. Any WARN → merged WARN. Only all-PASS gives merged PASS."

> "The point: the orchestrator never stores state outside these files. The pipeline is reconstructable from `pipeline/gates/` alone."

**Transition.** Let me show you the bigger picture — the whole pipeline.

---

## Slide 5 — The 13-stage pipeline

```
  full track:

  01. requirements  ──►  PM writes brief.md
  02. design        ──►  Principal writes design-spec.md + ADRs
  03. clarification ──►  PM resolves open questions
  04. build         ──►  Backend | Frontend | Platform | QA (4 workstreams)
  04a. pre-review   ──►  Platform runs lint / tests / dep review / security heuristic
  04b. security     ──►  (conditional) Security reviews flagged paths — has veto
  05. peer-review   ──►  Reviewer × 4 areas (auto-derived from REVIEW: markers)
  06. qa            ──►  QA runs tests; 1:1 criterion-to-test mapping required
  06b. accessibility──►  QA audits WCAG (axe-core / pa11y / lighthouse)
  06c. observability──►  Platform verifies brief §9 signals are actually emitted
  07. sign-off      ──►  PM + Platform; auto-fold from stage-06 if criteria met
  08. deploy        ──►  Platform follows core/deploy/<adapter>.md
  09. retrospective ──►  Principal harvests lessons; promotes ≤2 to lessons-learned.md
```

**Speaker notes.**

You don't have to explain every stage. Focus on three properties of the whole:

1. **Some stages are multi-role.** Build is 4 (backend, frontend, platform, qa). Peer-review is 4 (one per area). These produce per-workstream gates that get merged.

2. **Some stages are conditional.** Stage 4b (security) only fires when stage 4a's heuristic flags sensitive paths. It's not always on, but when it fires, it has veto — `veto: true` halts the pipeline regardless of any other approval.

3. **Some stages auto-complete.** Stage 7 (PM sign-off) auto-folds if Stage 6 reports `all_acceptance_criteria_met: true` AND a 1:1 mapping. No human action. The orchestrator just writes the gate.

> "What I want you to take from this slide: the pipeline isn't a single linear thing. It's a graph with merges, conditionals, and short-circuits. The orchestrator's job is to walk it correctly. Your job is to make decisions at the gates."

**Transition.** Speaking of which — let's talk about your three actual moments of control.

---

## Slide 6 — Your three moments of control

```
  As a human in the loop, you make decisions at exactly three places:

  1. AT THE START          You pick the track and write one paragraph.
                           `devteam stage requirements --feature "..."`

  2. AT EVERY GATE         You read the gate. PASS → next. FAIL → fix. ESCALATE → decide.
                           `devteam next`

  3. AT ESCALATIONS        When the pipeline halts, you make a binding call.
                           Resolve the gate or stop the pipeline.

  Everything else is the framework's job, not yours.
```

**Speaker notes.**

This is the "your time is respected" slide. It's a key adoption argument.

> "I want to call out what's NOT on your plate. You don't write boilerplate. You don't shuffle files between agents. You don't track which review came from whom. You don't compute aggregate status. You don't manage the test report. You make three kinds of decisions: what to build, whether each gate is good enough, and what to do when the pipeline halts. That's it."

> "Pipeline run takes maybe 30–60 minutes wall-clock for a real feature. Your active engagement is probably 5–10 minutes total. The rest is the model and the framework doing their jobs."

**Transition.** That's the human-facing story. Let me show you the technical seam that makes the rest of it work — the multi-host story.

---

## Slide 7 — Model-agnostic by design

```
   You in any AI tool (Claude Code, Codex, Gemini CLI, plain terminal)
            │
            ▼
   Host adapter (hosts/<host>/adapter.js)
     • declares capabilities (hooks, subagents, headless, …)
     • renders stage prompt
     • installs surface into your project
            │
            ▼
   Core (model-agnostic spine — never invokes a model)
     • 13 stages, 6 tracks
     • gate schemas + validator
     • routing + orchestrator
            │
            ▼
   Stage prompt rendered for THIS host
            │
            ▼  ← model produces:
   • the artifact (brief, design, code, …)
   • a gate JSON conforming to the stage's schema
            │
            ▼
   Core validates, advances, escalates, or halts.
```

**Speaker notes.**

> "Read this from top to bottom. **The core never invokes a model.** That's a hard rule. The orchestrator emits prompts and validates JSON. Everything model-specific lives in the host adapter."

> "What that buys you: I shipped Claude Code, Codex, Gemini CLI, and a generic terminal adapter from the same core. Adding a new host — say Cursor or Aider — is implementing five methods against a 150-line contract. It's not a fork. It's not a rewrite. It's a directory under `hosts/`."

> "And inside one run, you can mix them. The routing config lets you say 'backend on Codex, frontend on Claude, QA on Gemini, review back on Claude.' Each workstream writes its gate. The orchestrator merges across hosts through the same JSON seam. That's not a feature we tacked on; it's what falls out of the design."

**Transition.** Let me show you how that routing actually looks in config.

---

## Slide 8 — Routing in 12 lines of YAML

```yaml
# .devteam/config.yml — your project's pipeline config

routing:
  default_host: claude-code        # everything routes here unless overridden
  roles:
    backend: codex                  # backend workstreams → Codex
    qa: gemini-cli                  # QA → Gemini
  stages:
    stage-08: claude-code           # deploy always on claude-code, regardless of role
  review_fanout: []                 # optional N×M peer review across hosts

pipeline:
  default_track: full
```

**Speaker notes.**

> "Precedence is simple: `stages > roles > default_host`. Most specific wins. The deploy override on `stage-08` says 'no matter who the role is, run deploy on Claude Code' — which is what you want if your runbook is full of Claude-specific instructions."

> "The `review_fanout` option is the multi-model adversarial review feature. Set it to `[claude-code, codex, gemini-cli]` and Stage 5 (peer-review) duplicates across all three hosts. You get 4 areas × 3 hosts = 12 parallel reviews. Catches bugs that any single model misses."

> "Default is empty list — opt-in. You don't pay the 3× cost unless you ask for it."

**Transition.** That's the steady-state picture. Let me show you how it actually starts on day one.

---

## Slide 9 — Install and first run

```bash
# 1. Install the framework (one time, anywhere)
git clone <repo> /path/to/stagecraft && cd $_ && npm install && npm link

# 2. Initialize your target project
cd ~/projects/my-app
devteam init --host claude-code

# Lays down:
#   .devteam/config.yml          ← routing + track defaults
#   .devteam/rules/*.md          ← pipeline rules (10 docs)
#   .claude/agents/*.md          ← 8 role subagents
#   .claude/skills/*/SKILL.md    ← 6 task helpers
#   .claude/commands/devteam.md  ← /devteam slash command
#   .claude/settings.local.json  ← Stop / SubagentStop / PostToolUse hooks
#   pipeline/gates/              ← empty workspace

# 3. Verify
devteam doctor                    # → ✅ everything looks good

# 4. Run
devteam stage requirements --feature "Add SMS notification opt-in"
```

**Speaker notes.**

> "Total install time: maybe two minutes. Re-running `devteam init --force` re-renders the install with whatever the latest framework version laid down — that's how you upgrade."

> "I want to stress one thing: **the framework lives separately from your project**. The framework is one git clone. It can drive any number of target projects. Updates to the framework propagate via `devteam init --force` in each target. Customizations live in the framework, not in the target — that's how you survive upgrades."

> "If you're worried about install footprint: it's templates, role briefs, rules, and a 200-byte hooks config. No binaries. No services. No background processes. The hooks fire only when Claude Code is running anyway."

**Transition.** Now let's see one stage actually run.

---

## Slide 10 — A stage in action

```
$ devteam stage build --feature "Add SMS opt-in"

═══════════════════════════════════════════════════════════════════════
  Stage stage-04 (build) — 4 workstreams to dispatch
═══════════════════════════════════════════════════════════════════════

  The block(s) below are prompts to feed to your model.
  devteam does NOT call a model — it renders the prompt and validates
  the gate JSON the model writes back.

  ...
═══════════════════════════════════════════════════════════════════════

────────  workstream: backend  (host: codex)  ────────
[prompt addressed to the codex backend role]

────────  workstream: frontend  (host: claude-code)  ────────
[prompt addressed to the claude-code frontend subagent]

[... two more workstreams ...]

────────  end of stage-04 (4 workstreams)  ────────
```

**Speaker notes.**

> "The framework doesn't call the model itself — it renders the prompts. You feed them to your model. Three options: paste into Claude Code, use the `/devteam` slash command that init laid down, or add `--headless` and the framework pipes them to `claude --print` and `codex exec` for you."

> "Each workstream writes its own gate JSON when it's done. The Claude Code hook validates each one as it's written. After all 4 land, you run `devteam merge build` to get the aggregate stage gate. Then `devteam next` tells you what's next."

If you're demoing live: pause here, run the command, walk through the actual output. If you're presenting slides only, show a screenshot.

**Transition.** Once the gates start landing, you need a way to see the state at a glance.

---

## Slide 11 — The web UI

```
  $ devteam ui --open

  [Screenshot: stage list with per-workstream status icons,
   colored bars, click-to-open gate detail, live updates via SSE.]
```

**Speaker notes.**

> "There's a local web UI. `devteam ui --open`. Single-page, vanilla HTML, no build step, no external services. Loopback only by default — the UI has no auth, no rate limits. Bind guard refuses non-loopback unless you explicitly set an env var."

> "What you see: every stage as a row. Multi-role stages expand to show per-workstream status. Click any row, get the gate JSON, blockers, warnings, workstreams table. The UI watches `pipeline/gates/` via `fs.watch` and pushes updates over Server-Sent Events. Run a stage from one terminal, watch rows light up in the browser."

> "This is the demo I'd do live if I had time. Worth knowing exists; not worth dwelling on."

**Transition.** Let's talk about the failure cases — because the value of a pipeline is mostly in what it catches.

---

## Slide 12 — Safety, observability, and the failure modes

```
  WHAT CATCHES BUGS BEFORE MERGE
  ──────────────────────────────────────────────────────────────────
  Per-role allowedWrites          backend can't edit src/frontend/*
                                   Enforced by Claude Code PreToolUse hook.

  Stoplist                        lighter tracks refuse `auth`, `payments`,
                                   `migrations`, … unless --force.

  Secret scanning hook            blocks Write/Edit on AWS / GitHub / Anthropic /
                                   OpenAI / Slack / Stripe credentials.

  Security review (conditional)   fires when pre-review flags sensitive paths;
                                   has veto.

  Adversarial peer review         opt-in: stage-05 fanout across multiple hosts.
                                   Different models disagree about different things.

  Accessibility audit             stage-06b. PASS requires 0 critical + 0 serious
                                   WCAG violations.

  Observability gate              stage-06c. Brief §9 signals must be verified
                                   in the shipped code, not just promised.

  OBSERVABILITY OF THE PIPELINE ITSELF
  ──────────────────────────────────────────────────────────────────
  OpenTelemetry tracing           opt-in via OTEL_EXPORTER_OTLP_ENDPOINT.
                                   Spans on every workstream + merge + validate.

  Gate-pass-rate dashboards       npm run dashboard. Per-stage / per-host / per-role
                                   pass rates. Time-windowed. Multi-project rollup.

  Persistent memory               .devteam/memory/. Semantic index of briefs, designs,
                                   ADRs, retros. Ask "have we built X before?"
```

**Speaker notes.**

This is the "we thought about safety" slide. Don't read every line. Land three:

> "First — the stoplist. We have a list of phrases — `auth`, `payments`, `migrations`, `pii`, more — that block the lighter tracks. You cannot run `nano` track on a change with `add auth middleware` in the description. The framework refuses. You'd have to pass `--force`. That's a deliberate friction point: serious changes get serious process."

> "Second — adversarial peer review. This is the most distinctive feature. Set `review_fanout: [claude-code, codex, gemini-cli]` and Stage 5 runs across all three. You get four areas × three hosts = 12 parallel reviews. Pessimistic merge. The point: different models have different blind spots. A bug Claude rationalizes as fine, Codex might flag. We've seen this in practice."

> "Third — observability. Every pipeline operation emits an OTel span. Set the standard `OTEL_EXPORTER_OTLP_ENDPOINT` env var, ship to Honeycomb / Datadog / Tempo / Jaeger. The dashboard script aggregates gates across runs into per-stage, per-host, per-role pass rates. You can see where the pipeline is brittle, which model is best at which role, what's costing you the most retries."

**Transition.** Let's land this with what to do next.

---

## Slide 13 — Getting started

```
   1. Install:        git clone <repo>; cd $_; npm install && npm link
   2. Try:            cd /tmp/scratch; devteam init --host claude-code
   3. Read:           EXAMPLE.md — one full pipeline run, end to end
   4. Pilot:          two-week pilot script in docs/adoption-guide.md
   5. Adopt:          land devteam init in your project bootstrap

   Docs:              README.md → docs/concepts.md → docs/user-guide.md
   Source:            <repo URL>
   Issues / PRs:      <repo URL>/issues

   Add a new host:    CONTRIBUTING.md recipe 1 (~200 lines, half a day).
```

**Speaker notes.**

> "If you're convinced and you want to try it: install in a throwaway directory, read EXAMPLE.md, run one pipeline yourself. Half an hour. Then decide if you want to pilot."

> "If you're not convinced and you want to think about it: read the adoption guide. It's honest about when this is the wrong tool. Small teams doing exploratory work — bad fit. AI-for-completions only — bad fit. Stagecraft's value compounds with team size, change frequency, and the seriousness of what you ship."

> "If you have feedback or want to add a host: PRs welcome. The whole framework is MIT. There's a backlog with prioritized next ideas — A2 is more adapters (Cursor, Aider, Cline, Windsurf), F4 is CI runner integration, G2 is closed-loop acceptance-criteria-to-test generation. Pick something."

Pause, then:

> "Questions?"

---

## Q&A primers

Common questions and the short answers:

**Q: How does this compare to LangGraph / CrewAI / AutoGen?**
> Different problem space. Those are agent-framework libraries — you write Python and they coordinate LLM calls. Stagecraft is a pipeline scaffold for AI coding tools. The actual model invocation happens inside Claude / Codex / Gemini, not via a framework SDK. If your team already lives in those tools, Stagecraft meets you there.

**Q: What if my LLM doesn't follow the rules?**
> Role briefs are instructions, not enforcement — except where hooks enforce. The Claude Code hooks enforce `allowedWrites` at tool-call time: if backend tries to write `src/frontend/*`, the write is rejected. For things that aren't hook-enforceable, the gate validator catches them post-hoc — a FAIL gate halts the pipeline.

**Q: Cost — multi-model adversarial review sounds expensive.**
> Default config is one host per pipeline. Fanout is opt-in. And the cost story tilts the right way: route the bulk of work to cheaper models (Codex / Haiku) and reserve the expensive models (Opus) for Principal and Security. Net cost goes *down*, not up, for most teams.

**Q: What if the framework changes break our installed projects?**
> The framework version is in `package.json`. Re-running `devteam init --force` re-renders the install. Risk: framework changes a role brief in a way that conflicts with project-specific customization → you lose the customization. Mitigation: customize in the framework (your fork or a feature flag), not in target copies.

**Q: Can I add Cursor / Aider / Cline / Windsurf?**
> Yes. Each is a host adapter, ~200 lines. Implement 5 methods against the contract in `core/adapters/host-adapter.md`. CONTRIBUTING.md has the recipe. The Gemini CLI adapter is a good template for IDE-embedded tools.

**Q: Why no `/goal` integration like Claude / Codex have?**
> `/goal` is a continuation primitive (one condition → many turns until satisfied). Stagecraft's `--feature` is a decomposition primitive (one feature → 13 stages with defined artifacts). They're complementary. We could plausibly emit `/goal` invocations from the claude-code adapter for convergence-shaped stages (build, QA) where "done" is a condition, not an artifact — that's on the backlog. Not built today.

---

## Timing reference

| Section | Slides | Minimum | Comfortable | With demo |
|---|---|---|---|---|
| Hook + problem | 1, 2 | 3 min | 5 min | 5 min |
| Before/after + gate JSON | 3, 4 | 5 min | 7 min | 8 min |
| Pipeline + three moments of control | 5, 6 | 5 min | 7 min | 7 min |
| Multi-host (core idea) | 7, 8 | 5 min | 7 min | 10 min |
| Install + first run | 9 | 2 min | 4 min | 6 min |
| Stage in action | 10 | 3 min | 5 min | 10 min |
| UI + safety + observability | 11, 12 | 4 min | 6 min | 8 min |
| Close + Q&A primer | 13 | 3 min | 5 min | 5 min |
| **Total (no Q&A)** | | **30 min** | **46 min** | **59 min** |

For a 30-minute talk: skip slides 8 and 11. Trim slide 12 to one bullet per category.
For a 60-minute talk + Q&A: budget 45 min of talk + 15 min of questions.
For a 90-minute workshop: do the slides, then live-run the EXAMPLE.md walkthrough.

## What to bring

- Laptop with `devteam` installed and a target project ready to demo.
- A real gate JSON file open in an editor for Slide 4.
- The web UI loaded at `devteam ui --open` ready for Slide 11.
- A printout of EXAMPLE.md if you have audience members who want the deep-dive after.

## What not to do

- Don't lead with "AI dev team." It signals "another hype framework."
- Don't read the slide bullets. Talk to the audience; bullets are scaffolding.
- Don't apologize for the tool's limitations preemptively — wait for them to come up in Q&A.
- Don't dwell on architecture diagrams. People glaze. Show the gate JSON instead.
- Don't ask "any questions so far?" mid-talk. It always gets crickets. Save it for the end.
