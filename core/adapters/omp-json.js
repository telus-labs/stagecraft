// Incremental parser for `omp -p --mode json` (Oh My Pi, hosts/omp).
//
// Feeds raw stdout chunks in and returns readable text to tee into the
// transcript log — never the raw JSONL. Also accumulates per-message usage
// into one orchestrator-observed telemetry record.
//
// omp --mode json event shapes (omp 18.1.10, observed from live
// invocations: an error turn for the envelope and field names, then a
// real stage-01 dispatch — 19 tool calls, 2m08s — that produced
// tokens_in 583,393 / tokens_out 8,337 with the summation rule below,
// consistent with ~20 model calls each re-sending a 25–35K context and
// no double counting from turn_end/agent_end):
//   {"type":"agent_start"}
//   {"type":"turn_start"}
//   {"type":"message_start","message":{...}}
//   {"type":"message_update","message":{...}}          (streaming deltas)
//   {"type":"tool_execution_start","toolName":"bash",...}
//   {"type":"tool_execution_end",...}
//   {"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"..."}],
//        "api":"...","provider":"fuelix","model":"claude-sonnet-5",
//        "usage":{"input":N,"output":N,"cacheRead":N,"cacheWrite":N,"totalTokens":N,
//                 "cost":{"input":$,"output":$,"cacheRead":$,"cacheWrite":$,"total":$}},
//        "stopReason":"stop|toolUse|error","errorMessage":"..."}}
//   {"type":"turn_end","message":{...same assistant message...},"toolResults":[...]}
//   {"type":"agent_end","messages":[...every message in the run...],"isTerminal":true}
//
// Usage rule: one `message_end` per assistant message, each carrying that
// call's own usage, so the run total is the SUM over assistant
// `message_end` events (a tool-using step is several model calls).
// `turn_end` repeats the same message and `agent_end` repeats every
// message, so neither is counted — except as a fallback when no
// `message_end` was seen at all (older/newer omp that only emits the
// terminal frame). `input` excludes cache tokens in omp's usage model
// (pi-ai convention: totalTokens = input + output + cacheRead +
// cacheWrite), hence inputAccounting "exclusive" like claude-stream-json.
//
// Degradation contract: identical to codex-exec-json.js — mode is decided
// once from the first complete line; a non-JSON first line (omp without
// --mode json, DEVTEAM_HEADLESS_COMMAND=cat in tests, any wrapper that
// prints a banner first) falls back to raw passthrough and usage stays null.

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function textOf(message) {
  if (!message || !Array.isArray(message.content)) return "";
  let out = "";
  for (const block of message.content) {
    if (block && block.type === "text" && typeof block.text === "string" && block.text.length > 0) {
      out += block.text.endsWith("\n") ? block.text : `${block.text}\n`;
    }
  }
  return out;
}

function firstLine(s) {
  return String(s).split("\n").map((l) => l.trim()).find((l) => l.length > 0) || "";
}

const TOOL_ARG_KEYS = ["command", "path", "file_path", "filePath", "pattern", "glob", "query"];
const TOOL_ARG_MAX = 160;

function summarizeToolArgs(args) {
  if (!args || typeof args !== "object") return "";
  for (const key of TOOL_ARG_KEYS) {
    const v = args[key];
    if (typeof v === "string" && v.trim().length > 0) {
      const oneLine = v.replace(/\s+/g, " ").trim();
      return oneLine.length > TOOL_ARG_MAX ? `${oneLine.slice(0, TOOL_ARG_MAX - 1)}…` : oneLine;
    }
  }
  return "";
}

function createOmpJsonExtractor() {
  let buffer = "";
  let mode = null; // null (undetermined) | "json" | "raw"
  let sawMessageEnd = false;
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, messages: 0 };
  let model = null;
  let provider = null;

  function addUsage(message) {
    if (!message || message.role !== "assistant" || !message.usage || typeof message.usage !== "object") return;
    const u = message.usage;
    const input = num(u.input);
    const output = num(u.output);
    const cacheRead = num(u.cacheRead);
    const cacheWrite = num(u.cacheWrite);
    if (input + output + cacheRead + cacheWrite === 0) return; // error turn / nothing billed
    totals.input += input;
    totals.output += output;
    totals.cacheRead += cacheRead;
    totals.cacheWrite += cacheWrite;
    totals.cost += u.cost && typeof u.cost === "object" ? num(u.cost.total) : 0;
    totals.messages += 1;
    if (typeof message.model === "string" && message.model) model = message.model;
    if (typeof message.provider === "string" && message.provider) provider = message.provider;
  }

  function textForJsonLine(line) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      return ""; // one malformed line in an otherwise-JSON stream; skip it
    }
    if (!obj || typeof obj !== "object") return "";
    switch (obj.type) {
      case "message_end": {
        const m = obj.message;
        if (!m || m.role !== "assistant") return "";
        sawMessageEnd = true;
        addUsage(m);
        let out = textOf(m);
        if (m.stopReason === "error" && m.errorMessage) {
          out += `[omp error] ${firstLine(m.errorMessage)}\n`;
        }
        return out;
      }
      case "tool_execution_start": {
        // omp emits { type, toolCallId, toolName, args } (event-controller.ts
        // #handleToolExecutionStart). Show what the tool was asked to do —
        // the bash command, or the path/pattern — so a transcript explains a
        // slow or timed-out dispatch instead of listing bare tool names.
        const name = typeof obj.toolName === "string" ? obj.toolName
          : obj.toolCall && typeof obj.toolCall.name === "string" ? obj.toolCall.name
            : null;
        if (!name) return "";
        const summary = summarizeToolArgs(obj.args !== undefined ? obj.args : obj.toolCall && obj.toolCall.arguments);
        return summary ? `[tool ${name}] ${summary}\n` : `[tool ${name}]\n`;
      }
      case "agent_end": {
        if (!sawMessageEnd && Array.isArray(obj.messages)) {
          for (const m of obj.messages) addUsage(m);
        }
        return "";
      }
      default:
        return ""; // agent_start/turn_start/message_start/message_update/turn_end/tool_execution_end/…
    }
  }

  function consumeCompleteLines(lines) {
    let out = "";
    for (const line of lines) {
      if (line.length === 0) continue;
      out += textForJsonLine(line);
    }
    return out;
  }

  return {
    push(chunk) {
      buffer += chunk.toString("utf8");
      if (mode === "raw") {
        const out = buffer;
        buffer = "";
        return out;
      }
      const lines = buffer.split("\n");
      buffer = lines.pop(); // last element may be an incomplete line
      if (mode === null) {
        if (lines.length === 0) return ""; // no complete line yet — keep buffering
        let obj;
        try {
          obj = JSON.parse(lines[0]);
        } catch {
          obj = undefined;
        }
        mode = obj && typeof obj === "object" ? "json" : "raw";
        if (mode === "raw") {
          const out = lines.map((l) => `${l}\n`).join("") + buffer;
          buffer = "";
          return out;
        }
      }
      return consumeCompleteLines(lines);
    },
    end() {
      if (mode !== "json") {
        const out = buffer;
        buffer = "";
        return out;
      }
      const out = buffer.length > 0 ? textForJsonLine(buffer) : "";
      buffer = "";
      return out;
    },
    // { usage: {tokensIn, tokensOut, cachedTokens?, cacheCreationTokens?, costUsd, model, provider?, inputAccounting, source} | null,
    //   telemetry: "observed" | "unavailable" }
    result() {
      if (totals.messages === 0) return { usage: null, telemetry: "unavailable" };
      const usage = {
        tokensIn: totals.input,
        tokensOut: totals.output,
        ...(totals.cacheRead > 0 ? { cachedTokens: totals.cacheRead } : {}),
        ...(totals.cacheWrite > 0 ? { cacheCreationTokens: totals.cacheWrite } : {}),
        costUsd: totals.cost > 0 ? totals.cost : null,
        model,
        ...(provider ? { provider } : {}),
        inputAccounting: "exclusive",
        source: "omp:json",
      };
      return { usage, telemetry: "observed" };
    },
  };
}

module.exports = { createOmpJsonExtractor, summarizeToolArgs };
