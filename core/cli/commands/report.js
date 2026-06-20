"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { generateHelp } = require(path.join(__dirname, "..", "flags"));

const name = "report";

const flags = {
  cwd:       { type: "string",  description: "Target project directory (default: cwd)" },
  out:       { type: "string",  description: "Output path (default: pipeline/report.html)" },
  feature:   { type: "string",  description: "Feature name (for bounded-isolation runs)" },
  json:      { type: "boolean", description: "Print raw data as JSON; skip HTML" },
  "no-open": { type: "boolean", description: "Write file but don't open browser" },
  help:      { type: "boolean", description: "Show this help" },
};

function openBrowser(filePath) {
  const platform = process.platform;
  const cmd = platform === "darwin" ? "open"
    : platform === "win32" ? "explorer.exe"
    : "xdg-open";
  const args = [filePath];
  // windowsVerbatimArguments avoids the cmd.exe shell layer on Windows,
  // preventing argument interpretation of special chars in the file path.
  const options = platform === "win32"
    ? { stdio: "ignore", windowsVerbatimArguments: true }
    : { stdio: "ignore" };
  spawnSync(cmd, args, options);
}

function run(positional, _flags) {
  if (_flags.help) {
    console.log(generateHelp("devteam report [options]", flags));
    process.exit(0);
  }

  const cwd = _flags.cwd || process.cwd();
  const { collectReport } = require(path.join(__dirname, "..", "..", "report", "collect"));

  let data;
  try {
    data = collectReport(cwd, { feature: _flags.feature || null });
  } catch (err) {
    process.stderr.write(`devteam report: failed to collect pipeline data\n  ${err.message}\n`);
    process.exit(1);
  }

  if (_flags.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const { renderHtml } = require(path.join(__dirname, "..", "..", "report", "render-html"));
  const html = renderHtml(data);

  // Resolve output path.
  let outPath = _flags.out || null;
  if (!outPath) {
    const { pipelineRoot } = require(path.join(__dirname, "..", "..", "paths"));
    outPath = path.join(pipelineRoot(cwd, null), "report.html");
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, "utf8");
  console.log(`Report written → ${outPath}`);

  if (!_flags["no-open"]) {
    openBrowser(outPath);
  }
}

module.exports = { name, flags, run };
