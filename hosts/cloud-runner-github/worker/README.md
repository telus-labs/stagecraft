# stagecraft-runner — setup guide

This directory contains the two files you copy into your `stagecraft-runner` GitHub repo.

## Repo layout

```
stagecraft-runner/          ← create this as a private GitHub repo
  .github/
    workflows/
      stagecraft-runner.yml ← copy from this directory
  worker.js                 ← copy from this directory
```

`worker.js` has no npm dependencies — do not add a `package.json` or `node_modules`.

## One-time setup

### 1. Create the repo

Create a **private** GitHub repo named `stagecraft-runner` (or any name — you'll reference it in `.devteam/config.yml`).

Copy `stagecraft-runner.yml` to `.github/workflows/` and `worker.js` to the root.

### 2. Edit the workflow YAML

Open `.github/workflows/stagecraft-runner.yml` and update the four provider lines under `# Provider config`:

```yaml
STAGECRAFT_PROVIDER_ENDPOINT:   https://api.fuelix.ai   # ← your provider base URL
STAGECRAFT_PROVIDER_MODEL:      claude-sonnet-4-6        # ← your model ID
STAGECRAFT_PROVIDER_DRIVER:     openai-chat              # ← see driver table below
STAGECRAFT_MAX_TOKENS:          "8192"                   # ← increase for long outputs
```

**Driver selection:**

| Setup | `STAGECRAFT_PROVIDER_DRIVER` |
|---|---|
| Fuelix proxy (`api.fuelix.ai`) | `openai-chat` |
| Any OpenAI-compatible proxy | `openai-chat` |
| Direct OpenAI API | `openai-chat` |
| Direct Anthropic API | `anthropic-messages` |

Commit and push the updated YAML.

### 3. Set the auth token secret

Only the bearer token is stored as a secret (never in the YAML).

In **Settings → Secrets and variables → Actions → New repository secret**, add:

| Secret | Description |
|---|---|
| `STAGECRAFT_PROVIDER_AUTH_TOKEN` | API key or bearer token for your provider |

### 4. Create a GitHub PAT

In **github.com → Settings → Developer settings → Fine-grained personal access tokens**, create a token with:

- **Repository access**: this repo only (`stagecraft-runner`)
- **Permissions**: Actions → Read and write

Copy the token — you'll set it in your local project next.

### 5. Configure your local Stagecraft project

```bash
devteam install cloud-runner-github
```

Edit the stub written to `.devteam/config.yml`:

```yaml
routing:
  default_host: cloud-runner-github
  roles:
    principal: claude-code  # ruling + fix-escalation need local filesystem access
    platform: claude-code   # pre-review (stage-04a) and deploy (stage-08) need shell
    qa: claude-code         # qa stage (stage-06, stage-06e) needs shell to run tests
    verifier: claude-code   # verification-beyond-tests (stage-06d) needs shell
cloud_runner:
  owner: YOUR_GITHUB_ORG_OR_USERNAME
  repo: stagecraft-runner
  workflow: stagecraft-runner.yml
  auth_env: STAGECRAFT_RUNNER_TOKEN
  ref: main
```

The four `routing.roles` lines are required because several stages need the `shell` capability (to run tests, linters, or deploy scripts) that the cloud runner does not provide. See [Local-only operations](#local-only-operations) below.

Export your PAT before running:

```bash
export STAGECRAFT_RUNNER_TOKEN=github_pat_...
```

Check readiness:

```bash
devteam status cloud-runner-github
```

## Running a stage

```bash
devteam run
```

The adapter dispatches the workflow, polls until completion (~30–120 s), downloads the result artifact, and applies the model's file writes to your project. The gate file appears at `pipeline/gates/<stage>.json` when the stage passes.

## Local-only operations

Some roles always run on your local machine because they need the `shell` capability (to run tests, linters, or deploy scripts) or direct filesystem access. The cloud runner does not have shell support.

### Shell-required roles

| Role | Stages | Why it must run locally |
|---|---|---|
| `platform` | stage-04a (pre-review), stage-08 (deploy) | Runs test suites and deploy scripts |
| `qa` | stage-06, stage-06e | Runs tests and performance benchmarks |
| `verifier` | stage-06d | Runs verification scripts beyond automated tests |

These must be routed to `claude-code` (or another shell-capable host). If omitted, `devteam run` fails with:

```
stage "stage-04a" (role "platform") requires the "shell" capability but host
"cloud-runner-github" does not provide it. Update routing in .devteam/config.yml
to use a host with shell support (claude-code, codex, or gemini-cli).
```

### Filesystem-required operations

| Command | Why it must run locally |
|---|---|
| `devteam ruling --headless` | Reads gate files and appends `PRINCIPAL-RULING:` entries to `pipeline/context.md` |
| `devteam fix-escalation --headless` | Reads `PRINCIPAL-RULING:` entries from `pipeline/context.md` and dispatches the applicator agent |

Both commands call `dispatchToPrincipal`, which requires `headlessCommand` — a capability only available on local hosts like `claude-code`. If `routing.roles.principal` is not set, these commands fail with:

```
Host "cloud-runner-github" declares no headlessCommand.
Principal rulings require local filesystem access ...
Add `routing.roles.principal: claude-code` to .devteam/config.yml
```

**Fix:** the config stub written by `devteam install cloud-runner-github` includes all four required role lines.

## Notes

- Stages `stage-07` (sign-off) and `stage-08` (deploy) cannot route to the cloud runner — they must run locally.
- Result artifacts are retained for 7 days (configurable via `retention-days` in the YAML).
- The `if: always()` on the upload step ensures a `result.json` is uploaded even when the worker exits non-zero, so the adapter can distinguish "run failed" from "artifact missing".
- If you change providers or models, edit the YAML values and push — no secret changes needed.
