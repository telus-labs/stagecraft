// Load and resolve the target project's .devteam/config.yml.
//
// Missing file → defaults (host: generic, track: full, isolation: in-place).
// Routing precedence at resolveHost(): stages[stage] → roles[role] → default_host.

const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");

const DEFAULTS = {
  routing: {
    default_host: "generic",
    roles: {},
    stages: {},
    review_fanout: [],
  },
  pipeline: {
    default_track: "full",
    isolation: "in-place",
  },
};

function configPath(cwd) {
  return path.join(cwd, ".devteam", "config.yml");
}

function loadConfig(cwd = process.cwd()) {
  const p = configPath(cwd);
  if (!fs.existsSync(p)) return { ...DEFAULTS, _source: "defaults", _path: p };
  const raw = fs.readFileSync(p, "utf8");
  const parsed = yaml.load(raw) || {};
  return {
    routing: {
      default_host: parsed.routing?.default_host ?? DEFAULTS.routing.default_host,
      roles: parsed.routing?.roles ?? DEFAULTS.routing.roles,
      stages: parsed.routing?.stages ?? DEFAULTS.routing.stages,
      review_fanout: Array.isArray(parsed.routing?.review_fanout) ? parsed.routing.review_fanout : [],
    },
    pipeline: {
      default_track: parsed.pipeline?.default_track ?? DEFAULTS.pipeline.default_track,
      isolation: parsed.pipeline?.isolation ?? DEFAULTS.pipeline.isolation,
    },
    _source: "file",
    _path: p,
    _raw: parsed,
  };
}

function resolveHost(config, stage, role) {
  const routing = config.routing || DEFAULTS.routing;
  if (routing.stages && routing.stages[stage]) return routing.stages[stage];
  if (routing.roles && routing.roles[role]) return routing.roles[role];
  return routing.default_host;
}

function renderDefaultConfig(hosts) {
  const list = Array.isArray(hosts) ? hosts : [hosts];
  if (list.length === 0) throw new Error("renderDefaultConfig: at least one host required");
  const lines = [
    "# ai-dev-team configuration",
    "#",
    "# routing.default_host  fallback host for any (stage, role) not matched below",
    "# routing.roles         per-role overrides; key = role name, value = host name",
    "# routing.stages        per-stage overrides; key = stage id, takes precedence over roles",
    "",
    "routing:",
    `  default_host: ${list[0]}`,
  ];
  if (list.length > 1) {
    lines.push("  # multi-host install — uncomment and customize role overrides:");
    lines.push("  # roles:");
    for (const h of list.slice(1)) {
      lines.push(`  #   <role>: ${h}`);
    }
  }
  lines.push("");
  lines.push("pipeline:");
  lines.push("  default_track: full");
  lines.push("  isolation: in-place");
  lines.push("");
  return lines.join("\n");
}

function writeConfigIfAbsent(cwd, hosts, opts = {}) {
  const p = configPath(cwd);
  if (fs.existsSync(p) && !opts.force) {
    return { written: false, path: p, reason: "exists" };
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, renderDefaultConfig(hosts), "utf8");
  return { written: true, path: p };
}

module.exports = { loadConfig, resolveHost, configPath, renderDefaultConfig, writeConfigIfAbsent, DEFAULTS };
