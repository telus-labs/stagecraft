// Shared headless-invoke helper.
//
// Adapters whose host has capabilities.headless = true can wire their
// invoke() to runHeadless(adapter, descriptor, ctx). The helper:
//   1. Resolves capabilities.headlessCommand (e.g. "claude --print")
//   2. Renders the stage prompt via adapter.renderStagePrompt
//   3. Spawns the headless command; pipes the prompt to stdin
//   4. Streams stdout/stderr to the caller's terminal
//   5. Awaits exit, then checks pipeline/gates/<workstreamId>.json
//   6. Returns { exitCode, gatePath, durationMs }
//
// The DEVTEAM_HEADLESS_COMMAND env var overrides the adapter's
// declared headlessCommand. Useful for stubbing in tests (set to
// "cat" to just echo the prompt) and for users who alias the host CLI.

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

function runHeadless(adapter, descriptor, ctx) {
  const declared = adapter.capabilities && adapter.capabilities.headlessCommand;
  const override = process.env.DEVTEAM_HEADLESS_COMMAND;
  const cmdString = override || declared;
  if (!cmdString) {
    return Promise.reject(new Error(
      `host "${adapter.capabilities && adapter.capabilities.name}" declares no headlessCommand`,
    ));
  }

  const prompt = adapter.renderStagePrompt(descriptor, ctx);
  const gatePath = path.join(ctx.cwd, "pipeline", "gates", `${descriptor.workstreamId}.json`);
  const [bin, ...args] = cmdString.split(/\s+/);
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: ctx.cwd,
      stdio: ["pipe", "inherit", "inherit"],
    });
    child.on("error", (err) => reject(new Error(
      `headless invoke failed to spawn "${bin}": ${err.message}. Is ${bin} installed and on PATH?`,
    )));
    child.stdin.on("error", () => { /* swallow EPIPE when child exits early */ });
    child.stdin.write(prompt);
    child.stdin.end();
    child.on("close", (exitCode) => {
      resolve({
        exitCode,
        gatePath: fs.existsSync(gatePath) ? gatePath : null,
        durationMs: Date.now() - start,
      });
    });
  });
}

module.exports = { runHeadless };
