// Claude Code host adapter.
//
// install: renders roles/*.md into <target>/.claude/agents/<name>.md with
//          per-role Claude Code YAML frontmatter, and copies slash commands
//          from install/commands/ into <target>/.claude/commands/.
// renderStagePrompt: emits a Claude-Code-idiomatic stage prompt that
//          delegates to the subagent file installed above.
// status:  verifies installed files exist and are non-empty.
// uninstall: removes the files install() laid down.
//
// Hooks and headless `claude --print` invoke are declared in capabilities
// but not yet wired — deferred to a follow-up.

const fs = require("node:fs");
const path = require("node:path");

const capabilities = require("./capabilities.json");
const { runHeadless } = require("../../core/adapters/headless");
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ROLES_DIR = path.join(REPO_ROOT, "roles");
const RULES_DIR = path.join(REPO_ROOT, "rules");
const COMMANDS_SRC = path.join(__dirname, "install", "commands");

// Per-role frontmatter for Claude Code subagent files. The `name` field is
// the filename stem the agent is invoked under inside Claude Code.
const ROLE_FRONTMATTER = {
  pm: {
    name: "pm",
    description: "Product Manager. Owns the brief, acceptance criteria, scope, sign-off, and stakeholder summaries. Represents the customer; does not make technical decisions.",
    tools: "Read, Write, Glob",
    model: "opus",
    permissionMode: "acceptEdits",
  },
  principal: {
    name: "principal",
    description: "Principal Engineer. Owns the design spec, ADRs, and technical rulings. Has veto power on architecture and on escalated code review conflicts.",
    tools: "Read, Write, Glob, Grep, Bash",
    model: "opus",
    permissionMode: "acceptEdits",
  },
  reviewer: {
    name: "reviewer",
    description: "Peer reviewer for Stage 5. READ-ONLY during a review invocation; writes only to pipeline/code-review/by-<area>.md. Does not edit source or write stage gates directly.",
    tools: "Read, Write, Glob, Grep",
    model: "sonnet",
    permissionMode: "acceptEdits",
  },
  security: {
    name: "security-engineer",
    description: "Security reviewer for changes touching auth, crypto, PII, payments, secrets, IaC, or new/upgraded external dependencies. Has veto power on Stage 4a security gates.",
    tools: "Read, Write, Glob, Grep, Bash",
    model: "opus",
    permissionMode: "acceptEdits",
  },
  backend: {
    name: "dev-backend",
    description: "Backend implementer. Owns src/backend/. Implements APIs, services, data layer; runs local verification; writes the backend workstream gate.",
    tools: "Read, Write, Edit, Glob, Grep, Bash",
    model: "sonnet",
    permissionMode: "acceptEdits",
  },
  frontend: {
    name: "dev-frontend",
    description: "Frontend implementer. Owns src/frontend/. Implements UI; runs local verification; writes the frontend workstream gate.",
    tools: "Read, Write, Edit, Glob, Grep, Bash",
    model: "sonnet",
    permissionMode: "acceptEdits",
  },
  platform: {
    name: "dev-platform",
    description: "Platform/infra implementer. Owns src/infra/, CI, pre-review (Stage 4a) lint/test/SCA, and Stage 8 deploy. Writes the platform workstream gate.",
    tools: "Read, Write, Edit, Glob, Grep, Bash",
    model: "sonnet",
    permissionMode: "acceptEdits",
  },
  qa: {
    name: "dev-qa",
    description: "QA. Owns src/tests/ and the Stage 6 test-execution gate. Maps each acceptance criterion to a test 1:1; does not own infra or deploy.",
    tools: "Read, Write, Edit, Glob, Grep, Bash",
    model: "sonnet",
    permissionMode: "acceptEdits",
  },
};

function frontmatterFor(role) {
  const fm = ROLE_FRONTMATTER[role];
  if (!fm) throw new Error(`No frontmatter defined for role "${role}" in claude-code adapter`);
  const lines = ["---"];
  lines.push(`name: ${fm.name}`);
  lines.push(`description: >`);
  for (const wrapped of wrapText(fm.description, 72)) lines.push(`  ${wrapped}`);
  lines.push(`tools: ${fm.tools}`);
  lines.push(`model: ${fm.model}`);
  lines.push(`permissionMode: ${fm.permissionMode}`);
  lines.push("---");
  return { yaml: lines.join("\n"), filename: `${fm.name}.md` };
}

function wrapText(text, width) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    if (line.length + w.length + 1 > width && line.length > 0) {
      lines.push(line);
      line = w;
    } else {
      line = line ? `${line} ${w}` : w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function installRoles(targetDir, opts) {
  const agentsDir = path.join(targetDir, capabilities.agentsDir);
  fs.mkdirSync(agentsDir, { recursive: true });
  const written = [];
  const skipped = [];
  const warnings = [];
  const rolesToInstall = opts.roles && opts.roles.length > 0
    ? opts.roles
    : Object.keys(ROLE_FRONTMATTER);

  for (const role of rolesToInstall) {
    const briefPath = path.join(ROLES_DIR, `${role}.md`);
    if (!fs.existsSync(briefPath)) {
      warnings.push(`role brief missing: ${briefPath}`);
      continue;
    }
    const { yaml, filename } = frontmatterFor(role);
    const out = path.join(agentsDir, filename);
    if (fs.existsSync(out) && !opts.force) {
      skipped.push(out);
      continue;
    }
    const body = fs.readFileSync(briefPath, "utf8");
    fs.writeFileSync(out, `${yaml}\n\n${body}`, "utf8");
    written.push(out);
  }
  return { written, skipped, warnings };
}

function installCommands(targetDir, opts) {
  const commandsDir = path.join(targetDir, capabilities.commandsDir);
  fs.mkdirSync(commandsDir, { recursive: true });
  const written = [];
  const skipped = [];
  if (!fs.existsSync(COMMANDS_SRC)) {
    return { written, skipped, warnings: [`no commands payload at ${COMMANDS_SRC}`] };
  }
  for (const f of fs.readdirSync(COMMANDS_SRC)) {
    const src = path.join(COMMANDS_SRC, f);
    const dest = path.join(commandsDir, f);
    if (fs.existsSync(dest) && !opts.force) {
      skipped.push(dest);
      continue;
    }
    fs.copyFileSync(src, dest);
    written.push(dest);
  }
  return { written, skipped, warnings: [] };
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

function renderSettingsLocal() {
  const validatorPath = path.join(REPO_ROOT, "core", "gates", "validator.js");
  const cmd = `node ${JSON.stringify(validatorPath)}`;
  return {
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: cmd }] }],
      SubagentStop: [{ hooks: [{ type: "command", command: cmd }] }],
    },
    permissions: {
      allow: [
        "Bash(devteam *)",
        "Bash(npm run *)",
        "Bash(npm test *)",
        "Write(src/**)",
        "Write(pipeline/**)",
        "Write(.claude/agents/**)",
      ],
      deny: [
        "Bash(rm -rf *)",
        "Bash(git push --force *)",
        "Bash(git push -f *)",
      ],
    },
  };
}

function installSettings(targetDir, opts) {
  const dir = path.join(targetDir, ".claude");
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, "settings.local.json");
  if (fs.existsSync(dest) && !opts.force) {
    return { written: [], skipped: [dest], warnings: [] };
  }
  fs.writeFileSync(dest, JSON.stringify(renderSettingsLocal(), null, 2) + "\n", "utf8");
  return { written: [dest], skipped: [], warnings: [] };
}

function install(targetDir, opts = {}) {
  const o = { force: false, roles: [], isolation: "in-place", ...opts };
  const roles = installRoles(targetDir, o);
  const commands = installCommands(targetDir, o);
  const rules = installRules(targetDir, o);
  const settings = installSettings(targetDir, o);
  return {
    written: [...roles.written, ...commands.written, ...rules.written, ...settings.written],
    skipped: [...roles.skipped, ...commands.skipped, ...rules.skipped, ...settings.skipped],
    warnings: [...roles.warnings, ...commands.warnings, ...rules.warnings, ...settings.warnings],
  };
}

function uninstall(targetDir) {
  const agentsDir = path.join(targetDir, capabilities.agentsDir);
  if (fs.existsSync(agentsDir)) {
    for (const role of Object.keys(ROLE_FRONTMATTER)) {
      const { filename } = frontmatterFor(role);
      const p = path.join(agentsDir, filename);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }
  const commandsDir = path.join(targetDir, capabilities.commandsDir);
  if (fs.existsSync(commandsDir) && fs.existsSync(COMMANDS_SRC)) {
    for (const f of fs.readdirSync(COMMANDS_SRC)) {
      const p = path.join(commandsDir, f);
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
  const settings = path.join(targetDir, ".claude", "settings.local.json");
  if (fs.existsSync(settings)) fs.unlinkSync(settings);
}

function status(targetDir) {
  const missing = [];
  const stale = [];
  for (const role of Object.keys(ROLE_FRONTMATTER)) {
    const { filename } = frontmatterFor(role);
    const p = path.join(targetDir, capabilities.agentsDir, filename);
    if (!fs.existsSync(p)) missing.push(p);
    else if (fs.statSync(p).size === 0) stale.push(p);
  }
  const cmd = path.join(targetDir, capabilities.commandsDir, "devteam.md");
  if (!fs.existsSync(cmd)) missing.push(cmd);
  if (fs.existsSync(RULES_DIR)) {
    for (const f of fs.readdirSync(RULES_DIR)) {
      if (!f.endsWith(".md")) continue;
      const p = path.join(targetDir, ".devteam", "rules", f);
      if (!fs.existsSync(p)) missing.push(p);
    }
  }
  const settings = path.join(targetDir, ".claude", "settings.local.json");
  if (!fs.existsSync(settings)) missing.push(settings);
  return {
    ok: missing.length === 0 && stale.length === 0,
    missing,
    stale,
    notes: missing.length === 0 ? ["claude-code install looks healthy"] : [],
  };
}

function renderStagePrompt(descriptor, ctx) {
  const fm = ROLE_FRONTMATTER[descriptor.role];
  const agentName = fm ? fm.name : descriptor.role;
  const lines = [];
  lines.push(`# Stage ${descriptor.stage} — ${descriptor.name}`);
  lines.push(`Workstream: ${descriptor.workstreamId} (role: ${descriptor.role}, host: claude-code)`);
  lines.push(`Track: ${ctx.track}`);
  if (ctx.feature) lines.push(`Feature: ${ctx.feature}`);
  lines.push("");
  lines.push(`Use the **${agentName}** subagent (\`.claude/agents/${agentName}.md\`) for this workstream.`);
  lines.push("");
  lines.push(`## Objective`);
  lines.push(descriptor.objective);
  lines.push("");
  lines.push(`## Read first`);
  for (const f of descriptor.readFirst) lines.push(`- ${f}`);
  lines.push("");
  lines.push(`## Allowed writes (enforced by Claude Code hooks at tool-call time)`);
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
  lines.push(`The orchestrator adds \`"orchestrator": "${ctx.orchestrator}"\` and \`"host": "claude-code"\` at validation time.`);
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
