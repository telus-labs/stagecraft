- **New first-party host: `omp` (Oh My Pi).** `devteam init --host omp` installs
  role briefs to `.omp/prompts/roles/`, skills to `.omp/skills/<name>/SKILL.md`
  (where omp's native provider discovers them), and rules to `.devteam/rules/`,
  and `hosts/omp/adapter.js` dispatches stages through
  `omp -p --mode json --no-session --no-extensions --approval-mode yolo --tools …`.
  The tool list pins files, search, shell, LSP diagnostics, and a todo list, and
  leaves out omp's own subagent (`task`, `hub`), interactive (`ask`), and
  `eval` tools so a stage dispatch stays a single workstream under Stagecraft's
  post-hoc write audit.
  Telemetry is `native`: a new `omp-json` usage extractor
  (`core/adapters/omp-json.js`) sums `usage.{input,output,cacheRead,cacheWrite,
  cost.total}` across the run's assistant `message_end` frames, records the
  model and provider omp reports, and degrades to raw passthrough when the
  stream is not JSON — the same contract as the codex extractor. Cache tokens
  are recorded as `cached_tokens` and `cache_creation_tokens` with
  `input_accounting: exclusive`, matching omp's (pi-ai) usage model.
  *Scope note:* enforcement is `post-hoc-audit`/`prompt-only`, the same tier
  as codex and antigravity. omp exposes a blocking pre-tool `tool_call` hook
  that could lift this to tool-call-time; that is a follow-up, not part of this
  change. The JSON event shapes and the per-message summation were confirmed
  against omp 18.1.10 on a real stage-01 dispatch (19 tool calls, 583K input
  tokens observed, `cost_usd_derived` computed from `core/pricing.js`). Through
  an OpenAI-completions proxy omp reports `cacheRead: 0` and no cost, so
  `cached_tokens` is absent and `cost_usd` is null on that path; a direct
  Anthropic provider is expected to populate both.
- **`devteam stage` names the host it actually routes to.** The user-driven
  preamble said "Inside Claude Code: paste the prompt, OR type `/devteam …`"
  and "pipes the prompt to `claude --print`" for every host. It now lists the
  display names of the hosts the stage's workstreams resolve to, offers the
  slash-command line only when one of them declares `slashCommands`, and names
  each host's real headless binary (`omp -p`, `codex exec`, `agy --print`,
  `claude --print`). Adapters that fail to load fall back to the host name.
