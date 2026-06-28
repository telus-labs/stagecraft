# Phase 21 — Cloud Runner Adapter

**Status:** Proposed for review; no implementation is authorized by this plan.
**Source:** BACKLOG A3.
**Purpose:** run a single Stagecraft workstream on an ephemeral remote worker while
keeping routing, authority, validation, merging, and pipeline state under the local
orchestrator.

## 1. Outcome

An operator can route an eligible role or stage to `cloud-runner`:

```yaml
routing:
  default_host: claude-code
  roles:
    backend: cloud-runner

cloud_runner:
  endpoint: https://runner.example.com
  auth_env: STAGECRAFT_CLOUD_RUNNER_TOKEN
  profile: standard
  poll_interval_ms: 2000
  max_bundle_bytes: 52428800
```

For each routed workstream, the adapter snapshots the bounded local inputs, submits one
job, streams remote logs into the existing transcript path, downloads a result bundle,
applies only authorized outputs, and returns the existing `InvokeResult` shape. The
orchestrator then validates and merges gates exactly as it does for local hosts.

This is a host adapter, not a remote orchestrator. The local Stagecraft process remains
the sole owner of:

- track and route selection;
- stoplist, budget, retry, convergence, and consequence-ceiling decisions;
- workstream decomposition and stage-gate merge;
- local gate-chain stamping and validation;
- run state, evidence events, and authority provenance.

The remote service receives one rendered prompt and one bounded workspace snapshot. It
never decides what stage runs next.

## 2. Why an ADR is required

Cloud execution resolves `ARCHITECTURE.md`'s open question about where the orchestrator
runs and adds an externally implementable job protocol. It also makes trust and artifact
transport part of the host-adapter boundary. Phase 21 therefore begins with a proposed
cloud-execution ADR; implementation must not begin until that ADR is accepted.

The ADR must lock these decisions:

1. **Local orchestration.** Only workstream execution moves remotely.
2. **Pull-free jobs.** Workers receive an explicit input bundle; they do not clone an
   operator-supplied repository URL or fetch arbitrary refs.
3. **Server-owned execution profiles.** The client selects a named profile. It cannot
   submit a shell command, model credential, or worker image.
4. **Result allowlisting.** A result may contain only the expected gate and files matching
   that workstream's `allowedWrites`; Stagecraft verifies this before touching the working
   tree.
5. **Local truth.** A remotely returned gate has no authority until it is materialized,
   validated, write-audited, and, where configured, chain-stamped locally.
6. **At-least-once transport, at-most-once application.** Job submission and polling may
   retry by idempotency key; a result bundle is applied locally no more than once.
7. **MVP consequence boundary.** Stage 07 sign-off and Stage 08 deploy cannot route to the
   cloud runner. Remote credential delegation is a separate future ADR.

## 3. Trust boundaries and protocol

### 3.1 Job request

Use a versioned HTTPS protocol under `/v1/jobs`. A submission contains:

- a random idempotency key generated per run/attempt/workstream;
- protocol version and Stagecraft version;
- stage ID, role, workstream ID, track, timeout, and named execution profile;
- the already-rendered prompt;
- an input manifest containing relative POSIX paths, byte sizes, modes, and SHA-256
  digests;
- a compressed workspace bundle whose digest covers the exact uploaded bytes;
- the expected gate path and normalized `allowedWrites` patterns.

The service returns an opaque job ID. Status responses use a small closed state set:
`queued`, `running`, `succeeded`, `failed`, `cancelled`, or `expired`. Logs are read with
an opaque cursor so reconnecting never requires buffering the full transcript.

Successful jobs expose a result manifest and bundle. The manifest includes every output
path, its digest, the input digest from which the job ran, exit status, duration, and
optional provider-neutral token/cost/model telemetry. It contains no free-form server
diagnostics; those stay in the transcript.

### 3.2 Authentication and secrets

- The endpoint must be HTTPS outside loopback test fixtures.
- `auth_env` names an environment variable. Tokens never enter config, prompts, bundles,
  logs, gates, evidence exports, or error messages.
- The worker's model and infrastructure credentials are provisioned server-side by its
  execution profile.
- Input creation reuses Stagecraft's secret scanner and fails closed before upload.
- `.git`, dependency caches, host credential directories, `.env*`, private keys,
  Stagecraft locks/state, and prior transcripts are excluded regardless of git status.
- Authentication errors are structural dispatch failures, not transient retries.

The plan deliberately does not define multi-tenant authorization, billing, or a hosted
Stagecraft control plane. The reference worker is self-hosted infrastructure.

### 3.3 Input bundle

The bundle builder is a pure core utility shared by the adapter and tests. It includes:

1. tracked working-tree files using their current bytes, including unstaged edits;
2. non-ignored untracked files;
3. ignored `pipeline/` artifacts explicitly named by the stage's `readFirst` set or
   required by the rendered prompt contract;
4. installed host-neutral Stagecraft context required by that dispatch.

It excludes generated dependencies and caches by a documented fixed denylist. Symlinks
are preserved only when their resolved target remains inside the project root; escaping
or special filesystem entries fail closed. Paths are normalized and checked for case
collisions so bundles behave consistently on Windows and POSIX workers. The byte ceiling
is enforced before network submission, with an actionable list of the largest included
files.

The bundle manifest is stable-sorted and deterministic for identical bytes. Archive
timestamps and ownership metadata do not affect its digest.

### 3.4 Result application

Result handling is a transaction-like local operation:

1. download to a temporary directory and verify the bundle digest;
2. reject absolute paths, `..`, symlink escapes, special files, duplicate/case-colliding
   paths, and anything outside `allowedWrites` plus the exact expected gate path;
3. validate file digests and impose output file/count/byte ceilings;
4. compare each output's recorded input digest with the current local file digest;
5. if a local file changed after submission, accept only an identical returned digest;
   otherwise halt with a named result conflict and preserve the downloaded bundle for
   inspection outside the project tree;
6. stage verified files in a temporary sibling and apply them serially;
7. run the existing write audit and gate validator locally;
8. mark the job's idempotency key applied only after all writes succeed.

Parallel workstreams may execute remotely, but their results are applied through one
local queue. This preserves current fan-out while preventing two result downloads from
racing over the working tree.

### 3.5 Timeout, cancellation, and late results

The existing per-dispatch timeout remains authoritative. On timeout or process
interruption, the adapter requests cancellation and waits only for a short bounded
acknowledgement. Cancellation is best-effort: a late successful result is never applied
after the local invocation has settled. The local return remains `timedOut: true`, so the
current driver classification and retry policy continue to apply.

Submission retries use the same idempotency key. Poll/log/download retries use bounded
exponential backoff with jitter and honor `Retry-After`. Remote model failure is reported
as the workstream exit result; protocol corruption, authentication failure, and invalid
bundles are structural failures.

## 4. Adapter and worker shape

### 4.1 Built-in client adapter

Add `hosts/cloud-runner/` with the normal adapter contract:

- `capabilities.json`: `headless: true`, `hooks: false`, `subagents: false`,
  `slashCommands: false`, `worktrees: true`, and post-hoc allowed-write enforcement;
- `adapter.js`: idempotent install/status/uninstall, standard prompt rendering, and a
  custom `invoke()` backed by the remote job client rather than `runHeadless()`;
- no model-provider commands or credentials in the install payload.

`subagents: false` is intentional. Stagecraft already decomposes and parallelizes
workstreams; each remote job remains independently attributable and cancellable.

`devteam doctor` performs a read-only health/profile check, verifies protocol-version
compatibility, and reports server capabilities without exposing authentication material.
Dispatch still rechecks compatibility so a stale doctor result cannot authorize a job.

### 4.2 Reference worker

Ship a small self-hostable reference worker under the cloud-runner host boundary, not in
`core/`. It:

- authenticates requests through a replaceable middleware interface;
- maps the requested profile to server-owned command/image/resource limits;
- creates a fresh workspace per job and expands only verified input paths;
- invokes a configured Stagecraft-compatible model host with the submitted prompt;
- captures bounded streaming logs and packages allowlisted outputs;
- enforces wall-clock, CPU/memory where the deployment runtime supports them, input and
  output ceilings, and workspace cleanup/retention policy;
- never runs a client-supplied setup command.

The first reference deployment should be a single-worker container with an in-memory
queue and filesystem job store. It proves the protocol and is explicitly not highly
available. Durable queues, autoscaling, and vendor-specific deployment templates follow
only after the adapter contract is stable.

## 5. Work items and PR sequence

### 21.0 — ADR-013 and threat model

**Scope:** documentation only.

- Write ADR-013 with the decisions in section 2 and alternatives: remote orchestrator,
  git-ref-only workers, shared network filesystem, provider-specific runner, and arbitrary
  client command execution.
- Add a data-flow threat model covering bundle construction, transport, worker isolation,
  logs, result application, cancellation, retention, and compromised-worker behavior.
- Update the architecture's open decision and host-adapter contract at proposal level;
  do not claim implementation.

**Exit:** explicit approval of ADR-013 and the MVP exclusion of sign-off/deploy.

### 21.1 — Deterministic bundle and result validator

**Scope:** pure local primitives; no networking and no adapter.

- Implement deterministic input manifest/bundle creation and fixed exclusions.
- Reuse secret scanning before bundle creation.
- Implement result-manifest validation, extraction into temp storage, path/size/digest
  enforcement, base-digest conflict detection, and serialized application.
- Add hostile archive fixtures: traversal, symlink escape, case collision, duplicate
  path, oversized expansion, unauthorized write, corrupt digest, secret input, and local
  edit after dispatch.

**Likely files:** `core/adapters/remote-bundle.js`, `core/guards/`, `core/paths.js`,
`tests/cloud-runner-bundle.test.js`.

**Exit:** all bundle behavior is testable offline and no test fixture can write outside
its temporary project.

### 21.2 — Protocol client and adapter

**Scope:** client-side remote execution against a fake HTTP service.

- Add config parsing and validation for `cloud_runner` without accepting inline tokens.
- Implement submit, idempotent retry, cursor logs, status polling, cancellation, result
  download, and error classification using Node's built-in HTTP facilities.
- Stream logs through the same bounded transcript behavior operators already use.
- Add the built-in adapter, doctor checks, consequence-stage refusal, and routing tests.
- Prove mixed local/remote Stage 04 fan-out and unchanged gate merging end to end.

**Likely files:** `core/config.js`, `hosts/cloud-runner/`, `core/cli/commands/doctor.js`,
`tests/cloud-runner-client.test.js`, `tests/orchestrator.test.js`,
`tests/adapter-contract.test.js`.

**Exit:** a fully offline fake server can exercise success, reconnect, duplicate submit,
timeout/cancel, late result, malformed result, conflict, and mixed-host fan-out.

### 21.3 — Reference worker and container

**Scope:** one self-hosted execution profile and local-container integration tests.

- Implement the versioned endpoints and job lifecycle.
- Add fresh-workspace execution, fixed server profiles, bounded logs/results, cleanup, and
  cancellation.
- Publish a container definition that runs without privileged mode and documents the
  required isolation supplied by the deployment platform.
- Use a stub host command in CI; real model credentials are never required by tests.

**Likely files:** `hosts/cloud-runner/worker/`, `tests/cloud-runner-worker.test.js`,
container and example deployment files under the host directory.

**Exit:** a local reference worker completes one workstream, returns authorized edits and
its gate, refuses hostile bundles/profile requests, and cleans up expired workspaces.

### 21.4 — Operator surface and hardening

**Scope:** documentation, observability, compatibility, and release readiness.

- Add setup, routing, troubleshooting, retention, and incident-response guidance.
- Extend `devteam run --watch` events with remote queue/running state using callback-only
  display samples; durable logs retain only bounded typed lifecycle events.
- Add OTel spans for submit, queue wait, execution, download, validation, and apply.
- Add protocol compatibility fixtures, native Windows client coverage, interruption
  tests, and a manual two-machine smoke script.
- Update `docs/FEATURES.md`, generated references, backlog status, architecture, adapter
  docs, security docs, and changelog fragment.

**Exit:** CI-equivalent tests, consistency, lint, container integration, and the manual
two-machine smoke all pass; docs state the single-worker and stage-07/08 limitations.

## 6. Acceptance criteria

1. A local Stage 04 can run one workstream remotely and others locally, then produce the
   same merged gate shape as an all-local run.
2. No remote service response can write outside the selected workstream's
   `allowedWrites` or expected gate path.
3. Input secrets, path escapes, corrupt manifests, oversized bundles, and local/result
   conflicts fail closed before project files are changed.
4. Duplicate submissions produce one logical remote job; duplicate results are applied
   at most once.
5. Logs stream without unbounded client memory growth and reconnect without duplication.
6. Timeout and interruption request cancellation, preserve current driver semantics, and
   never apply a late result.
7. The adapter cannot route stage-07 or stage-08 in the MVP.
8. Tokens and remote credentials never appear in config, logs, gates, errors, evidence
   bundles, or uploaded workspace contents.
9. The full offline suite requires neither network access nor model credentials.
10. A protocol-compatible third-party worker can be implemented from ADR-013 and the
    host-adapter documentation without reading the reference worker source.

## 7. Verification per implementation PR

```bash
CI=true DEVTEAM_HEADLESS_COMMAND=cat npm test
npm run consistency
npx eslint .
git diff --check
```

PR 21.3 additionally runs the reference-worker container integration test. PR 21.4 adds
a documented manual smoke between two machines or isolated local network namespaces;
that smoke is evidence for release, not a replacement for offline CI.

## 8. Deliberate limits and follow-ups

The MVP does not provide:

- a Stagecraft-hosted SaaS control plane, tenant management, or billing;
- a remote pipeline orchestrator or shared remote pipeline state;
- remote sign-off or deploy;
- client-uploaded cloud/model credentials;
- arbitrary setup commands, worker images, or git repository cloning;
- automatic dependency-cache transfer;
- durable/high-availability queueing or autoscaling;
- cross-job mutable workspaces;
- remote interactive/conversational sessions.

After real use, review queue duration, cancellation success, bundle sizes, conflicts,
failure classes, and operator interventions. Only that evidence should decide whether to
add durable queues, cache layers, provider deployment templates, remote consequence
stages, or a broader remote-orchestration design.
