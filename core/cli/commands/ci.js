"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { generateHelp } = require(path.join(__dirname, "..", "flags"));

const name = "ci";

const flags = {
  cwd:   { type: "string",  description: "Target project directory" },
  ci:    { type: "string",  description: "CI system (default: github-actions)" },
  out:   { type: "string",  description: "Output directory for install" },
  force: { type: "boolean", description: "Overwrite existing workflow file" },
  help:  { type: "boolean", description: "Show this help" },
};

// F4 — CI runner integration. Currently only `install` for GitHub Actions.
function run(positional, _flags) {
  if (_flags.help) { console.log(generateHelp("devteam ci <install|show> [options]", flags)); process.exit(0); }
  const sub = positional[0];

  if (sub === "install") {
    const ci = _flags.ci || "github-actions";
    if (ci !== "github-actions") {
      console.error(`Unknown CI system "${ci}". Supported: github-actions.`);
      process.exit(2);
    }
    const cwd = _flags.cwd || process.cwd();
    const sourceFile = path.join(__dirname, "..", "..", "..", "templates", "ci", "github-actions", "stagecraft-pr-checks.yml");
    const targetDir = _flags.out || path.join(cwd, ".github", "workflows");
    const targetFile = path.join(targetDir, "stagecraft-pr-checks.yml");

    if (!fs.existsSync(sourceFile)) {
      console.error(`Stagecraft workflow template not found at ${sourceFile}`);
      process.exit(1);
    }
    fs.mkdirSync(targetDir, { recursive: true });
    if (fs.existsSync(targetFile) && !_flags.force) {
      console.error(`Workflow already exists at ${path.relative(cwd, targetFile)}. Use --force to overwrite.`);
      process.exit(1);
    }
    fs.copyFileSync(sourceFile, targetFile);
    console.log(`✅ Installed ${path.relative(cwd, targetFile)}`);
    console.log("");
    console.log("Next steps:");
    console.log("  1. Edit the STAGECRAFT_REPO + STAGECRAFT_REF env vars at the top of the");
    console.log("     workflow file to point at your fork / pinned version.");
    console.log("  2. Commit + push the workflow file.");
    console.log("  3. Open a PR that touches pipeline/gates/ to see the workflow run.");
    console.log("");
    console.log("What the workflow does (see file header for full detail):");
    console.log("  - Validates pipeline/gates/*.json with Stagecraft's validator");
    console.log("  - Posts each gate as a GitHub check run on the PR head");
    console.log("  - Runs `devteam reproduce` on each gate as an advisory drift check");
    console.log("  - Skips cleanly when the PR doesn't touch pipeline/");
    return;
  }

  if (sub === "show") {
    const ci = _flags.ci || "github-actions";
    const sourceFile = path.join(__dirname, "..", "..", "..", "templates", "ci", "github-actions", "stagecraft-pr-checks.yml");
    if (ci !== "github-actions") { console.error(`Unknown CI: ${ci}`); process.exit(2); }
    console.log(fs.readFileSync(sourceFile, "utf8"));
    return;
  }

  console.error(`Unknown ci subcommand: ${sub || "(none)"}`);
  console.error("Usage:");
  console.error("  devteam ci install [--ci github-actions] [--out <dir>] [--force]");
  console.error("  devteam ci show    [--ci github-actions]");
  process.exit(2);
}

module.exports = { name, flags, run };
