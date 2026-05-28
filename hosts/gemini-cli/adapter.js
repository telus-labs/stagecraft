// Gemini CLI host adapter.
//
// install: copies roles/*.md verbatim into <target>/.gemini/prompts/roles/
//          (gemini consumes plain markdown — no frontmatter), renders
//          rules/*.md into <target>/.devteam/rules/ to satisfy "Read
//          first" references, and copies skills/*/SKILL.md to
//          <target>/.gemini/skills/<name>/.
// renderStagePrompt: emits a Gemini-CLI-idiomatic prompt that points
//          at the installed role prompt.
// status: verifies installed files exist and are non-empty.
// uninstall: removes the install payload.
//
// Capability deltas (vs claude-code):
//   - no hooks            → no auto-validate; users run `devteam
//                           validate` manually or via shell aliases
//   - no slash commands   → users invoke `devteam` directly from
//                           the terminal
//   - no subagents        → orchestrator runs each workstream in
//                           its own gemini session
//   - headless: true      → `gemini` reads from stdin; DEVTEAM_
//                           HEADLESS_COMMAND env var overrides the
//                           bin if your gemini install uses a
//                           different name (e.g. `gemini-cli`)

const fs = require("node:fs");
const path = require("node:path");

const capabilities = require("./capabilities.json");
const { runHeadless } = require("../../core/adapters/headless");
const { listRoles, ROLES_DIR } = require("../../core/roles");
const baseInstall = require("../../core/adapters/base-install");
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RULES_DIR = baseInstall.RULES_DIR;
const SKILLS_DIR = baseInstall.SKILLS_DIR;

// Role list scanned from roles/*.md by core/roles.js — single source of
// truth. Adding a role brief makes it visible to every host adapter.
const ROLES = listRoles();

function installRoles(targetDir, opts) {
  const dir = path.join(targetDir, capabilities.rolePromptsDir);
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  const skipped = [];
  const warnings = [];
  const toInstall = opts.roles && opts.roles.length > 0 ? opts.roles : ROLES;

  for (const role of toInstall) {
    const src = path.join(ROLES_DIR, `${role}.md`);
    if (!fs.existsSync(src)) {
      warnings.push(`role brief missing: ${src}`);
      continue;
    }
    const dest = path.join(dir, `${role}.md`);
    if (fs.existsSync(dest) && !opts.force) {
      skipped.push(dest);
      continue;
    }
    fs.copyFileSync(src, dest);
    written.push(dest);
  }
  return { written, skipped, warnings };
}

function install(targetDir, opts = {}) {
  const o = { force: false, roles: [], isolation: "in-place", ...opts };
  const roles = installRoles(targetDir, o);
  const rules = baseInstall.installRules(targetDir, o);
  const skills = baseInstall.installSkills(targetDir, capabilities.skillsDir, o);
  return {
    written: [...roles.written, ...rules.written, ...skills.written],
    skipped: [...roles.skipped, ...rules.skipped, ...skills.skipped],
    warnings: [...roles.warnings, ...rules.warnings, ...skills.warnings],
  };
}

function uninstall(targetDir) {
  const rolesDir = path.join(targetDir, capabilities.rolePromptsDir);
  if (fs.existsSync(rolesDir)) {
    for (const role of ROLES) {
      const p = path.join(rolesDir, `${role}.md`);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }
  baseInstall.uninstallRules(targetDir);
  baseInstall.uninstallSkills(targetDir, capabilities.skillsDir);
}

function status(targetDir) {
  const missing = [];
  const stale = [];
  for (const role of ROLES) {
    const p = path.join(targetDir, capabilities.rolePromptsDir, `${role}.md`);
    if (!fs.existsSync(p)) missing.push(p);
    else if (fs.statSync(p).size === 0) stale.push(p);
  }
  if (fs.existsSync(RULES_DIR)) {
    for (const f of fs.readdirSync(RULES_DIR)) {
      if (!f.endsWith(".md")) continue;
      const p = path.join(targetDir, ".devteam", "rules", f);
      if (!fs.existsSync(p)) missing.push(p);
    }
  }
  if (fs.existsSync(SKILLS_DIR)) {
    for (const skill of fs.readdirSync(SKILLS_DIR)) {
      const p = path.join(targetDir, capabilities.skillsDir, skill, "SKILL.md");
      if (!fs.existsSync(p)) missing.push(p);
    }
  }
  return {
    ok: missing.length === 0 && stale.length === 0,
    missing,
    stale,
    notes: missing.length === 0 ? ["gemini-cli install looks healthy"] : [],
  };
}

function renderStagePrompt(descriptor, ctx) {
  // descriptor.subagent (when set) overrides the role-to-prompt mapping —
  // used by stages like peer-review where every workstream-area dispatches
  // to the same reviewer prompt file.
  const promptRole = descriptor.subagent || descriptor.role;
  const rolePromptPath = `${capabilities.rolePromptsDir}/${promptRole}.md`;
  const lines = [];
  lines.push(`# Stage ${descriptor.stage} — ${descriptor.name}`);
  lines.push(`Workstream: ${descriptor.workstreamId} (role: ${descriptor.role}, host: gemini-cli)`);
  lines.push(`Track: ${ctx.track}`);
  if (ctx.feature) lines.push(`Feature: ${ctx.feature}`);
  lines.push("");
  lines.push(`Read the role prompt at \`${rolePromptPath}\` before acting on this stage.`);
  lines.push("");
  lines.push(`## Objective`);
  lines.push(descriptor.objective);
  lines.push("");
  lines.push(`## Read first`);
  for (const f of descriptor.readFirst) lines.push(`- ${f}`);
  lines.push("");
  lines.push(`## Allowed writes (advisory — gemini-cli enforces this in prompt only; the gate validator catches violations post-hoc)`);
  for (const f of descriptor.allowedWrites) lines.push(`- ${f}`);
  lines.push("");
  lines.push(`## Artifact`);
  lines.push(`Produce \`${descriptor.artifact}\` using \`templates/${descriptor.template}\`.`);
  lines.push("");
  lines.push(`## Gate to write`);
  lines.push(`Write to \`pipeline/gates/${descriptor.workstreamId}.json\`. You provide:`);
  lines.push("```json");
  lines.push(JSON.stringify({
    stage: descriptor.stage,
    workstream: descriptor.role,
    status: "PASS|WARN|FAIL|ESCALATE",
    track: ctx.track,
    timestamp: "<ISO-8601>",
    blockers: [],
    warnings: [],
    ...descriptor.expectedGate,
  }, null, 2));
  lines.push("```");
  lines.push(`The orchestrator adds \`"orchestrator": "${ctx.orchestrator}"\` and \`"host": "gemini-cli"\` at validation time.`);
  return lines.join("\n");
}

function invoke(descriptor, ctx) {
  return runHeadless(module.exports, descriptor, ctx);
}

module.exports = {
  capabilities,
  install,
  uninstall,
  status,
  renderStagePrompt,
  invoke,
};
