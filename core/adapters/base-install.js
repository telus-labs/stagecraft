// Shared install helpers used by every host adapter.
//
// Each host's `install()` orchestrates a sequence of artifact-type
// installs (roles, rules, skills, commands, settings). Some of those
// are identical across hosts; others differ. This module covers the
// IDENTICAL ones so they live in one place:
//
//   - installRules: copy framework rules/*.md → target/.devteam/rules/
//   - installTemplates: copy framework templates/** → target/.devteam/templates/
//   - installSkills: copy framework skills/<name>/ → target/<capabilities.skillsDir>/<name>/
//
// Per-host helpers (claude-code's installCommands + installSettings,
// each adapter's installRoles which differs in rendering) stay in
// the adapter. The pattern is: this module provides building blocks;
// the adapter composes them.

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RULES_DIR = path.join(REPO_ROOT, "rules");
const SKILLS_DIR = path.join(REPO_ROOT, "skills");
const TEMPLATES_DIR = path.join(REPO_ROOT, "templates");

// Returns { written, skipped, warnings } — same shape as adapter install
// helpers, so the per-adapter install() can spread the arrays directly.
function installRules(targetDir, opts = {}) {
  const rulesDir = path.join(targetDir, ".devteam", "rules");
  fs.mkdirSync(rulesDir, { recursive: true });
  const written = [];
  const skipped = [];
  if (!fs.existsSync(RULES_DIR)) {
    return { written, skipped, warnings: [`no rules source at ${RULES_DIR}`] };
  }
  for (const f of fs.readdirSync(RULES_DIR)) {
    if (!f.endsWith(".md")) continue;
    const src = path.join(RULES_DIR, f);
    const dest = path.join(rulesDir, f);
    if (fs.existsSync(dest) && !opts.force) {
      skipped.push(dest);
      continue;
    }
    fs.copyFileSync(src, dest);
    written.push(dest);
  }
  return { written, skipped, warnings: [] };
}

function copyTree(srcDir, destDir, opts, written, skipped) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const f of fs.readdirSync(srcDir)) {
    const src = path.join(srcDir, f);
    const dest = path.join(destDir, f);
    if (fs.statSync(src).isDirectory()) {
      copyTree(src, dest, opts, written, skipped);
      continue;
    }
    if (fs.existsSync(dest) && !opts.force) {
      skipped.push(dest);
      continue;
    }
    fs.copyFileSync(src, dest);
    written.push(dest);
  }
}

function installTemplates(targetDir, opts = {}) {
  const written = [];
  const skipped = [];
  if (!fs.existsSync(TEMPLATES_DIR)) {
    return { written, skipped, warnings: [`no templates source at ${TEMPLATES_DIR}`] };
  }
  copyTree(TEMPLATES_DIR, path.join(targetDir, ".devteam", "templates"), opts, written, skipped);
  return { written, skipped, warnings: [] };
}

// Copy every framework skill into the target's per-host skills directory.
// capabilities.skillsDir varies per host (".claude/skills",
// ".codex/skills", ".gemini/skills") so it's passed in.
function installSkills(targetDir, capabilitiesSkillsDir, opts = {}) {
  const written = [];
  const skipped = [];
  if (!fs.existsSync(SKILLS_DIR)) {
    return { written, skipped, warnings: [`no skills source at ${SKILLS_DIR}`] };
  }
  const destBase = path.join(targetDir, capabilitiesSkillsDir);
  for (const skill of fs.readdirSync(SKILLS_DIR)) {
    const srcDir = path.join(SKILLS_DIR, skill);
    if (!fs.statSync(srcDir).isDirectory()) continue;
    const destDir = path.join(destBase, skill);
    fs.mkdirSync(destDir, { recursive: true });
    for (const f of fs.readdirSync(srcDir)) {
      const src = path.join(srcDir, f);
      const dest = path.join(destDir, f);
      if (fs.existsSync(dest) && !opts.force) {
        skipped.push(dest);
        continue;
      }
      fs.copyFileSync(src, dest);
      written.push(dest);
    }
  }
  return { written, skipped, warnings: [] };
}

// Symmetric uninstall: remove the rules + skills laid down by installRules
// and installSkills. Leaves empty dirs in place (the uninstaller doesn't
// know if the user has unrelated files there).
function uninstallRules(targetDir) {
  const rulesDir = path.join(targetDir, ".devteam", "rules");
  if (!fs.existsSync(rulesDir) || !fs.existsSync(RULES_DIR)) return;
  for (const f of fs.readdirSync(RULES_DIR)) {
    if (!f.endsWith(".md")) continue;
    const p = path.join(rulesDir, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

function removeTreeFiles(srcDir, destDir) {
  if (!fs.existsSync(srcDir) || !fs.existsSync(destDir)) return;
  for (const f of fs.readdirSync(srcDir)) {
    const src = path.join(srcDir, f);
    const dest = path.join(destDir, f);
    if (fs.statSync(src).isDirectory()) {
      removeTreeFiles(src, dest);
      try { fs.rmdirSync(dest); } catch { /* not empty — leave it */ }
      continue;
    }
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
  }
}

function uninstallTemplates(targetDir) {
  removeTreeFiles(TEMPLATES_DIR, path.join(targetDir, ".devteam", "templates"));
}

function uninstallSkills(targetDir, capabilitiesSkillsDir) {
  const skillsBase = path.join(targetDir, capabilitiesSkillsDir);
  if (!fs.existsSync(skillsBase) || !fs.existsSync(SKILLS_DIR)) return;
  for (const skill of fs.readdirSync(SKILLS_DIR)) {
    const dir = path.join(skillsBase, skill);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      try { fs.unlinkSync(path.join(dir, f)); } catch { /* */ }
    }
    try { fs.rmdirSync(dir); } catch { /* not empty — leave it */ }
  }
}

module.exports = {
  installRules,
  installTemplates,
  installSkills,
  uninstallRules,
  uninstallTemplates,
  uninstallSkills,
  RULES_DIR,
  TEMPLATES_DIR,
  SKILLS_DIR,
};
