// Verification runner. Spawns an external command (lint, test, or SCA),
// captures result, returns a structured outcome the orchestrator can
// stamp onto a gate. This is the machinery that turns "the model says
// tests passed" into "the orchestrator ran the tests and observed
// exit code 0" — closing the gap between agent self-report and
// orchestrator verification.
//
// Public API:
//   - runCommand(command, opts) -> Promise<{ exitCode, stdout, stderr, durationMs, command, timedOut }>
//   - discoverScripts(cwd) -> { lint, test }    (reads package.json scripts; nulls when absent)
//   - resolveCommands(cwd, config) -> { lint, test }
//
// Commands run with shell:false where possible (split on whitespace),
// or shell:true when the configured command contains shell operators
// (&&, |, ;). The orchestrator passes `command` strings through from
// .devteam/config.yml or package.json — never user-controlled at
// invocation time.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { terminateChild } = require("../process-kill");

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 min; lint and tests should fit easily

function needsShell(command) {
  return /[|&;<>$`\\]/.test(command);
}

function runCommand(command, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;

  return new Promise((resolve) => {
    const started = Date.now();
    const useShell = needsShell(command);
    const args = useShell ? [] : command.trim().split(/\s+/);
    const cmd = useShell ? command : args.shift();
    const child = spawn(cmd, args, {
      cwd,
      shell: useShell,
      env: { ...process.env, CI: process.env.CI || "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let finished = false;

    const timer = setTimeout(() => {
      timedOut = true;
      terminateChild(child, { graceMs: 2000 });
    }, timeoutMs);
    timer.unref();

    child.stdout.on("data", (d) => { stdout += d.toString("utf8"); });
    child.stderr.on("data", (d) => { stderr += d.toString("utf8"); });

    child.on("error", (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        exitCode: null,
        stdout,
        stderr: stderr + `\n[runner] spawn error: ${err.message}`,
        durationMs: Date.now() - started,
        command,
        timedOut: false,
        spawnError: err.code || err.message,
      });
    });

    child.on("close", (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        exitCode: code,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        command,
        timedOut,
        signal: signal || null,
      });
    });
  });
}

function discoverScripts(cwd) {
  const pkgPath = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgPath)) return { lint: null, test: null };
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const scripts = pkg.scripts || {};
    return {
      lint: scripts.lint ? "npm run lint" : null,
      test: scripts.test ? "npm test" : null,
    };
  } catch {
    return { lint: null, test: null };
  }
}

// Resolve which lint/test commands to run for this project. Precedence:
// .devteam/config.yml `pipeline.verify.{lint,test}_command` wins; then
// package.json scripts; then null (skip with a warning recorded in the
// gate). Explicit `null` or empty string in config means "skip" — not
// the same as omitted, which falls back to discovery.
function resolveCommands(cwd, config) {
  const verify = (config && config.pipeline && config.pipeline.verify) || {};
  const discovered = discoverScripts(cwd);

  function pick(configKey, discoveredValue) {
    if (configKey === null) return null;            // explicit skip
    if (typeof configKey === "string" && configKey.trim()) return configKey.trim();
    return discoveredValue;
  }

  return {
    lint: pick(verify.lint_command, discovered.lint),
    test: pick(verify.test_command, discovered.test),
  };
}

module.exports = { runCommand, discoverScripts, resolveCommands };
