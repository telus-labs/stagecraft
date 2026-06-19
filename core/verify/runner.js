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
//   - discoverTestCommands(cwd) -> [{ id, command }]
//   - resolveTestCommands(cwd, config) -> [{ id, command }]
//   - runTestCommands(commands, opts) -> aggregate result
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
const MAX_PYTHON_TEST_FILES = 2000;
const MAX_PYTHON_TEST_DEPTH = 6;

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

function regularFile(file) {
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function regularDirectory(dir) {
  try {
    const stat = fs.lstatSync(dir);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function fileContains(file, pattern) {
  if (!regularFile(file)) return false;
  try { return pattern.test(fs.readFileSync(file, "utf8")); } catch { return false; }
}

function hasPythonTests(cwd) {
  if (regularFile(path.join(cwd, "pytest.ini"))) return true;
  if (fileContains(path.join(cwd, "pyproject.toml"), /^\s*\[tool\.pytest(?:\.|\])/m)) return true;
  if (fileContains(path.join(cwd, "setup.cfg"), /^\s*\[tool:pytest\]\s*$/m)) return true;

  const queue = [{ dir: cwd, depth: 0 }];
  const seen = new Set();
  let inspected = 0;
  while (queue.length > 0 && inspected < MAX_PYTHON_TEST_FILES) {
    const { dir, depth } = queue.shift();
    const resolved = path.resolve(dir);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    if (!regularDirectory(resolved)) continue;
    let entries;
    try { entries = fs.readdirSync(resolved, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isFile()) {
        inspected += 1;
        if (/^(?:test_.*|.*_test)\.py$/.test(entry.name) || entry.name === "conftest.py") return true;
      } else if (entry.isDirectory() && depth < MAX_PYTHON_TEST_DEPTH
        && (resolved !== path.resolve(cwd) || ["tests", "test"].includes(entry.name))) {
        queue.push({ dir: path.join(resolved, entry.name), depth: depth + 1 });
      }
      if (inspected >= MAX_PYTHON_TEST_FILES) break;
    }
  }
  return false;
}

function discoverTestCommands(cwd) {
  const commands = [];
  const nodeTest = discoverScripts(cwd).test;
  if (nodeTest) commands.push({ id: "node", command: nodeTest });
  if (hasPythonTests(cwd)) {
    commands.push({
      id: "python",
      command: process.platform === "win32" ? "py -m pytest" : "python3 -m pytest",
    });
  }
  if (regularFile(path.join(cwd, "go.mod"))) {
    commands.push({ id: "go", command: "go test ./..." });
  }
  return commands;
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

function resolveTestCommands(cwd, config) {
  const verify = (config && config.pipeline && config.pipeline.verify) || {};
  if (Object.prototype.hasOwnProperty.call(verify, "test_command")) {
    if (verify.test_command === null) return [];
    if (typeof verify.test_command === "string" && verify.test_command.trim()) {
      return [{ id: "configured", command: verify.test_command.trim() }];
    }
  }
  return discoverTestCommands(cwd);
}

async function runTestCommands(commands, opts = {}) {
  const runs = [];
  for (const suite of commands) {
    const result = await runCommand(suite.command, opts);
    runs.push({ id: suite.id, ...result });
  }
  return {
    passed: runs.length > 0 && runs.every((run) =>
      run.exitCode === 0 && !run.timedOut && !run.spawnError),
    durationMs: runs.reduce((sum, run) => sum + run.durationMs, 0),
    runs,
  };
}

module.exports = {
  runCommand,
  discoverScripts,
  discoverTestCommands,
  resolveCommands,
  resolveTestCommands,
  runTestCommands,
};
