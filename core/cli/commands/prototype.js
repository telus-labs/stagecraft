"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { generateHelp } = require(path.join(__dirname, "..", "flags"));
const { TRACKS } = require(path.join(__dirname, "..", "..", "pipeline", "stages"));
const { loadConfig, resolveHost } = require(path.join(__dirname, "..", "..", "config"));
const { loadAdapter } = require(path.join(__dirname, "..", "..", "router"));
const { version } = require(path.join(__dirname, "..", "..", "..", "package.json"));

const name = "prototype";
const ORCHESTRATOR_ID = `devteam@${version}`;

const flags = {
  cwd:          { type: "string",  description: "Target project directory" },
  id:           { type: "string",  description: "Prototype id (default: slug from title)" },
  feature:      { type: "string",  description: "Prototype intent text" },
  "feature-file": { type: "string", description: "Read prototype intent from a UTF-8 file" },
  feedback:     { type: "string",  description: "Feedback text for prototype note" },
  host:         { type: "string",  description: "Host for prototype build (default: routing.default_host)" },
  "apply-to-project": { type: "boolean", description: "Allow prototype build writes outside the packet workspace" },
  "timeout-ms": { type: "number",  description: "Prototype build timeout in milliseconds" },
  track:        { type: "string",  description: "Promotion target track (default: full)" },
  force:        { type: "boolean", description: "Overwrite an existing prototype packet on start" },
  json:         { type: "boolean", description: "Machine-readable output" },
  help:         { type: "boolean", description: "Show this help" },
};

function usage() {
  return generateHelp("devteam prototype <start|build|note|promote> [id-or-title] [options]", flags);
}

function slugify(input) {
  const slug = String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return slug || `prototype-${Date.now()}`;
}

function prototypeDir(cwd, id) {
  return path.join(cwd, "pipeline", "prototypes", id);
}

function rel(cwd, file) {
  return path.relative(cwd, file).replace(/\\/g, "/");
}

function readFeature(cwd, flagsObj, fallback) {
  if (flagsObj.feature && flagsObj.featureFile) {
    throw new Error("--feature and --feature-file are mutually exclusive");
  }
  if (flagsObj.featureFile) {
    const file = path.resolve(cwd, flagsObj.featureFile);
    return fs.readFileSync(file, "utf8").trim();
  }
  return (flagsObj.feature || fallback || "").trim();
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

function appendFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

function nowIso() {
  return new Date().toISOString();
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function updateManifest(dir, mutator) {
  const manifestPath = path.join(dir, "prototype.json");
  const manifest = readJsonSafe(manifestPath) || {};
  mutator(manifest);
  manifest.updated_at = nowIso();
  writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}

function ensurePrototype(cwd, id, subcommand) {
  if (!id) throw new Error(`prototype ${subcommand} requires an id`);
  const dir = prototypeDir(cwd, id);
  if (!fs.existsSync(dir)) throw new Error(`prototype "${id}" does not exist`);
  return dir;
}

function readPacketFile(dir, name) {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) {
    throw new Error(`prototype packet is missing ${name}`);
  }
  return fs.readFileSync(file, "utf8");
}

function buildDispatchPrompt({ id, title, dirRel, workspaceRel, intent, buildPrompt, applyToProject }) {
  const writeScope = applyToProject
    ? "the target project root; keep prototype changes easy to discard"
    : `the packet workspace at ${workspaceRel}`;
  return `# Prototype Build Dispatch — ${title}

You are building a Stagecraft prototype packet.

This is pre-SDLC exploratory work, not gate evidence. Do not write normal
Stagecraft gates, do not claim sign-off, and do not deploy to production.

Prototype id: ${id}
Packet directory: ${dirRel}
Current working directory: ${applyToProject ? "." : workspaceRel}
Allowed write scope: ${writeScope}

Rules:
- Build only what is needed for fast learning and demo feedback.
- Prefer local/demo data over production data.
- Keep shortcuts visible in ${dirRel}/promotion.md.
- Append demo instructions or run commands to ${dirRel}/promotion.md when useful.
- Avoid auth, payments, migrations, secrets, customer data, and infrastructure
  changes unless a human explicitly accepted that risk.
- Do not write files under pipeline/gates/.

## intent.md

${intent.trim()}

## build-prompt.md

${buildPrompt.trim()}
`;
}

function startPrototype(positional, flagsObj) {
  const cwd = flagsObj.cwd || process.cwd();
  const title = positional.join(" ").trim() || flagsObj.feature || "prototype";
  const id = slugify(flagsObj.id || title);
  const dir = prototypeDir(cwd, id);
  const intent = readFeature(cwd, flagsObj, title);

  if (fs.existsSync(dir) && !flagsObj.force) {
    throw new Error(`prototype "${id}" already exists; pass --force to replace it`);
  }

  fs.mkdirSync(dir, { recursive: true });
  const manifest = {
    id,
    title,
    status: "prototype",
    created_at: nowIso(),
    updated_at: nowIso(),
    intent_file: "intent.md",
    feedback_file: "feedback.md",
    promotion_file: "promotion.md",
  };

  writeFile(path.join(dir, "prototype.json"), JSON.stringify(manifest, null, 2));
  writeFile(path.join(dir, "intent.md"), `# Prototype Intent — ${title}

## Intent

${intent || "_Describe the prototype intent._"}

## Learning Goal

- What must we learn before deciding whether this deserves a normal Stagecraft delivery track?

## Constraints

- Optimize for fast feedback, not production readiness.
- Do not treat this packet as gate evidence.
- Promote before production deployment, sign-off, or protected-branch merge.
`);
  writeFile(path.join(dir, "build-prompt.md"), `# Prototype Build Prompt — ${title}

Build a fast prototype for the intent in \`intent.md\`.

Rules:
- Optimize for learning speed and demoability.
- Optimize for learning, not production readiness.
- Keep the change easy to discard or replace.
- Prefer local/demo data over production data.
- Avoid auth, payments, migrations, secrets, customer data, and infrastructure changes unless a human explicitly accepts the risk.
- Record known shortcuts and open questions in \`promotion.md\`.
- Append feedback from demos or review to \`feedback.md\`.
`);
  writeFile(path.join(dir, "feedback.md"), `# Prototype Feedback — ${title}

Append observations with:

\`\`\`bash
devteam prototype note ${id} --feedback "..."
\`\`\`
`);
  writeFile(path.join(dir, "promotion.md"), `# Prototype Promotion — ${title}

## Decision

- [ ] discard
- [ ] iterate
- [ ] promote to normal Stagecraft track
- [ ] extract learning only

## What Worked

- 

## What Failed

- 

## User / Stakeholder Feedback

- 

## Known Shortcuts

- 

## Risks Discovered

- 

## Suggested Acceptance Criteria

- 

## Recommended Track

- full
`);

  const result = {
    id,
    dir: rel(cwd, dir),
    files: ["prototype.json", "intent.md", "build-prompt.md", "feedback.md", "promotion.md"].map((f) => rel(cwd, path.join(dir, f))),
  };

  if (flagsObj.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Created prototype packet: ${result.dir}`);
    console.log(`Build prompt: ${rel(cwd, path.join(dir, "build-prompt.md"))}`);
    console.log(`Promotion handoff: ${rel(cwd, path.join(dir, "promotion.md"))}`);
  }
}

function notePrototype(positional, flagsObj) {
  const cwd = flagsObj.cwd || process.cwd();
  const id = positional[0];
  if (!flagsObj.feedback) throw new Error("prototype note requires --feedback");
  const dir = ensurePrototype(cwd, id, "note");

  const entry = `\n## ${nowIso()}\n\n${flagsObj.feedback.trim()}\n`;
  appendFile(path.join(dir, "feedback.md"), entry);

  updateManifest(dir, (manifest) => { manifest.status = manifest.status || "prototype"; });

  const result = { id, feedback_file: rel(cwd, path.join(dir, "feedback.md")) };
  if (flagsObj.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`Appended feedback to ${result.feedback_file}`);
}

async function buildPrototype(positional, flagsObj) {
  const cwd = flagsObj.cwd || process.cwd();
  const id = positional[0];
  const dir = ensurePrototype(cwd, id, "build");
  const manifest = readJsonSafe(path.join(dir, "prototype.json")) || {};
  const title = manifest.title || id;
  const config = loadConfig(cwd);
  const hostName = flagsObj.host || resolveHost(config, "prototype", "prototype");
  const adapter = loadAdapter(hostName);

  if (!adapter.capabilities?.headless || typeof adapter.invoke !== "function") {
    throw new Error(
      `host "${hostName}" cannot run prototype builds headlessly. ` +
      "Use --host with a headless-capable host or hand the build prompt to a CLI.",
    );
  }

  const applyToProject = flagsObj.applyToProject === true;
  const workspace = applyToProject ? cwd : path.join(dir, "workspace");
  fs.mkdirSync(workspace, { recursive: true });

  const intent = readPacketFile(dir, "intent.md");
  const buildPrompt = readPacketFile(dir, "build-prompt.md");
  const dirRel = rel(cwd, dir);
  const workspaceRel = rel(cwd, workspace) || ".";
  const prompt = buildDispatchPrompt({
    id,
    title,
    dirRel,
    workspaceRel,
    intent,
    buildPrompt,
    applyToProject,
  });
  const allowedWrites = applyToProject ? ["**"] : [`${dirRel}/`];
  const descriptor = {
    stage: "prototype",
    name: "Prototype Build",
    role: "prototype",
    workstreamId: `prototype.${id}`,
    objective: `Build prototype packet ${id}`,
    readFirst: [`${dirRel}/intent.md`, `${dirRel}/build-prompt.md`],
    allowedWrites,
    artifact: applyToProject ? "." : `${workspaceRel}/`,
    template: null,
    expectedGate: {},
    toolBudget: null,
  };
  const ctx = {
    cwd,
    processCwd: workspace,
    track: "prototype",
    feature: manifest.title || id,
    orchestrator: ORCHESTRATOR_ID,
    timeoutMs: flagsObj.timeoutMs,
  };

  const startedAt = nowIso();
  const result = await adapter.invoke(descriptor, ctx, prompt);
  const status = result.exitCode === 0 && !result.timedOut ? "built" : "build-failed";
  const buildRecord = {
    started_at: startedAt,
    completed_at: nowIso(),
    host: hostName,
    status,
    exit_code: result.exitCode,
    timed_out: result.timedOut === true,
    duration_ms: result.durationMs,
    workspace: workspaceRel,
    apply_to_project: applyToProject,
    log_file: result.logPath ? rel(cwd, result.logPath) : null,
  };

  updateManifest(dir, (m) => {
    m.id = m.id || id;
    m.title = m.title || title;
    m.status = status === "built" ? "prototype-built" : "prototype-build-failed";
    m.last_build = buildRecord;
    m.builds = Array.isArray(m.builds) ? m.builds : [];
    m.builds.push(buildRecord);
  });

  const output = {
    id,
    host: hostName,
    status,
    exit_code: result.exitCode,
    timed_out: result.timedOut === true,
    workspace: workspaceRel,
    apply_to_project: applyToProject,
    log_file: buildRecord.log_file,
    duration_ms: result.durationMs,
  };

  if (flagsObj.json) {
    console.log(JSON.stringify(output, null, 2));
  } else if (status === "built") {
    console.log(`Prototype build completed: ${id}`);
    console.log(`Workspace: ${workspaceRel}`);
    if (buildRecord.log_file) console.log(`Log: ${buildRecord.log_file}`);
    console.log("Reminder: prototype builds are not gate evidence.");
  } else {
    console.error(`Prototype build failed: ${id}`);
    if (buildRecord.log_file) console.error(`Log: ${buildRecord.log_file}`);
  }

  if (status !== "built") process.exit(1);
}

function promotePrototype(positional, flagsObj) {
  const cwd = flagsObj.cwd || process.cwd();
  const id = positional[0];
  const track = flagsObj.track || "full";
  if (!TRACKS.includes(track)) {
    throw new Error(`unknown promotion track "${track}". Valid: ${TRACKS.join(", ")}`);
  }
  const dir = ensurePrototype(cwd, id, "promote");

  const promotionPath = path.join(dir, "promotion.md");
  const command = `devteam run --feature-file ${rel(cwd, promotionPath)} --track ${track}`;
  appendFile(promotionPath, `\n## Promotion Command\n\n\`\`\`bash\n${command}\n\`\`\`\n`);

  try {
    updateManifest(dir, (manifest) => {
      manifest.status = "promotion-ready";
      manifest.promotion_track = track;
    });
  } catch {
    // Keep promote usable even after manual packet edits.
  }

  const result = {
    id,
    track,
    promotion_file: rel(cwd, promotionPath),
    command,
  };
  if (flagsObj.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Updated ${result.promotion_file}`);
    console.log(command);
  }
}

function run(positional, flagsObj) {
  if (flagsObj.help) {
    console.log(usage());
    process.exit(0);
  }

  const [subcommand, ...rest] = positional;
  switch (subcommand) {
    case "start":
      return startPrototype(rest, flagsObj);
    case "build":
      return buildPrototype(rest, flagsObj).catch((err) => {
        console.error(`devteam: ${err.message}`);
        process.exit(1);
      });
    case "note":
      return notePrototype(rest, flagsObj);
    case "promote":
      return promotePrototype(rest, flagsObj);
    default:
      console.error(usage());
      process.exit(2);
  }
}

module.exports = { name, flags, run, slugify };
