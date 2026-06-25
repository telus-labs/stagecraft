# ADR 013 — GitHub Actions cloud runner adapter

**Status:** Accepted
**Date:** 2026-06-22
**Authors:** Mumit Khan (design), drafted with Claude Sonnet 4.6

## Context

The BACKLOG item A3 (cloud-runner adapter, I:4 E:4) and `plans/phase-21-cloud-runner-adapter.md`
describe the goal: route an eligible workstream to an ephemeral remote worker while keeping
routing, authority, gate validation, and pipeline state under the local orchestrator. The
phase-21 plan assumed a custom `/v1/jobs` HTTP server — a portable but infrastructure-heavy
first step that requires somewhere to host the worker process.

The operator starting this implementation has a GitHub organization (`mumit-khan`) with
GitHub Actions available and no hosted cloud infrastructure (no AWS, Replit, or VM).
GitHub Actions is the only available remote execution environment.

Three facts shape the decision space:

**Fact 1 — GitHub Actions is not a persistent HTTP server.** Workflows are triggered by
events via GitHub's REST API. There is no `/v1/jobs` endpoint to submit to; the submission
mechanism is `workflow_dispatch`. Status, logs, and results are retrieved through separate
GitHub API calls. The phase-21 generic protocol cannot be consumed as-is by a GitHub Actions
backend without a proxy layer, which would require a hosted server to run.

**Fact 2 — GitHub workflow_dispatch does not return a run ID.** The dispatch call returns
`204 No Content`. The adapter must correlate its request to the resulting run by embedding an
idempotency key as a workflow input and matching against the `run-name` field, which the
workflow YAML sets to `${{ inputs.idempotency_key }}`. The runs list API returns `name`
on each run, enabling reliable correlation without additional infrastructure.

**Fact 3 — Provider configuration must not leak private endpoint URLs.** One target
configuration uses a proxy endpoint (`https://api.fuelix.ai`) that must not appear in the
workflow YAML (which may be public). GitHub Secrets hold arbitrary strings — not just
credentials — so all provider configuration values can be stored as secrets and referenced
as `${{ secrets.VAR }}` in the YAML without exposing values.

## Decision

### 1. GitHub-native adapter, not generic protocol

Build `hosts/cloud-runner-github/` as a GitHub-specific adapter. It speaks the GitHub
Actions REST API directly rather than implementing the phase-21 `/v1/jobs` generic protocol.
The adapter is modeled on the existing host-adapter contract (`docs/adr/002-host-adapter-contract.md`):
`capabilities.json` plus `adapter.js` with `install`, `renderStagePrompt`, `status`,
`uninstall`, and `invoke`.

The generic `/v1/jobs` protocol from phase-21 remains the long-term target for hosting
providers beyond GitHub. This ADR does not define or implement that protocol. A future ADR
will absorb the lessons from this implementation when a second cloud target warrants the
generic layer.

### 2. Dedicated `stagecraft-runner` repository

The runner workflow (`stagecraft-runner.yml`) lives in a separate repository
(`mumit-khan/stagecraft-runner`), not co-located with the Stagecraft library. Reasons:

- The runner is an independently deployable artifact — operators fork or copy it; it is not
  a library file.
- Access controls, visibility settings, and secret scopes for the runner are separate from
  the library repo.
- CI on the library repo should not depend on a workflow file in the same repo.
- Future operators who implement a different cloud target do not need to touch the Stagecraft
  source tree.

### 3. Protocol mapping — GitHub API as the job protocol

The adapter maps Stagecraft's job lifecycle onto GitHub's existing APIs:

| Stagecraft concept | GitHub mechanism |
|---|---|
| Submit job | `POST /repos/{owner}/{repo}/actions/workflows/{workflow}/dispatches` with `inputs.idempotency_key`, `inputs.stage`, `inputs.workstream_id`, `inputs.prompt` (base64), `inputs.allowed_writes` (JSON) |
| Correlate run | Workflow YAML sets `run-name: ${{ inputs.idempotency_key }}`; adapter polls `GET /repos/{owner}/{repo}/actions/runs` and matches on `run.name` |
| Job status | `GET /repos/{owner}/{repo}/actions/runs/{run_id}` — `status: queued/in_progress/completed`, `conclusion: success/failure/cancelled/timed_out` |
| Log streaming | Poll `GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs` for step logs; bound log volume before writing to the local transcript path |
| Result bundle | GitHub Actions artifact uploaded by the workflow; adapter downloads via `GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/zip`, verifies digest, applies locally |

**Idempotency.** The adapter records the idempotency key in run-state before dispatching.
On reconnect it re-correlates by polling `runs?event=workflow_dispatch&created=>T` (where T
is the dispatch timestamp recorded in run-state), matching on `run.name`. A successful result
is applied at most once; the key is marked consumed in run-state before the working tree is
touched.

**Prompt transport.** The rendered prompt is base64-encoded and passed as a workflow input.
GitHub Actions input values are limited to 65,535 bytes each. Prompts that exceed this limit
fail closed at submission time with an actionable error before any dispatch occurs.

**Timeout and cancellation.** The existing per-dispatch timeout governs. On timeout or
process interruption, the adapter calls `POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel`
and waits a short bounded period for acknowledgement. A late successful result arriving after
the local invocation settles is never applied.

### 4. Provider configuration — non-sensitive values in YAML, auth token as secret

The reference worker running inside the GitHub Actions job supports two provider drivers:

| Driver | API format | Default endpoint |
|---|---|---|
| `anthropic-messages` | Anthropic Messages API (`POST /v1/messages`) | `https://api.anthropic.com` |
| `openai-chat` | OpenAI Chat Completions API (`POST /v1/chat/completions`) | `https://api.openai.com` |

The `openai-chat` driver covers OpenAI, compatible proxies (including private endpoints),
Azure OpenAI, Codex, and Ollama. Auth is always `Authorization: Bearer <token>`; the
`x-api-key` header is never used (even with Anthropic-compatible proxies that accept bearer
auth).

Non-sensitive provider configuration is hardcoded directly in the workflow YAML. Only the
auth token is stored as a secret:

```yaml
env:
  STAGECRAFT_PROVIDER_ENDPOINT:   https://api.fuelix.ai     # plain value in YAML
  STAGECRAFT_PROVIDER_MODEL:      claude-sonnet-4-6          # plain value in YAML
  STAGECRAFT_PROVIDER_DRIVER:     openai-chat                # plain value in YAML
  STAGECRAFT_MAX_TOKENS:          "8192"                     # plain value in YAML
  STAGECRAFT_PROVIDER_AUTH_TOKEN: ${{ secrets.STAGECRAFT_PROVIDER_AUTH_TOKEN }}
```

This is the simpler operational model: one secret to manage, YAML values are visible for
debugging, and changing providers or models is a YAML edit and push — no secret rotation
required. The auth token is the only value that must be kept out of the repository.

Operators who need to keep their provider endpoint private (e.g., an internal proxy whose URL
is itself sensitive) may move `STAGECRAFT_PROVIDER_ENDPOINT` to a GitHub Secret — the worker
reads it from the environment either way.

### 5. Local orchestration invariant

Only workstream execution moves to the remote runner. The local Stagecraft process retains
authority over all other decisions, identical to the phase-21 plan:

- track and route selection
- stoplist, budget, retry, convergence, and consequence-ceiling decisions
- workstream decomposition and stage-gate merge
- gate-chain stamping and local validation
- write auditing (allowed-writes enforcement runs locally against the downloaded bundle)
- run state, evidence events, and authority provenance

The remote workflow receives one rendered prompt and one bounded set of workspace inputs
embedded in the workflow dispatch. It returns a result bundle; the local orchestrator decides
whether and how to apply it.

### 6. Result application

The workflow uploads its output as a GitHub Actions artifact. The adapter downloads and
applies results as a local transaction:

1. Download artifact zip and verify digest.
2. Reject absolute paths, `..` traversal, symlink escapes, duplicate paths, anything outside
   `allowedWrites` plus the expected gate path, and files exceeding output ceilings.
3. Validate all file digests against the result manifest.
4. Detect base-digest conflicts: if a local file changed after submission, accept only an
   identical returned digest; otherwise halt with a named conflict.
5. Stage verified files in a temporary sibling directory.
6. Apply serially; run the existing write audit and gate validator locally.
7. Mark the idempotency key consumed in run-state only after all writes succeed.
8. Delete the GitHub artifact after successful application.

### 7. MVP consequence boundary

Stage-07 (sign-off) and stage-08 (deploy) cannot be routed to the GitHub cloud runner in
this implementation. The adapter's `invoke()` throws a structural failure if called for
either stage. Remote credential delegation (for deploy targets) and remote human-in-the-loop
sign-off are separate future concerns.

### 8. Authentication — client side

The Stagecraft client authenticates to the GitHub API with a fine-grained Personal Access
Token scoped to the `stagecraft-runner` repository with:

- `actions: write` — to dispatch workflows and cancel runs
- `actions: read` — to poll run status, fetch logs, and download artifacts

The token is stored in the local environment or operator secrets under `STAGECRAFT_RUNNER_TOKEN`
and referenced in the Stagecraft client config:

```yaml
cloud_runner:
  provider: github-actions
  owner: mumit-khan
  repo: stagecraft-runner
  workflow: stagecraft-runner.yml
  auth_env: STAGECRAFT_RUNNER_TOKEN
  profile: standard
```

The token never enters the rendered prompt, the result bundle, or gate files.

## Consequences

**Positive:**

- Works with existing GitHub organization — no new cloud account, no hosted server, no
  billing setup beyond GitHub plan limits.
- Auth token is hidden behind a GitHub Secret; non-sensitive values (endpoint URL, model,
  driver) are visible in the YAML for easy debugging and rotation without touching secrets.
  Only one secret to manage.
- Two provider drivers cover the full current range: Anthropic native, OpenAI, and any
  compatible proxy.
- The local orchestration invariant (decision 5) preserves all existing gate-chain,
  write-audit, and authority-provenance guarantees. Remote execution is additive, not
  substitutive.
- The idempotency key and at-most-once application rule prevent duplicate gate writes on
  reconnect or retry.

**Negative / costs:**

- **GitHub-only.** This adapter does not generalize to other cloud providers. An operator on
  AWS, Fly.io, or Replit needs a different adapter or the future generic protocol.
- **Prompt size limit.** The 65,535-byte GitHub Actions input limit constrains prompt length.
  Long-context stages (e.g., full-file analysis prompts) may hit this ceiling. Mitigation:
  upload oversized prompts as a pre-run artifact and reference the artifact URL in the input;
  deferred to post-MVP.
- **No real-time log streaming.** GitHub Actions does not stream log lines to an external
  client. The adapter polls step-level logs at a bounded interval; the user sees progress
  samples, not a live stream.
- **Artifact retention window.** GitHub artifacts expire (1–90 days, configurable in the
  runner repo). The adapter deletes the artifact on successful application; residual artifacts
  from interrupted runs are cleaned up by a workflow scheduled job.
- **Run correlation delay.** Dispatching and correlating a run via name-matching adds a
  bounded polling window (typically 5–30 seconds for GitHub to register the new run). This
  is dead time from the orchestrator's perspective and counts against the dispatch timeout.
- **Several roles must run locally.** The cloud runner has no `shell` capability. Four roles
  are affected: `principal` (ruling and fix-escalation need direct filesystem access),
  `platform` (pre-review stage-04a and deploy stage-08 run test suites and deploy scripts),
  `qa` (stage-06 and stage-06e run tests and performance benchmarks), and `verifier`
  (stage-06d runs verification scripts). Operators must add all four to `routing.roles` in
  `.devteam/config.yml`. The `install()` stub includes all four lines by default.

**What now needs to be true:**

- `hosts/cloud-runner-github/capabilities.json` declares the adapter surface and limitations.
- `hosts/cloud-runner-github/adapter.js` implements the full adapter contract plus `invoke()`.
- `hosts/cloud-runner-github/worker/` contains the runner workflow YAML and the model
  invocation script (Node.js), living in the Stagecraft repo as the reference implementation
  to be copied to `mumit-khan/stagecraft-runner`.
- `core/adapters/remote-bundle.js` provides a deterministic input manifest used by the adapter
  to embed workspace files in the dispatch inputs (for small workspaces) or as a pre-run
  artifact reference (for large ones).
- The adapter's `install()` validates token scopes and repository reachability via a read-only
  preflight call; `status()` reports the last run outcome.
- `tests/cloud-runner-github.test.js` covers job submission, run correlation, timeout,
  cancellation, duplicate result, conflict detection, and consequence-stage refusal against
  a local HTTP fake of the GitHub API.
- Tokens never appear in logs, gate files, evidence exports, or error messages.
- The offline test suite runs without GitHub credentials or network access.

## Alternatives considered

1. **Generic `/v1/jobs` protocol first (phase-21 plan).** Build an HTTP server implementing
   the protocol, deploy it somewhere, then implement the GitHub adapter as one deployment
   target. Correct and portable but requires a hosted server before any cloud execution is
   possible. Deferred: no second cloud target exists yet to justify the generic layer; the
   GitHub adapter will inform that design with real usage evidence.

2. **Co-locate the runner workflow in the Stagecraft repo.** Rejected: conflates library
   source with deployable runner artifact. Operators copying or forking the runner should not
   need to track library commits. Separate repo also allows different visibility and access
   control settings.

3. **All provider configuration in GitHub Secrets (no plain YAML values).** Initially
   considered to keep the workflow YAML completely opaque in public repos. Rejected in favor
   of putting non-sensitive values (endpoint URL, model, driver, max tokens) directly in the
   YAML. Reason: one secret (the auth token) is sufficient for security; storing non-credential
   values as secrets adds rotation burden and makes debugging harder (secret values are masked
   in logs). Operators who genuinely need to hide their endpoint URL may still move it to a
   secret — the worker reads it either way.

4. **Single JSON blob secret for all worker config.** Rejected in the same decision as above.
   A JSON blob secret makes all values opaque and hard to change without also rotating the
   secret. The plain YAML approach is easier to read and maintain.

5. **GitHub App instead of Personal Access Token.** A GitHub App allows finer permission
   scopes and installation-level tokens. Rejected for MVP: adds OAuth token exchange and
   installation management complexity. Revisit if the adapter is used across multiple
   organizations.

6. **Workspace files via git ref, not input bundle.** The remote worker would clone the
   operator's repository at the current commit. Rejected per phase-21 ADR design principle:
   workers must receive an explicit input bundle; arbitrary repository cloning by a remote
   worker is a supply-chain risk and leaks repo credentials to the runner.
