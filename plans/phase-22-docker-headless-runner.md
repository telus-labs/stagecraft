# Phase 22 — Docker-Based Headless Runner

**Status:** Implemented in the Docker runner PR; ADR-014 accepted.
**Source:** GitHub #282.
**Purpose:** package Stagecraft and headless-capable hosts into a repeatable container
runtime for unattended pipeline execution while keeping all pipeline state in the
operator's mounted project directory.

## 1. Outcome

An operator can run a full pipeline without keeping their interactive shell or laptop
alive:

```bash
docker run --rm \
  --user "$(id -u):$(id -g)" \
  -v "$PWD:/workspace" \
  --env-file .devteam/docker.env \
  stagecraft-runner:latest run --cwd /workspace --watch
```

The container starts `devteam run`, executes the same local orchestrator and host adapter
logic as a normal install, writes artifacts to the mounted project, and exits with the
driver's final status. A later container invocation can resume from the mounted
`pipeline/` state.

This is a packaging and runtime surface, not a new host adapter and not a remote
orchestrator. Stagecraft still owns:

- stage ordering, routing, retries, and consequence ceilings;
- gate validation, gate-chain stamping, write audit, and evidence events;
- all artifacts under the mounted project directory;
- host selection through the project's existing `.devteam/config.yml`.

## 2. Why an ADR is required

The Docker runner changes the recommended unattended-execution trust boundary. It
touches secrets, filesystem ownership, stale locks, host credential provisioning, and
support expectations for long-running runs. Phase 22 therefore begins with ADR-014.
Implementation began after ADR-014 was accepted.

ADR-014 locks these decisions:

1. **Containerized local orchestration.** The whole orchestrator runs in the container;
   no per-stage result protocol or external queue is introduced.
2. **Mounted project is the source of truth.** `pipeline/`, gates, logs, and run state
   live on the mounted volume and remain readable from the host after exit.
3. **Host-neutral by default.** The image does not hard-code Claude Code. It supports
   `openai-compat` as the no-extra-CLI path and documents optional host CLIs as image
   variants or build-time additions.
4. **Environment-only credentials.** API keys and host credentials enter through
   environment variables, env files, Docker secrets, or the runtime's secret manager.
   They are never baked into the image.
5. **Non-root writes.** The default path writes mounted artifacts as a non-root user,
   with documented UID/GID options for Linux hosts and clear macOS/Windows notes.
6. **Conservative lock handling.** Startup may report stale locks and provide an
   explicit resume/clear workflow, but it must not silently delete a lock that could
   represent a live run.
7. **No scheduler in the image.** tmux, cron, remote Docker contexts, GitHub Actions,
   and webhook wrappers are documented operator patterns, not built-in Stagecraft job
   queues.

## 3. Scope boundaries

### In scope

- A Dockerfile under `hosts/docker/` or another clearly documented packaging directory.
- A tiny entrypoint that sets up `/workspace`, validates environment, and delegates to
  `devteam`.
- Documentation for build, run, resume, secrets, UID/GID, resource limits, and common
  host configurations.
- Tests that can run offline without model credentials.
- A manual smoke recipe for real end-to-end runs with `openai-compat` or a locally
  available CLI host.

### Out of scope

- Per-stage container isolation.
- Multi-machine parallelism.
- A hosted runner service, durable queue, webhook server, or autoscaler.
- Remote sign-off/deploy delegation beyond what existing Stagecraft stages already do
  inside the container.
- Baking provider credentials into the image.

## 4. Runtime contract

### Image contents

The MVP image should include:

- Node.js at the same support level documented by Stagecraft;
- Stagecraft source or installed package;
- production npm dependencies;
- a `stagecraft-runner` or `devteam` entrypoint;
- optional shell utilities needed by Stagecraft smoke checks.

The MVP should not try to bundle every possible host CLI. `openai-compat` provides the
default zero-extra-CLI story. Host-specific images can be layered later if users want
preinstalled Claude Code, Codex, Gemini, or private tools.

### Invocation

The entrypoint must support both styles:

```bash
docker run stagecraft-runner:latest run --cwd /workspace
docker run stagecraft-runner:latest devteam status --cwd /workspace
```

If no command is supplied, the default should print concise usage rather than start a
pipeline accidentally.

### State and resume

All durable state remains under the mounted project:

- `.devteam/config.yml`
- `pipeline/`
- `pipeline/gates/`
- `pipeline/logs/`
- `pipeline/run-state.json`
- `pipeline/run-log.jsonl`
- `pipeline/run.lock`

On startup, the entrypoint should detect an existing `pipeline/run.lock` and report:

- whether the lock looks active or stale using existing Stagecraft lock/status data;
- the safe resume command;
- the explicit command to clear a stale lock, if Stagecraft exposes one by then.

Silent lock deletion is not allowed in the MVP.

### Exit semantics

The container should preserve Stagecraft's existing CLI exit behavior:

- success when the command succeeds;
- non-zero when the pipeline halts, errors, or validation fails;
- no special Docker-only exit-code mapping unless an ADR accepts it.

This keeps Docker, cron, GitHub Actions, and other supervisors simple: they can trust the
process exit code.

## 5. Work items and PR sequence

### 22.0 — ADR-014 and plan approval

**Scope:** documentation only.

- Write ADR-014 for the Docker runner trust boundary and packaging decision.
- Record alternatives: GitHub Actions cloud runner (#276), generic cloud-runner protocol
  (Phase 21), tmux-only documentation, host-specific images, and wrapper scripts outside
  the repo.
- Update this plan if ADR review changes the boundary.

**Exit:** ADR-014 accepted and issue #282's acceptance criteria are confirmed or revised.

### 22.1 — Image skeleton and entrypoint

**Scope:** packaging surface with no behavior changes to core orchestration.

- Add `hosts/docker/Dockerfile`.
- Add `hosts/docker/entrypoint.sh` or a small Node entrypoint.
- Build with a non-root runtime user and documented UID/GID arguments.
- Install Stagecraft dependencies without requiring dev-only tooling at runtime.
- Default to usage output when no command is supplied.
- Add smoke tests or scripted checks for entrypoint argument forwarding.

**Likely files:** `hosts/docker/Dockerfile`, `hosts/docker/entrypoint.sh`,
`hosts/docker/README.md`, `tests/docker-runner.test.js` if local Docker is available or
a shellcheck-style offline test if it is not.

**Exit:** image builds locally and `devteam help` works inside the container against a
mounted temp project.

### 22.2 — Mounted-project run and resume behavior

**Scope:** prove the image preserves Stagecraft's on-disk contract.

- Run `devteam init --host openai-compat --cwd /workspace` in a mounted temp project.
- Run `devteam status`, `summary`, and a headless stub command against the mount.
- Add lock detection/reporting behavior at startup.
- Document explicit stale-lock recovery; do not delete locks silently.
- Verify mounted files are not written as root under the supported Linux path.

**Exit:** a container invocation can halt and a later invocation can inspect/resume the
same mounted pipeline state.

### 22.3 — Host and secret guidance

**Scope:** operator documentation and examples.

- Document the preferred `openai-compat` setup using env files.
- Document optional CLI-host images or build extensions without making them required.
- Provide examples for Docker secrets, `--env-file`, remote Docker context, tmux/systemd,
  CPU/memory limits, and log inspection.
- Add troubleshooting for permissions, stale locks, missing host credentials, and
  unsupported interactive browser auth flows.

**Exit:** a new operator can choose a host, supply credentials, and run an unattended
pipeline without reading unrelated architecture docs.

### 22.4 — CI and release hardening

**Scope:** make the packaging surface trustworthy enough to ship.

- Add a CI lane that builds the image when Docker is available.
- Keep model-dependent execution out of CI; use existing headless stubs and
  `openai-compat` fetch mocks.
- Add docs to `docs/FEATURES.md`, `docs/user-guide.md`, and relevant references.
- Add changelog fragment and consistency coverage if new stable facts are introduced.

**Exit:** CI-equivalent tests, consistency, lint, Docker build smoke, and docs all pass.

## 6. Acceptance criteria

- `docker build` succeeds from a clean checkout.
- `docker run -v <project>:/workspace ... stagecraft-runner:latest devteam help` works.
- `docker run -v <project>:/workspace ... stagecraft-runner:latest run --cwd /workspace`
  preserves normal Stagecraft exit semantics.
- Artifacts written inside the container are visible on the host under the mounted
  project and are not root-owned on the supported Linux path.
- Stale locks are detected and reported with a safe recovery path.
- Secrets are accepted through runtime env/secrets only and are never copied into image
  layers, config files, gates, logs, or docs examples.
- Existing offline suite remains green; Docker-specific tests are skipped with a clear
  reason when Docker is unavailable.

## 7. Risks and mitigations

- **Image drifts from local Stagecraft.** Keep the image a thin packaging wrapper around
  the same CLI, and test argument forwarding plus mounted-state behavior.
- **Permission surprises on mounted volumes.** Use non-root defaults and document UID/GID
  explicitly; test the Linux path.
- **Secrets leak through examples.** Use placeholder names and env-file patterns only;
  never show real-looking keys.
- **Users mistake this for cloud-runner isolation.** Repeat that the whole orchestrator
  runs in one container; per-stage isolation and remote execution stay in Phase 21/#276.
- **Interactive host auth fails in containers.** Prefer `openai-compat` for the MVP and
  document CLI-host auth as an operator responsibility.
