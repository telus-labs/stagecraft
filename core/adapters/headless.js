// Shared headless-invoke helper.
//
// Adapters whose host has capabilities.headless = true can wire their
// invoke() to runHeadless(adapter, descriptor, ctx). The helper:
//   1. Resolves capabilities.headlessCommand (e.g. "claude --print")
//   2. Renders the stage prompt via adapter.renderStagePrompt
//   3. Spawns the headless command; pipes the prompt to stdin
//   4. Streams stdout/stderr to the caller's terminal
//   5. Awaits exit (with a timeout), then checks
//      pipeline/gates/<workstreamId>.json
//   6. Returns { exitCode, gatePath, durationMs, timedOut }
//
// The DEVTEAM_HEADLESS_COMMAND env var overrides the adapter's
// declared headlessCommand. Useful for stubbing in tests (set to
// "cat" to just echo the prompt) and for users who alias the host CLI.
//
// Timeout: ctx.timeoutMs caps the child's wall-clock. Default 10 min
// (600_000 ms). Pass 0 (or any non-positive number) for no timeout.
// On timeout, the child is SIGTERM'd and the returned exitCode is
// null with timedOut: true.

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

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
  const gatePath = path.join(ctx.cwd, "pipeline", "gates", `${descriptor.workstreamId}.json`);
  const [bin, ...args] = cmdString.split(/\s+/);
  const start = Date.now();
  const timeoutMs = typeof ctx.timeoutMs === "number" ? ctx.timeoutMs : DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: ctx.cwd,
      stdio: ["pipe", "inherit", "inherit"],
    });

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
      reject(new Error(
        `headless invoke failed to spawn "${bin}": ${err.message}. Is ${bin} installed and on PATH?`,
      ));
    });
    child.stdin.on("error", () => { /* swallow EPIPE when child exits early */ });
    child.stdin.write(prompt);
    child.stdin.end();
    child.on("close", (exitCode) => {
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: timedOut ? null : exitCode,
        gatePath: fs.existsSync(gatePath) ? gatePath : null,
        durationMs: Date.now() - start,
        timedOut,
      });
    });
  });
}

module.exports = { runHeadless, DEFAULT_TIMEOUT_MS };
