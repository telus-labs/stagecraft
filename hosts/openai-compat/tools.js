// Tool definitions and executor for the openai-compat host adapter.
//
// The adapter drives the model through an agentic tool-call loop rather than
// spawning a CLI subprocess. Four tools are available to the model:
//
//   write_file   — write a file; enforces descriptor.allowedWrites at call time
//   read_file    — read a file; enforces project-root boundary
//   list_files   — list a directory; enforces project-root boundary
//   bash         — execute a shell command; included when role toolBudget has "Bash"

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { isAllowed } = require("../../core/guards/write-audit");

const DEFAULT_BASH_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 8 * 1024; // 8 KB per stream — keeps tool messages from bloating context

// --- Tool definitions (OpenAI function-calling schema) -------------------

const WRITE_FILE = {
  type: "function",
  function: {
    name: "write_file",
    description:
      "Write content to a file. Use this to produce pipeline artifacts and gate JSON. " +
      "Paths are relative to the project root. Only paths listed in allowedWrites are permitted.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path from the project root" },
        content: { type: "string", description: "Full file content to write" },
      },
      required: ["path", "content"],
    },
  },
};

const READ_FILE = {
  type: "function",
  function: {
    name: "read_file",
    description: "Read the content of a file. Paths are relative to the project root.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path from the project root" },
      },
      required: ["path"],
    },
  },
};

const LIST_FILES = {
  type: "function",
  function: {
    name: "list_files",
    description: "List files and subdirectories inside a directory.",
    parameters: {
      type: "object",
      properties: {
        dir: {
          type: "string",
          description: "Relative directory path from the project root. Use '.' for root.",
        },
      },
      required: ["dir"],
    },
  },
};

const BASH = {
  type: "function",
  function: {
    name: "bash",
    description:
      "Execute a shell command in the project root and return stdout, stderr, and exit code. " +
      "Use for running tests, linters, build scripts, and deploy commands. " +
      "Working directory is always the project root.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to run. Executed via `sh -c` at the project root.",
        },
        timeout_ms: {
          type: "number",
          description: "Optional timeout in milliseconds. Defaults to 60000 (60 s).",
        },
      },
      required: ["command"],
    },
  },
};

// Build the tool list for a given descriptor. The set respects the role's
// toolBudget: Read → read_file + list_files; Write → write_file; Bash → bash.
// Glob is treated as an alias for list_files (already included via Read).
function buildTools(descriptor) {
  const budget = descriptor.toolBudget;
  if (!budget || budget.length === 0) {
    // No declared budget → offer the full set (advisory host, prompt-only enforcement).
    return [WRITE_FILE, READ_FILE, LIST_FILES, BASH];
  }
  const tools = [];
  const hasRead = budget.includes("Read") || budget.includes("Glob");
  const hasWrite = budget.includes("Write");
  const hasBash = budget.includes("Bash");
  if (hasRead) { tools.push(READ_FILE); tools.push(LIST_FILES); }
  if (hasWrite) tools.push(WRITE_FILE);
  if (hasBash) tools.push(BASH);
  // Always offer write_file for artifact + gate production, even for read-mostly
  // roles such as reviewer/security/red-team, so they can at least write their
  // gate JSON. Without this, the pipeline can never advance.
  if (!tools.includes(WRITE_FILE)) tools.push(WRITE_FILE);
  return tools;
}

// --- Tool executors -------------------------------------------------------

// Resolve a model-supplied relative path safely inside cwd.
// Returns null (and an error string) if the path would escape the project root.
function resolveSafe(cwd, relPath) {
  const resolved = path.resolve(cwd, relPath);
  if (!resolved.startsWith(path.resolve(cwd))) {
    return { resolved: null, error: `path escapes project root: ${relPath}` };
  }
  return { resolved, error: null };
}

// Execute a shell command in the project root. Returns a structured string
// (exit_code / stdout / stderr) to send back as the tool message content.
function executeBash(command, cwd, timeoutMs) {
  const timeout = (typeof timeoutMs === "number" && timeoutMs > 0)
    ? timeoutMs
    : DEFAULT_BASH_TIMEOUT_MS;

  process.stderr.write(`[devteam] openai-compat: bash(${JSON.stringify(command)})\n`);

  const result = spawnSync("sh", ["-c", command], {
    cwd,
    timeout,
    encoding: "utf8",
    maxBuffer: MAX_OUTPUT_BYTES * 4,
  });

  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      return `error: command timed out after ${timeout}ms`;
    }
    return `error: failed to spawn shell: ${result.error.message}`;
  }

  const stdout = (result.stdout || "").slice(0, MAX_OUTPUT_BYTES);
  const stderr = (result.stderr || "").slice(0, MAX_OUTPUT_BYTES);
  const exitCode = result.status ?? 1;

  return [
    `exit_code: ${exitCode}`,
    stdout ? `stdout:\n${stdout}` : "stdout: (empty)",
    stderr ? `stderr:\n${stderr}` : "stderr: (empty)",
  ].join("\n");
}

// Execute a single tool call from the model. Returns a string result to send
// back as the tool message content.
function executeTool(toolCall, cwd, allowedWrites) {
  let args;
  try {
    args = typeof toolCall.function.arguments === "string"
      ? JSON.parse(toolCall.function.arguments)
      : toolCall.function.arguments;
  } catch {
    return `error: could not parse tool arguments: ${toolCall.function.arguments}`;
  }

  const name = toolCall.function.name;

  if (name === "write_file") {
    const { resolved, error } = resolveSafe(cwd, args.path);
    if (error) return `error: ${error}`;
    const rel = path.relative(cwd, resolved).replace(/\\/g, "/");
    if (!isAllowed(rel, allowedWrites)) {
      const patterns = (allowedWrites || []).join(", ");
      return (
        `error: write denied — "${args.path}" does not match any allowed-write pattern for this workstream.\n` +
        `Allowed patterns: ${patterns}\n` +
        `Note: patterns use * as a wildcard and <name> as a placeholder — ` +
        `do NOT write to a file literally named with angle brackets. ` +
        `For example, write to "pipeline/code-review/by-qa.md", not "pipeline/code-review/by-<reviewer>.md".`
      );
    }
    try {
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, args.content, "utf8");
      return `ok: wrote ${args.content.length} bytes to ${args.path}`;
    } catch (err) {
      return `error: write failed: ${err.message}`;
    }
  }

  if (name === "read_file") {
    const { resolved, error } = resolveSafe(cwd, args.path);
    if (error) return `error: ${error}`;
    try {
      return fs.readFileSync(resolved, "utf8");
    } catch (err) {
      return `error: read failed: ${err.message}`;
    }
  }

  if (name === "list_files") {
    const { resolved, error } = resolveSafe(cwd, args.dir || ".");
    if (error) return `error: ${error}`;
    try {
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      return entries
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .join("\n");
    } catch (err) {
      return `error: list failed: ${err.message}`;
    }
  }

  if (name === "bash") {
    if (!args.command || typeof args.command !== "string") {
      return "error: bash tool requires a non-empty 'command' string";
    }
    return executeBash(args.command, cwd, args.timeout_ms);
  }

  return `error: unknown tool "${name}"`;
}

module.exports = { buildTools, executeTool, executeBash, WRITE_FILE, READ_FILE, LIST_FILES, BASH };
