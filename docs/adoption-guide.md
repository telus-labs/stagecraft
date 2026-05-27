# Adoption guide

For team leads deciding whether to introduce Stagecraft to their team. Not a how-to (that's [`user-guide.md`](user-guide.md)) — a "should we do this, and how do we land it?" document.

## When this is the right tool

You're a good fit if:

- Your team uses an AI coding tool (Claude Code, Codex, Gemini CLI) for non-trivial work — features, refactors, migrations — not just one-off completions.
- You want a record of what an AI did and why: who approved, what was reviewed, what tests covered which acceptance criterion. Auditable, not just outputs in a chat log.
- You routinely have changes that touch multiple areas (backend + frontend + infra) and want a structured handoff between them.
- You have engineers reviewing AI output, not blind-merging — and you want their reviews structured (per-area, with verdicts the system tracks).
- Compliance or regulatory pressure means you need to show *how* a change was developed, not just *what* changed.

You're a poor fit if:

- The team is one or two people doing exploratory work and a pipeline would slow you down.
- You're using AI mostly for inline completions or quick fixes — the orchestration overhead doesn't pay off.
- You don't have a strong distinction between "the work" and "verification of the work." Stagecraft's value is in gates between roles; if your team works in undifferentiated flow, the gates are friction.

## What you get

After adoption:

- **A consistent pipeline** every change runs through (modulo track choice). New team members onboard to the pipeline, not to one person's idiosyncratic workflow.
- **Audit trail per change.** Brief, design spec, code, reviews, test report, deploy log, retrospective. All on disk, all version-controlled, all queryable.
- **Pre-merge guardrails.** Stoplist blocks dangerous changes from running on lighter tracks. Security review fires conditionally when the diff touches auth/PII/crypto/etc. Allowed-writes enforcement (on hosts that support it) prevents agents from editing files they shouldn't.
- **Multi-host flexibility.** Same pipeline, different models per role. PM on Opus, backend on Codex, QA on Haiku — whatever maximizes quality/cost per role.
- **Retrospective learning.** Lessons flow into `pipeline/lessons-learned.md`, get reinforced, age out if unused. Patterns from peer review get promoted. Future runs benefit from past ones.

## What it costs

Real costs to budget for:

- **One-time setup per project:** ~5 minutes (`devteam init`). Then ~15-30 minutes to skim the rules docs and adjust `.devteam/config.yml`.
- **Per-stage overhead:** each stage adds ~30 seconds of orchestration time (CLI invocations, gate validation, hook execution). Negligible vs the LLM's wall-clock.
- **Learning curve:** ~2 hours for an experienced engineer to understand the pipeline, gates, hooks, tracks. Less if they've used `claude-dev-team` or `codex-dev-team`.
- **Discipline:** the pipeline is opt-in per change. Engineers will sometimes skip it for "quick" changes. That's fine — `nano` and `quick` tracks exist for exactly that. But if the team consistently bypasses the pipeline, you're not getting the value.
- **Sometimes the LLM doesn't follow the rules.** Role briefs are instructions, not enforcement (except where hooks enforce). You'll occasionally have to nudge an agent that wandered out of its lane.

## How to pilot

A 2-week pilot answers most adoption questions cheaply.

### Week 1: setup and shadow run

1. **Pick a pilot project.** Active development, multiple contributors, a couple of features in flight. Avoid greenfield projects (the pipeline's value compounds with team size + change history).
2. **Install in the pilot project.** `devteam init --host claude-code` (or your team's host of choice). Verify with `devteam doctor`.
3. **Adjust the config.** Routing, default track, deploy adapter. ~15 min.
4. **Skim the role briefs.** `roles/*.md`. Adjust ROLE_FRONTMATTER in the host adapter if your team has different model preferences per role.
5. **Run one full pipeline on a real-but-small feature.** Doesn't need to ship — see how it feels. Note any friction points.

### Week 2: real use

6. **Use Stagecraft for every new feature for one week.** Force the test even if it feels heavy at first. Track:
   - Time-to-merge before vs after.
   - Number of bugs caught at peer-review or security-review that would have shipped otherwise.
   - Number of times the pipeline blocked something valid (false-positive stoplist matches, over-strict gate validation).
   - Engineer sentiment (one-line "this stage was useful" / "this stage was friction" per stage).

7. **Decision.** At end of week 2:
   - **Adopt:** the value showed up. Roll out to the team.
   - **Adapt:** the value is there but the defaults aren't right. Identify what to customize (stoplist, role briefs, tracks).
   - **Drop:** the overhead didn't pay off. That's a real answer; it's not a good fit for every team.

## How to land it broadly (post-pilot)

If you adopt:

1. **Land the install in CI.** Add `devteam init --host <name>` to your project bootstrap script. New devs get the pipeline without ceremony.

2. **Document the team's track choices.** Make it explicit in your contributing docs: "Use `nano` for typo fixes, `quick` for single-area changes, `full` for cross-area features." Decision-making without a doc devolves to "everyone picks full."

3. **Set up GitHub Actions to validate gates.** A simple PR check: if `pipeline/gates/` exists, validator must pass. Catches missing/malformed gates before merge.

4. **Promote one engineer as pipeline champion.** Someone owns "is the pipeline working for the team?" — surfaces friction, lands customizations, runs internal training when needed.

5. **Run retrospectives on the pipeline itself.** Monthly: what stages are friction? What's underused? What's our gate-pass-rate? (Backlog D2 will make this easy via dashboards; for now, hand-tally.)

## Common objections and responses

### "We don't want another layer between us and the LLM."

The framework adds ~30 seconds of orchestration per stage. It's not a layer between you and the LLM — it's a layer that tells the LLM what role to play and validates what it wrote. The LLM call itself is unchanged.

### "Our team is too small for this much process."

Pick a lighter track. `nano` is 2 stages. `quick` is 7. The pipeline is opt-in; you don't have to run `full` on every change.

### "We already do code review; we don't need Stage 5."

You're already doing it informally. Stage 5 just structures it: per-area sections, explicit verdicts, automatic gate derivation. If your team is small enough that informal review works (1-2 people), skip Stage 5 by picking `nano` / `dep-update`. If your team is >3, structured review pays off via the audit trail alone.

### "What if the framework changes break our installed projects?"

The framework version is in `package.json#version`. Re-running `devteam init --force` re-renders the install with the new version. The risk is: if the new framework changes a role brief in a way that conflicts with project-specific customization, you lose the customization. Mitigations: (a) customize in the framework, not in target copies (see `CONTRIBUTING.md`); (b) version-control the target's `.claude/agents/` so you can diff after re-install; (c) fork Stagecraft if you have substantial team-specific customizations.

### "We use [other AI tool] that isn't supported."

Adding a host adapter is a self-contained ~200-line task. See `CONTRIBUTING.md` recipe 1. If you can implement five methods, you have a working adapter.

### "We don't trust LLM output enough to put it in our codebase."

You're already trusting LLM output if you use Claude Code or Codex. Stagecraft adds structure to *how* you trust it: peer review by other agents (or humans!), test gates, security gates, sign-off gates. If you're not ready to trust LLM output at all, this tool isn't going to change that — but you probably aren't using Claude Code or Codex in the first place.

### "What about cost? Multi-model adversarial review sounds expensive."

The default config is one host per pipeline. Multi-host is opt-in. Even with multi-host, models like Codex (and Haiku, when we add adaptive routing) are 5-10× cheaper than Opus — routing the bulk of work to cheaper models while reserving Opus for Principal/Security is a cost *reduction*, not increase. The BACKLOG (D6) tracks cost telemetry as a planned feature.

## What success looks like

After 1 month:

- New features routinely go through the pipeline without team complaints. Pipeline is invisible infrastructure, not a debate.
- The audit trail has been used at least once — to explain a decision to a stakeholder, debug an incident, or onboard a new engineer.
- The team has customized 1-3 things (stoplist additions, a role brief, a custom track) to fit their context.
- Engineer sentiment per stage is mostly positive; the friction points are known and either accepted or scheduled to fix.

After 6 months:

- The pipeline is your team's standard way of working. Bypassing it for a feature is a deliberate choice with a reason.
- `pipeline/lessons-learned.md` has 20-50 promoted lessons that are actually shaping new work.
- You've contributed back to the framework (a stage, a track, an adapter, a docs fix). The framework feels like *yours*, not someone else's tool.

## When to walk away

Six months in and:

- Engineers consistently bypass the pipeline.
- The audit trail is unused.
- Gate pass-rates are >95% across the board (means the gates aren't catching anything).
- Lessons-learned is empty or stale.

Those are signs the pipeline isn't earning its overhead. Drop it, or scope it down dramatically (e.g., only use `nano` track on routine changes; skip the pipeline entirely on PRs from senior engineers). Don't keep paying overhead for value you're not getting.

## Where to start

Read [`README.md`](../README.md), then [`EXAMPLE.md`](../EXAMPLE.md). Then run a `devteam init` in a throwaway project and walk through one full pipeline run yourself. The whole thing should take an hour. If after that hour you can see how it would help your team, run the 2-week pilot. If not, don't.
