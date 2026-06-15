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
    skip_stages: [],
    // verify: optional. Holds orchestrator-stamped verification commands
    // for stages that the orchestrator can verify directly (stage-04a
    // and stage-06 today). Absent means "discover from package.json
    // scripts or skip"; explicit null on a field means "skip even if
    // discoverable." See core/verify/runner.js → resolveCommands.
    verify: {},
    // G6: custom_stages overrides default_track when set. An array of
    // stage names, e.g. ["requirements","build","pre-review","peer-review"].
    // Produced by `devteam assess --apply` or set manually. null = use
    // default_track.
    custom_stages: null,
  },
  autonomy: {
    // ADR-003 / H1: retry budget before `next()` escalates a still-FAIL stage
    // (failure_class "convergence-exhausted") instead of returning
    // fix-and-retry again. Count-based ceiling on the gate's retry_number.
    // Progress-based detection (blocker count decreasing across attempts) is a
    // follow-up — it requires gate archiving, which this layer does not add.
    // 0 = escalate on the first FAIL.
    max_retries: 2,
    // ADR-006: when true, an inferred pipeline/track.json at medium/low confidence
    // produces an unconfirmed-track halt (requires --track or --force to proceed).
    // Off by default — opt in via .devteam/config.yml autonomy.require_confirmed_track.
    require_confirmed_track: false,
  },
};

function configPath(cwd) {
  return path.join(cwd, ".devteam", "config.yml");
}

const _cache = new Map();
function clearConfigCache() { _cache.clear(); }

function loadConfig(cwd = process.cwd()) {
  const resolved = path.resolve(cwd);
  if (_cache.has(resolved)) return _cache.get(resolved);
  const p = configPath(resolved);
  let result;
  if (!fs.existsSync(p)) {
    result = { ...DEFAULTS, _source: "defaults", _path: p };
  } else {
    const raw = fs.readFileSync(p, "utf8");
    const parsed = yaml.load(raw) || {};
    result = {
      routing: {
        default_host: parsed.routing?.default_host ?? DEFAULTS.routing.default_host,
        roles: parsed.routing?.roles ?? DEFAULTS.routing.roles,
        stages: parsed.routing?.stages ?? DEFAULTS.routing.stages,
        review_fanout: Array.isArray(parsed.routing?.review_fanout) ? parsed.routing.review_fanout : [],
      },
      pipeline: {
        default_track: parsed.pipeline?.default_track ?? DEFAULTS.pipeline.default_track,
        isolation: parsed.pipeline?.isolation ?? DEFAULTS.pipeline.isolation,
        isolation_acknowledge_partial: parsed.pipeline?.isolation_acknowledge_partial === true,
        skip_stages: Array.isArray(parsed.pipeline?.skip_stages) ? parsed.pipeline.skip_stages : [],
        verify: (parsed.pipeline && typeof parsed.pipeline.verify === "object" && parsed.pipeline.verify !== null) ? parsed.pipeline.verify : {},
        custom_stages: Array.isArray(parsed.pipeline?.custom_stages) ? parsed.pipeline.custom_stages : null,
      },
      autonomy: {
        max_retries: Number.isInteger(parsed.autonomy?.max_retries) && parsed.autonomy.max_retries >= 0
          ? parsed.autonomy.max_retries
          : DEFAULTS.autonomy.max_retries,
        // ADR-006: explicit opt-in flag; not CI=true (CI is already overloaded)
        require_confirmed_track: parsed.autonomy?.require_confirmed_track === true,
      },
      _source: "file",
      _path: p,
      _raw: parsed,
    };
  }
  _cache.set(resolved, result);
  return result;
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
  lines.push("  # skip_stages: []     # stage names to skip, e.g. [red-team]");
  lines.push("  # verify:             # orchestrator-stamped verification commands");
  lines.push("  #   lint_command: \"npm run lint\"   # override; defaults to package.json scripts.lint");
  lines.push("  #   test_command: \"npm test\"      # override; set to null to disable");
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

// B9: derive a filesystem-safe change identifier from the feature name.
// Lowercases, collapses non-alphanumeric runs to hyphens, strips leading/
// trailing hyphens, and caps at 64 chars. Returns null for blank input so
// callers can treat null as "in-place mode".
function changeIdFromFeature(feature) {
  if (!feature || typeof feature !== "string") return null;
  const slug = feature
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || null;
}

// ADR-009 §Consequences: bounded-isolation needs a changeId derivation for
// repair runs (from the symptom string). Same slug algorithm as changeIdFromFeature.
function changeIdFromSymptom(symptom) { return changeIdFromFeature(symptom); }

// B9 fence (item 5.4): CLI commands that have not yet been wired to pass
// changeId through their pipeline/ path calls. The meta-test in
// tests/bounded-fence.test.js greps core/cli/commands/ for resolveChangeId
// usage and asserts this list matches reality — so the fence cannot silently
// go stale when a command is wired.
//
// All seven commands were wired in commit 2 of Phase 5.4; this list is now
// empty. It remains exported so the meta-test can assert that parity holds
// and so that future additions can be caught before they silently misread paths.
const BOUNDED_UNWIRED_COMMANDS = [];

// Throw if isolation:bounded is active for an unwired command and the
// operator has not acknowledged partial support via isolation_acknowledge_partial.
// Silent-wrong is the only unacceptable outcome; this makes the current state
// honest. Set isolation_acknowledge_partial: true in .devteam/config.yml to
// use only the driver path (which is fully wired) while the CLI catches up.
function checkBoundedFence(config, commandName) {
  if (config.pipeline.isolation !== "bounded") return;
  if (config.pipeline.isolation_acknowledge_partial) return;
  if (!BOUNDED_UNWIRED_COMMANDS.includes(commandName)) return;
  throw new Error(
    `isolation: bounded is not yet fully wired in the CLI layer.\n` +
    `Commands with no changeId support: ${BOUNDED_UNWIRED_COMMANDS.join(", ")}\n` +
    `Set isolation_acknowledge_partial: true in .devteam/config.yml to bypass ` +
    `this check (driver path is fully wired; CLI read-side commands will silently ` +
    `read the wrong directory without this guard).`,
  );
}

module.exports = {
  loadConfig, clearConfigCache, resolveHost, configPath, renderDefaultConfig,
  writeConfigIfAbsent, changeIdFromFeature, changeIdFromSymptom, DEFAULTS,
  BOUNDED_UNWIRED_COMMANDS, checkBoundedFence,
};
