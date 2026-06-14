"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { generateHelp } = require(path.join(__dirname, "..", "flags"));

const name = "derive-approvals";

const flags = {
  cwd:  { type: "string",  description: "Target project directory" },
  json: { type: "boolean", description: "JSON output" },
  help: { type: "boolean", description: "Show this help" },
};

// `devteam derive-approvals [<review-file>] [--cwd <dir>] [--json]`
//
// Invoke core/hooks/approval-derivation.js the same way Claude Code does —
// stdin carries a synthetic PostToolUse payload — but from the shell, so
// stage managers who hand-edit pipeline/code-review/by-*.md files outside an
// agent session can still get the per-area stage-05 gates re-derived.
//
// Without an argument, walks every by-*.md under pipeline/code-review/.
// With an argument, derives from that one file only. Either way, the
// hook reconciles approvals and changes_requested for every "## Review
// of <area>" section it finds.
//
// Followed by `devteam merge peer-review` to rebuild the merged
// stage-05.json from the updated per-area gates.
function run(positional, _flags) {
  if (_flags.help) { console.log(generateHelp("devteam derive-approvals [<file>] [options]", flags)); process.exit(0); }
  const cwd = _flags.cwd ? path.resolve(_flags.cwd) : process.cwd();
  const { loadConfig, checkBoundedFence } = require(path.join(__dirname, "..", "..", "config"));
  checkBoundedFence(loadConfig(cwd), "derive-approvals");
  const hookPath = path.join(__dirname, "..", "..", "hooks", "approval-derivation.js");
  const reviewDir = path.join(cwd, "pipeline", "code-review");

  let files;
  if (positional[0]) {
    const arg = positional[0];
    const abs = path.isAbsolute(arg) ? arg : path.resolve(cwd, arg);
    if (!fs.existsSync(abs)) {
      console.error(`devteam: file not found: ${arg}`);
      process.exit(2);
    }
    // Confine to pipeline/code-review/. The hook is otherwise happy to
    // ignore anything outside that directory (it returns early), but we
    // want stage managers to get a clear error rather than a silent no-op.
    const realArg = fs.realpathSync(abs);
    if (!fs.existsSync(reviewDir)) {
      console.error(`devteam: pipeline/code-review/ does not exist under ${cwd}`);
      process.exit(2);
    }
    const realReviewDir = fs.realpathSync(reviewDir);
    if (!realArg.startsWith(realReviewDir + path.sep)) {
      console.error(`devteam: ${arg} is not under pipeline/code-review/ — refusing to derive`);
      process.exit(2);
    }
    if (!/^by-[\w-]+\.md$/.test(path.basename(realArg))) {
      console.error(`devteam: ${arg} is not a by-<reviewer>.md file — refusing to derive`);
      process.exit(2);
    }
    files = [realArg];
  } else {
    if (!fs.existsSync(reviewDir)) {
      console.error(`devteam: pipeline/code-review/ does not exist under ${cwd}`);
      process.exit(2);
    }
    files = fs.readdirSync(reviewDir)
      .filter((n) => /^by-[\w-]+\.md$/.test(n))
      .map((n) => path.join(reviewDir, n))
      .sort();
    if (files.length === 0) {
      console.error(`devteam: no by-*.md review files found under ${reviewDir}`);
      process.exit(2);
    }
  }

  const { spawnSync } = require("node:child_process");
  const perFile = [];
  let anyFailed = false;
  for (const file of files) {
    const payload = JSON.stringify({ tool_input: { file_path: file } });
    const result = spawnSync(process.execPath, [hookPath], {
      cwd,
      input: payload,
      // Stdout/stderr inherit so the hook's [approval-derivation] log
      // lines reach the operator. Empty input → hook short-circuits.
      stdio: ["pipe", _flags.json ? "pipe" : "inherit", "inherit"],
      encoding: "utf8",
    });
    const ok = result.status === 0;
    if (!ok) {
      anyFailed = true;
      console.error(`devteam: approval-derivation exited ${result.status} for ${path.relative(cwd, file)}`);
    }
    perFile.push({ file: path.relative(cwd, file), exitCode: result.status, ok });
  }

  if (_flags.json) {
    console.log(JSON.stringify({ cwd, files: perFile, ok: !anyFailed }, null, 2));
  } else if (!anyFailed) {
    const rel = perFile.map((p) => p.file).join(", ");
    console.log(`Derived approvals from ${files.length} review file${files.length === 1 ? "" : "s"}: ${rel}`);
    console.log("Run `devteam merge peer-review` to rebuild pipeline/gates/stage-05.json from the updated per-area gates.");
  }

  process.exit(anyFailed ? 1 : 0);
}

module.exports = { name, flags, run };
