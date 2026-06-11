"use strict";

const path = require("node:path");
const { generateHelp } = require(path.join(__dirname, "..", "flags"));

const name = "ui";

const flags = {
  cwd:  { type: "string",  description: "Target project directory" },
  port: { type: "number",  description: "Port to listen on (default: 3737)" },
  open: { type: "boolean", description: "Open browser automatically" },
  help: { type: "boolean", description: "Show this help" },
};

function run(positional, _flags) {
  if (_flags.help) { console.log(generateHelp("devteam ui [options]", flags)); process.exit(0); }
  const { startServer } = require(path.join(__dirname, "..", "..", "ui", "server"));
  startServer({
    port: _flags.port,
    cwd: _flags.cwd || process.cwd(),
    open: _flags.open,
  }).then(({ url, server }) => {
    console.log(`devteam UI: ${url}`);
    console.log(`Watching pipeline/gates/ for live updates. Ctrl-C to stop.`);
    function shutdown() {
      console.log("\nshutting down…");
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 500).unref();
    }
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }).catch((err) => {
    console.error(`devteam ui: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { name, flags, run };
