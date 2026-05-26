# Adapter: custom

Escape hatch. Runs a project-provided deploy script. Use when the
built-in adapters don't fit and writing a new adapter file isn't worth
the investment yet.

The custom adapter is minimalist by design — the project owns the
substance; this file just frames the inputs, outputs, and gate
contract.

## Assumptions

- The project has a script that, when given a plan file and the
  working directory, deploys the current build. The script is
  idempotent-enough that re-running is not catastrophic.
- The script either succeeds (exit 0 and the deploy is live) or
  fails (non-zero exit with stderr that a human can read).

## Config (`.devteam/config.yml`)

```yaml
deploy:
  adapter: custom
  custom:
    # Path relative to the project root. Must be executable.
    script: scripts/deploy.sh
    # Optional args passed to the script
    args:
      - --environment
      - prod
    # How long to wait for the script before declaring hung
    timeout_s: 1200
    # Optional smoke-test commands the adapter runs AFTER the script
    # completes. Each entry is a shell command; a zero exit = pass.
    smoke_commands:
      - curl -sf https://api.example.com/health
      - ./scripts/check_queue_depth.sh
```

## Procedure

### 1. Preconditions

- Stage 7 gate check (same as docker-compose §1)
- `pipeline/runbook.md` must exist
- `script` path must exist and be executable. If not, `status: FAIL`
  with the path as blocker.

### 2. Run the script

```bash
timeout <timeout_s> <script> <args...>
```

Capture stdout and stderr to `pipeline/deploy-log.md`.

Non-zero exit: `status: FAIL`, stderr as blocker, halt.
Timeout: `status: FAIL`, reason "deploy script exceeded <timeout_s>",
halt.

### 3. Smoke tests

For each `smoke_commands` entry:

```bash
<command>
```

Zero exit = pass. Any non-zero: capture the command, exit code, and
stderr as a blocker. `status: FAIL`, halt.

### 4. Write outputs

#### `pipeline/deploy-log.md`

```markdown
# Deploy Log

**Date**: <ISO>
**Method**: custom — <script>
**Runbook**: pipeline/runbook.md §<section>

## Script invocation
<script> <args>

## Script output
<captured stdout/stderr>

## Smoke tests
<per-command pass/fail with exit code>

## Recovery procedure
See runbook §Rollback.
```

#### `pipeline/gates/stage-08.json`

```json
{
  "stage": "stage-08",
  "status": "PASS",
  "agent": "dev-platform",
  "track": "<track>",
  "timestamp": "<ISO>",
  "adapter": "custom",
  "environment": "<from script output or config>",
  "smoke_test_passed": true,
  "runbook_referenced": true,
  "adapter_result": {
    "script": "<path>",
    "exit_code": 0,
    "duration_s": N
  },
  "blockers": [],
  "warnings": []
}
```

## Runbook hooks

`pipeline/runbook.md` must include:

- **§Rollback** — the project's rollback procedure. The custom
  adapter does not attempt a rollback; the runbook is the
  authoritative source.
- **§Script contract** — what the deploy script does and doesn't do,
  so a future on-call engineer can trust its idempotency claims.

## When to switch to a named adapter

If the custom script grows past ~100 lines or gets re-used across
projects, promote it to a proper adapter file under `.devteam/adapters/`
following `README.md` §"Writing a new adapter".
