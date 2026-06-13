// `devteam hook <name>` — portable dispatcher for Claude Code hooks.
// Replaces the absolute-path approach that baked installation paths into
// settings.local.json at `devteam init` time.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { REPO_ROOT, BIN } = require("./_helpers");

const { HOOKS } = require(path.join(REPO_ROOT, "core", "cli", "commands", "hook"));

function devteam(args, opts = {}) {
  return spawnSync("node", [BIN, "hook", ...args], {
    cwd: opts.cwd || REPO_ROOT,
    input: opts.input,
    encoding: "utf8",
  });
}

describe("devteam hook: HOOKS map", () => {
  it("all hook entries resolve to files that exist on disk", () => {
    for (const [hookName, scriptPath] of Object.entries(HOOKS)) {
      assert.ok(fs.existsSync(scriptPath),
        `HOOKS["${hookName}"] points to a missing file: ${scriptPath}`);
    }
  });

  it("paths are absolute (resolve-relative-to-package, not cwd)", () => {
    for (const [hookName, scriptPath] of Object.entries(HOOKS)) {
      assert.ok(path.isAbsolute(scriptPath),
        `HOOKS["${hookName}"] must be an absolute path; got: ${scriptPath}`);
    }
  });
});

describe("devteam hook: CLI dispatch", () => {
  it("unknown hook name exits 2 with a helpful message", () => {
    const r = devteam(["does-not-exist"]);
    assert.equal(r.status, 2, "must exit 2 for unknown hook name");
    assert.ok(r.stderr.includes("does-not-exist"), "stderr must mention the unknown name");
    assert.ok(r.stderr.includes("Known:"), "stderr must list known hook names");
  });

  it("no subcommand exits 2 and prints usage", () => {
    const r = devteam([]);
    assert.equal(r.status, 2, "must exit 2 when no subcommand given");
    assert.ok(r.stdout.includes("devteam hook"), "stdout must include usage line");
  });

  it("--help exits 0 and prints available hook names", () => {
    const r = devteam(["--help"]);
    assert.equal(r.status, 0, "must exit 0 with --help");
    assert.ok(r.stdout.includes("validate"), "help must list 'validate'");
    assert.ok(r.stdout.includes("secret-scan"), "help must list 'secret-scan'");
    assert.ok(r.stdout.includes("approval-derivation"), "help must list 'approval-derivation'");
  });

  it("secret-scan exits 0 on empty JSON payload (no secrets)", () => {
    const r = devteam(["secret-scan"], {
      input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: "src/foo.js", content: "const x = 1;" } }),
    });
    assert.equal(r.status, 0, `secret-scan must exit 0 on clean content; stderr: ${r.stderr}`);
  });

  it("approval-derivation exits 0 on empty payload (conservative on error)", () => {
    const r = devteam(["approval-derivation"], { input: "{}" });
    assert.equal(r.status, 0, `approval-derivation must exit 0 conservatively; stderr: ${r.stderr}`);
  });
});
