// Headless invoke for the openai-compat host adapter.
//
// Unlike the claude-code / codex / gemini-cli adapters, this adapter has no
// CLI to spawn. Instead it drives the model directly via the OpenAI
// chat-completions HTTP API, using function-calling to give the model
// file I/O capability (write_file, read_file, list_files).
//
// Configuration is resolved in priority order:
//   1. .devteam/config.yml → hosts.openai-compat.*
//   2. Environment variables (OPENAI_COMPAT_BASE_URL, _API_KEY, _MODEL)
//
// Per-role model selection (config.yml):
//   hosts:
//     openai-compat:
//       base_url: https://openrouter.ai/api/v1
//       api_key_env: OPENROUTER_API_KEY     # env var holding the key
//       models:
//         default: moonshotai/kimi-k2.7-code
//         principal: deepseek/deepseek-v4-pro
//         security: deepseek/deepseek-v4-pro

const fs = require("node:fs");
const path = require("node:path");
const { gatesDir } = require("../../core/paths");
const { loadConfig } = require("../../core/config");
const { snapshotWritables, auditWrites } = require("../../core/guards/write-audit");
const { buildTools, executeTool } = require("./tools");

const MAX_TOOL_ITERATIONS = 40;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MAX_TOKENS = 16384;

// Resolve the three required config values for a given role.
function resolveConfig(ctx, role) {
  let cfg = {};
  try {
    const full = loadConfig(ctx.cwd);
    cfg = full?._raw?.hosts?.["openai-compat"] ?? {};
  } catch { /* config absent — fall back to env vars */ }

  const baseUrl =
    cfg.base_url ||
    process.env.OPENAI_COMPAT_BASE_URL ||
    "https://openrouter.ai/api/v1";

  const apiKeyEnv = cfg.api_key_env || "OPENAI_COMPAT_API_KEY";
  const apiKey = process.env[apiKeyEnv] || process.env.OPENAI_COMPAT_API_KEY;

  const models = cfg.models || {};
  const model =
    models[role] ||
    models.default ||
    process.env.OPENAI_COMPAT_MODEL;

  return { baseUrl, apiKey, model };
}

// Single HTTP call to the chat-completions endpoint.
async function callAPI(url, apiKey, model, messages, tools, timeoutMs) {
  const body = {
    model,
    messages,
    max_tokens: DEFAULT_MAX_TOKENS,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://github.com/telus-labs/stagecraft",
      "X-Title": "stagecraft/openai-compat",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "(unreadable body)");
    throw new Error(`API error ${response.status} from ${url}: ${text}`);
  }

  return response.json();
}

async function invoke(descriptor, ctx, preRenderedPrompt) {
  const role = descriptor.role;
  const { baseUrl, apiKey, model } = resolveConfig(ctx, role);

  if (!apiKey) {
    throw new Error(
      "openai-compat: no API key found. Set OPENAI_COMPAT_API_KEY (or api_key_env in " +
      ".devteam/config.yml hosts.openai-compat).",
    );
  }
  if (!model) {
    throw new Error(
      "openai-compat: no model configured. Set OPENAI_COMPAT_MODEL (or " +
      "hosts.openai-compat.models in .devteam/config.yml).",
    );
  }

  const adapter = require("./adapter");
  const prompt = preRenderedPrompt || adapter.renderStagePrompt(descriptor, ctx);
  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const timeoutMs =
    typeof ctx.timeoutMs === "number" && ctx.timeoutMs > 0
      ? ctx.timeoutMs
      : DEFAULT_TIMEOUT_MS;

  const tools = buildTools(descriptor);
  const messages = [{ role: "user", content: prompt }];

  process.stderr.write(
    `[devteam] openai-compat: ${role} → ${model} at ${baseUrl}\n`,
  );

  const beforeSnapshot = snapshotWritables(ctx.cwd);
  const start = Date.now();
  let iterations = 0;
  let lastContent = "";

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;
    let json;
    try {
      json = await callAPI(url, apiKey, model, messages, tools, timeoutMs);
    } catch (err) {
      throw new Error(`openai-compat invoke failed (iteration ${iterations}): ${err.message}`);
    }

    const choice = json.choices?.[0];
    if (!choice) throw new Error("openai-compat: API returned no choices");

    const assistantMsg = choice.message;
    messages.push(assistantMsg);

    // Stream assistant text to stdout so the user sees progress.
    if (assistantMsg.content) {
      lastContent = assistantMsg.content;
      process.stdout.write(assistantMsg.content);
      if (!assistantMsg.content.endsWith("\n")) process.stdout.write("\n");
    }

    const finishReason = choice.finish_reason;
    const toolCalls = assistantMsg.tool_calls;

    if (!toolCalls || toolCalls.length === 0 || finishReason === "stop") {
      // Model is done.
      break;
    }

    // Execute each tool call and collect results.
    const toolResults = [];
    for (const tc of toolCalls) {
      const result = executeTool(tc, ctx.cwd, descriptor.allowedWrites || []);
      const isWrite = tc.function?.name === "write_file";
      process.stderr.write(
        `[devteam] openai-compat: tool ${tc.function?.name}(${
          isWrite ? JSON.parse(tc.function.arguments || "{}").path : "..."
        }) → ${result.slice(0, 80)}\n`,
      );
      toolResults.push({
        role: "tool",
        tool_call_id: tc.id,
        content: result,
      });
    }
    messages.push(...toolResults);
  }

  if (iterations >= MAX_TOOL_ITERATIONS) {
    process.stderr.write(
      `[devteam] openai-compat: warn: hit ${MAX_TOOL_ITERATIONS}-iteration cap for ${descriptor.workstreamId}\n`,
    );
  }

  // Post-hoc write audit.
  const afterSnapshot = snapshotWritables(ctx.cwd);
  const { violations } = auditWrites(
    beforeSnapshot,
    afterSnapshot,
    descriptor.allowedWrites || [],
  );
  for (const v of violations) {
    process.stderr.write(
      `[devteam] ⛔ write-audit: unauthorized write "${v}" (not in allowedWrites for ${descriptor.workstreamId})\n`,
    );
  }

  const gatePath = path.join(
    gatesDir(ctx.cwd, ctx.changeId),
    `${descriptor.workstreamId}.json`,
  );
  const gateExists = fs.existsSync(gatePath);
  let isStub = false;
  if (gateExists) {
    try {
      const parsed = JSON.parse(fs.readFileSync(gatePath, "utf8"));
      isStub = parsed._stub === true;
    } catch { /* unreadable; treat as real gate */ }
  }

  return {
    exitCode: 0,
    gatePath: gateExists && !isStub ? gatePath : null,
    stubGate: isStub,
    logPath: null,
    durationMs: Date.now() - start,
    timedOut: false,
    writeViolations: violations,
  };
}

module.exports = { invoke, resolveConfig, callAPI };
