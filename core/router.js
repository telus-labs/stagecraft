// Resolve and load host adapters per (stage, role).
//
// Adapters live under <project-root>/hosts/<name>/adapter.js. Each adapter
// module exports the contract documented in core/adapters/host-adapter.md:
// capabilities, install, renderStagePrompt, [invoke], status, uninstall.

const fs = require("node:fs");
const path = require("node:path");
const { resolveHost } = require("./config");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const HOSTS_DIR = path.join(PROJECT_ROOT, "hosts");

function adapterPath(hostName) {
  return path.join(HOSTS_DIR, hostName, "adapter.js");
}

function loadAdapter(hostName) {
  const p = adapterPath(hostName);
  if (!fs.existsSync(p)) {
    throw new Error(
      `No adapter found for host "${hostName}" at ${p}. ` +
      `Available hosts: ${listHosts().join(", ") || "(none installed)"}.`,
    );
  }
  return require(p);
}

function listHosts() {
  if (!fs.existsSync(HOSTS_DIR)) return [];
  return fs.readdirSync(HOSTS_DIR).filter((n) =>
    fs.existsSync(adapterPath(n)),
  );
}

function resolveAdapter(config, stage, role) {
  const hostName = resolveHost(config, stage, role);
  if (!hostName) {
    throw new Error(
      `Routing did not resolve a host for stage="${stage}" role="${role}". ` +
      `Set routing.default_host in .devteam/config.yml.`,
    );
  }
  return { hostName, adapter: loadAdapter(hostName) };
}

module.exports = { resolveAdapter, loadAdapter, listHosts };
