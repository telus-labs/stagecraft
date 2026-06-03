// Codex CLI host adapter.
//
// install: copies roles/*.md verbatim into <target>/.codex/prompts/roles/
//          (codex consumes plain markdown — no frontmatter) and renders
//          rules/*.md into <target>/.devteam/rules/ to satisfy "Read first"
//          references in the role briefs.
// renderStagePrompt: emits a Codex-idiomatic prompt that points at the
//          installed role prompt and inlines the gate skeleton.
// status:  verifies installed files exist and are non-empty.
// uninstall: removes the files install() laid down.
//
// Capability deltas vs claude-code:
//   - no subagents      → orchestrator runs each workstream as its own
//                         codex session
//   - no hooks          → enforcement of allowed_writes/stoplist is
//                         prompt-only; the post-hoc gate validator catches
//                         violations after the fact
//   - no slash commands → users invoke `devteam` from the terminal directly
//   - headless: true    → `codex exec` can drive this non-interactively
//                         (invoke() not yet implemented; user-driven only)

const fs = require("node:fs");
const path = require("node:path");

const capabilities = require("./capabilities.json");
const { runHeadless } = require("../../core/adapters/headless");
const { listRoles, ROLES_DIR } = require("../../core/roles");
const baseInstall = require("../../core/adapters/base-install");
const RULES_DIR = baseInstall.RULES_DIR;
const SKILLS_DIR = baseInstall.SKILLS_DIR;

// Codex uses the bare role name (no `dev-` prefix, no `-engineer` suffix),
// matching the filenames in roles/. The list comes from core/roles.js,
// which scans roles/*.md as the source of truth — adding a role brief
// there makes it visible here automatically.
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
    notes: missing.length === 0 ? ["codex install looks healthy"] : [],
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
  lines.push(`Workstream: ${descriptor.workstreamId} (role: ${descriptor.role}, host: codex)`);
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
  const { allowedWritesCaption, appendGateFooter } = require("../../core/adapters/render-helpers");
  lines.push(allowedWritesCaption(capabilities.enforces.allowed_writes, capabilities.displayName || "codex"));
  for (const f of descriptor.allowedWrites) lines.push(`- ${f}`);
  lines.push("");
  lines.push(`## Artifact`);
  lines.push(`Produce \`${descriptor.artifact}\` using \`templates/${descriptor.template}\`.`);
  lines.push("");
  appendGateFooter(lines, descriptor, ctx, "codex");
  return lines.join("\n");
}

function invoke(descriptor, ctx, preRenderedPrompt) {
  return runHeadless(module.exports, descriptor, ctx, preRenderedPrompt);
}

module.exports = {
  capabilities,
  install,
  uninstall,
  status,
  renderStagePrompt,
  invoke,
};
