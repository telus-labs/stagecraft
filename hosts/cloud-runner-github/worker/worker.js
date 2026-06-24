#!/usr/bin/env node
"use strict";

// Stagecraft cloud runner worker.
// Runs inside the stagecraft-runner GitHub Actions job.
// No npm dependencies — uses only Node.js built-ins.
//
// Reads inputs from environment variables, calls the configured AI provider
// via the write_file tool, and writes result.json for artifact upload.
//
// Supported drivers (STAGECRAFT_PROVIDER_DRIVER):
//   openai-chat        — OpenAI Chat Completions API (default; also covers
//                        OpenAI-compatible proxies such as Fuelix)
//   anthropic-messages — Anthropic Messages API (direct Anthropic usage)
//
// Provider secrets referenced by the workflow YAML (never logged here):
//   STAGECRAFT_PROVIDER_ENDPOINT   — API base URL (optional; uses driver default)
//   STAGECRAFT_PROVIDER_AUTH_TOKEN — API key or bearer token
//   STAGECRAFT_PROVIDER_MODEL      — model name, e.g. claude-sonnet-4-6
//   STAGECRAFT_PROVIDER_DRIVER     — driver name (optional; defaults to openai-chat)
//   STAGECRAFT_MAX_TOKENS          — max response tokens (optional; default 8192)

const https = require("node:https");
const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");

// ---------------------------------------------------------------------------
// Helpers (defined first so fatal() is available during input parsing)
// ---------------------------------------------------------------------------

function fatal(msg) {
  process.stderr.write(`\nWorker fatal: ${msg}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Read inputs
// ---------------------------------------------------------------------------

function required(name) {
  const v = (process.env[name] || "").trim();
  if (!v) { fatal(`Missing required env var: ${name}`); }
  return v;
}

const idempotencyKey     = required("STAGECRAFT_IDEMPOTENCY_KEY");
const promptB64          = required("STAGECRAFT_PROMPT");
const allowedWritesJSON  = required("STAGECRAFT_ALLOWED_WRITES");
const gatePath           = required("STAGECRAFT_GATE_PATH");
const authToken          = required("STAGECRAFT_PROVIDER_AUTH_TOKEN");
const model              = required("STAGECRAFT_PROVIDER_MODEL");
const driver             = (process.env.STAGECRAFT_PROVIDER_DRIVER || "openai-chat").trim();
const providerEndpoint   = (process.env.STAGECRAFT_PROVIDER_ENDPOINT || "").trim().replace(/\/$/, "");
const maxTokens          = parseInt((process.env.STAGECRAFT_MAX_TOKENS || "8192").trim(), 10);

const prompt = Buffer.from(promptB64, "base64").toString("utf8");

let allowedWrites;
try {
  allowedWrites = JSON.parse(allowedWritesJSON);
  if (!Array.isArray(allowedWrites)) throw new Error("expected JSON array");
} catch (e) {
  fatal(`Invalid STAGECRAFT_ALLOWED_WRITES JSON: ${e.message}`);
}

// Glob-aware allowed-write matcher. Supports * (any chars except /) and
// trailing / (directory prefix). Used for both the gate-coverage check and
// per-write authorization in buildFileEntries below.
function matchesAllowed(filePath, pattern) {
  if (pattern === filePath) return true;
  if (pattern.endsWith("/") && filePath.startsWith(pattern)) return true;
  if (pattern.includes("*")) {
    const re = new RegExp(
      "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*") + "$",
    );
    return re.test(filePath);
  }
  return false;
}

// Gate path must be reachable through allowedWrites; if not, the gate retry
// would silently discard the gate and the job would always fail.
if (!allowedWrites.some((a) => matchesAllowed(gatePath, a))) {
  fatal(`Gate path "${gatePath}" is not covered by STAGECRAFT_ALLOWED_WRITES — configuration bug`);
}

// ---------------------------------------------------------------------------
// HTTP helper (no fetch — Node 20 has it, but older runners might not)
// ---------------------------------------------------------------------------

function httpRequest(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: opts.method || "POST",
        headers: opts.headers || {},
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }),
        );
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// Retry wrapper for transient provider errors (rate-limit, gateway, network).
async function httpRequestWithRetry(url, opts = {}) {
  const RETRYABLE = new Set([429, 502, 503, 504]);
  const MAX_RETRIES = 3;
  let lastRes;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      lastRes = await httpRequest(url, opts);
    } catch (err) {
      if (attempt < MAX_RETRIES - 1) {
        const delay = 2000 * (attempt + 1);
        console.log(`Worker: network error — retrying in ${delay}ms (${attempt + 1}/${MAX_RETRIES}): ${err.message}`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
    if (!RETRYABLE.has(lastRes.status)) return lastRes;
    if (attempt < MAX_RETRIES - 1) {
      const delay = Math.min(2000 * Math.pow(2, attempt), 30000);
      console.log(`Worker: HTTP ${lastRes.status} — retrying in ${delay}ms (${attempt + 1}/${MAX_RETRIES})`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  return lastRes;
}

// ---------------------------------------------------------------------------
// Tool definition (write_file)
// ---------------------------------------------------------------------------

// Anthropic tool schema
const WRITE_FILE_ANTHROPIC = {
  name: "write_file",
  description:
    "Write a file to the output. Call this once for each file you need to create or update. " +
    "Include the full file content in the `content` field.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Relative file path (e.g. pipeline/gates/stage-01.json)" },
      content: { type: "string", description: "Complete file content as a UTF-8 string" },
    },
    required: ["path", "content"],
  },
};

// OpenAI tool schema (Chat Completions function calling)
const WRITE_FILE_OPENAI = {
  type: "function",
  function: {
    name: "write_file",
    description: WRITE_FILE_ANTHROPIC.description,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path" },
        content: { type: "string", description: "Complete file content as a UTF-8 string" },
      },
      required: ["path", "content"],
    },
  },
};

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT =
  "You are a software-engineering AI running inside a headless GitHub Actions job. " +
  "You have NO filesystem access — you cannot read, list, or stat any files. " +
  "The ONLY action available to you is the write_file tool. " +
  "All context you need is already embedded in the user message. " +
  "Any 'Read first' section in the prompt lists reference files for context; " +
  "their contents were intentionally omitted — work with what is provided. " +
  "IMPORTANT: Only call write_file for paths listed under 'Allowed writes' in the prompt. " +
  "Any write_file call to a path NOT in 'Allowed writes' is silently discarded. " +
  "Do NOT write files like 'read-request.md', 'needs-context.md', or any other file " +
  "outside the 'Allowed writes' list — they will be discarded and have no effect.";

// ---------------------------------------------------------------------------
// Shared write-collection helper
// ---------------------------------------------------------------------------

// Parse one tool call's arguments and add to allWrites if valid.
// Returns false and logs a warning if the call should be skipped.
function collectWrite(rawArgs, allWrites) {
  let args;
  try {
    args = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs;
  } catch (e) {
    console.warn(`Worker: skipping write_file — malformed arguments JSON: ${e.message}`);
    return;
  }
  if (typeof args.path !== "string" || typeof args.content !== "string") {
    console.warn(`Worker: skipping write_file — missing path or content (got path=${typeof args.path}, content=${typeof args.content})`);
    return;
  }
  console.log(`Worker: write_file → ${args.path}`);
  allWrites.push({ path: args.path, content: args.content });
}

// ---------------------------------------------------------------------------
// Gate retry helper (shared by both drivers)
//
// Called after the main loop exits when the gate file is still missing.
// Makes one dedicated API call asking for the gate. Wrapped in try-catch so
// errors here do not crash the job — gate synthesis in main() handles the
// remaining failure case.
// ---------------------------------------------------------------------------

async function attemptGateRetry(url, headers, messages, allWrites) {
  console.log(`Worker: gate file missing after main loop — attempting gate retry for ${gatePath}`);
  try {
    const res = await httpRequestWithRetry(url, {
      headers,
      body: JSON.stringify({
        model,
        max_tokens: Math.min(maxTokens, 2048),
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages,
          {
            role: "user",
            content:
              `You completed the implementation but did not write the required gate file \`${gatePath}\`. ` +
              `Call write_file with path="${gatePath}" now. ` +
              `Set status to "PASS" if all objectives were met, "FAIL" if there are blockers, ` +
              `"WARN" for minor issues, or "ESCALATE" if human judgment is needed. ` +
              `Include any blockers or warnings in the corresponding arrays.`,
          },
        ],
        tools: [WRITE_FILE_OPENAI],
        tool_choice: "required",
      }),
    });

    if (res.status >= 200 && res.status < 300) {
      const data = JSON.parse(res.body);
      const choice = data.choices && data.choices[0];
      if (choice) {
        for (const call of (choice.message.tool_calls || [])) {
          if (call.function && call.function.name === "write_file") {
            collectWrite(call.function.arguments, allWrites);
          }
        }
      }
      console.log(`Worker: gate retry complete`);
    } else {
      console.warn(`Worker: gate retry HTTP ${res.status} — will fall back to gate synthesis`);
    }
  } catch (e) {
    console.warn(`Worker: gate retry failed (${e.message}) — will fall back to gate synthesis`);
  }
}

async function attemptGateRetryAnthropic(url, headers, messages, allWrites) {
  console.log(`Worker: gate file missing after main loop — attempting gate retry for ${gatePath}`);
  try {
    const bodyObj = {
      model,
      max_tokens: Math.min(maxTokens, 2048),
      system: SYSTEM_PROMPT,
      messages: [
        ...messages,
        {
          role: "user",
          content:
            `You completed the implementation but did not write the required gate file \`${gatePath}\`. ` +
            `Call write_file with path="${gatePath}" now. ` +
            `Set status to "PASS" if all objectives were met, "FAIL" if there are blockers, ` +
            `"WARN" for minor issues, or "ESCALATE" if human judgment is needed. ` +
            `Include any blockers or warnings in the corresponding arrays.`,
        },
      ],
      tools: [WRITE_FILE_ANTHROPIC],
      tool_choice: { type: "any" },
    };

    const res = await httpRequestWithRetry(url, {
      headers,
      body: JSON.stringify(bodyObj),
    });

    if (res.status >= 200 && res.status < 300) {
      const data = JSON.parse(res.body);
      for (const block of (data.content || [])) {
        if (block.type === "tool_use" && block.name === "write_file") {
          collectWrite(block.input, allWrites);
        }
      }
      console.log(`Worker: gate retry complete`);
    } else {
      console.warn(`Worker: gate retry HTTP ${res.status} — will fall back to gate synthesis`);
    }
  } catch (e) {
    console.warn(`Worker: gate retry failed (${e.message}) — will fall back to gate synthesis`);
  }
}

// ---------------------------------------------------------------------------
// OpenAI Chat Completions driver
// ---------------------------------------------------------------------------

async function runOpenAI(initialMessages) {
  const base = providerEndpoint || "https://api.openai.com";
  const url = `${base}/v1/chat/completions`;
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${authToken}`,
  };
  const allWrites = [];
  // 15 turns: enough for up to 13 sequential file writes before the model
  // signals done. Previously 6, which matched how many files the model
  // happened to write one-at-a-time, leaving no room for the gate retry.
  const MAX_TURNS = 15;
  let messages = initialMessages;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await httpRequestWithRetry(url, {
      headers,
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        tools: [WRITE_FILE_OPENAI],
        tool_choice: "auto",
      }),
    });

    if (res.status < 200 || res.status >= 300) {
      throw new Error(`openai-chat HTTP ${res.status}: ${res.body.slice(0, 400)}`);
    }

    const data = JSON.parse(res.body);
    const choice = data.choices && data.choices[0];
    if (!choice) throw new Error("openai-chat: no choices in response");

    const msg = choice.message;
    messages = [...messages, msg];

    const toolCalls = msg.tool_calls || [];
    for (const call of toolCalls) {
      if (call.function && call.function.name === "write_file") {
        collectWrite(call.function.arguments, allWrites);
      }
    }

    if (choice.finish_reason === "length") {
      console.warn(
        "Worker: model hit max_tokens (finish_reason=length) — " +
        "output may be truncated; consider increasing STAGECRAFT_MAX_TOKENS",
      );
    }

    if (choice.finish_reason !== "tool_calls" || toolCalls.length === 0) {
      break;
    }

    // Send tool results so the model can continue writing
    messages = [
      ...messages,
      ...toolCalls.map((call) => ({
        role: "tool",
        tool_call_id: call.id,
        content: "ok",
      })),
    ];
  }

  // Gate retry: if the gate is still missing after the main loop, make one
  // dedicated API call. Outside the main loop so it never competes for turn
  // budget, and wrapped in try-catch so errors fall through to gate synthesis.
  if (gatePath && !allWrites.some((w) => w.path === gatePath)) {
    await attemptGateRetry(url, headers, messages, allWrites);
  }

  return allWrites;
}

// ---------------------------------------------------------------------------
// Anthropic Messages driver
// ---------------------------------------------------------------------------

async function runAnthropic(initialMessages) {
  const base = providerEndpoint || "https://api.anthropic.com";
  const url = `${base}/v1/messages`;
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": authToken,
    "anthropic-version": "2023-06-01",
  };
  const allWrites = [];
  const MAX_TURNS = 15;
  let messages = initialMessages;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await httpRequestWithRetry(url, {
      headers,
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: SYSTEM_PROMPT,
        messages,
        tools: [WRITE_FILE_ANTHROPIC],
      }),
    });

    if (res.status < 200 || res.status >= 300) {
      throw new Error(`anthropic-messages HTTP ${res.status}: ${res.body.slice(0, 400)}`);
    }

    const data = JSON.parse(res.body);
    const content = data.content || [];

    const toolUseBlocks = content.filter((b) => b.type === "tool_use" && b.name === "write_file");
    for (const block of toolUseBlocks) {
      collectWrite(block.input, allWrites);
    }

    if (data.stop_reason === "max_tokens") {
      console.warn(
        "Worker: model hit max_tokens (stop_reason=max_tokens) — " +
        "output may be truncated; consider increasing STAGECRAFT_MAX_TOKENS",
      );
    }

    if (data.stop_reason !== "tool_use" || toolUseBlocks.length === 0) {
      break;
    }

    // Send tool results so the model can continue writing
    messages = [
      ...messages,
      { role: "assistant", content },
      {
        role: "user",
        content: toolUseBlocks.map((b) => ({
          type: "tool_result",
          tool_use_id: b.id,
          content: "ok",
        })),
      },
    ];
  }

  // Gate retry: dedicated call outside the main loop with error handling.
  if (gatePath && !allWrites.some((w) => w.path === gatePath)) {
    await attemptGateRetryAnthropic(url, headers, messages, allWrites);
  }

  return allWrites;
}

// ---------------------------------------------------------------------------
// Validate and encode writes
// ---------------------------------------------------------------------------

function buildFileEntries(writes) {
  const seen = new Map();

  for (const w of writes) {
    if (!allowedWrites.some((a) => matchesAllowed(w.path, a))) {
      // Warn but do not fail — the model sometimes writes extra files (e.g. read-request.md).
      // The gate-present check below will still fail the job if nothing useful was written.
      console.warn(`Worker: unauthorized write discarded: ${w.path}`);
      continue;
    }
    seen.set(w.path, w.content);  // last write wins across multi-turn
  }

  return [...seen.entries()].map(([p, content]) => {
    const buf = Buffer.from(content, "utf8");
    const hash = crypto.createHash("sha256").update(buf).digest("hex");
    return { path: p, sha256: hash, contentBase64: buf.toString("base64") };
  });
}

// ---------------------------------------------------------------------------
// result.json writer
// ---------------------------------------------------------------------------

function writeResult(exitCode, durationMs, files) {
  const result = { schema: "1", idempotencyKey, exitCode, durationMs, files };
  fs.writeFileSync("result.json", JSON.stringify(result, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startMs = Date.now();

  console.log(`Stagecraft worker — stage=${process.env.STAGECRAFT_STAGE} driver=${driver} model=${model}`);

  let writes;
  try {
    const messages = [{ role: "user", content: prompt }];
    if (driver === "anthropic-messages") {
      writes = await runAnthropic(messages);
    } else {
      writes = await runOpenAI(messages);
    }
  } catch (err) {
    console.error(`Worker: API call failed — ${err.message}`);
    writeResult(1, Date.now() - startMs, []);
    process.exit(1);
  }

  console.log(`Worker: model returned ${writes.length} write_file call(s)`);

  let files;
  try {
    files = buildFileEntries(writes);
  } catch (err) {
    console.error(`Worker: buildFileEntries failed — ${err.message}`);
    writeResult(1, Date.now() - startMs, []);
    process.exit(1);
  }

  // Gate synthesis: if the gate is still missing after the main loop and gate
  // retry, synthesize a WARN gate when implementation files were written.
  // This prevents the job from failing when the model did useful work but
  // forgot the gate (a consistent model behaviour with certain providers).
  // The validator auto-injects orchestrator; track is warn-only (not required).
  const missingGate = gatePath && !files.find((f) => f.path === gatePath);
  if (missingGate) {
    if (files.length > 0) {
      const stage = (process.env.STAGECRAFT_STAGE || "").trim();
      const workstreamId = (process.env.STAGECRAFT_WORKSTREAM_ID || "").trim();
      const workstream = workstreamId.includes(".")
        ? workstreamId.slice(workstreamId.indexOf(".") + 1)
        : workstreamId;
      const synthetic = {
        stage,
        workstream,
        status: "WARN",
        timestamp: new Date().toISOString(),
        blockers: [],
        warnings: [
          `gate not written by remote model — synthesized by cloud runner; ` +
          `${files.length} implementation file(s) were written`,
        ],
      };
      const gateBuf = Buffer.from(JSON.stringify(synthetic, null, 2), "utf8");
      const gateHash = crypto.createHash("sha256").update(gateBuf).digest("hex");
      files.push({ path: gatePath, sha256: gateHash, contentBase64: gateBuf.toString("base64") });
      console.warn(
        `Worker: synthesized WARN gate at ${gatePath} ` +
        `(model wrote ${files.length - 1} implementation file(s) but no gate)`,
      );
    } else {
      console.error(`Worker: model wrote no files and no gate — ${gatePath}`);
      writeResult(1, Date.now() - startMs, files);
      process.exit(1);
    }
  }

  writeResult(0, Date.now() - startMs, files);
  console.log(`Worker: done. ${files.length} file(s) in result.json (${Date.now() - startMs} ms)`);
}

main().catch((err) => {
  process.stderr.write(`\nWorker uncaught: ${err.stack || err.message}\n`);
  // Best-effort result.json so the adapter gets a structured failure instead of "artifact missing"
  try { writeResult(1, 0, []); } catch (_) { /* ignore */ }
  process.exit(1);
});
