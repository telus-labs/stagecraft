// Shared headless-invoke helper.
//
// Adapters whose host has capabilities.headless = true can wire their
// invoke() to runHeadless(adapter, descriptor, ctx). The helper:
//   1. Resolves capabilities.headlessCommand (e.g. "claude --print")
//   2. Renders the stage prompt via adapter.renderStagePrompt
//   3. Spawns the headless command; pipes the prompt to stdin
//   4. Streams stdout/stderr to the caller's terminal AND, by default,
//      tees them to pipeline/logs/<workstreamId>.log for post-hoc reading
//   5. Awaits exit (with a timeout), then checks
//      pipeline/gates/<workstreamId>.json
//   6. Returns { exitCode, gatePath, logPath, durationMs, timedOut }
//
// The DEVTEAM_HEADLESS_COMMAND env var overrides the adapter's
// declared headlessCommand. Useful for stubbing in tests (set to
// "cat" to just echo the prompt) and for users who alias the host CLI.
//
// The DEVTEAM_NO_LOG=1 env var (or ctx.log === false) disables the tee
// and reverts to inherit-style stdio. Tests that don't want log files
// scattered in tempdirs should set this.
//
// Log rotation: before each run, the existing <workstreamId>.log is rotated
// to <workstreamId>.1.log, .1.log → .2.log, and so on. The oldest slot
// (index DEVTEAM_LOG_HISTORY, default 3) is pruned. Set DEVTEAM_LOG_HISTORY=0
// to disable rotation and revert to the overwrite-on-each-run behaviour.
//
// Timeout: ctx.timeoutMs caps the child's wall-clock. Default 10 min
// (600_000 ms). Pass 0 (or any non-positive number) for no timeout.
// On timeout, the child is SIGTERM'd and the returned exitCode is
// null with timedOut: true.

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { gatesDir, logsDir } = require("../paths");
const { snapshotWritables, auditWrites } = require("../guards/write-audit");

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Rotate <logPath> before writing a new run.
// <ws>.log → <ws>.1.log, <ws>.1.log → <ws>.2.log, …, <ws>.<N>.log pruned.
// All filesystem errors are swallowed — rotation is best-effort and must
// never prevent the new log from being written.
function rotateLog(logPath, maxHistory) {
  if (maxHistory <= 0) return;
  const slot = (n) => logPath.replace(/\.log$/, `.${n}.log`);
  try { fs.unlinkSync(slot(maxHistory)); } catch { /* already gone */ }
  for (let i = maxHistory - 1; i >= 1; i--) {
    try { fs.renameSync(slot(i), slot(i + 1)); } catch { /* didn't exist */ }
  }
  try { fs.renameSync(logPath, slot(1)); } catch { /* no current log yet */ }
}

function runHeadless(adapter, descriptor, ctx, preRenderedPrompt) {
  const declared = adapter.capabilities && adapter.capabilities.headlessCommand;
  const override = process.env.DEVTEAM_HEADLESS_COMMAND;
  const cmdString = override || declared;
  if (!cmdString) {
    return Promise.reject(new Error(
      `host "${adapter.capabilities && adapter.capabilities.name}" declares no headlessCommand`,
    ));
  }

  const prompt = preRenderedPrompt || adapter.renderStagePrompt(descriptor, ctx);
  const gatePath = path.join(gatesDir(ctx.cwd, ctx.changeId), `${descriptor.workstreamId}.json`);
  // Guard: quoted segments would be mis-split by the naive whitespace split below.
  // Throw early rather than silently invoke the wrong binary (e.g. a path with spaces).
  if (/['"]/.test(cmdString)) {
    return Promise.reject(new Error(
      `headlessCommand "${cmdString}" contains quote characters. ` +
      "Stagecraft does not support shell quoting in headless commands — " +
      "use an unquoted binary name or set DEVTEAM_HEADLESS_COMMAND to a single token.",
    ));
  }
  const [bin, ...args] = cmdString.split(/\s+/);

  // C1: post-hoc write audit for adapters that declare enforces.allowed_writes = "post-hoc-audit".
  // Snapshot dirty state before spawn; diff after close to find unauthorized writes.
  const shouldAudit = adapter.capabilities?.enforces?.allowed_writes === "post-hoc-audit";
  const beforeSnapshot = shouldAudit ? snapshotWritables(ctx.cwd) : null;
  const start = Date.now();
  const timeoutMs = typeof ctx.timeoutMs === "number" ? ctx.timeoutMs : DEFAULT_TIMEOUT_MS;

  // Logging: tee stdout/stderr to pipeline/logs/<workstreamId>.log.
  // Disabled in tests + by env opt-out. When disabled we keep the
  // historical "inherit" stdio so terminal colors / TTY detection
  // in the host CLI continue to work; when enabled we pipe so we can
  // duplicate the streams.
  // Logging: buffer the host's stdout/stderr in memory and writeFileSync
  // on close. In-memory buffering avoids the close-vs-error race that
  // an async write stream would create, and synchronous flush means
  // the file is durable the instant runHeadless's promise settles.
  // Agent transcripts are typically <1 MB; memory cost is negligible.
  const logDisabled = process.env.DEVTEAM_NO_LOG === "1" || ctx.log === false;
  let logPath = null;
  let logBuffer = null;     // null when logging disabled or open failed
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
      logBuffer = [
        `# Stage transcript: ${descriptor.workstreamId}`,
        `# Host: ${adapter.capabilities && adapter.capabilities.name}`,
        `# Command: ${cmdString}`,
        `# Started: ${new Date().toISOString()}`,
        "# ---",
        "",
        "",
      ].join("\n");
    } catch {
      // Best-effort: if we can't create logs/, fall back to terminal-only.
      logPath = null;
      logBuffer = null;
    }
  }
  function appendLog(chunk) {
    if (logBuffer === null) return;
    logBuffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
  }
  // Idempotent log-flush. First caller writes the trailer and flushes
  // to disk synchronously. Subsequent calls are no-ops. Safe to call
  // from both spawn-error and close handlers.
  function endLog(reason) {
    if (!logPath || logEnded) return;
    logEnded = true;
    appendLog(`\n# ---\n# Ended: ${new Date().toISOString()}\n# Exit: ${reason}\n`);
    try { fs.writeFileSync(logPath, logBuffer); } catch { /* full disk, etc. */ }
  }

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: ctx.cwd,
      // When logging is on we read stdout/stderr ourselves to duplicate
      // them into the buffer; when off, inherit gets us the historical
      // terminal-color behavior for free.
      stdio: logBuffer !== null ? ["pipe", "pipe", "pipe"] : ["pipe", "inherit", "inherit"],
    });

    // Tee paths: write each chunk to both the caller's terminal and
    // the in-memory log buffer. Errors on stdout (closed terminal)
    // are swallowed — a closed pipe shouldn't fail the stage.
    if (logBuffer !== null) {
      child.stdout.on("data", (chunk) => {
        try { process.stdout.write(chunk); } catch { /* */ }
        appendLog(chunk);
      });
      child.stderr.on("data", (chunk) => {
        try { process.stderr.write(chunk); } catch { /* */ }
        appendLog(chunk);
      });
    }

    let timedOut = false;
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        // SIGTERM first; the host CLI gets a chance to flush.
        try { child.kill("SIGTERM"); } catch { /* already dead */ }
        // SIGKILL after a 5s grace window in case the child ignores SIGTERM.
        setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* */ } }, 5000).unref();
      }, timeoutMs);
      timer.unref();
    }

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      endLog(`spawn error: ${err.message}`);
      reject(new Error(
        `headless invoke failed to spawn "${bin}": ${err.message}. Is ${bin} installed and on PATH?`,
      ));
    });
    child.stdin.on("error", () => { /* swallow EPIPE when child exits early */ });
    child.stdin.write(prompt);
    child.stdin.end();
    child.on("close", (exitCode) => {
      if (timer) clearTimeout(timer);
      endLog(timedOut ? "TIMED OUT" : String(exitCode));

      // C1: diff the dirty-file snapshot; log violations immediately.
      let writeViolations = [];
      if (shouldAudit && beforeSnapshot) {
        const afterSnapshot = snapshotWritables(ctx.cwd);
        const { violations } = auditWrites(beforeSnapshot, afterSnapshot, descriptor.allowedWrites || []);
        writeViolations = violations;
        for (const v of violations) {
          try { process.stderr.write(`[devteam] ⛔ write-audit: unauthorized write "${v}" (not in allowedWrites for ${descriptor.workstreamId})\n`); } catch { /* */ }
        }
      }

      resolve({
        exitCode: timedOut ? null : exitCode,
        gatePath: fs.existsSync(gatePath) ? gatePath : null,
        logPath,
        durationMs: Date.now() - start,
        timedOut,
        writeViolations,
      });
    });
  });
}

module.exports = { runHeadless, rotateLog, DEFAULT_TIMEOUT_MS };
