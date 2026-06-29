# Stagecraft Docker Runner

The Docker runner packages the normal `devteam` CLI and production Node.js
dependencies into a container for unattended headless runs. It is a packaging
surface, not a new host adapter and not a scheduler. The mounted project remains
the source of truth for `.devteam/`, `pipeline/`, gates, logs, reports, and
run-state files.

## Build

From the Stagecraft repository root:

```bash
docker build -f hosts/docker/Dockerfile -t stagecraft-runner:latest .
```

The image defaults to a non-root runtime user with UID/GID `1000:1000`. On Linux,
match the host user that owns the mounted project to avoid root-owned artifacts:

```bash
docker build \
  -f hosts/docker/Dockerfile \
  --build-arg STAGECRAFT_UID="$(id -u)" \
  --build-arg STAGECRAFT_GID="$(id -g)" \
  -t stagecraft-runner:local .
```

## Run

Mount the target project at `/workspace` and pass the same `devteam` command you
would run locally:

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -v "$PWD:/workspace" \
  --env-file .devteam/docker.env \
  stagecraft-runner:local run --cwd /workspace --watch
```

The `devteam` prefix is optional, so these are equivalent:

```bash
docker run --rm -v "$PWD:/workspace" stagecraft-runner:local run --cwd /workspace
docker run --rm -v "$PWD:/workspace" stagecraft-runner:local devteam run --cwd /workspace
```

If no command is supplied, the entrypoint prints usage and exits without starting
a pipeline.

## Host Configuration

The runner does not hard-code one model host. Routing still comes from the
mounted project's `.devteam/config.yml`.

For the smallest unattended setup, use `openai-compat` and pass credentials via
environment variables:

```bash
docker run --rm \
  -v "$PWD:/workspace" \
  --env-file .devteam/docker.env \
  stagecraft-runner:local run --cwd /workspace
```

Example `.devteam/docker.env`:

```dotenv
OPENAI_COMPAT_BASE_URL=https://example.invalid/v1
OPENAI_COMPAT_API_KEY=replace-with-runtime-secret
OPENAI_COMPAT_MODEL=provider/model-name
```

Do not bake API keys into the image. Use `--env-file`, `-e`, Docker secrets, a
runtime secret manager, or the environment injection facility of the system that
starts the container.

CLI hosts such as Claude Code, Codex CLI, and Gemini CLI can be layered in a
derived image if your team has a non-interactive authentication story. Browser
login flows are intentionally out of scope for the base image.

## Resume and Locks

All durable run state stays in the mounted project:

- `pipeline/run.lock`
- `pipeline/run-state.json`
- `pipeline/run-log.jsonl`
- `pipeline/gates/`
- `pipeline/logs/`

On startup, the entrypoint checks `/workspace/pipeline/run.lock` or the path
passed via `--cwd`. It reports whether the lock points at a live PID in the
container namespace or appears stale. It does not silently delete locks.

Common recovery commands:

```bash
docker run --rm -v "$PWD:/workspace" stagecraft-runner:local status --cwd /workspace
docker run --rm -v "$PWD:/workspace" stagecraft-runner:local run --cwd /workspace --resume
docker run --rm -v "$PWD:/workspace" stagecraft-runner:local run --cwd /workspace --force
```

If you have verified the lock is stale and want the wrapper to remove it before
delegating to `devteam`, set:

```bash
docker run --rm \
  -e STAGECRAFT_RUNNER_CLEAR_STALE_LOCK=1 \
  -v "$PWD:/workspace" \
  stagecraft-runner:local status --cwd /workspace
```

## Resource Limits and Supervisors

The image does not include a scheduler. Use `tmux`, `systemd`, cron, a remote
Docker context, or CI job runners around `docker run` if you need supervision.
Docker resource limits are operator policy:

```bash
docker run --rm \
  --cpus 4 \
  --memory 8g \
  -v "$PWD:/workspace" \
  --env-file .devteam/docker.env \
  stagecraft-runner:local run --cwd /workspace
```

The container preserves normal Stagecraft exit semantics. A pipeline halt or
error exits non-zero, and `pipeline-complete` exits zero unless the underlying
`devteam run` flags request stricter behavior.
