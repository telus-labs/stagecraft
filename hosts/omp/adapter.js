// Oh My Pi (OMP) host adapter.
//
// OMP (binary: `omp`, https://github.com/can1357/oh-my-pi) is a fork of
// Mario Zechner's pi coding agent with in-process tools and 60+ model
// providers behind one CLI. Confirmed against a live `omp --help`
// (v18.1.10) and two `omp -p` dispatches: `-p` reads the prompt from
// stdin and exits, and `--mode json` emits the NDJSON event stream that
// core/adapters/omp-json.js parses for usage.
//
// install: copies roles/*.md verbatim into <target>/.omp/prompts/roles/
//          (omp consumes plain markdown — no frontmatter, same as codex),
//          renders rules/*.md into <target>/.devteam/rules/ to satisfy
//          "Read first" references, and copies skills/*/SKILL.md to
//          <target>/.omp/skills/<name>/ — omp's native provider discovers
//          project skills one level under `.omp/skills/`, so these double
//          as real omp skills (docs/skills.md in the omp repo).
// renderStagePrompt: emits an omp-idiomatic prompt that points at the
//          installed role prompt and inlines the gate skeleton.
// status:  verifies installed files exist and are non-empty.
// uninstall: removes the files install() laid down.
//
// Capability deltas vs claude-code:
//   - no hooks (wired)  → enforcement of allowed_writes/stoplist is
//                         post-hoc-audit / prompt-only. omp does have a
//                         blocking pre-tool `tool_call` hook
//                         (.omp/hooks/pre/*.ts, returns {block, reason});
//                         Stagecraft does not lay one down yet, so the
//                         capability stays false until it does.
//   - no subagents      → orchestrator runs each workstream as its own
//                         omp session. omp's own `task`/`hub` subagent
//                         tools are deliberately left out of --tools so a
//                         stage dispatch does not spawn a second team.
//   - no slash commands → users invoke `devteam` from the terminal
//   - headless: true    → `omp -p --mode json --no-session …` drives this
//                         non-interactively; DEVTEAM_HEADLESS_COMMAND
//                         overrides the whole command string.
//
// Headless command choices (see capabilities.json):
//   --no-session        no transcript written to ~/.omp; Stagecraft owns
//                       the run log
//   --no-extensions     the operator's global TypeScript extensions do not
//                       run inside a dispatch; explicit --hook paths still
//                       load, which is how enforcement will be added later
//   --approval-mode yolo  omp's default anyway; stated so a project-level
//                       .omp/config.yml cannot flip a headless dispatch
//                       into a prompt that nobody is there to answer
//   --tools …           read/write/edit/grep/glob/bash/lsp/todo: files,
//                       search, shell, diagnostics, and a scratch todo
//                       list. Excludes task/hub (subagents), ask
//                       (interactive), eval (bypasses bash policy),
//                       browser/computer/web_search/memory tools.

const capabilities = require("./capabilities.json");
const { runHeadless } = require("../../core/adapters/headless");
const { makeMarkdownHostAdapter } = require("../../core/adapters/markdown-host");

const { install, uninstall, status, renderStagePrompt, renderStagePromptLayers } = makeMarkdownHostAdapter(capabilities);

function invoke(descriptor, ctx, preRenderedPrompt) {
  return runHeadless(module.exports, descriptor, ctx, preRenderedPrompt);
}

module.exports = {
  capabilities,
  install,
  uninstall,
  status,
  renderStagePrompt,
  renderStagePromptLayers,
  invoke,
};
