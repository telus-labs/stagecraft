// core/adapters/omp-json.js — unit tests for the incremental
// `omp -p --mode json` extractor (hosts/omp).

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { REPO_ROOT } = require("./_helpers");
const { createOmpJsonExtractor, summarizeToolArgs } = require(path.join(REPO_ROOT, "core", "adapters", "omp-json"));

function line(obj) {
  return `${JSON.stringify(obj)}\n`;
}

function assistant(text, usage, extra = {}) {
  return {
    role: "assistant",
    content: text === null ? [] : [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "anthropic",
    model: "claude-sonnet-5",
    usage: {
      input: usage.input, output: usage.output,
      cacheRead: usage.cacheRead || 0, cacheWrite: usage.cacheWrite || 0,
      totalTokens: usage.input + usage.output + (usage.cacheRead || 0) + (usage.cacheWrite || 0),
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: usage.cost || 0 },
    },
    stopReason: "stop",
    timestamp: 1,
    ...extra,
  };
}

describe("createOmpJsonExtractor — JSON mode", () => {
  it("emits assistant text blocks and skips lifecycle/streaming noise", () => {
    const ex = createOmpJsonExtractor();
    let out = "";
    out += ex.push(line({ type: "agent_start" }));
    out += ex.push(line({ type: "turn_start" }));
    out += ex.push(line({ type: "message_start", message: { role: "assistant", content: [] } }));
    out += ex.push(line({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "Hel" }] } }));
    out += ex.push(line({ type: "message_end", message: assistant("Hello", { input: 10, output: 2 }) }));
    out += ex.push(line({ type: "turn_end", message: assistant("Hello", { input: 10, output: 2 }), toolResults: [] }));
    out += ex.push(line({ type: "agent_end", messages: [assistant("Hello", { input: 10, output: 2 })], isTerminal: true }));
    out += ex.end();
    assert.equal(out, "Hello\n");
  });

  it("ignores user-role message_end frames", () => {
    const ex = createOmpJsonExtractor();
    let out = ex.push(line({ type: "message_end", message: { role: "user", content: [{ type: "text", text: "the prompt" }] } }));
    out += ex.end();
    assert.equal(out, "");
    assert.equal(ex.result().telemetry, "unavailable");
  });

  it("sums usage across assistant message_end events (tool-using steps are several model calls)", () => {
    const ex = createOmpJsonExtractor();
    ex.push(line({ type: "message_end", message: assistant(null, { input: 100, output: 20, cacheRead: 50, cacheWrite: 10, cost: 0.01 }, { stopReason: "toolUse" }) }));
    ex.push(line({ type: "tool_execution_start", toolName: "bash", toolCallId: "t1" }));
    ex.push(line({ type: "tool_execution_end", toolCallId: "t1" }));
    ex.push(line({ type: "message_end", message: assistant("done", { input: 200, output: 30, cacheRead: 150, cost: 0.02 }) }));
    ex.push(line({ type: "turn_end", message: assistant("done", { input: 200, output: 30, cacheRead: 150, cost: 0.02 }), toolResults: [] }));
    ex.push(line({ type: "agent_end", messages: [], isTerminal: true }));
    const { usage, telemetry } = ex.result();
    assert.equal(telemetry, "observed");
    assert.deepEqual(usage, {
      tokensIn: 300,
      tokensOut: 50,
      cachedTokens: 200,
      cacheCreationTokens: 10,
      costUsd: 0.03,
      model: "claude-sonnet-5",
      provider: "anthropic",
      inputAccounting: "exclusive",
      source: "omp:json",
    });
  });

  it("names the tool in the transcript when a tool execution starts", () => {
    const ex = createOmpJsonExtractor();
    let out = ex.push(line({ type: "tool_execution_start", toolName: "edit", toolCallId: "t1" }));
    out += ex.push(line({ type: "tool_execution_start", toolCall: { name: "grep" } }));
    out += ex.end();
    assert.equal(out, "[tool edit]\n[tool grep]\n");
  });

  it("shows what the tool was asked to do: bash command, or path/pattern", () => {
    const ex = createOmpJsonExtractor();
    let out = ex.push(line({ type: "tool_execution_start", toolName: "bash", toolCallId: "t1", args: { command: "PORT=3001 node index.js &\n  sleep 1 && curl -s localhost:3001/health" } }));
    out += ex.push(line({ type: "tool_execution_start", toolName: "read", toolCallId: "t2", args: { path: "pipeline/brief.md" } }));
    out += ex.push(line({ type: "tool_execution_start", toolName: "glob", toolCallId: "t3", args: { pattern: "src/**/*.test.js" } }));
    out += ex.push(line({ type: "tool_execution_start", toolName: "todo", toolCallId: "t4", args: { items: [1, 2] } }));
    out += ex.end();
    assert.equal(out, [
      "[tool bash] PORT=3001 node index.js & sleep 1 && curl -s localhost:3001/health",
      "[tool read] pipeline/brief.md",
      "[tool glob] src/**/*.test.js",
      "[tool todo]",
      "",
    ].join("\n"));
  });

  it("truncates a long command to one line of at most 160 characters", () => {
    const long = "x".repeat(500);
    assert.equal(summarizeToolArgs({ command: long }).length, 160);
    assert.ok(summarizeToolArgs({ command: long }).endsWith("…"));
    assert.equal(summarizeToolArgs(null), "");
    assert.equal(summarizeToolArgs({ command: "   " }), "");
  });

  it("omits cache fields when zero and reports costUsd null when omp priced nothing", () => {
    const ex = createOmpJsonExtractor();
    ex.push(line({ type: "message_end", message: assistant("x", { input: 5, output: 1 }) }));
    const { usage } = ex.result();
    assert.equal("cachedTokens" in usage, false);
    assert.equal("cacheCreationTokens" in usage, false);
    assert.equal(usage.costUsd, null);
  });

  it("an error turn with all-zero usage is not counted as observed telemetry, and the error surfaces in the transcript", () => {
    const ex = createOmpJsonExtractor();
    const m = assistant(null, { input: 0, output: 0 }, {
      stopReason: "error",
      errorMessage: "401 \n {\n  \"title\": \"Unauthorized\"\n }",
    });
    let out = ex.push(line({ type: "message_end", message: m }));
    out += ex.push(line({ type: "agent_end", messages: [m], isTerminal: true }));
    out += ex.end();
    assert.equal(out, "[omp error] 401\n");
    assert.equal(ex.result().telemetry, "unavailable");
    assert.equal(ex.result().usage, null);
  });

  it("falls back to agent_end.messages when no message_end frames were seen", () => {
    const ex = createOmpJsonExtractor();
    ex.push(line({
      type: "agent_end",
      messages: [
        { role: "user", content: [{ type: "text", text: "prompt" }] },
        assistant("a", { input: 7, output: 3 }),
        assistant("b", { input: 8, output: 4 }),
      ],
      isTerminal: true,
    }));
    const { usage, telemetry } = ex.result();
    assert.equal(telemetry, "observed");
    assert.equal(usage.tokensIn, 15);
    assert.equal(usage.tokensOut, 7);
  });

  it("does not double count when both message_end and agent_end carry the same messages", () => {
    const ex = createOmpJsonExtractor();
    const m = assistant("a", { input: 7, output: 3 });
    ex.push(line({ type: "message_end", message: m }));
    ex.push(line({ type: "turn_end", message: m, toolResults: [] }));
    ex.push(line({ type: "agent_end", messages: [m], isTerminal: true }));
    assert.equal(ex.result().usage.tokensIn, 7);
  });

  it("handles a JSON chunk split mid-line across multiple push() calls", () => {
    const ex = createOmpJsonExtractor();
    const full = line({ type: "message_end", message: assistant("split across chunks", { input: 1, output: 1 }) });
    const mid = Math.floor(full.length / 2);
    let out = "";
    out += ex.push(full.slice(0, mid));
    out += ex.push(full.slice(mid));
    out += ex.end();
    assert.equal(out, "split across chunks\n");
  });

  it("accepts Buffer chunks, not just strings", () => {
    const ex = createOmpJsonExtractor();
    let out = "";
    out += ex.push(Buffer.from(line({ type: "message_end", message: assistant("buffered", { input: 1, output: 1 }) }), "utf8"));
    out += ex.end();
    assert.equal(out, "buffered\n");
  });
});

describe("createOmpJsonExtractor — degradation to raw passthrough", () => {
  it("plain-text output (non-JSON first line) is passed through verbatim", () => {
    const ex = createOmpJsonExtractor();
    let out = "";
    out += ex.push("plain text line one\n");
    out += ex.push("plain text line two\n");
    out += ex.end();
    assert.equal(out, "plain text line one\nplain text line two\n");
    assert.equal(ex.result().telemetry, "unavailable");
    assert.equal(ex.result().usage, null);
  });

  it("mode decision is made once from the first complete line, not re-evaluated per line", () => {
    const ex = createOmpJsonExtractor();
    let out = "";
    out += ex.push("Working...\n");
    out += ex.push(line({ type: "message_end", message: assistant("x", { input: 1, output: 1 }) }));
    out += ex.end();
    assert.match(out, /Working\.\.\./);
    assert.match(out, /"type":"message_end"/, "raw mode must not swallow the JSON-shaped line's text");
    assert.equal(ex.result().telemetry, "unavailable");
  });

  it("empty output never crashes and reports unavailable", () => {
    const ex = createOmpJsonExtractor();
    const out = ex.end();
    assert.equal(out, "");
    assert.equal(ex.result().telemetry, "unavailable");
  });
});
