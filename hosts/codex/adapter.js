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
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ROLES_DIR = path.join(REPO_ROOT, "roles");
const RULES_DIR = path.join(REPO_ROOT, "rules");

// Role → filename mapping. Codex uses the bare role name (no `dev-` prefix
// and no `-engineer` suffix), matching what's already in roles/.
const ROLES = ["pm", "principal", "backend", "frontend", "platform", "qa", "reviewer", "security"];

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

function installRules(targetDir, opts) {
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

function install(targetDir, opts = {}) {
  const o = { force: false, roles: [], isolation: "in-place", ...opts };
  const roles = installRoles(targetDir, o);
  const rules = installRules(targetDir, o);
  return {
    written: [...roles.written, ...rules.written],
    skipped: [...roles.skipped, ...rules.skipped],
    warnings: [...roles.warnings, ...rules.warnings],
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
  const rulesDir = path.join(targetDir, ".devteam", "rules");
  if (fs.existsSync(rulesDir) && fs.existsSync(RULES_DIR)) {
    for (const f of fs.readdirSync(RULES_DIR)) {
      if (!f.endsWith(".md")) continue;
      const p = path.join(rulesDir, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }
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
  return {
    ok: missing.length === 0 && stale.length === 0,
    missing,
    stale,
    notes: missing.length === 0 ? ["codex install looks healthy"] : [],
  };
}

function renderStagePrompt(descriptor, ctx) {
  const rolePromptPath = `${capabilities.rolePromptsDir}/${descriptor.role}.md`;
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
  lines.push(`## Allowed writes (advisory — codex enforces this in prompt only; the gate validator catches violations post-hoc)`);
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
  lines.push(`The orchestrator adds \`"orchestrator": "${ctx.orchestrator}"\` and \`"host": "codex"\` at validation time.`);
  return lines.join("\n");
}

module.exports = {
  capabilities,
  install,
  uninstall,
  status,
  renderStagePrompt,
};
