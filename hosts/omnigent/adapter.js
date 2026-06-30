// Omnigent host adapter.
//
// Omnigent is a meta-harness, so Stagecraft treats it as a host runtime:
// Stagecraft still owns stages, gates, routing, and post-hoc validation;
// Omnigent owns the underlying model/harness session for one workstream.

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const capabilities = require("./capabilities.json");
const { makeMarkdownHostAdapter } = require("../../core/adapters/markdown-host");
const { splitCommand } = require("../../core/command-line");
const { loadConfig } = require("../../core/config");
const { gatesDir, logsDir, pipelineRoot } = require("../../core/paths");
const { snapshotWritables, auditWrites } = require("../../core/guards/write-audit");
const { terminateChild } = require("../../core/process-kill");
const {
  createTranscriptWriter,
  rotateLog,
  DEFAULT_TIMEOUT_MS,
} = require("../../core/adapters/headless");

const shared = makeMarkdownHostAdapter(capabilities);
const AGENT_SPEC_REL = capabilities.agentSpec;
const DEFAULT_SESSION_MODE = "no-session";

function agentSpecText() {
  return [
    "spec_version: 1",
    "name: stagecraft_workstream",
    "description: >-",
    "  Stagecraft workstream executor. Stagecraft supplies the per-stage prompt,",
    "  owns gate validation, and audits filesystem writes after this Omnigent",
    "  session exits.",
    "",
    "executor:",
    "  harness: codex",
    "",
    "prompt: |",
    "  You are executing a single Stagecraft workstream.",
    "  Follow the user prompt exactly. Read the referenced role prompt before",
    "  acting, write only the requested artifact and gate paths, and finish only",
    "  after the gate JSON exists at the exact path named in the prompt.",
    "",
    "# Operators may override harness/model/session launch settings through",
    "# .devteam/config.yml hosts.omnigent, or set DEVTEAM_HEADLESS_COMMAND for",
    "# one emergency run. The installed default favors the Codex harness because",
    "# it carries its own coding tools.",
    "",
  ].join("\n");
}

function installAgentSpec(targetDir, opts = {}) {
  const dest = path.join(targetDir, AGENT_SPEC_REL);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest) && !opts.force) {
    return { written: [], skipped: [dest], warnings: [] };
  }
  fs.writeFileSync(dest, agentSpecText(), "utf8");
  return { written: [dest], skipped: [], warnings: [] };
}

function install(targetDir, opts = {}) {
  const base = shared.install(targetDir, opts);
  const spec = installAgentSpec(targetDir, opts);
  return {
    written: [...base.written, ...spec.written],
    skipped: [...base.skipped, ...spec.skipped],
    warnings: [...base.warnings, ...spec.warnings],
  };
}

function status(targetDir) {
  const base = shared.status(targetDir);
  const missing = [...base.missing];
  const stale = [...base.stale];
  const spec = path.join(targetDir, AGENT_SPEC_REL);
  if (!fs.existsSync(spec)) missing.push(spec);
  else if (fs.statSync(spec).size === 0) stale.push(spec);
  return {
    ok: missing.length === 0 && stale.length === 0,
    missing,
    stale,
    notes: missing.length === 0 && stale.length === 0
      ? ["omnigent install looks healthy"]
      : [],
  };
}

function uninstall(targetDir) {
  shared.uninstall(targetDir);
  const spec = path.join(targetDir, AGENT_SPEC_REL);
  if (fs.existsSync(spec)) fs.unlinkSync(spec);
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeExtraArgs(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error("hosts.omnigent.extra_args must be an array of strings");
  }
  const forbidden = new Set(["-p", "--prompt", "--prompt-file"]);
  return value.map((arg, idx) => {
    if (typeof arg !== "string" || arg.length === 0) {
      throw new Error(`hosts.omnigent.extra_args[${idx}] must be a non-empty string`);
    }
    if (forbidden.has(arg)) {
      throw new Error(`hosts.omnigent.extra_args[${idx}] cannot override Stagecraft prompt transport`);
    }
    return arg;
  });
}

function resolveLaunchProfile(ctx = {}) {
  let raw = {};
  try {
    raw = loadConfig(ctx.cwd || process.cwd())?._raw?.hosts?.omnigent || {};
  } catch {
    raw = {};
  }
  const sessionMode = optionalString(raw.session_mode) ||
    (raw.no_session === false ? "session" : DEFAULT_SESSION_MODE);
  const allowedSessionModes = new Set(["no-session", "session", "resume"]);
  if (!allowedSessionModes.has(sessionMode)) {
    throw new Error(
      `hosts.omnigent.session_mode must be one of: ${[...allowedSessionModes].join(", ")}`,
    );
  }
  return {
    agentSpecPath: optionalString(raw.agent_spec_path) ||
      optionalString(raw.agent_spec) ||
      AGENT_SPEC_REL,
    harness: optionalString(raw.harness),
    model: optionalString(raw.model),
    serverUrl: optionalString(raw.server_url),
    sessionMode,
    sessionId: optionalString(raw.session_id),
    extraArgs: safeExtraArgs(raw.extra_args),
  };
}

function buildOmnigentCommandFromProfile(profile = resolveLaunchProfile()) {
  const args = ["run", profile.agentSpecPath || AGENT_SPEC_REL];
  if (profile.harness) args.push("--harness", profile.harness);
  if (profile.model) args.push("--model", profile.model);
  if (profile.serverUrl) args.push("--server-url", profile.serverUrl);
  if (profile.sessionMode === "no-session") args.push("--no-session");
  if (profile.sessionMode === "resume") {
    if (!profile.sessionId) {
      throw new Error("hosts.omnigent.session_id is required when session_mode is resume");
    }
    args.push("--session", profile.sessionId);
  }
  args.push(...(profile.extraArgs || []));
  return { bin: "omnigent", args, displayCommand: ["omnigent", ...args].join(" ") };
}

function buildOmnigentArgs(cmdString, prompt) {
  const { bin, args } = splitCommand(cmdString, "headlessCommand");
  return { bin, args: [...args, "-p", prompt] };
}

function buildOmnigentInvocation(prompt, ctx = {}) {
  if (process.env.DEVTEAM_HEADLESS_COMMAND) {
    const cmdString = process.env.DEVTEAM_HEADLESS_COMMAND;
    return {
      ...buildOmnigentArgs(cmdString, prompt),
      displayCommand: `${cmdString} -p <stage-prompt>`,
      source: "env",
    };
  }
  const profile = resolveLaunchProfile(ctx);
  const command = buildOmnigentCommandFromProfile(profile);
  return {
    bin: command.bin,
    args: [...command.args, "-p", prompt],
    displayCommand: `${command.displayCommand} -p <stage-prompt>`,
    source: "config",
    profile,
  };
}

function isOrchestratorWrite(ctx, relPath) {
  const relPipelineRoot = path.relative(ctx.cwd, pipelineRoot(ctx.cwd, ctx.changeId)).replace(/\\/g, "/");
  const relLogsDir = path.relative(ctx.cwd, logsDir(ctx.cwd, ctx.changeId)).replace(/\\/g, "/");
  const normalized = relPath.replace(/\\/g, "/");
  return normalized === path.posix.join(relPipelineRoot, "run-log.jsonl") ||
    normalized === path.posix.join(relPipelineRoot, "run-state.json") ||
    normalized === path.posix.join(relPipelineRoot, "run.lock") ||
    normalized.startsWith(`${relLogsDir}/`);
}

function invoke(descriptor, ctx, preRenderedPrompt) {
  const prompt = preRenderedPrompt || shared.renderStagePrompt(descriptor, ctx);
  let bin, args, displayCommand;
  try {
    ({ bin, args, displayCommand } = buildOmnigentInvocation(prompt, ctx));
  } catch (err) {
    return Promise.reject(new Error(`invalid Omnigent launch profile: ${err.message}`));
  }

  const gatePath = path.join(gatesDir(ctx.cwd, ctx.changeId), `${descriptor.workstreamId}.json`);
  const beforeSnapshot = snapshotWritables(ctx.cwd);
  const start = Date.now();
  const timeoutMs = typeof ctx.timeoutMs === "number" ? ctx.timeoutMs : DEFAULT_TIMEOUT_MS;

  const logDisabled = process.env.DEVTEAM_NO_LOG === "1" || ctx.log === false;
  const liveTee = ctx.tee === true ||
    process.env.DEVTEAM_HEADLESS_TEE === "1" ||
    process.env.DEVTEAM_VERBOSE === "1";
  let logPath = null;
  let logWriter = null;
  let logEnded = false;
  if (!logDisabled) {
    try {
      const logsDirPath = logsDir(ctx.cwd, ctx.changeId);
      fs.mkdirSync(logsDirPath, { recursive: true });
      logPath = path.join(logsDirPath, `${descriptor.workstreamId}.log`);
      const rawHistory = process.env.DEVTEAM_LOG_HISTORY;
      const maxHistory = (rawHistory !== undefined && Number.isFinite(parseInt(rawHistory, 10)) && parseInt(rawHistory, 10) >= 0)
        ? parseInt(rawHistory, 10)
        : 3;
      rotateLog(logPath, maxHistory);
      logWriter = createTranscriptWriter(logPath, [
        `# Stage transcript: ${descriptor.workstreamId}`,
        "# Host: omnigent",
        `# Command: ${displayCommand}`,
        `# Started: ${new Date().toISOString()}`,
        "# ---",
        "",
        "",
      ].join("\n"));
    } catch {
      logPath = null;
      logWriter = null;
    }
  }

  function endLog(reason) {
    if (!logPath || logEnded) return;
    logEnded = true;
    logWriter?.end(`\n# ---\n# Ended: ${new Date().toISOString()}\n# Exit: ${reason}\n`);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: ctx.processCwd || ctx.cwd,
      stdio: logWriter !== null ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
    });

    if (logWriter !== null) {
      child.stdout.on("data", (chunk) => {
        if (liveTee) {
          try { process.stdout.write(chunk); } catch { /* closed pipe */ }
        }
        logWriter.append(chunk);
      });
      child.stderr.on("data", (chunk) => {
        if (liveTee) {
          try { process.stderr.write(chunk); } catch { /* closed pipe */ }
        }
        logWriter.append(chunk);
      });
    }

    let timedOut = false;
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        terminateChild(child, { graceMs: 5000 });
      }, timeoutMs);
      timer.unref();
    }

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      endLog(`spawn error: ${err.message}`);
      reject(new Error(
        `omnigent invoke failed to spawn "${bin}": ${err.message}. Is omnigent installed and on PATH?`,
      ));
    });

    child.on("close", (exitCode) => {
      if (timer) clearTimeout(timer);
      endLog(timedOut ? "TIMED OUT" : String(exitCode));

      let writeViolations = [];
      if (beforeSnapshot) {
        const afterSnapshot = snapshotWritables(ctx.cwd);
        const { violations } = auditWrites(beforeSnapshot, afterSnapshot, descriptor.allowedWrites || []);
        writeViolations = violations.filter((v) => !isOrchestratorWrite(ctx, v));
      }

      const gateExists = fs.existsSync(gatePath);
      let isStub = false;
      if (gateExists) {
        try {
          const parsed = JSON.parse(fs.readFileSync(gatePath, "utf8"));
          isStub = parsed._stub === true;
        } catch { /* unreadable; validator will report it */ }
      }

      resolve({
        exitCode: timedOut ? null : exitCode,
        gatePath: gateExists && !isStub ? gatePath : null,
        stubGate: isStub,
        logPath,
        durationMs: Date.now() - start,
        timedOut,
        writeViolations,
      });
    });
  });
}

module.exports = {
  capabilities,
  install,
  uninstall,
  status,
  renderStagePrompt: shared.renderStagePrompt,
  invoke,
  buildOmnigentArgs,
  buildOmnigentCommandFromProfile,
  buildOmnigentInvocation,
  resolveLaunchProfile,
  agentSpecText,
};
