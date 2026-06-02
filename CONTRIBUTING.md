# Contributing to Stagecraft

Concrete recipes for the four most common kinds of change.

Before anything: read [`AGENTS.md`](AGENTS.md) for the load-bearing contracts. Edits that break them in the wrong way silently corrupt downstream behavior — Stagecraft has a tier-1 test suite that catches most contract regressions, so the burden is on you.

## Setup

```bash
git clone <repo> && cd stagecraft
npm install
./bin/devteam help    # verify it loads
```

Run smoke tests with a temp target project:

```bash
TMPDIR=$(mktemp -d)
./bin/devteam init --host claude-code --cwd "$TMPDIR"
./bin/devteam stages --cwd "$TMPDIR"
./bin/devteam stage requirements --cwd "$TMPDIR" --feature "Test feature"
```

## Recipe 1 — Adding a host adapter

You want to add support for a new AI tool (e.g. Gemini CLI, Cursor, Aider).

1. **Create the directory and capabilities.**
   ```bash
   mkdir -p hosts/<name>/install
   ```
   `hosts/<name>/capabilities.json` declares what the host can do. See `hosts/codex/capabilities.json` for a minimal example. Key fields:
   - `hooks`, `subagents`, `slashCommands`, `worktrees`, `headless` — booleans
   - `headlessCommand` — the shell command if `headless: true` (e.g. `"gemini --print"`)
   - `enforces` — where the host enforces each core rule (`tool-call-time` / `post-hoc-audit` / `prompt-only`)
   - Path conventions: `skillsDir`, `commandsDir`, `agentsDir`, `rolePromptsDir` — whichever apply

2. **Implement the adapter contract** in `hosts/<name>/adapter.js`. See `core/adapters/host-adapter.md` for the formal contract. Required methods: `install`, `renderStagePrompt`, `status`, `uninstall`. Optional: `invoke` (only if `headless: true`).

   For headless, reuse the shared helper:
   ```js
   const { runHeadless } = require("../../core/adapters/headless");
   function invoke(d, c) { return runHeadless(module.exports, d, c); }
   ```

3. **Install payload**, if any. Anything host-specific that needs to be copied to the target project goes under `hosts/<name>/install/`. The adapter's `install()` function copies these to the right place in the target.

4. **Mirror `installRoles`, `installRules`, `installSkills`** from an existing adapter. Each adapter is responsible for laying down the host-specific copies of the shared `roles/`, `rules/`, and `skills/` directories.

5. **Verify locally.**
   ```bash
   ./bin/devteam hosts                    # new host appears
   TMPDIR=$(mktemp -d)
   ./bin/devteam init --host <name> --cwd "$TMPDIR"
   find "$TMPDIR" -type f                 # expected files landed
   ```

6. **Add a tier-1 contract assertion** (when the test suite exists): your adapter must export `capabilities`, `install`, `renderStagePrompt`, `status`, `uninstall` — same shape as `tests/adapter-contract.test.js` will assert.

Examples to copy from:
- `hosts/generic/` — minimal; install is a no-op.
- `hosts/codex/` — moderate; renders roles + rules + skills, no hooks/commands.
- `hosts/claude-code/` — full; everything including hooks payload + slash command.

## Recipe 2 — Adding a stage

You want to insert a new stage (e.g. an accessibility audit between QA and sign-off).

1. **Define the stage in `core/pipeline/stages.js`.** Choose:
   - `stage` id (e.g. `"stage-06a"` or `"stage-08b"`). Numbering convention: `stage-NN` for top-level, `stage-NNa`/`stage-NNb` for sub-stages of NN.
   - `roles` — array. Single role = `["platform"]`. Multi-role = `["backend", "frontend", "platform", "qa"]`.
   - `objective`, `readFirst`, `allowedWrites`, `artifact`, `template`, `gate` (skeleton).
   - Optional: `roleWrites` (per-role allowedWrites map), `subagent` (forces all workstreams to a named subagent), `conditionalOn` ({stage, field, equals} — skip unless prereq matches).

2. **Add to `ORDERED_STAGE_NAMES`** at the right position.

3. **Add to `STAGES_BY_TRACK`** for each track that should run it. Conditional stages still need to be in the track list — the conditional skip happens at runtime, not at track filtering.

4. **Create the gate schema** at `core/gates/schemas/<stage>.schema.json`. Stage-specific required fields only — the base fields (`stage`, `status`, `orchestrator`, …) come from `gate.schema.json`.

5. **Update `rules/gates.md`** with a section under `## Stage-Specific Extra Fields` documenting the gate body for the new stage.

6. **Add a per-stage rules file** at `rules/stage-NN.md` (e.g. `stage-04d.md` for a new sub-stage between 4c and 5). Add a row to the index table in `rules/pipeline-build.md` pointing at it. For stages 1–3 or 9, append the section to `pipeline-core.md` instead. For track-level behavior, edit `pipeline-tracks.md`.

7. **If the stage needs a new role**, see Recipe 3.

8. **Verify locally.**
   ```bash
   ./bin/devteam stages                   # new name appears
   TMPDIR=$(mktemp -d)
   ./bin/devteam init --host claude-code --cwd "$TMPDIR"
   ./bin/devteam stage <name> --cwd "$TMPDIR"   # prompt renders
   ```

## Recipe 3 — Adding a role

You want a new role (e.g. `compliance`, `accessibility`, `data-engineer`).

1. **Write the host-neutral role brief** at `roles/<role>.md`. Use existing briefs as templates. Structure:
   - Opening paragraph: who you are, what you own, what you don't.
   - `## Read First` — files the role reads at start of any task.
   - `## Writes` — paths the role writes to.
   - `## Handoff` — what gets passed to the next stage.
   - `## Standing Rules`, `## Gate Writing Rules`, `## Escalation Triggers` — the operational rules.

2. **Update each adapter that uses subagents** (currently `hosts/claude-code/adapter.js`). Add an entry to `ROLE_FRONTMATTER`:
   ```js
   <role>: {
     name: "dev-<role>",                  // or just the role name
     description: "...",
     tools: "Read, Write, Edit, Glob, Grep, Bash",
     model: "sonnet",                     // or "opus" / "haiku"
     permissionMode: "acceptEdits",
   }
   ```

3. **Reference from at least one stage's `roles` array** in `stages.js`. A role with no stage assignment is dead code.

4. **If the role uses a different subagent than its name** (like peer-review's `subagent: "reviewer"`), declare that on the stage, not on the role.

5. **Update `rules/orchestrator.md`** to list the role under `## The Team`.

6. **Verify.**
   ```bash
   ./bin/devteam stage <stage-using-the-role> --cwd "$TMPDIR"
   # Prompt should say "Use the <name> subagent (.claude/agents/<name>.md)"
   ```

## Recipe 4 — Adding a skill

Skills are task-oriented helpers the LLM consults when doing specific tasks (writing code to a convention, running a self-review, etc.). They're host-neutral.

1. **Create the skill directory** at `skills/<name>/` with at minimum a `SKILL.md`. Optional sub-files for examples or longer explanations.

2. **Skill front-matter (`SKILL.md`)** doesn't need YAML headers — adapters add host-specific wrappers if needed. Just write the body as plain markdown:
   ```markdown
   # <Skill Name>

   Use this skill when …

   ## Inputs
   - …

   ## Steps
   1. …
   ```

3. **No additional registration needed.** Both `hosts/claude-code/adapter.js` and `hosts/codex/adapter.js` auto-iterate `skills/` and copy each directory into the host's expected skills path.

4. **Reference from a role brief if relevant.** Skills don't "fire" automatically — they have to be invoked. The role brief is where you tell the LLM "consult this skill when doing X."

5. **Verify.**
   ```bash
   TMPDIR=$(mktemp -d)
   ./bin/devteam init --host claude-code --cwd "$TMPDIR"
   ls "$TMPDIR/.claude/skills/<name>/"
   ```

## Style guidance

- **No comments-as-documentation in code.** If a fact needs explaining and isn't obvious from the code, put it in a doc, not a multi-paragraph code comment. One-line "why this is here" comments are fine; docstrings aren't.
- **Strip version numbers from docs.** Stagecraft has no v1/v2/v3 — those are claude-dev-team's history. If you find a `(v2.X+)` annotation while editing, strip it.
- **Host-neutral first.** Anything that could go in shared (`roles/`, `rules/`, `skills/`, `templates/`, `core/`) and be rendered into host-specific paths by an adapter, should. Direct host-specific files only when there's no neutral form.
- **Path conventions.** `.devteam/` for the shared workspace in target projects. `AGENTS.md` for host-neutral context. `pipeline/` for artifacts. `pipeline/gates/<stage>.<workstream>.json` for workstream gates (dot separator, not hyphen).
- **No `agent` field.** Contract F removed it. Use `workstream` (role identity), `host` (adapter identity), `orchestrator` (orchestrator+version).

## Testing your change

Today: manual smoke test against a temp target project (see Setup above).

Soon ([`docs/TESTING.md`](docs/TESTING.md)): `npm test`. Until the tier-1 test suite lands, **the burden of regression-checking is on you**.

If your change touches a load-bearing contract from `AGENTS.md`, add the test in lockstep — don't wait for the suite to "happen later."

## Commit & PR style

- One logical change per commit; conventional commit subject (no `feat:`/`fix:` prefix — descriptive style; see `git log --oneline`).
- Commit messages explain *why*, not just *what*. Diff shows what; commit message answers "why is this the right change?"
- Reference the doc you updated alongside the code (e.g. "updates ARCHITECTURE.md decision #5"). Doc + code in the same commit.
- Sign off with `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` if Claude helped.
- Don't `git add -A` or `git add .`. Stage by name to avoid accidentally committing `node_modules/` artifacts or scratch files.

## Where to ask

- Design intent → `ARCHITECTURE.md`, then `docs/walkthroughs/`.
- Operational behavior → `docs/concepts.md`, then the relevant `rules/*.md`.
- "Why was X done this way?" → check the commit history first; the messages explain intent.

## Two anti-patterns

1. **Editing installed copies in a target project.** The single source of truth is here in `roles/`, `rules/`, `skills/`. Target-project copies are *rendered* by adapters at install time. Edits to the rendered copies get lost on the next install.

2. **Introducing host-specific logic in `core/`.** The core never invokes a model and never knows about `claude --print` or `codex exec`. If you need host-specific behavior, it goes in `hosts/<host>/adapter.js`. If you need shared host-behavior helpers, they go under `core/adapters/`.
