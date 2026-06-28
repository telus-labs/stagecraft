"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { generateHelp } = require(path.join(__dirname, "..", "flags"));
const { TRACKS } = require(path.join(__dirname, "..", "..", "pipeline", "stages"));

const name = "prototype";

const flags = {
  cwd:          { type: "string",  description: "Target project directory" },
  id:           { type: "string",  description: "Prototype id (default: slug from title)" },
  feature:      { type: "string",  description: "Prototype intent text" },
  "feature-file": { type: "string", description: "Read prototype intent from a UTF-8 file" },
  feedback:     { type: "string",  description: "Feedback text for prototype note" },
  track:        { type: "string",  description: "Promotion target track (default: full)" },
  force:        { type: "boolean", description: "Overwrite an existing prototype packet on start" },
  json:         { type: "boolean", description: "Machine-readable output" },
  help:         { type: "boolean", description: "Show this help" },
};

function usage() {
  return generateHelp("devteam prototype <start|note|promote> [id-or-title] [options]", flags);
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
  if (!id) throw new Error("prototype note requires an id");
  if (!flagsObj.feedback) throw new Error("prototype note requires --feedback");
  const dir = prototypeDir(cwd, id);
  if (!fs.existsSync(dir)) throw new Error(`prototype "${id}" does not exist`);

  const entry = `\n## ${nowIso()}\n\n${flagsObj.feedback.trim()}\n`;
  appendFile(path.join(dir, "feedback.md"), entry);

  const manifestPath = path.join(dir, "prototype.json");
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.updated_at = nowIso();
    writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  } catch {
    // Feedback is the source of value here; tolerate a missing or hand-edited manifest.
  }

  const result = { id, feedback_file: rel(cwd, path.join(dir, "feedback.md")) };
  if (flagsObj.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`Appended feedback to ${result.feedback_file}`);
}

function promotePrototype(positional, flagsObj) {
  const cwd = flagsObj.cwd || process.cwd();
  const id = positional[0];
  if (!id) throw new Error("prototype promote requires an id");
  const track = flagsObj.track || "full";
  if (!TRACKS.includes(track)) {
    throw new Error(`unknown promotion track "${track}". Valid: ${TRACKS.join(", ")}`);
  }
  const dir = prototypeDir(cwd, id);
  if (!fs.existsSync(dir)) throw new Error(`prototype "${id}" does not exist`);

  const promotionPath = path.join(dir, "promotion.md");
  const command = `devteam run --feature-file ${rel(cwd, promotionPath)} --track ${track}`;
  appendFile(promotionPath, `\n## Promotion Command\n\n\`\`\`bash\n${command}\n\`\`\`\n`);

  const manifestPath = path.join(dir, "prototype.json");
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.status = "promotion-ready";
    manifest.promotion_track = track;
    manifest.updated_at = nowIso();
    writeFile(manifestPath, JSON.stringify(manifest, null, 2));
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
