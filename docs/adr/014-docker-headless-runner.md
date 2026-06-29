# ADR 014 — Docker-Based Headless Runner

**Status:** Accepted
**Date:** 2026-06-29
**Authors:** Stagecraft maintainers

## Context

Long `devteam run` executions can outlive an interactive shell or laptop
session. The earlier cloud-runner direction moved individual stages into GitHub
Actions, but that created a second orchestration protocol: result bundles,
dispatch correlation, polling, and hook emulation for stages that derive gates
from file writes.

Issue #282 asks for a lower-complexity unattended path: package Stagecraft and a
headless-capable execution environment into a Docker image, mount the target
project, and let the normal local orchestrator run inside the container.

This changes the recommended unattended-execution trust boundary, so the
container behavior needs an explicit decision before becoming a supported
surface.

## Decision

Stagecraft ships a Docker runner under `hosts/docker/` that packages the normal
`devteam` CLI and production Node.js dependencies. It is a packaging and runtime
surface, not a new host adapter, not a cloud runner, and not a scheduler.

The runner follows these rules:

1. **Containerized local orchestration.** The whole `devteam run` driver runs
   inside one container. Stagecraft does not introduce per-stage container
   isolation, an external queue, a result-bundle protocol, or remote worker
   correlation in this surface.
2. **Mounted project as source of truth.** The target project is mounted at
   `/workspace` by convention. `.devteam/`, `pipeline/`, gates, logs,
   `run-state.json`, `run-log.jsonl`, and `run.lock` remain on the mounted
   volume and are readable from the host after the container exits.
3. **Host-neutral base image.** The base image does not hard-code Claude Code or
   any other CLI host. It supports Stagecraft's existing routing config. The
   preferred no-extra-CLI path is `openai-compat`; teams that need Claude Code,
   Codex CLI, Gemini CLI, or private tools can layer them in derived images.
4. **Environment-only credentials.** Provider keys and host credentials enter at
   runtime through environment variables, env files, Docker secrets, or a
   supervisor's secret manager. Credentials are never baked into image layers or
   shown with real-looking values in docs.
5. **Non-root writes.** The Dockerfile creates a non-root runtime user and
   exposes build args for UID/GID. Operators can also pass Docker `--user` to
   align writes with the mounted project owner.
6. **Conservative lock handling.** The entrypoint detects `pipeline/run.lock`
   and reports active or stale-looking locks with resume/force guidance. It does
   not silently delete locks. Explicit stale-lock removal is available only via
   `STAGECRAFT_RUNNER_CLEAR_STALE_LOCK=1`.
7. **No scheduler in the image.** `tmux`, `systemd`, cron, remote Docker
   contexts, CI jobs, and webhook wrappers are operator patterns around
   `docker run`; Stagecraft does not bundle a job queue in this image.

The container preserves the normal CLI exit codes. Docker supervisors can trust
the `devteam` process result: success for normal completion or clean configured
stops, non-zero for halts, lock errors, validation failures, or stricter
operator-selected gates.

## Consequences

The MVP is much simpler than a cloud runner and reuses the existing local driver,
router, host adapters, gate validation, evidence events, and exit semantics.
Operators can stop and resume runs because all durable state stays on the mounted
project volume.

The runner is not a security sandbox for untrusted code. The orchestrator and
host tools run in one container with whatever credentials and filesystem mount
the operator supplies. Stronger per-stage isolation remains a separate
cloud-runner or worker-protocol problem.

Interactive host authentication is not solved by the base image. The
documented default is `openai-compat` with runtime environment credentials.
CLI-host images are possible follow-ups, but each one needs its own
non-interactive auth story and maintenance owner.

Lock detection is advisory. PID checks inside a container namespace cannot prove
that a host-side process is still alive. The wrapper therefore reports lock state
and provides explicit recovery commands rather than deleting locks by default.

## Alternatives Considered

### GitHub Actions Cloud Runner

Rejected for this scope. It can keep work running when a laptop disappears, but
it requires stage dispatch, result correlation, polling, and gate-derivation
emulation. That complexity belongs to a separate cloud-runner design, not the
local unattended MVP.

### Per-Stage Container Isolation

Deferred. Per-stage isolation would improve blast-radius control but requires a
new worker protocol and artifact handoff model. The Docker runner deliberately
keeps the existing in-project file contract.

### Host-Specific Base Image

Rejected for the base image. Baking in Claude Code or another CLI would make the
image less portable and force one authentication model. Derived host-specific
images remain possible.

### Wrapper Script Outside the Repository

Rejected. A private wrapper would be easy to start but hard to test, document,
and keep aligned with Stagecraft's lock and exit semantics. The supported runner
belongs in the repo with tests and docs.

### Silent Stale-Lock Deletion

Rejected. A stale lock can represent a live run outside the current container
namespace. The runner can report the condition and support explicit deletion,
but silent cleanup would weaken the safety model.
