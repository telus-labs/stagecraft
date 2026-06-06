# Git workflow for a Stagecraft pipeline run

This guide covers the end-to-end git practice for a fresh feature built with
Stagecraft: branch setup, which pipeline artifacts belong in git, when to
commit, how Stage 4's parallel build interacts with git, when to open the PR,
and what the final commit history should look like.

---

## Starting a feature: create the branch first

Before running any `devteam` command, create a feature branch from main:

```bash
git checkout main && git pull
git checkout -b feature/my-feature-name
```

The branch is the unit of work. All pipeline artifacts (`pipeline/`) and all
source code (`src/`) produced by the pipeline go on this branch. One branch per
pipeline run.

---

## Pipeline artifacts belong in git

Commit `pipeline/` alongside `src/`. These files are the pipeline's audit trail
— gate JSON, design spec, review files, test report, ADRs — and they're what
`devteam ci` validates and publishes as GitHub check runs on your PR. Without
committed gate files, CI has nothing to post and reviewers can't see stage
status.

**What to include and exclude:**

| Path | Commit? | Reason |
|------|---------|--------|
| `pipeline/brief.md` | ✓ | Source of truth |
| `pipeline/design-spec.md` | ✓ | Design record |
| `pipeline/adr/` | ✓ | Architectural decisions |
| `pipeline/context.md` | ✓ | Decision + assumption log |
| `pipeline/spec.feature` | ✓ | Executable specification |
| `pipeline/clarification-log.md` | ✓ | PM resolutions |
| `pipeline/gates/` | ✓ | What CI reads; validator reads |
| `pipeline/pr-*.md` | ✓ | Per-workstream build record |
| `pipeline/code-review/` | ✓ | Peer-review audit trail |
| `pipeline/red-team-report.md` | ✓ | Red-team evidence |
| `pipeline/security-review.md` | ✓ | Security finding record |
| `pipeline/test-report.md` | ✓ | Stage 6 evidence |
| `pipeline/runbook.md` | ✓ | Deploy runbook (Stage 8) |
| `pipeline/observability-report.md` | ✓ | Stage 6c evidence |
| `pipeline/retrospective.md` | ✓ | Lessons |
| `pipeline/logs/` | ✗ | Ephemeral; add to `.gitignore` |
| `pipeline/gates/replay/` | ✗ | `devteam replay` output; ephemeral |
| `pipeline/pre-review-output.txt` | optional | Large raw output; useful for audits |
| `pipeline/lint-output.txt` | optional | Same |

Add this to your project's `.gitignore`:

```
pipeline/logs/
pipeline/gates/replay/
```

---

## When to commit: after each stage group, not every command

Don't commit every `devteam stage X` invocation. Commit at the natural
checkpoints — groups of stages that passed cleanly and won't be re-run. Interim
failed states (FAIL gates you deleted and re-ran) should not be in the history.

**Recommended commit points:**

| Commit | What to stage | Typical message |
|--------|--------------|-----------------|
| After Stage 1 (requirements) | `pipeline/brief.md pipeline/gates/stage-01.json pipeline/context.md` | `stage-01: requirements PASS` |
| After Stage 2 (design) | `pipeline/design-spec.md pipeline/adr/ pipeline/gates/stage-02.json` | `stage-02: design PASS — 6 ADRs` |
| After Stage 3 + 3b | `pipeline/clarification-log.md pipeline/spec.feature pipeline/gates/stage-03*.json` | `stage-03: clarification + spec PASS` |
| After Stage 4 build chain (4 + 4a + 4b + 4c + QA augment) | `src/ pipeline/pr-*.md pipeline/red-team-report.md pipeline/security-review.md pipeline/pre-review.md pipeline/gates/stage-04*.json` | `stage-04: build + pre-review + red-team PASS` |
| After Stage 5 (peer-review) — may include code fixes | `src/ pipeline/code-review/ pipeline/gates/stage-05*.json` | `stage-05: peer-review PASS` |
| After Stage 6 (QA) | `pipeline/test-report.md pipeline/gates/stage-06.json pipeline/gates/stage-06c.json` | `stage-06: QA + observability PASS` |
| After Stages 7 + 8 (sign-off + deploy) | `pipeline/runbook.md pipeline/deploy-log.md pipeline/gates/stage-07.json pipeline/gates/stage-08.json` | `stage-07/08: sign-off + deploy PASS` |
| After Stage 9 (retrospective) | `pipeline/retrospective.md pipeline/lessons-learned.md pipeline/gates/stage-09.json` | `stage-09: retrospective PASS` |

Stage 3 and Stage 7 are short; bundle them with their neighbors unless the
design session produced substantial ADRs.

**Practical staging command pattern:**

```bash
# After the Stage 4 build chain:
git add src/ \
  pipeline/pr-*.md \
  pipeline/red-team-report.md \
  pipeline/security-review.md \
  pipeline/pre-review.md \
  pipeline/build-plan.md \
  pipeline/context.md \
  pipeline/gates/
git commit -m "stage-04: build + pre-review + red-team + QA augment PASS"
```

Stage files explicitly by name or glob — never `git add -A` or `git add .`
(risks capturing unrelated files, `node_modules/` artifacts, scratch files).

---

## Stage 4: parallel build and git worktrees

`rules/stage-04.md` describes an explicit worktree model where each build
workstream operates in its own branch:

```bash
git worktree add ../dev-team-backend feature/backend
git worktree add ../dev-team-frontend feature/frontend
git worktree add ../dev-team-platform feature/platform
```

**In practice with Claude Code, worktrees are optional.** Claude Code dispatches
all four build workstreams as concurrent subagents writing to the same working
directory. Since each workstream has a non-overlapping write surface
(`src/backend/`, `src/frontend/`, `src/infra/`, `src/tests/`) there are no file
conflicts and a single working directory is fine. The SOC2 evidence collector
ran all four workstreams in parallel without worktrees.

**When you do need worktrees:**

| Scenario | Why worktrees help |
|---|---|
| Workstreams run on separate machines | Each machine needs its own checkout |
| Mixed-host pipelines where adapters need filesystem isolation | e.g. Codex backend + Claude Code frontend in separate directories |
| Workstreams write to shared root files (rare) | e.g., both backend and platform update `package.json` with conflicting changes |

**If using worktrees**, commit each branch after its workstream's gate passes,
then merge back to the feature branch before moving to Stage 4a:

```bash
# In each worktree after that workstream's build gate passes:
cd ../dev-team-backend
git add src/backend/ pipeline/pr-backend.md pipeline/gates/stage-04.backend.json
git commit -m "stage-04 backend: PASS"

# Merge all workstreams back to the feature branch
cd /path/to/your-project
git merge feature/backend --no-ff -m "merge stage-04 backend"
git merge feature/frontend --no-ff -m "merge stage-04 frontend"
git merge feature/platform --no-ff -m "merge stage-04 platform"

# Then clean up worktrees
git worktree remove ../dev-team-backend
git worktree remove ../dev-team-frontend
git worktree remove ../dev-team-platform
```

---

## When to open the PR

**Recommended: open as draft after the Stage 4 build chain, mark ready-for-review after Stage 5.**

```bash
# After Stage 4 build chain (stages 4 + 4a + 4b + 4c + QA augment) all pass:
git push -u origin feature/my-feature-name
gh pr create --draft \
  --title "feat: my-feature-name" \
  --body "Stagecraft pipeline in progress. Stage 4 build chain PASS; peer-review running."

# After Stage 5 (peer-review) passes:
gh pr ready   # convert draft → ready for review
```

This approach gives you two things:
1. CI validates and publishes gate check runs throughout the rest of the pipeline
   (stages 5–9), so you can watch them progress in the PR's status bar
2. The draft state signals to teammates that the work isn't ready for merge yet

**Alternative: open after all stages pass.** Simpler, but you lose CI visibility
during the pipeline. Fine for small teams where the operator drives the whole
run end-to-end in one session.

Do NOT open the PR before Stage 4 — there's no code for reviewers to look at
and CI would post FAIL gates that aren't real blockers, just "pipeline in
progress."

---

## The CI connection

Once the PR is open, every commit to the branch triggers Stagecraft's CI
workflow (if `devteam ci install` was run in your project). It validates every
gate in `pipeline/gates/` and posts each as a GitHub check run:

```
✓ stage-01 requirements    PASS
✓ stage-02 design          PASS
✓ stage-04 build           PASS (4 workstreams)
✓ stage-04a pre-review     PASS
⚠ stage-04c red-team       WARN (2 noted-for-followup)
✓ stage-05 peer-review     PASS
...
```

This means: **don't commit FAIL gates**. A committed FAIL gate shows as a
failing check run in the PR. If you've cleared and re-run a stage, commit only
after the re-run gate is PASS or WARN.

See [`docs/ci.md`](ci.md) for the full CI workflow setup.

---

## Merging into main

After all stages pass and the PR is approved:

```bash
# Squash-merge is fine — the feature branch's commit history is the audit
# trail, and pipeline/gates/ in the squash commit is the permanent record.
git merge --squash feature/my-feature-name
git commit -m "feat: my-feature-name — full pipeline PASS (stages 1–9)"

# Or keep the per-stage history:
git merge --no-ff feature/my-feature-name
```

**Squash-merge** produces a clean main history: one commit per feature, gate
files at the final passing state. The full per-stage commit history lives on
the feature branch for as long as you keep it (or until it's pruned per your
team's branch retention policy).

**No-ff merge** preserves every stage commit in main. Useful if your team
audits via `git log` and wants to see stage-by-stage progression in the main
branch history.

Delete the feature branch after merge:

```bash
git push origin --delete feature/my-feature-name
git branch -d feature/my-feature-name
```

---

## What the final branch history looks like

```
feature/my-feature-name
  ├── stage-01: requirements PASS
  ├── stage-02: design PASS — 6 ADRs (Node LTS, AWS SDK v3, hash normalization, …)
  ├── stage-03: clarification + executable-spec PASS
  ├── stage-04: build + pre-review + red-team + QA augment PASS
  │     ← source code lands here
  ├── stage-05: peer-review PASS (iam guard + commander exit patched)
  │     ← any fix-and-retry code changes bundled here
  ├── stage-06: QA + observability PASS
  ├── stage-07/08: sign-off + deploy PASS
  └── stage-09: retrospective PASS
```

Each commit contains both the pipeline artifacts produced by that stage group
AND any source changes that stage required (peer-review fixes, etc.). A reader
checking out any commit gets a consistent snapshot: the gate that passed is
alongside the code that passed it.

---

## Quick reference

```bash
# Start
git checkout -b feature/my-feature-name

# After each stage group passes, commit by name:
git add <specific files and paths>
git commit -m "stage-NN: <stage name> PASS"

# After Stage 4 build chain:
git push -u origin feature/my-feature-name
gh pr create --draft --title "feat: ..."

# After Stage 5:
gh pr ready

# After pipeline completes and PR approved:
git checkout main
git merge --squash feature/my-feature-name
git commit -m "feat: my-feature-name — full pipeline PASS"
git push
git push origin --delete feature/my-feature-name
```

---

## See also

- [`docs/ci.md`](ci.md) — CI workflow setup, gate check runs, permissions
- [`docs/tracks.md`](tracks.md) — which track to pick (affects which stages run)
- [`docs/runbooks/fix-and-retry.md`](runbooks/fix-and-retry.md) — when a stage fails: scoped patch builds, gate clearing, QA augmentation
- [`rules/stage-04.md`](../rules/stage-04.md) — Stage 4 parallel build and worktree contract
