// Tool definitions and executor for the openai-compat host adapter.
//
// The adapter drives the model through an agentic tool-call loop rather than
// spawning a CLI subprocess. Three tools are available to the model:
//
//   write_file   — write a file; enforces descriptor.allowedWrites at call time
//   read_file    — read a file; enforces project-root boundary
//   list_files   — list a directory; enforces project-root boundary
//
// Shell (Bash) is intentionally absent: openai-compat capabilities declare
// shell: false. Stages that require lint/test execution (platform pre-review,
// deploy) should route to claude-code, codex, or gemini-cli instead.

const fs = require("node:fs");
const path = require("node:path");
const { isAllowed } = require("../../core/guards/write-audit");

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

// Build the tool list for a given descriptor. The set respects the role's
// toolBudget: Read → read_file + list_files; Write → write_file.
// Glob is treated as an alias for list_files (already included via Read).
function buildTools(descriptor) {
  const budget = descriptor.toolBudget;
  if (!budget || budget.length === 0) {
    // No declared budget → offer the full set (advisory host, prompt-only enforcement).
    return [WRITE_FILE, READ_FILE, LIST_FILES];
  }
  const tools = [];
  const hasRead = budget.includes("Read") || budget.includes("Glob");
  const hasWrite = budget.includes("Write");
  if (hasRead) { tools.push(READ_FILE); tools.push(LIST_FILES); }
  if (hasWrite) tools.push(WRITE_FILE);
  // Always offer write_file for artifact + gate production, even for read-mostly
  // roles such as reviewer/security/red-team, so they can at least write their
  // gate JSON. Without this, the pipeline can never advance.
  if (!tools.includes(WRITE_FILE)) tools.push(WRITE_FILE);
  return tools;
}

// --- Tool executor -------------------------------------------------------

// Resolve a model-supplied relative path safely inside cwd.
// Returns null (and an error string) if the path would escape the project root.
function resolveSafe(cwd, relPath) {
  const resolved = path.resolve(cwd, relPath);
  if (!resolved.startsWith(path.resolve(cwd))) {
    return { resolved: null, error: `path escapes project root: ${relPath}` };
  }
  return { resolved, error: null };
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
      return `error: write denied — "${args.path}" is not in allowedWrites. ` +
             `Permitted paths: ${(allowedWrites || []).join(", ")}`;
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

  return `error: unknown tool "${name}"`;
}

module.exports = { buildTools, executeTool, WRITE_FILE, READ_FILE, LIST_FILES };
