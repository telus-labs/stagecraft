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
const { listRoles, ROLES_DIR } = require("../../core/roles");
const baseInstall = require("../../core/adapters/base-install");
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const RULES_DIR = baseInstall.RULES_DIR;
const SKILLS_DIR = baseInstall.SKILLS_DIR;
const COMMANDS_SRC = path.join(__dirname, "install", "commands");

// Per-role frontmatter for Claude Code subagent files. The `name` field is
// the filename stem the agent is invoked under inside Claude Code.
//
// The KEYS of this object are role names. They must be a subset of the
// roles discovered by core/roles.js (which scans roles/*.md). If a brief
// exists in roles/ but has no ROLE_FRONTMATTER entry, install will warn
// and skip — claude-code can't render a subagent without frontmatter.
// Add an entry below to enable a new role under claude-code.
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
  auditor: {
    name: "auditor",
    description: "Codebase auditor. Read-only by design — analyzes architecture, health, security, performance, code quality; produces docs/audit/00–10 outputs and a prioritized roadmap. Used by the /audit and /audit-quick slash commands. Never writes source code.",
    tools: "Read, Glob, Grep, Bash, Write",
    model: "opus",
    permissionMode: "acceptEdits",
  },
  "red-team": {
    name: "red-team",
    description: "Adversarial reviewer for stage-04c. Read-only on code — finds concrete attack scenarios, hostile inputs, race conditions, abuse cases, scale failures, downstream effects, observability gaps the spec didn't cover. Writes pipeline/red-team-report.md + stage-04c gate. Distinct from security-engineer (narrower auth/crypto/PII remit, conditional, has veto) and reviewer (code review at stage-05). Route to a DIFFERENT host than the build agents for maximum independence.",
    tools: "Read, Glob, Grep, Bash, Write",
    model: "opus",
    permissionMode: "acceptEdits",
  },
  migrations: {
    name: "migrations",
    description: "Migration-safety reviewer for stage-04d (conditional on data-layer diffs). Read-only on code — evaluates schema delta, breaking-change classification, backfill strategy, dual-write strategy, rollback plan + tested status. Writes pipeline/migration-safety.md + stage-04d gate. Has VETO power: a migration without a tested rollback halts the pipeline regardless of peer-review. Distinct from security-engineer (auth/crypto/PII), red-team (general adversarial), reviewer (code-level). Route to a different host than the build agents.",
    tools: "Read, Glob, Grep, Bash, Write",
    model: "opus",
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

  // Sanity check: every brief in roles/ should have a ROLE_FRONTMATTER
  // entry, otherwise it's a silent claude-code-only gap (the role would
  // be installed under codex/gemini but not as a claude-code subagent).
  // Warn but don't fail — adding the brief without the frontmatter is a
  // legitimate intermediate state.
  if (!opts.roles) {
    const briefsWithoutFrontmatter = listRoles().filter((r) => !ROLE_FRONTMATTER[r]);
    for (const r of briefsWithoutFrontmatter) {
      warnings.push(
        `role "${r}" has a brief at roles/${r}.md but no ROLE_FRONTMATTER entry in hosts/claude-code/adapter.js — ` +
        `skipped on this host. Add an entry to enable the subagent.`,
      );
    }
  }

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

function renderSettingsLocal() {
  const validatorPath = path.join(REPO_ROOT, "core", "gates", "validator.js");
  const approvalDerivationPath = path.join(REPO_ROOT, "core", "hooks", "approval-derivation.js");
  const secretScanPath = path.join(REPO_ROOT, "core", "hooks", "secret-scan.js");
  const validateCmd = `node ${JSON.stringify(validatorPath)}`;
  const approvalCmd = `node ${JSON.stringify(approvalDerivationPath)}`;
  const secretScanCmd = `node ${JSON.stringify(secretScanPath)}`;
  return {
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: validateCmd }] }],
      SubagentStop: [{ hooks: [{ type: "command", command: validateCmd }] }],
      PreToolUse: [
        { matcher: "Write|Edit", hooks: [{ type: "command", command: secretScanCmd }] },
      ],
      PostToolUse: [
        { matcher: "Write|Edit", hooks: [{ type: "command", command: approvalCmd }] },
      ],
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
  const rules = baseInstall.installRules(targetDir, o);
  const skills = baseInstall.installSkills(targetDir, capabilities.skillsDir, o);
  const settings = installSettings(targetDir, o);
  return {
    written: [...roles.written, ...commands.written, ...rules.written, ...skills.written, ...settings.written],
    skipped: [...roles.skipped, ...commands.skipped, ...rules.skipped, ...skills.skipped, ...settings.skipped],
    warnings: [...roles.warnings, ...commands.warnings, ...rules.warnings, ...skills.warnings, ...settings.warnings],
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
  baseInstall.uninstallRules(targetDir);
  const settings = path.join(targetDir, ".claude", "settings.local.json");
  if (fs.existsSync(settings)) fs.unlinkSync(settings);
  baseInstall.uninstallSkills(targetDir, capabilities.skillsDir);
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
    notes: missing.length === 0 ? ["claude-code install looks healthy"] : [],
  };
}

function renderStagePrompt(descriptor, ctx) {
  // descriptor.subagent (when set) overrides the role-to-agent mapping —
  // used by stages like peer-review where every workstream-area dispatches
  // to the same reviewer subagent.
  const fm = descriptor.subagent
    ? ROLE_FRONTMATTER[descriptor.subagent]
    : ROLE_FRONTMATTER[descriptor.role];
  const agentName = fm ? fm.name : (descriptor.subagent || descriptor.role);
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
  lines.push("");
  lines.push(`## Optional: cost telemetry`);
  lines.push(`If you know your token usage for this dispatch, include these fields in the gate JSON:`);
  lines.push("- `model`: the specific model id you ran on (e.g. `claude-opus-4-7`).");
  lines.push("- `tokens_in`: total input tokens (prompt + history).");
  lines.push("- `tokens_out`: total output tokens you generated.");
  lines.push("- `duration_ms`: wall-clock time for this dispatch.");
  lines.push("");
  lines.push("`cost_usd` will be computed by downstream tooling (`scripts/dashboard.js --view cost`) from these fields plus `core/pricing.js`. Omit any field you can't measure.");

  // C4 reproducibility — hash this very prompt and include the hash in
  // the gate skeleton hint so the agent records it verbatim. Computing
  // the hash AFTER all prior lines are pushed (excluding this block)
  // gives us a stable input — adding the C4 block to the prompt itself
  // doesn't change the hash because the hash is computed BEFORE that
  // block is appended.
  const { hashSystemPrompt } = require("../../core/reproducibility");
  const promptUpToHere = lines.join("\n");
  const systemPromptHash = hashSystemPrompt(promptUpToHere);
  lines.push("");
  lines.push(`## Optional: reproducibility (C4)`);
  lines.push("For audit trails and replay, include these fields in the gate JSON when known:");
  lines.push("- `model_version`: vendor's exact version string (e.g. `claude-opus-4-7-20251104`). Distinct from `model`.");
  lines.push("- `temperature`: sampling temperature used (number).");
  lines.push("- `seed`: RNG seed if your host supports seeded sampling.");
  lines.push("- `max_tokens`: max_tokens parameter passed to the model.");
  lines.push("- `tools_hash`: sha256 of the sorted list of tool names you had access to (use `core/reproducibility.hashTools`).");
  lines.push("");
  lines.push("**Stamp this field verbatim into the gate** — it's the hash of the prompt you're reading right now:");
  lines.push("```json");
  lines.push(`"system_prompt_hash": "${systemPromptHash}"`);
  lines.push("```");
  lines.push("");
  lines.push("Recording these fields makes the run auditable — `devteam reproduce <stage>` can later compare against current config and surface drift.");
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
