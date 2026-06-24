// Shared adapter logic for markdown-prompt hosts (codex, gemini-cli).
//
// Both hosts install plain-markdown role prompts, share the same
// install/uninstall/status/renderStagePrompt shape, and differ only in
// their capabilities.json values (name, rolePromptsDir, etc.).
// makeMarkdownHostAdapter(capabilities) returns the four shared functions;
// each adapter supplies its own invoke() since it captures module.exports.

const fs = require("node:fs");
const path = require("node:path");

const { listRoles, ROLES_DIR } = require("../roles");
const baseInstall = require("./base-install");
const { renderPatchBlock, allowedWritesCaption, appendGateFooter, toolBudgetSection } = require("./render-helpers");

const RULES_DIR = baseInstall.RULES_DIR;
const SKILLS_DIR = baseInstall.SKILLS_DIR;

function makeMarkdownHostAdapter(capabilities) {
  const ROLES = listRoles();
  const hostName = capabilities.name;

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
      notes: missing.length === 0 ? [`${hostName} install looks healthy`] : [],
    };
  }

  function renderStagePrompt(descriptor, ctx) {
    const promptRole = descriptor.subagent || descriptor.role;
    const rolePromptPath = `${capabilities.rolePromptsDir}/${promptRole}.md`;
    const lines = [];
    lines.push(`# Stage ${descriptor.stage} — ${descriptor.name}`);
    lines.push(`Workstream: ${descriptor.workstreamId} (role: ${descriptor.role}, host: ${hostName})`);
    lines.push(`Track: ${ctx.track}`);
    if (ctx.feature) lines.push(`Feature: ${ctx.feature}`);
    renderPatchBlock(ctx, lines);
    lines.push("");
    lines.push(`Read the role prompt at \`${rolePromptPath}\` before acting on this stage.`);
    lines.push("");
    lines.push(`## Objective`);
    lines.push(descriptor.objective);
    lines.push("");
    lines.push(`## Read first`);
    for (const f of descriptor.readFirst) lines.push(`- ${f}`);
    lines.push("");
    lines.push(allowedWritesCaption(capabilities.enforces.allowed_writes, capabilities.displayName || hostName));
    for (const f of descriptor.allowedWrites) lines.push(`- ${f}`);
    if (descriptor.allowedWrites.some((f) => f.includes("<"))) {
      lines.push("(Note: `<name>` tokens above are placeholders — substitute your actual value.");
      lines.push(" For example, write to `pipeline/code-review/by-qa.md`, NOT `pipeline/code-review/by-<reviewer>.md`.)");
    }
    lines.push("");
    const budgetSection = toolBudgetSection(descriptor.toolBudget, capabilities.enforces.tool_budget);
    if (budgetSection) { lines.push(budgetSection); lines.push(""); }
    lines.push(`## Artifact`);
    lines.push(`Produce \`${descriptor.artifact}\` using \`templates/${descriptor.template}\`.`);
    lines.push("");
    appendGateFooter(lines, descriptor, ctx, hostName);
    return lines.join("\n");
  }

  return { install, uninstall, status, renderStagePrompt };
}

module.exports = { makeMarkdownHostAdapter };
