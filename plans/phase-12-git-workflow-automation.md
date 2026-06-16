# Phase 12 — Git Workflow Automation

**Goal:** remove the two structural friction points operators face when using Stagecraft with
git — volatile file management and commit timing in autonomous mode — by giving the tool an
opinion about its own VCS footprint.

**Decided in:** [ADR-010](../docs/adr/010-git-integration.md) (Accepted 2026-06-15).

**Framing (read before starting any item):** this phase is *interface* work, not capability
work. The pipeline does not change. The stages do not change. The gate schema does not change.
What changes is how Stagecraft interacts with git: it now manages its own gitignore block,
exposes a commit command, and offers an opt-in auto-commit hook on clean driver halts. The
design principle throughout is **composable**: `devteam commit` does not push, does not open
PRs, does not create branches. Those decisions remain with the operator.

**Order:** 12.0 (ADR acceptance) → 12.1 → 12.2 → 12.3 → 12.4. 12.1–12.4 are blocked on
ADR-010 being accepted. 12.2 is blocked on 12.1 (the gitignore block is the negative
space that defines what `devteam commit` must not stage). 12.3 is blocked on 12.2 (auto-
commit uses `devteam commit` as its implementation). 12.4 (docs restructure) is parallel to
12.2–12.3 but benefits from knowing the final flag names.

---

## 12.0 ADR-010 — file and present for acceptance

**This is not a code item.** It is a gate: the other items do not start until ADR-010's
status is changed to Accepted in `docs/adr/010-git-integration.md`.

To accept: read `docs/adr/010-git-integration.md` and `plans/phase-12-git-workflow-
automation.md`, raise any blockers, update the status line to `**Status:** Accepted`.
Update `docs/adr/README.md` to reflect the accepted state.

No tests, no code, no changelog fragment.

---

## 12.1 `devteam init` writes managed gitignore block

**Goal:** structural fix for Problem 1 (volatile files). After this item, every project
initialised or reinitialised with `devteam init --host <x>` has the correct gitignore block
and does not need manual `.gitignore` curation.

**Change:**

1. **Implement `writeGitignoreBlock(projectRoot)`** in `hosts/shared/gitignore.js` (new
   file). The function:
   - Reads `.gitignore` if it exists; treats missing as empty.
   - Locates `# BEGIN stagecraft` / `# END stagecraft` delimiters.
   - Replaces the block (or appends if absent) with the canonical block from ADR-010.
   - Writes the result back. The block is the single source of truth; copy it from ADR-010
     verbatim — do not paraphrase.
   - The canonical block:
     ```
     # BEGIN stagecraft — managed by devteam init; do not edit manually
     pipeline/run.lock
     pipeline/run-state.json
     pipeline/run-log.jsonl
     pipeline/logs/
     pipeline/gates/archive/
     pipeline/gates/replay/
     pipeline/dispatches/
     pipeline/memory/
     pipeline/changes/*/run.lock
     pipeline/changes/*/run-state.json
     pipeline/changes/*/run-log.jsonl
     pipeline/changes/*/logs/
     pipeline/changes/*/gates/archive/
     pipeline/changes/*/gates/replay/
     pipeline/changes/*/dispatches/
     pipeline/changes/*/memory/
     .devteam/memory/
     # END stagecraft
     ```

2. **Call `writeGitignoreBlock` from `core/cli/commands/init.js`**, after the existing
   adapter installation, before final success output. Print `wrote .gitignore (stagecraft
   block)` or `updated .gitignore (stagecraft block)` to stdout. [verify-first] how
   `init.js` calls adapter install and what the post-install step order is.

3. **`--force` re-runs `writeGitignoreBlock`** (replacement semantics). Without `--force`,
   if the block already exists and is identical to the canonical block, skip silently. If
   the block exists but differs (older format), update it and print the update message.

4. **Update `docs/user-guide.md`** to replace the manual gitignore list with a pointer to
   the `devteam init` step and a note that the block is machine-managed. Update
   `docs/git-workflow.md` §gitignore to reference `devteam init` rather than enumerating
   the list.

**Tests:**
- No `.gitignore`: `writeGitignoreBlock` creates one with the block.
- Existing `.gitignore` with no block: block is appended; pre-existing content is preserved.
- Existing block (identical): no-op (content unchanged).
- Existing block (outdated): block is replaced; pre-existing content before/after block is
  preserved.
- Block with user content inside the delimiters: content is overwritten (the function owns
  the block interior).
- `devteam init` flow writes the block to a temp project dir.

**Verify:** `npm test`, `npx eslint .`, `npm run consistency` green; manual smoke:
`devteam init --host claude-code` in a temp project; `grep "BEGIN stagecraft" .gitignore`
shows the block; `grep "run.lock" .gitignore` shows the entry; re-run shows no duplicate.

**Branch:** `feat/init-gitignore-block`

---

## 12.2 `devteam commit` command

**Goal:** structural fix for Problem 2 (autonomous commit timing). After this item,
operators have a first-class command that stages exactly the right files for the pipeline
state and generates a meaningful commit message, without manual `git add` decisions.

**Change:**

1. **Stage artifact registry** (`core/pipeline/artifacts.js`, new file). A map from
   stage-id → list of artifact paths relative to `pipelineRoot()`:

   ```js
   // Stage ID → artifact paths. Gate files are NOT listed here — they are derived
   // from stages.js and added unconditionally for PASS/WARN stages.
   const STAGE_ARTIFACTS = {
     "stage-01": ["brief.md"],                  // or diagnosis.md in repair mode
     "stage-02": ["spec.feature"],
     "stage-03": ["spec.feature"],              // may have updated scenarios
     "stage-03b": [],                           // gate-only (reproduced field)
     "stage-04":  ["code-review/"],             // directory
     "stage-04e": [],                           // gate-only (preflight)
     "stage-05":  ["code-review/"],             // approval-derived updates
     "stage-06":  ["test-report.md"],
     // ... continue for remaining stages; read stages.js for the full list
   };
   ```

   [verify-first] read `core/pipeline/stages.js` for the full stage list and confirm which
   stages write named artifacts vs. gate-only. Populate the registry to match; leave a
   `// TODO` comment for any stage where the artifact is uncertain.

2. **Implement `devteam commit` command** (`core/cli/commands/commit.js`, new file):

   ```
   devteam commit [options]
   ```

   Flags: `--all` (stage all gate-bearing stages regardless of cursor), `--dry-run`
   (print what would be staged, don't commit), `--message <msg>` (override generated
   message), `--json` (machine-readable output), `--help`.

   Algorithm:
   a. Read `pipeline/run-state.json`. Extract `stages_advanced` (list of stage-ids that
      completed) and `last_committed_stage_index` (cursor, `null` if never committed).
   b. If `--all`: `toCommit = stages_advanced`. Else: `toCommit = stages_advanced` after
      the cursor (the uncollected stages).
   c. From `toCommit`, derive `filesToStage`:
      - For each stage-id in `toCommit`, include the gate file path (from stages.js) if
        the gate's status is PASS or WARN.
      - For each stage-id, include its entries from `STAGE_ARTIFACTS`.
      - Resolve all paths relative to `pipelineRoot()`.
      - Exclude any path matched by the `# BEGIN stagecraft` block (volatile).
      - Filter to files that exist on disk.
   d. If `filesToStage` is empty: print "nothing to commit (all stages already committed)"
      and exit 0.
   e. Generate commit message: `"pipeline: stages NN–NN PASS"` or `"pipeline(repair):
      diagnosis + build PASS"` (read `intent` from run-state). Include a `[N stages]`
      count in the body.
   f. Print staged file list and proposed message to stdout. Prompt for confirmation
      (`y/n/e` for edit) unless `--dry-run`.
   g. On confirm: `git add <file> <file> ...` (by name, never `-A`), `git commit -m
      "<generated>"`. Add `Co-Authored-By: Stagecraft (Claude Sonnet 4.6)
      <stagecraft@mumit.org>` trailer.
   h. On success: write `last_committed_stage_index` to `run-state.json` pointing to the
      last stage committed.

3. **Register the command** in `bin/devteam` and `scripts/generate-cli-ref.js` (in the
   COMMANDS array, after `run`).

4. **Schema bump:** add `last_committed_stage_index: null` to the initial `run-state.json`
   written by the driver start. Read the current `RUN_SCHEMA_VERSION` constant
   ([verify-first]) and bump it. Add a migration in the schema reader: if the field is
   missing, initialise to `null`.

5. **`devteam commit --all` + diagnosis file.** In repair mode, `pipeline/diagnosis.md`
   is the stage-01 artifact (not `brief.md`). Read `intent` from run-state to select the
   correct filename.

**Tests:**
- `stages_advanced: ["stage-01", "stage-02"]`, `last_committed_stage_index: null` →
  stages both gate files + brief.md + spec.feature.
- `last_committed_stage_index: 1` (stage-02 already committed) → stages only stage-02
  gate + spec.feature (idempotent: calling twice stages nothing the second time).
- `--all` ignores cursor; stages everything with a PASS/WARN gate.
- `--dry-run` prints file list, exits 0, no git calls.
- Volatile file (run-state.json) not staged even if somehow in `toCommit`.
- Missing gate file (e.g. stage skipped): absent file not staged, no error.
- Schema migration: old run-state.json without `last_committed_stage_index` → field
  initialised to `null` on read.

**Verify:** `npm test`, `npx eslint .`, `npm run consistency` green; manual smoke:
`devteam commit --dry-run` in a pipeline with a few completed stages; confirm output lists
the right files; confirm `npm run docs:generate` picks up the new command.

**Branch:** `feat/devteam-commit`

---

## 12.3 `devteam run --auto-commit`

**Goal:** remove commit overhead from the autonomous operator loop. After this item,
operators who opt in get automatic commits at clean driver halts, with `devteam commit`
as the implementation (so the staged file set is identical to the manual case).

**Change:**

1. **Add `--auto-commit` flag** to `core/cli/commands/run.js`. Boolean, default `false`.

2. **Call `devteam commit` programmatically** after a clean halt. "Clean halt" is defined
   as `halt_action` in `{"ceiling", "until", "budget"}` — the halts where the pipeline
   stopped by design. [verify-first] where these halt codes are emitted in `core/driver.js`
   and the exact `halt_action` string values; do NOT fire on `fix-and-retry`,
   `resolve-escalation`, `structural-input`, `merge-failed`, `max-iterations`,
   `convergence-exhausted`, `scope-gate`, `unconfirmed-track`, `stoplist`.

3. **Programmatic call** uses the same algorithm as the CLI command but skips the
   interactive confirmation prompt (it is unattended). It prints the staged file list to
   stderr before committing so the operator can see what happened.

4. **Log to `run-log.jsonl`:**
   ```json
   {"event":"auto-commit","staged_files":[...],"commit_hash":"abc1234","at":"..."}
   ```
   On commit failure: log `{"event":"auto-commit-failed","reason":"..."}` and emit a loud
   warning to stderr. The run itself still exits with the halt's exit code — a commit
   failure does not change the halt's semantics.

5. **Skip if no stages to commit** (cursor is already at the last advanced stage). Log
   `{"event":"auto-commit-skipped","reason":"nothing-to-commit"}`.

6. **Generate-cli-ref:** `--auto-commit` flag appears in the CLI reference table for `run`.

**Tests:**
- Clean halt (`ceiling`): `--auto-commit` fires, stages correct files, logs `auto-commit`.
- `--until` boundary halt: fires.
- `budget` halt: fires.
- Non-clean halt (`resolve-escalation`, `fix-and-retry`, ...): does NOT fire.
- `--auto-commit` not passed: never fires regardless of halt type.
- Nothing to commit (cursor already current): logs `auto-commit-skipped`, no git call.
- Commit failure: logs `auto-commit-failed`, does not change exit code.

**Verify:** `npm test`, `npx eslint .`, `npm run consistency` green; manual smoke of
`devteam run --auto-commit --until stage-02 --max-iterations 5` in a temp project.

**Branch:** `feat/run-auto-commit`

---

## 12.4 `docs/git-workflow.md` restructure + repair-flow git guidance

**Goal:** close the documentation gap. After this item, `docs/git-workflow.md` covers both
interactive and autonomous operator modes, references `devteam commit` as the primary
interface, and the repair-flow runbook has "when to commit" guidance.

**Change (doc-only — no code):**

1. **Restructure `docs/git-workflow.md`:**

   New outline:
   - §1 Overview — two modes; what Stagecraft tracks; what lives in git
   - §2 What to commit vs. ignore — reference the `devteam init` gitignore block (do not
     repeat the list); note that gate files are the human artifact, volatile state is not
   - §3 Interactive mode — non-autonomous operator workflow; per-stage-group commit cadence
     (same content as today, updated for the Phase 12 commands)
   - §4 Autonomous mode — pipeline halts are commit triggers; `devteam commit` usage;
     `--auto-commit` opt-in; what each `halt_action` implies for the commit decision
   - §5 Repair mode — when to commit in a `--repair` run: after diagnosis approval, after
     failing-first test, after build + scope gate PASS; note that each is a natural
     `devteam commit` call
   - §6 PR timing — unchanged from current
   - §7 CI integration — unchanged from current

   Preserve the "what to commit" table from the current doc (updated for Phase 12 artifact
   names and the `devteam commit` command as the mechanism).

2. **Add "When to commit in repair mode" to `docs/runbooks/repair-flow.md`:**

   Three natural commit points:
   - After diagnosis gate approval (gates + `diagnosis.md`)
   - After failing-first test stage (gates + `spec.feature`)
   - After build + scope gate PASS (gates + changed source files, if any were explicitly
     staged by operator)

   Note: `devteam commit` stages the gate files automatically; source file staging for the
   fix itself requires `git add <path>` by the operator (Stagecraft does not own the
   application source files — only pipeline artifacts).

3. **Update `docs/git-workflow.md` §gitignore** to replace the manual list with:
   > Run `devteam init --host <x>` once to write the managed `.gitignore` block. The block
   > is the canonical list of volatile Stagecraft files; do not duplicate it in prose.

4. **Add a `devteam commit` entry to `docs/reference/cli.md`** (this regenerates from the
   flag schema via `npm run docs:generate` — run the generator; confirm the entry appears).

**Tests:** `npm run consistency` green (no orphan doc references); `npm run docs:generate`
idempotent.

**Verify:** `npm run consistency`, `npm run docs:generate` green; human read of the
restructured `git-workflow.md` for narrative coherence.

**Branch:** `docs/git-workflow-restructure`

---

## Sequencing & exit criteria

12.0 (ADR accepted) → 12.1 → 12.2 → 12.3 → 12.4.

12.2 and 12.4 can run in parallel once 12.1 is merged. 12.3 requires 12.2.

**Phase exit:** `devteam init` writes the gitignore block; `devteam commit` stages the
right files with an idempotency cursor; `devteam run --auto-commit` fires on clean halts
only; `docs/git-workflow.md` covers both interactive and autonomous modes. When done, mark
Phase 12 complete in `plans/prompts/ALL-PROMPTS.md` and `plans/README.md`.
