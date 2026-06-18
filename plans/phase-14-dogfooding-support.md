# Phase 14 — Dogfooding Support

**Goal:** make it practical to run Stagecraft against its own source tree. The manual setup in
`stagecraft-dogfooding-guide.md` requires 8 steps and discipline to avoid committing pipeline
artifacts or accidentally editing framework files. This phase mechanises those safeguards into
`devteam init --profile dogfood` and its companion doctor checks, adds a preflight gate that
blocks staged pipeline artifacts from reaching peer-review, and emits an early warning when
`devteam run` is started with no budget cap.

**Tracking:** GitHub issue #130 — "feat: add dogfooding support (devteam init --profile dogfood
and supporting tooling)".

**Order:** 14.1 → 14.2 → 14.3 → 14.4 → 14.5 (14.5 builds on 14.1–14.2 existing).

---

## Background: what dogfooding needs

When Stagecraft runs against itself:

1. **Infrastructure guard** — a pre-commit hook that blocks changes to `core/`, `bin/devteam`,
   `pipeline/stages/`, `roles/`, `rules/`. Without this, a misguided agent could commit changes
   to the framework it is driving.

2. **Pipeline artifact isolation** — generated pipeline documents (`pipeline/brief.md`,
   `pipeline/context.md`, `pipeline/spec.feature`, `pipeline/runbook.md`, `pipeline/test-report.md`,
   `pipeline/code-review/`) must not be committed into the Stagecraft repo. Phase 12's canonical
   gitignore block already covers volatile runtime files; dogfood mode adds a supplemental block
   for the document artifacts.

3. **Deploy spec exclusion** — `pipeline/stages/deploy.md` (a Stagecraft-specific deploy spec
   for self-hosted deploy) belongs in `.git/info/exclude`, not `.gitignore`, so it is invisible
   to git without touching the committed gitignore.

4. **Budget discipline** — dogfood runs must set `--budget-usd`; an unbounded run on the framework
   repo can exhaust spend before a human can intervene.

5. **Staged-artifacts guard** — the preflight stage (stage-04e) should block a PR if any
   pipeline artifact files appear in the git index.

---

## Config schema addition

`--profile dogfood` writes a new top-level key to `.devteam/config.yml`:

```yaml
profile: dogfood   # set by devteam init --profile dogfood; enables dogfood-mode doctor checks
```

No other config keys change. `loadConfig` does not need to be updated — callers read
`config.profile` (or `parsed.profile`) directly. Default is absent/`undefined`.

---

## Supplemental gitignore block (dogfood mode)

A second managed block, separate from the Phase 12 canonical block, written only when
`--profile dogfood` is used. Canonical content:

```
# BEGIN stagecraft-dogfood — managed by devteam init --profile dogfood; do not edit manually
pipeline/brief.md
pipeline/context.md
pipeline/spec.feature
pipeline/runbook.md
pipeline/test-report.md
pipeline/code-review/
pipeline/changes/*/brief.md
pipeline/changes/*/context.md
pipeline/changes/*/spec.feature
pipeline/changes/*/runbook.md
pipeline/changes/*/test-report.md
pipeline/changes/*/code-review/
# END stagecraft-dogfood
```

The Phase 12 block is written first (or left if already present); the dogfood block is appended
below it. The two blocks coexist — the dogfood block is never merged into the Phase 12 block.

---

## Infrastructure guard pre-commit hook

Written to `.git/hooks/pre-commit` (executable, mode 0o755).

If a pre-commit hook already exists and does NOT contain `# stagecraft-dogfood`, prepend the
guard block inside the existing file (after the shebang line if present, otherwise at the top).
If it already contains `# stagecraft-dogfood`, skip.

Hook content written (or prepended):

```bash
#!/bin/bash
# stagecraft-dogfood: infrastructure guard — managed by devteam init --profile dogfood
BLOCKED_PREFIXES="core/ bin/devteam pipeline/stages/ roles/ rules/"
for f in $(git diff --cached --name-only); do
  for b in $BLOCKED_PREFIXES; do
    if [[ "$f" == ${b}* ]] || [[ "$f" == "$b" ]]; then
      echo "ERROR [dogfood guard]: cannot commit changes to Stagecraft infrastructure: $f"
      echo "       Stagecraft files must not be modified during a dogfood run."
      echo "       Use 'git restore --staged $f' to unstage, or fix the root cause."
      exit 1
    fi
  done
done
```

If prepending into an existing hook, do not duplicate the shebang. Insert after the first line
if that line is `#!/...`, otherwise prepend to the top.

---

## `.git/info/exclude` entry

Add the line `pipeline/stages/deploy.md` to `.git/info/exclude` (project-local, not committed).
If the file does not exist, create it. If the line already exists, skip.

---

## 14.1 `devteam init --profile dogfood`

**Deliverables:** `core/cli/commands/init.js` (add `--profile` flag + dogfood branch),
`core/gitignore.js` (add `writeDogfoodGitignoreBlock` and export), `tests/init.test.js`
(add dogfood-mode assertions).

### Changes

#### `core/gitignore.js`

Add alongside the existing `writeGitignoreBlock`:

```js
const DOGFOOD_BLOCK_BEGIN = "# BEGIN stagecraft-dogfood — managed by devteam init --profile dogfood; do not edit manually";
const DOGFOOD_BLOCK_END   = "# END stagecraft-dogfood";

const CANONICAL_DOGFOOD_BLOCK = `${DOGFOOD_BLOCK_BEGIN}
pipeline/brief.md
pipeline/context.md
pipeline/spec.feature
pipeline/runbook.md
pipeline/test-report.md
pipeline/code-review/
pipeline/changes/*/brief.md
pipeline/changes/*/context.md
pipeline/changes/*/spec.feature
pipeline/changes/*/runbook.md
pipeline/changes/*/test-report.md
pipeline/changes/*/code-review/
${DOGFOOD_BLOCK_END}`;

/**
 * Writes or updates the supplemental dogfood gitignore block.
 * Returns "wrote", "updated", or "skipped".
 */
function writeDogfoodGitignoreBlock(projectRoot) {
  const giPath = path.join(projectRoot, ".gitignore");
  const existing = fs.existsSync(giPath) ? fs.readFileSync(giPath, "utf8") : "";

  const beginIdx = existing.indexOf(DOGFOOD_BLOCK_BEGIN);
  const endIdx   = existing.indexOf(DOGFOOD_BLOCK_END);

  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    const currentBlock = existing.slice(beginIdx, endIdx + DOGFOOD_BLOCK_END.length);
    if (currentBlock === CANONICAL_DOGFOOD_BLOCK) return "skipped";
    const before = existing.slice(0, beginIdx);
    const after  = existing.slice(endIdx + DOGFOOD_BLOCK_END.length);
    fs.writeFileSync(giPath, before + CANONICAL_DOGFOOD_BLOCK + after, "utf8");
    return "updated";
  }

  const separator = (existing.length > 0 && !existing.endsWith("\n\n")) ? "\n" : "";
  fs.writeFileSync(giPath, existing + separator + CANONICAL_DOGFOOD_BLOCK + "\n", "utf8");
  return "wrote";
}
```

Export both functions: `module.exports = { writeGitignoreBlock, writeDogfoodGitignoreBlock };`

#### `core/cli/commands/init.js`

Add `--profile` flag to `flags`:
```js
profile: { type: "string", description: "Optional profile: dogfood" },
```

After the existing gitignore block write (around line 77), add the dogfood branch:

```js
if (_flags.profile === "dogfood") {
  const { writeDogfoodGitignoreBlock } = require(path.join(__dirname, "..", "..", "gitignore"));
  const dgr = writeDogfoodGitignoreBlock(cwd);
  console.log(dgr === "skipped"
    ? "  ✓ .gitignore dogfood block already up-to-date"
    : `  ✓ ${dgr === "wrote" ? "wrote" : "updated"} .gitignore (dogfood block)`);

  // Pre-commit infrastructure guard
  const hookDir  = path.join(cwd, ".git", "hooks");
  const hookPath = path.join(hookDir, "pre-commit");
  const GUARD_MARKER = "# stagecraft-dogfood: infrastructure guard";
  const GUARD_BLOCK = [
    "#!/bin/bash",
    "# stagecraft-dogfood: infrastructure guard — managed by devteam init --profile dogfood",
    'BLOCKED_PREFIXES="core/ bin/devteam pipeline/stages/ roles/ rules/"',
    'for f in $(git diff --cached --name-only); do',
    '  for b in $BLOCKED_PREFIXES; do',
    '    if [[ "$f" == ${b}* ]] || [[ "$f" == "$b" ]]; then',
    '      echo "ERROR [dogfood guard]: cannot commit changes to Stagecraft infrastructure: $f"',
    '      echo "       Stagecraft files must not be modified during a dogfood run."',
    '      echo "       Use \'git restore --staged $f\' to unstage, or fix the root cause."',
    '      exit 1',
    '    fi',
    '  done',
    'done',
  ].join("\n");

  if (!fs.existsSync(hookDir)) {
    console.log("  ⚠ .git/hooks/ not found — is this a git repository?");
  } else if (fs.existsSync(hookPath) && fs.readFileSync(hookPath, "utf8").includes(GUARD_MARKER)) {
    console.log("  ✓ pre-commit hook dogfood guard already present");
  } else if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, "utf8");
    const lines = existing.split("\n");
    const shebangLine = lines[0].startsWith("#!") ? lines[0] : null;
    const rest = shebangLine ? lines.slice(1).join("\n") : existing;
    const guardBody = GUARD_BLOCK.split("\n").slice(1).join("\n"); // skip #!/bin/bash
    const newContent = shebangLine
      ? shebangLine + "\n" + guardBody + "\n" + rest
      : GUARD_BLOCK + "\n" + existing;
    fs.writeFileSync(hookPath, newContent, "utf8");
    fs.chmodSync(hookPath, 0o755);
    console.log("  ✓ pre-commit hook: prepended dogfood infrastructure guard");
  } else {
    fs.mkdirSync(hookDir, { recursive: true });
    fs.writeFileSync(hookPath, GUARD_BLOCK + "\n", "utf8");
    fs.chmodSync(hookPath, 0o755);
    console.log("  ✓ wrote pre-commit hook (dogfood infrastructure guard)");
  }

  // .git/info/exclude entry
  const infoDir     = path.join(cwd, ".git", "info");
  const excludePath = path.join(infoDir, "exclude");
  const EXCLUDE_LINE = "pipeline/stages/deploy.md";
  if (fs.existsSync(infoDir)) {
    const exc = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, "utf8") : "";
    if (!exc.includes(EXCLUDE_LINE)) {
      const sep = exc.length > 0 && !exc.endsWith("\n") ? "\n" : "";
      fs.writeFileSync(excludePath, exc + sep + EXCLUDE_LINE + "\n", "utf8");
      console.log("  ✓ wrote .git/info/exclude (pipeline/stages/deploy.md)");
    } else {
      console.log("  ✓ .git/info/exclude already contains deploy.md entry");
    }
  } else {
    console.log("  ⚠ .git/info/ not found — skipping .git/info/exclude");
  }

  // Write profile marker to config.yml
  const cfgPath = path.join(cwd, ".devteam", "config.yml");
  if (fs.existsSync(cfgPath)) {
    const cfgContent = fs.readFileSync(cfgPath, "utf8");
    if (!cfgContent.includes("profile: dogfood")) {
      fs.writeFileSync(cfgPath, `profile: dogfood\n\n${cfgContent}`, "utf8");
      console.log("  ✓ wrote profile: dogfood to .devteam/config.yml");
    } else {
      console.log("  ✓ profile: dogfood already in .devteam/config.yml");
    }
  }

  console.log("\n✅ Dogfood profile active. Run 'devteam doctor' to verify the install.");
  console.log("   Tip: use --budget-usd with devteam run to cap spend during dogfood runs.");
}
```

#### `tests/init.test.js`

Add a describe block `devteam init --profile dogfood` with these tests:
1. `writeDogfoodGitignoreBlock` appends the dogfood block to `.gitignore`
2. `writeDogfoodGitignoreBlock` returns "skipped" when block already matches canonical
3. `writeDogfoodGitignoreBlock` returns "updated" when block is outdated
4. `devteam init --profile dogfood` writes pre-commit hook with guard marker
5. `devteam init --profile dogfood` adds `pipeline/stages/deploy.md` to `.git/info/exclude`
6. `devteam init --profile dogfood` writes `profile: dogfood` to config.yml
7. Running again with `--profile dogfood` (idempotent): hook not duplicated, block not duplicated

Use `mkdtempSync("devteam-test-")` + a synthetic `.git/` directory for hook/exclude tests.

**Verify:**
```bash
npm test && npx eslint .
# Manual:
cd /tmp && mkdir df-test && cd df-test && git init -q && mkdir pipeline
devteam init --host claude-code --profile dogfood
grep "BEGIN stagecraft-dogfood" .gitignore
grep "stagecraft-dogfood: infrastructure guard" .git/hooks/pre-commit
grep "pipeline/stages/deploy.md" .git/info/exclude
grep "profile: dogfood" .devteam/config.yml
cd - && rm -rf /tmp/df-test
```

**Branch:** `feat/init-profile-dogfood`

---

## 14.2 Doctor dogfood-mode checks

**Deliverables:** `core/cli/commands/doctor.js` (add "Dogfood mode" section), `tests/doctor.test.js`
(add dogfood-mode assertions).

### Changes

#### `core/cli/commands/doctor.js`

After the existing "Adapters" section (around line 91), add a conditional "Dogfood mode" section:

```js
const profile = config.profile;
if (profile === "dogfood") {
  console.log("\nDogfood mode");

  // 1. Pre-commit hook present and contains guard
  const hookPath    = path.join(cwd, ".git", "hooks", "pre-commit");
  const hookExists  = fs.existsSync(hookPath);
  const hookContent = hookExists ? fs.readFileSync(hookPath, "utf8") : "";
  check("pre-commit infrastructure guard", hookExists && hookContent.includes("# stagecraft-dogfood"),
    hookExists ? "guard marker missing — re-run devteam init --profile dogfood" : "hook missing — run devteam init --profile dogfood");

  // 2. Hook is executable
  if (hookExists) {
    let hookExecutable = false;
    try { fs.accessSync(hookPath, fs.constants.X_OK); hookExecutable = true; } catch { /* */ }
    check("pre-commit hook is executable", hookExecutable,
      hookExecutable ? null : "run: chmod +x .git/hooks/pre-commit");
  }

  // 3. Dogfood gitignore block present
  const giPath = path.join(cwd, ".gitignore");
  const giContent = fs.existsSync(giPath) ? fs.readFileSync(giPath, "utf8") : "";
  check(".gitignore dogfood block present", giContent.includes("# BEGIN stagecraft-dogfood"),
    "run: devteam init --profile dogfood");

  // 4. pipeline/stages/deploy.md in .git/info/exclude
  const excludePath = path.join(cwd, ".git", "info", "exclude");
  const excludeContent = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, "utf8") : "";
  check(".git/info/exclude: deploy.md entry", excludeContent.includes("pipeline/stages/deploy.md"),
    "run: devteam init --profile dogfood");

  // 5. No npm publish script (anti-pattern for dogfooding)
  const pkgPath = path.join(cwd, "package.json");
  if (fs.existsSync(pkgPath)) {
    let pkg = {};
    try { pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")); } catch { /* */ }
    const hasPublish = !!(pkg.scripts && pkg.scripts.publish);
    check("no npm publish script", hasPublish ? "warn" : true,
      hasPublish ? "dogfood mode on a publishable package — double-check you are in the right project" : null);
  }

  // 6. Budget recommendation (advisory)
  check("budget-usd reminder", "info",
    "always use --budget-usd with devteam run to cap spend");
}
```

#### `tests/doctor.test.js`

Add tests for the dogfood section using a tempdir with synthetic `.devteam/config.yml`
(containing `profile: dogfood`), `.git/hooks/pre-commit`, `.gitignore`, and `.git/info/exclude`.
Verify that the check function is called for each of the 6 items above, and that appropriate
pass/fail/warn states are reported.

**Verify:**
```bash
npm test && npx eslint .
# Manual — run from a dogfood-init'd directory:
devteam doctor
# Must show a "Dogfood mode" section with 6 check lines
```

**Branch:** `feat/doctor-dogfood-checks`

---

## 14.3 Preflight: block staged pipeline artifacts

**Deliverables:** `core/preflight.js` (add staged-artifact check), `tests/preflight.test.js`
(add staged-artifact test).

### Context

`core/preflight.js` runs at stage-04e (pre-peer-review). It calls `runPreflight(cwd, opts)` which
returns `{ status, blockers, warnings }`. Adding a check here blocks a PR from reaching peer-review
if the developer accidentally staged pipeline artifacts (brief.md, gates/*.json, etc.).

This check applies to all projects (not just dogfood mode) — staging pipeline artifacts is always
a mistake for a peer-review PR.

### Changes

#### `core/preflight.js`

Add a new check inside `runPreflight` using `spawnSync("git", ["diff", "--cached", "--name-only"])`:

```js
// Check: staged pipeline artifacts must not appear in the PR
function checkStagedPipelineArtifacts(cwd) {
  const { spawnSync } = require("node:child_process");
  const result = spawnSync("git", ["diff", "--cached", "--name-only"], { cwd, encoding: "utf8" });
  if (result.status !== 0) return []; // not a git repo or no index — skip silently
  const staged = (result.stdout || "").split("\n").filter(Boolean);
  const ARTIFACT_PREFIXES = [
    "pipeline/brief.md",
    "pipeline/context.md",
    "pipeline/spec.feature",
    "pipeline/runbook.md",
    "pipeline/test-report.md",
    "pipeline/deploy-log.md",
    "pipeline/code-review/",
    "pipeline/gates/",
    "pipeline/changes/",
    "pipeline/run-state.json",
    "pipeline/run-log.jsonl",
    "pipeline/run.lock",
    "pipeline/logs/",
    "pipeline/dispatches/",
    "pipeline/memory/",
  ];
  return staged.filter((f) =>
    ARTIFACT_PREFIXES.some((p) => p.endsWith("/") ? f.startsWith(p) : f === p)
  );
}
```

In `runPreflight`, call this and convert matches to blockers:

```js
const stagedArtifacts = checkStagedPipelineArtifacts(cwd);
if (stagedArtifacts.length > 0) {
  blockers.push(
    `Pipeline artifacts are staged for commit — these must not appear in a PR: ` +
    stagedArtifacts.slice(0, 5).join(", ") +
    (stagedArtifacts.length > 5 ? ` (+${stagedArtifacts.length - 5} more)` : "") +
    `. Run 'git restore --staged <files>' to unstage.`
  );
}
```

#### `tests/preflight.test.js`

Add two tests in the staged-artifact describe block:
1. Returns a blocker when `pipeline/brief.md` is in the git index (mock `spawnSync` or
   use a real tempdir with `git init && git add pipeline/brief.md`).
2. Returns no blocker when only non-pipeline files are staged.

**Verify:**
```bash
npm test && npx eslint .
# Manual (in a project with staged pipeline files):
git add pipeline/brief.md
devteam preflight
# Should exit 1 with BLOCKER: Pipeline artifacts are staged for commit
git restore --staged pipeline/brief.md
```

**Branch:** `feat/preflight-staged-artifacts`

---

## 14.4 Budget cap warning in driver.js

**Deliverables:** `core/driver.js` (add one-time warning when `budgetUsd === null`),
`tests/driver.test.js` (add budget-warning assertion).

### Context

In `core/driver.js` line 445: `const budgetUsd = ... null`. When no budget is set, `devteam run`
will never halt on spend — a dogfood run can exhaust budget before a human can intervene.

A single warning at run start is sufficient. It goes to stderr so it doesn't pollute JSON output.

### Changes

#### `core/driver.js`

After line 445 (`const budgetUsd = ...`), add:

```js
if (budgetUsd === null) {
  process.stderr.write(
    "[devteam run] Warning: no --budget-usd cap set. The run will not halt on spend.\n" +
    "              Use --budget-usd <amount> to prevent runaway cost.\n"
  );
}
```

#### `tests/driver.test.js`

Add a test: when `budgetUsd` is not set, the driver writes the warning to stderr before the first
dispatch. Use a stderr capture (redirect `process.stderr.write` temporarily or spawn the process
and capture output).

**Verify:**
```bash
npm test && npx eslint .
# Manual — run without budget cap:
devteam run --feature "test" 2>&1 | head -5
# Must show the budget warning on stderr
```

**Branch:** `feat/run-budget-warning`

---

## 14.5 `docs/guides/dogfooding.md`

**Deliverables:** `docs/guides/dogfooding.md` (new file), `docs/user-guide.md` (add cross-reference).

### Content of `docs/guides/dogfooding.md`

````markdown
# Dogfooding Stagecraft

Running Stagecraft against its own source tree ("dogfooding") lets you use the framework
to develop new Stagecraft features. This guide covers the one-time setup and the per-feature
workflow.

## Prerequisites

- A dedicated Stagecraft clone — do **not** dogfood in your primary install.
- Node.js 18+.
- Claude Code or another supported host CLI, authenticated.

```bash
git clone <stagecraft-repo> ~/Development/stagecraft-dogfood
cd ~/Development/stagecraft-dogfood
npm install
npm link          # puts 'devteam' on PATH pointing to this clone
```

## One-time setup

Run `devteam init` with the dogfood profile:

```bash
devteam init --host claude-code --profile dogfood
devteam doctor
```

This writes four safeguards:

| Safeguard | What it does |
|---|---|
| `.gitignore` stagecraft block | Excludes volatile runtime files |
| `.gitignore` stagecraft-dogfood block | Excludes generated pipeline documents |
| `.git/hooks/pre-commit` guard | Blocks commits to framework infrastructure files |
| `.git/info/exclude` entry | Hides `pipeline/stages/deploy.md` locally |

If `devteam doctor` shows all green under "Dogfood mode", you are ready.

## Per-feature workflow

For each Stagecraft feature or fix you want to dogfood:

```bash
# 1. Create a branch for the feature
git checkout -b feat/my-new-feature

# 2. Run the pipeline with a budget cap (required in dogfood mode)
devteam run --feature "describe the feature" --budget-usd 15

# 3. When the pipeline completes or halts for sign-off, review pipeline/gates/
devteam summary

# 4. If the generated code passes review, commit normally
git add <specific-source-files>
git commit

# 5. Clean up pipeline artifacts before switching features
git restore pipeline/  # or: devteam restart stage-01 --cascade
```

### Recommended budget

| Phase | Budget |
|---|---|
| Requirements + design only | $3–5 |
| Through build | $8–12 |
| Full pipeline (sign-off + deploy allowed) | $15–25 |

Use `--allow-stage sign-off,deploy` only when you intend to run the full pipeline.

## Infrastructure guard

The pre-commit hook installed by `devteam init --profile dogfood` will reject any commit
that touches `core/`, `bin/devteam`, `pipeline/stages/`, `roles/`, or `rules/`. This is
intentional — framework files must only be changed by you, not by an agent run.

If you need to commit a legitimate framework change (e.g. applying a fix that the agent
proposed in a file), do it manually:

```bash
git restore --staged pipeline/brief.md   # unstage pipeline artifacts first
git add core/specific-file.js            # stage only what you mean to commit
git commit
```

## Failure modes

| Symptom | Resolution |
|---|---|
| Agent tries to commit `pipeline/brief.md` | Normal — pre-commit hook blocks it; pipeline continues |
| Run stalls after sign-off | Use `--allow-stage sign-off` if intentional |
| Budget exhausted before design | Raise `--budget-usd`; start from `devteam restart stage-01 --cascade` |
| Pipeline artifacts appear in PR | `git restore --staged pipeline/` before pushing |

## Re-running doctor after setup

```bash
devteam doctor
```

Expected output includes a "Dogfood mode" section:

```
Dogfood mode
  ✓ pre-commit infrastructure guard
  ✓ pre-commit hook is executable
  ✓ .gitignore dogfood block present
  ✓ .git/info/exclude: deploy.md entry
  ✓ no npm publish script
  ℹ budget-usd reminder  — always use --budget-usd with devteam run to cap spend
```
````

### `docs/user-guide.md` addition

In the "Further reading" or equivalent section, add:

```markdown
- [Dogfooding guide](../docs/guides/dogfooding.md) — running Stagecraft against its own source tree
```

**Verify:**
```bash
npm run consistency
# Manual: confirm the file renders correctly and all commands in code blocks are valid
```

**Branch:** `docs/dogfooding-guide`

---

## Sequencing & exit criteria

14.1 → 14.2 → 14.3 → 14.4 (independent) → 14.5 (after 14.1 and 14.2 merged).

**Phase exit:**
- `devteam init --profile dogfood` writes all four safeguards in a tempdir integration test
- `devteam doctor` shows "Dogfood mode" section with ≥5 checks when `profile: dogfood` is set
- `devteam preflight` exits 1 with a clear blocker when pipeline artifacts are staged
- `devteam run` (without `--budget-usd`) emits budget warning to stderr
- `docs/guides/dogfooding.md` exists and is cross-referenced from `docs/user-guide.md`
- `npm test && npx eslint . && npm run consistency` all pass
