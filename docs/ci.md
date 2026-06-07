# CI integration (F4)

Stagecraft ships a CI workflow template that **validates and publishes** pipeline state on pull requests. It does **not** run the pipeline itself in CI. Running an LLM pipeline on every PR is expensive, and the pipeline is designed to be human-driven. CI's job is to surface the audit trail that local runs produced.

This is the **F4** BACKLOG item.

- [What the workflow does](#what-the-workflow-does)
- [Install](#install)
- [Required GitHub permissions](#required-github-permissions)
- [What the PR review experience looks like](#what-the-pr-review-experience-looks-like)
- [Why not run the pipeline in CI?](#why-not-run-the-pipeline-in-ci)
- [Other CI systems](#other-ci-systems)
- [Pinning + drift](#pinning--drift)
- [See also](#see-also)

## What the workflow does

When a PR touches `pipeline/` or `.devteam/`:

1. **Checks out** the target project at the PR's head commit.
2. **Checks out Stagecraft** at a pinned version (configurable env var).
3. **Skips cleanly** if the PR includes no gates. If `pipeline/gates/` is empty or absent, the workflow short-circuits with a `::notice::` and exits green.
4. **Validates** every gate file with Stagecraft's validator. Exit codes propagate: 0 PASS/WARN (job stays green), 1 malformed (fail), 2 FAIL gate (fail), 3 ESCALATE (fail — surfaces needs-resolution).
5. **Posts each gate as a GitHub check run** on the PR head commit via `scripts/pr-publish.js`. PASS→success, WARN→neutral, FAIL/ESCALATE→failure. Reviewers see "15/17 stages passing" in the PR's status bar with click-through to per-stage detail.
6. **Reproducibility drift check** (advisory, doesn't block merge): runs `devteam reproduce` on each gate, surfacing any drift between the recorded `system_prompt_hash` and what would render today.

Not invoking the LLM in CI keeps cost predictable and avoids running the pipeline without human oversight.

## Install

In your target project:

```bash
devteam ci install                       # drops the workflow into .github/workflows/
devteam ci install --force               # overwrite an existing file
devteam ci install --out custom/path/    # redirect output (rare)
devteam ci show                          # print the template to stdout (preview)
```

After install:

1. Open `.github/workflows/stagecraft-pr-checks.yml` and edit the two env vars at the top:
   - `STAGECRAFT_REPO`: where to fetch Stagecraft from (e.g. `your-org/stagecraft`)
   - `STAGECRAFT_REF`: which Stagecraft version/tag/sha to pin
2. Commit + push the workflow file.
3. Open a PR that touches `pipeline/gates/` and watch the checks fire.

## Required GitHub permissions

The workflow declares:

```yaml
permissions:
  contents: read
  checks: write
  pull-requests: write
```

These are scoped to the workflow run. No PAT is needed. The runner's default `GITHUB_TOKEN` is used for posting check runs.

## What the PR review experience looks like

Without this workflow, a PR with a `pipeline/gates/stage-04.json` PASS gate looks identical to one with a FAIL gate. Reviewers have to read the JSON. With it:

```
✓ stagecraft pr-checks / validate-and-publish
   ✓ stage-01 requirements      PASS  (12s)
   ✓ stage-02 design             PASS  (47s)
   ✓ stage-03 clarification      PASS  (skipped, auto-folded)
   ✓ stage-04 build              PASS  (4 workstreams)
   ✓ stage-04a pre-review         PASS
   ✗ stage-04b security-review    FAIL  ← visible in the PR status bar
       Blockers:
       - High-severity finding in src/backend/auth.ts:42
   ⚠ stage-04c red-team           WARN  ← yellow in the status bar
       Warnings:
       - 2 noted-for-followup findings
   ...
```

Each line in the PR's "Checks" tab links back to the gate detail. A reviewer can see at a glance which stages need attention.

## Why not run the pipeline in CI?

Three reasons:

1. **Cost.** A `full`-track run is 5–60 minutes of LLM time. Running it on every PR, including draft PRs and force-pushes, multiplies that by PR volume.
2. **Human-in-the-loop.** Stagecraft's pipeline is designed for a human reading the prompt and decisions at each stage. Running it unattended in CI means agents make decisions that nobody sees until after the fact.
3. **Shape mismatch.** A PR has *already been built*. Running `devteam stage build` against a PR doesn't fit the model.

The validate-and-publish path (this workflow) is the appropriate CI integration. If your team eventually wants to run a `nano` track on `dependabot` PRs, or an `audit-quick` on PRs touching sensitive paths, those belong in separate adjacent workflow files, not as a replacement for this one.

## Other CI systems

`devteam ci install --ci <type>` currently supports only `github-actions`. GitLab CI / Buildkite / CircleCI templates are BACKLOG candidates. The Stagecraft side (validator + pr-publish.js) is CI-agnostic; the templates just need to be written.

## Pinning + drift

The template pins `STAGECRAFT_REF: v0.3.0`. Update it on each Stagecraft release you want to adopt. Pinning matters because:

- Validator behavior could change (rare but possible).
- `scripts/pr-publish.js`'s output shape could evolve.
- A floating ref (`@main`) means your CI silently changes when Stagecraft does.

Update the workflow file in lockstep with Stagecraft upgrades.

## See also

- [`templates/ci/github-actions/stagecraft-pr-checks.yml`](../templates/ci/github-actions/stagecraft-pr-checks.yml) — the workflow itself.
- [`scripts/pr-publish.js`](../scripts/pr-publish.js) — what the workflow invokes for check-run posting.
- [`docs/BACKLOG.md`](BACKLOG.md) F4 — the BACKLOG entry this implements.
- [`docs/reproducibility.md`](reproducibility.md) — the drift check that runs as an advisory step.
