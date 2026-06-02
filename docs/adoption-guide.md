# Adoption guide

For team leads deciding whether to introduce Stagecraft to their team. Not a how-to (that's [`user-guide.md`](user-guide.md)) — a "should we do this, and how do we land it?" document.

If you're an individual engineer trying it out for yourself, the [README's First 30 minutes](../README.md#first-30-minutes) is the right path. This page is for the question "should we make this our team's way of working?"

## When this is the right tool

You're a good fit if **most** of these are true:

- **Your team uses an AI coding tool for non-trivial work.** Features, refactors, migrations — not just one-off completions. If the only thing you use Claude / Codex / Gemini for is autocomplete-style inline suggestions, the orchestration overhead doesn't pay off.

- **You want a record of what an AI did and why.** Who approved. What was reviewed. What tests covered which acceptance criterion. Auditable on disk, not just outputs in a chat log. This is the value that compounds over months.

- **You routinely have changes that touch multiple areas** (backend + frontend + infra) and want a structured handoff between them. Single-area changes can absolutely use Stagecraft, but the multi-workstream design earns its keep on cross-cutting work.

- **You have engineers reviewing AI output, not blind-merging.** And you want their reviews structured (per-area, with verdicts the system tracks). Stagecraft formalizes review; if review is already a real practice on your team, this fits cleanly.

- **Compliance or regulatory pressure means you need to show *how* a change was developed**, not just *what* changed. The pipeline produces an audit trail by construction — brief, design, code, reviews, tests, deploy log, retrospective — all version-controlled.

- **Multiple AI tools live on your team.** Some folks prefer Claude Code, others Codex, some Gemini CLI. Stagecraft is one pipeline that meets them where they are. If you've standardized on one tool and don't see that changing, you can still benefit, but the multi-host story is less of a draw.

You're a poor fit if **any** of these are true:

- **The team is one or two people doing exploratory work** and a pipeline would slow you down. The friction-to-value ratio inverts at small scale.

- **You're using AI mostly for inline completions or quick fixes.** The orchestration overhead is wrong-sized for that work. Use `nano` track for one-line fixes if you must, but honestly, just don't use the pipeline for those.

- **You don't have a strong distinction between "the work" and "verification of the work."** Stagecraft's value is in gates between roles; if your team works in undifferentiated flow, the gates are friction without payoff.

- **Your codebase is unstructured enough that "files this role can write" is unanswerable.** The per-role `allowedWrites` story assumes there's *some* notion of "backend code" vs "frontend code." If your codebase is a single grab-bag, you'll have to think about that before adopting.

- **Your team treats AI output as a fait accompli** ("Claude said do it, so we do it"). Stagecraft assumes humans-in-the-loop at gates. If your culture is "ship whatever the AI produces," the gates feel like obstruction.

## What you get

After adoption (typically 2–4 weeks in):

- **A consistent pipeline every change runs through** (modulo track choice). New team members onboard to the pipeline, not to one person's idiosyncratic workflow. Senior engineers don't have to repeat the same review feedback to every junior engineer — it's encoded in role briefs and gate schemas.

- **Audit trail per change.** Brief, design spec, code, reviews, test report, deploy log, retrospective. All on disk, all version-controlled, all queryable. When an incident happens six months later and someone asks "why did we ship this?", you have an answer.

- **Pre-merge guardrails.** Stoplist blocks dangerous changes from running on lighter tracks. Security review fires conditionally when the diff touches auth / PII / crypto / etc. Allowed-writes enforcement (on hosts that support it) prevents agents from editing files they shouldn't. Secret scanner blocks credentials in code at write time.

- **Multi-host flexibility.** Same pipeline, different models per role. PM on Opus, backend on Codex, QA on Haiku — whatever maximizes quality-per-dollar for your team. Or run all on one host; that's the default. The point is you have the option.

- **Retrospective learning.** Lessons flow into `pipeline/lessons-learned.md`, get reinforced when patterns recur, age out if unused. Patterns from peer review get promoted by the Principal at Stage 9. Future runs benefit from past ones in a structured way.

- **Adversarial peer review (opt-in).** Run Stage 5 across multiple hosts. Different models catch different bugs. Cost is N× peer-review time and money; benefit is real bug catches that any single model misses.

## What it costs

Real costs to budget for:

- **One-time setup per project: ~5 minutes** (`devteam init`). Then ~15–30 minutes to skim the rules docs and adjust `.devteam/config.yml`. The config decisions you'll make: default track, routing per role, deploy adapter, optional review-fanout list.

- **Per-stage overhead: ~30 seconds of orchestration time** (CLI invocations, gate validation, hook execution). Negligible vs the LLM's wall-clock (which is typically minutes per stage on real work).

- **Learning curve: ~2 hours** for an experienced engineer to understand the pipeline, gates, hooks, tracks. Less if they've used `claude-dev-team` or `codex-dev-team` (Stagecraft's predecessors). Plan for a 30-minute team walkthrough using the [presentation deck](presentation-notes.md).

- **Discipline:** the pipeline is opt-in per change. Engineers will sometimes skip it for "quick" changes. That's fine — `nano` and `quick` tracks exist for exactly that. But if the team consistently bypasses the pipeline for non-trivial work, you're not getting the value. This is mostly a culture question, not a tool question.

- **Sometimes the LLM doesn't follow the rules.** Role briefs are instructions, not enforcement (except where hooks enforce — allowedWrites on Claude Code, secret scanning, gate validation). You'll occasionally have to nudge an agent that wandered out of its lane. Less common as the role briefs mature; more common in the first weeks.

- **Multi-host costs.** If you opt into multi-host or review fanout, you're paying for N× LLM calls at peer-review time. Budget accordingly — review fanout is the single largest cost driver if enabled. Most teams run single-host for steady state and turn on fanout for high-risk changes.

## How to pilot

A 2-week pilot answers most adoption questions cheaply.

### Week 1: setup and shadow run

1. **Pick a pilot project.** Active development, multiple contributors, a couple of features in flight. Avoid greenfield projects (the pipeline's value compounds with team size + change history). Avoid projects where the team is in the middle of a release crunch — adoption needs a calm baseline.

2. **Install in the pilot project.** `devteam init --host claude-code` (or your team's host of choice). Verify with `devteam doctor` — should be all green.

3. **Adjust the config.** Routing, default track, deploy adapter. ~15 minutes. Make these decisions explicit so the team isn't relitigating them per change.

4. **Skim the role briefs.** `roles/*.md`. Each is the source of truth for what that role does, reads, and writes. Adjust ROLE_FRONTMATTER in the host adapter if your team has different model preferences per role.

5. **Run one full pipeline on a real-but-small feature.** Doesn't need to ship — see how it feels. Note any friction points: stages that felt mechanical, gates that fired false-positively, agent behaviors that needed nudging. These notes drive Week 2's customization.

### Week 2: real use

6. **Use Stagecraft for every new feature for one week.** Force the test even if it feels heavy at first. Resist the urge to bypass — bypassed runs don't teach you anything. Track:
   - **Time-to-merge before vs after.** Often increases by 10–30% in week one (overhead) and decreases by 20–40% by month two (audit trail prevents re-work).
   - **Number of bugs caught at peer-review or security-review** that would have shipped otherwise. This is the single biggest "is it earning its keep" metric.
   - **Number of times the pipeline blocked something valid** (false-positive stoplist matches, over-strict gate validation). High numbers mean you need to customize.
   - **Engineer sentiment per stage** — one-line "this stage was useful" / "this stage was friction" per stage. Use these for week-3 customization decisions.

7. **Decision.** At end of week 2:
   - **Adopt:** the value showed up. Roll out to the team. Don't roll out before you have evidence; "we should use this because it sounds good" doesn't survive contact with real work.
   - **Adapt:** the value is there but the defaults aren't right. Identify what to customize (stoplist, role briefs, tracks, routing) before broader rollout.
   - **Drop:** the overhead didn't pay off. That's a real answer; it's not a good fit for every team. Better to recognize that at week 2 than at month 6.

## How to land it broadly (post-pilot)

If you adopt:

1. **Land the install in CI.** Add `devteam init --host <name>` to your project bootstrap script. New devs get the pipeline without ceremony. Re-running `devteam init --force` is idempotent — running it on every CI bootstrap is safe.

2. **Document the team's track choices.** Make it explicit in your contributing docs: "Use `nano` for typo fixes, `quick` for single-area changes, `full` for cross-area features, `hotfix` for production incidents." Decision-making without a doc devolves to "everyone picks full" — which then becomes "everyone picks nano because full is too heavy."

3. **Set up GitHub Actions to validate gates.** A simple PR check: if `pipeline/gates/` exists, validator must pass. Catches missing / malformed gates before merge. The `scripts/pr-publish.js` tool can push gate status as GitHub check runs on the PR head commit (PASS → success, FAIL → failure).

4. **Promote one engineer as pipeline champion.** Someone owns "is the pipeline working for the team?" — surfaces friction, lands customizations, runs internal training when needed. Without an owner, customizations stall and friction accumulates. Rotate the role quarterly so it doesn't become any one person's burden.

5. **Run retrospectives on the pipeline itself.** Monthly: what stages are friction? What's underused? What's our gate-pass-rate? (Use `scripts/dashboard.js` to get per-stage / per-host / per-role pass rates.) These retros are where the pipeline evolves to match your team's actual work.

6. **Wire up observability if you have an OTel collector.** Set `OTEL_EXPORTER_OTLP_ENDPOINT` in your team's standard env. Pipeline spans show up in your existing trace tooling. Useful for debugging stuck pipelines and spotting model latency outliers.

## Common objections and responses

### "We don't want another layer between us and the LLM."

The framework adds ~30 seconds of orchestration per stage. It's not a layer between you and the LLM — it's a layer that tells the LLM what role to play and validates what it wrote. The LLM call itself is unchanged.

What changes: the LLM gets a focused prompt with explicit scope, a defined artifact path, and a gate schema to produce. That structure is what makes the output predictable and reviewable. If you've ever had an agent drift mid-session and felt "I should have given it a tighter prompt" — Stagecraft is that tighter prompt, applied consistently.

The real question to test is: does the structure produce better output for non-trivial work, or just add ceremony? Run the pilot; that's how you find out.

### "Our team is too small for this much process."

Pick a lighter track. `nano` is 2 stages (build + qa). `quick` is 7. The pipeline is opt-in; you don't have to run `full` on every change. The track system exists specifically to scale the process to the change.

That said: there's an honest answer too. If your team is 1–2 people doing fast-moving exploratory work, Stagecraft probably is the wrong shape. It pays off when you have multiple people, multiple changes in flight, and a non-trivial codebase. Below that scale, you're getting structure you don't yet need.

### "We already do code review; we don't need Stage 5."

You're already doing it informally. Stage 5 just structures it: per-area sections, explicit verdicts (`REVIEW: APPROVED` / `CHANGES REQUESTED`), automatic gate derivation from the markers.

If your team is small enough that informal review works (1–2 people), skip Stage 5 by picking `nano` / `dep-update`. If your team is >3 people, structured review pays off via the audit trail alone — six months later, the question "did anyone actually review this?" has a definitive answer.

The other benefit, often missed: multi-model peer review. With `review_fanout` configured, Stage 5 runs across 2–3 different models. Different models catch different bugs. This is a capability you cannot replicate with human review alone, and it's structurally cheap (the cost is wall-clock time and LLM dollars; the bugs caught more than pay back). For *method* diversity — a role applying a different methodology, not a different model — that's what stage-04c red-team is for.

### "What if the framework changes break our installed projects?"

The framework version is in `package.json#version`. Re-running `devteam init --force` re-renders the install with the new version. The risk: if the new framework changes a role brief in a way that conflicts with project-specific customization, you lose the customization.

Mitigations:
- **Customize in the framework**, not in target copies. See `CONTRIBUTING.md` for the right place to put each kind of change. This is the single most important habit to instill.
- **Version-control the target's `.claude/agents/`** so you can diff after re-install. If you customized something accidentally, you can recover the diff.
- **Pin a framework version** for stability. The framework has tagged releases; you can `git checkout v0.2.0` in your framework dir if you're not ready for newer changes.
- **Fork Stagecraft** if you have substantial team-specific customizations. The framework is MIT; forking is fine, expected, and easier than fighting upstream.

### "We use [other AI tool] that isn't supported."

Adding a host adapter is a self-contained task. See `CONTRIBUTING.md` recipe 1. If you can implement five methods (`install`, `renderStagePrompt`, `status`, `uninstall`, optional `invoke`) against the contract in `core/adapters/host-adapter.md`, you have a working adapter. The Gemini CLI adapter (`hosts/gemini-cli/`) is a good template for IDE-embedded tools; the Codex adapter (`hosts/codex/`) for prompt-based tools without hooks.

Typical effort: ~200 lines of JavaScript, half a day for someone who's used the target tool. The `generic` adapter exists as a degenerate case (zero in-host integration) to prove the contract really is host-neutral.

### "We don't trust LLM output enough to put it in our codebase."

You're already trusting LLM output if you use Claude Code or Codex. Stagecraft adds structure to *how* you trust it: peer review by other agents (or humans!), test gates, security gates, sign-off gates. The pipeline doesn't make the model better — it makes the model's output more reviewable.

If you're not ready to trust LLM output at all, this tool isn't going to change that — but you probably aren't using Claude Code or Codex in the first place. The right move there is to keep using AI for autocomplete and not orchestration.

### "What about cost? Multi-model peer review sounds expensive."

The default config is one host per pipeline. Multi-host is opt-in. Review fanout is opt-in on top of that. None of this is on by default — you turn it on per project as you see value.

Even with multi-host, the cost story usually works in your favor: models like Codex and Haiku are 5–10× cheaper than Opus. Routing the bulk of work to cheaper models while reserving Opus for Principal / Security is a cost *reduction*, not increase. The biggest cost spike is review fanout (3× peer-review cost if you fan across three hosts). Reserve it for high-risk changes (security-sensitive, customer-facing) and don't enable it by default.

Cost telemetry per stage is built in (`npm run dashboard:cost`). Adaptive routing reads that telemetry and suggests config swaps (`npm run routing:suggest`).

### "What if we want to bypass the pipeline?"

You can. Run `devteam stage <name> --force` to bypass the stoplist. Hand-write a gate JSON with `status: "PASS"` and skip a stage that didn't run. The orchestrator doesn't lock you out — it surfaces friction points and lets you proceed if you've decided to.

But: the pipeline only earns its keep if you use it. A team that bypasses 80% of the time is paying setup costs for no value. Track your bypass rate (it's grep-able: count `--force` invocations or hand-written gates) and treat a high rate as a signal that either the defaults are wrong (customize them) or the tool is wrong for your team (drop it).

### "How do we onboard new engineers?"

Three artifacts, in order:
1. **`EXAMPLE.md`** — one full pipeline traced end-to-end. New hire reads this in 15 minutes.
2. **`docs/concepts.md`** — six primitives in a table. Glance before the example, refer back later.
3. **A 30-minute walkthrough** using [`docs/presentation-notes.md`](presentation-notes.md). Run it as part of new-hire onboarding.

For a deeper example of what the full pipeline produces on a real, non-trivial problem: [`docs/walkthroughs/soc2-evidence-collector.md`](walkthroughs/soc2-evidence-collector.md) — builds a SOC 2 evidence collector CLI through all 17 stages, including conditional stages (security review, migration safety), multi-model peer review, and property-based testing.

After that, the first real change they ship goes through the pipeline with a buddy. By their third pipeline run, they're independent.

## What success looks like

After 1 month:

- New features routinely go through the pipeline without team complaints. Pipeline is invisible infrastructure, not a debate.
- The audit trail has been used at least once — to explain a decision to a stakeholder, debug an incident, or onboard a new engineer.
- The team has customized 1–3 things (stoplist additions, a role brief, a custom track, routing) to fit their context.
- Engineer sentiment per stage is mostly positive; the friction points are known and either accepted or scheduled to fix.
- Gate pass-rates across stages are <100% — meaning the gates are actually catching things, not rubber-stamping.

After 6 months:

- The pipeline is your team's standard way of working. Bypassing it for a feature is a deliberate choice with a reason, not laziness.
- `pipeline/lessons-learned.md` has 20–50 promoted lessons that are actually shaping new work. Old lessons have aged out if unused.
- You've contributed back to the framework (a stage, a track, an adapter, a role brief, a docs fix). The framework feels like *yours*, not someone else's tool.
- You've identified at least one bug class that the pipeline catches systematically — security regressions, missing tests, missing observability — that previously slipped through.

After 12 months:

- A new engineer can join the team and ship their first feature through the pipeline with minimal hand-holding. The pipeline + audit trail does what verbal mentoring used to do.
- The framework version is pinned or you've forked. You have an opinion about upstream changes.
- Pipeline retrospectives have stopped being interesting (in a good way) — the system is stable, the defaults work, the customizations are done.

## When to walk away

Six months in and:

- **Engineers consistently bypass the pipeline** despite training. Means the value isn't landing for them, regardless of theoretical merit.
- **The audit trail is unused.** Nobody refers to past briefs / designs / reviews. Means the audit value isn't real for your team.
- **Gate pass-rates are >95% across the board.** Means the gates aren't catching anything; they're rubber-stamping. Either tighten them or admit the framework isn't earning its keep.
- **Lessons-learned is empty or stale.** Means the retrospective stage isn't producing actionable insights. The pipeline runs but doesn't get better over time.

Those are signs the pipeline isn't earning its overhead. Drop it, or scope it down dramatically (e.g., only use `nano` track on routine changes; skip the pipeline entirely on PRs from senior engineers). Don't keep paying overhead for value you're not getting.

The framework being right for some teams doesn't mean it's right for yours. Walking away is a legitimate outcome.

## Where to start

1. **Read [`README.md`](../README.md)** for the elevator pitch and First 30 minutes path.
2. **Read [`EXAMPLE.md`](../EXAMPLE.md)** for what one run actually looks like.
3. **Run `devteam init` in a throwaway project** and walk through one full pipeline yourself. Half an hour.

If after that hour you can see how it would help your team, run the 2-week pilot above. If not, don't — it's not a tool that benefits every team, and a forced adoption costs more than skipping it.
