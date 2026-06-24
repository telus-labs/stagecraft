// OpenAI-compatible host adapter.
//
// Routes stagecraft roles to any OpenAI chat-completions API endpoint —
// OpenRouter, DeepSeek, Moonshot AI, Xiaomi MiMo, etc. — without requiring
// a dedicated CLI tool. Invocation is HTTP-native (httpNative: true in
// capabilities); the agentic tool-call loop lives in invoke.js.
//
// Capability deltas vs claude-code:
//   - no hooks          → gate polling is orchestrator-driven (no SubagentStop)
//   - no subagents      → each workstream dispatches sequentially in its HTTP loop
//   - no shell          → Bash-dependent stages (platform pre-review, deploy)
//                         should use claude-code, codex, or gemini-cli instead
//   - no headlessCommand → invoke() bypasses runHeadless entirely
//
// Configuration (.devteam/config.yml):
//   hosts:
//     openai-compat:
//       base_url: https://openrouter.ai/api/v1
//       api_key_env: OPENROUTER_API_KEY
//       models:
//         default: moonshotai/kimi-k2.7-code
//         principal: deepseek/deepseek-v4-pro
//         security: deepseek/deepseek-v4-pro
//         red-team: deepseek/deepseek-v4-pro
//         migrations: deepseek/deepseek-v4-pro
//         qa: qwen/qwen3.6-27b
//         verifier: xiaomimimo/mimo-v2.5-pro

const capabilities = require("./capabilities.json");
const { makeMarkdownHostAdapter } = require("../../core/adapters/markdown-host");
const { invoke } = require("./invoke");

const { install, uninstall, status, renderStagePrompt } =
  makeMarkdownHostAdapter(capabilities);

module.exports = {
  capabilities,
  install,
  uninstall,
  status,
  renderStagePrompt,
  invoke,
};
