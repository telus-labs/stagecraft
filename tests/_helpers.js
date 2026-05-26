// Shared test helpers. Not a test file itself; imported by *.test.js.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const BIN = path.join(REPO_ROOT, "bin", "devteam");

function makeTargetProject(opts = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "devteam-test-"));
  if (opts.config !== false) {
    fs.mkdirSync(path.join(cwd, ".devteam"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, ".devteam", "config.yml"),
      opts.config || "routing:\n  default_host: generic\npipeline:\n  default_track: full\n",
    );
  }
  if (opts.gates !== false) {
    fs.mkdirSync(path.join(cwd, "pipeline", "gates"), { recursive: true });
  }
  return cwd;
}

function seedGate(cwd, name, gate) {
  const dir = path.join(cwd, "pipeline", "gates");
  fs.mkdirSync(dir, { recursive: true });
  const finalGate = {
    stage: gate.stage || name.replace(/\.json$/, ""),
    orchestrator: "devteam@test",
    track: "full",
    timestamp: "2026-05-26T20:00:00Z",
    blockers: [],
    warnings: [],
    status: "PASS",
    ...gate,
  };
  const file = path.join(dir, name.endsWith(".json") ? name : `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(finalGate, null, 2));
  return file;
}

function cleanup(cwd) {
  if (cwd && fs.existsSync(cwd) && cwd.includes("devteam-test-")) {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

function runCLI(args, opts = {}) {
  const result = spawnSync("node", [BIN, ...args], {
    cwd: opts.cwd || process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...(opts.env || {}) },
  });
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

module.exports = { REPO_ROOT, BIN, makeTargetProject, seedGate, cleanup, runCLI };
