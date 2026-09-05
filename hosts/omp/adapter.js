// Oh My Pi (OMP) host adapter.
//
// OMP (binary: `omp`, https://github.com/can1357/oh-my-pi) is a fork of
// Mario Zechner's pi coding agent with in-process tools and 60+ model
// providers behind one CLI. Confirmed against a live `omp --help`
// (v18.1.10) and real dispatches: `-p` reads the prompt from stdin and
// exits, and `--mode json` emits the NDJSON event stream that
// core/adapters/omp-json.js parses for usage.
//
// install: copies roles/*.md verbatim into <target>/.omp/prompts/roles/
//          (omp consumes plain markdown — no frontmatter, same as codex),
//          renders rules/*.md into <target>/.devteam/rules/ to satisfy
//          "Read first" references, copies skills/*/SKILL.md to
//          <target>/.omp/skills/<name>/ — omp's native provider discovers
//          project skills one level under `.omp/skills/`, so these double
//          as real omp skills (docs/skills.md in the omp repo) — and writes
//          the dispatch config overlay (see below).
// renderStagePrompt: emits an omp-idiomatic prompt that points at the
//          installed role prompt and inlines the gate skeleton, plus the
//          host notes declared in capabilities.json.
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
//   --config .devteam/omp/dispatch.yml
//                       per-run settings overlay written by install() (omp
//                       hard-errors "Config overlay not found" if it is
//                       missing, so status() checks for it). Today it caps
//                       any single tool call at 120 s. It exists because a
//                       real QA dispatch timed out at 600 s starting a
//                       server in the foreground ten times — omp only
//                       auto-backgrounds a command after 60 s — and the
//                       overlay is where such host-side guards live
//                       without touching the operator's own omp config.
//   --tools …           read/write/edit/ast_edit/grep/glob/bash/lsp/todo:
//                       files, search, shell, diagnostics, and a scratch
//                       todo list. Excludes task/hub (subagents), ask
//                       (interactive), eval (bypasses bash policy),
//                       browser/computer/web_search/memory tools.

const fs = require("node:fs");
const path = require("node:path");
const capabilities = require("./capabilities.json");
const { runHeadless } = require("../../core/adapters/headless");
const { makeMarkdownHostAdapter } = require("../../core/adapters/markdown-host");

const base = makeMarkdownHostAdapter(capabilities);

const DISPATCH_CONFIG_REL = capabilities.dispatchConfigPath;
const DISPATCH_CONFIG_BODY = [
  "# Stagecraft dispatch overlay for Oh My Pi.",
  "# Loaded on every headless dispatch via `--config` (see hosts/omp/capabilities.json).",
  "# Written by `devteam init --host omp`; edit freely — `devteam init --force` resets it.",
  "# Keys are omp settings (docs/settings.md in the omp repo) and deep-merge over",
  "# your global ~/.omp/agent/config.yml and this project's .omp/config.yml.",
  "tools:",
  "  maxTimeout: 120   # no single tool call may run longer than 2 minutes",
  "",
].join("\n");

function dispatchConfigAbs(targetDir) {
  return path.join(targetDir, DISPATCH_CONFIG_REL);
}

function install(targetDir, opts = {}) {
  const result = base.install(targetDir, opts);
  const dest = dispatchConfigAbs(targetDir);
  if (fs.existsSync(dest) && !opts.force) {
    result.skipped.push(dest);
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, DISPATCH_CONFIG_BODY, "utf8");
    result.written.push(dest);
  }
  return result;
}

function uninstall(targetDir) {
  base.uninstall(targetDir);
  const dest = dispatchConfigAbs(targetDir);
  try { fs.unlinkSync(dest); } catch { /* already gone */ }
  try { fs.rmdirSync(path.dirname(dest)); } catch { /* not empty or already gone */ }
}

function status(targetDir) {
  const result = base.status(targetDir);
  const dest = dispatchConfigAbs(targetDir);
  if (!fs.existsSync(dest)) {
    result.missing.push(dest);
    result.ok = false;
    result.notes = [];
  } else if (fs.statSync(dest).size === 0) {
    result.stale.push(dest);
    result.ok = false;
    result.notes = [];
  }
  return result;
}

function invoke(descriptor, ctx, preRenderedPrompt) {
  return runHeadless(module.exports, descriptor, ctx, preRenderedPrompt);
}

module.exports = {
  capabilities,
  install,
  uninstall,
  status,
  renderStagePrompt: base.renderStagePrompt,
  renderStagePromptLayers: base.renderStagePromptLayers,
  invoke,
  DISPATCH_CONFIG_BODY,
};
