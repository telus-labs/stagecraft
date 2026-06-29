- **Docker-based headless runner** (closes #282). Adds `hosts/docker/` with a
  non-root Dockerfile, a small entrypoint that delegates to the normal `devteam`
  CLI, lock-state reporting for mounted projects, explicit stale-lock cleanup
  via `STAGECRAFT_RUNNER_CLEAR_STALE_LOCK=1`, and operator docs for build, run,
  resume, UID/GID alignment, secrets, host choices, and resource limits. ADR-014
  locks the trust boundary: the runner is containerized local orchestration, not
  a scheduler, cloud worker, per-stage sandbox, or new host adapter. Offline
  tests cover the packaging surface and entrypoint behavior without requiring
  Docker or model credentials.
