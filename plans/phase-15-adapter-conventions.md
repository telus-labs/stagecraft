# Phase 15 — Adapter-aware stage context

**Goal:** When `deploy.adapter` is set in `.devteam/config.yml`, stages 01–03
automatically receive platform constraints via `pipeline/context.md` so the
`--feature` string can be pure intent — no stack details, no `wrangler.toml`
instructions, no "Hono TypeScript".

**Background:** `core/deploy/gizmos.md` (Phase 13) has `## Platform constraints`
covering stack, structure, and runtime limits. These are only ever read by the
`dev-platform` role at stage-08. The requirements, design, and build agents have
no signal that the project targets Gizmos and must be told via `--feature`.

**Architecture note:** The orchestrator passes file *paths* in `readFirst` lists;
agents read those files from the project directory themselves. The existing
cross-stage mechanism is `pipeline/context.md` — it appears in every stage's
`readFirst` and accumulates append-only notes across the full run. The correct
injection point is a delimited section written into `pipeline/context.md` before
the first stage dispatches, using the same `upsertSection` pattern already
established by `writeRunBlockers` in `core/driver.js`.

**Key implementation facts (verified against main):**
- `upsertSection` is imported in `core/driver.js` from `./markers`
- `pipelineRoot(cwd, changeId)` is from `core/paths.js` (imported in driver.js as `{ pipelineRoot }`)
- `loadConfig()` in `core/config.js` currently exposes `routing`, `pipeline`, `autonomy`, `_raw` — NOT `deploy`; 15.2 must update `loadConfig` to also expose `config.deploy` (passthrough from `_raw`)
- In `core/driver.js`, `changeId` is resolved at line ~433; `seedDeployContext` must be called after that
- In `core/cli/commands/stage.js`, `cwd` is resolved at line ~93 via `_flags.cwd || process.cwd()`; the stage command always uses in-place mode (`changeId = null`)
- `core/driver.js` module.exports is at line ~1195: `{ run, CONSEQUENCE_CEILING, DEFAULT_MAX_ITERATIONS, totalCostUsd, runStatePath, runLogPath }`

**Pre-work complete (already merged to main):**
- `devteam init --adapter <name>` (PR #173): sets `deploy.adapter` in `.devteam/config.yml`
  at init time without hand-editing YAML. Makes the full UX story coherent — users now
  have a frictionless way to configure the deploy target that Phase 15 reads.
- `KNOWN_DEPLOY_ADAPTERS` exported from `core/config.js` (same PR).

**Order:** 15.1 → 15.2. 15.1 fixes a bug in the shipped adapter spec; 15.2 adds
the new capability.

---

## 15.1 — Fix `gizmos whoami` in `core/deploy/gizmos.md` ✅ PR #176

**Deliverables:** `core/deploy/gizmos.md` (two lines changed).

**Problem:** `gizmos whoami` is not a real CLI command (verified from source).
Authentication is via the `GIZMOS_API_KEY` environment variable — a missing or
empty value causes `gizmos push` to fail with a 401.

**Fix applied:** The `## Assumptions` line and Precondition step 1f both now
reference `GIZMOS_API_KEY` instead of `gizmos whoami` / `gizmos login`.

**Branch:** `fix/gizmos-auth-check` (PR #176)

---

## 15.2 — Adapter conventions files + context.md injection

**Deliverables:**
- `core/deploy/gizmos.conventions.md` (new)
- `core/deploy/cloud-run.conventions.md` (new)
- `core/deploy/README.md` (conventions file pattern documented)
- `core/config.js` (expose `config.deploy` from loadConfig)
- `core/driver.js` (`seedDeployContext` function + call in `run()`)
- `core/cli/commands/stage.js` (`seedDeployContext` called before stage-01/02/03 dispatch)
- `tests/deploy-conventions.test.js` (new, 6 tests)
- `changelog.d/feat-adapter-conventions.md`

**Branch:** `feat/adapter-conventions`

---

### `core/deploy/gizmos.conventions.md`

```markdown
# Deploy target: Gizmos

This project deploys to the Gizmos platform (`gizmos push`). Gizmos is a
multi-tenant platform on Cloudflare Workers — it is NOT standard `wrangler deploy`.
These constraints are binding on requirements, design, and build decisions.

## Language and runtime

TypeScript or JavaScript with Hono is the recommended stack.
Python with FastAPI (via Pyodide) is also supported. No other runtimes.

## Required project structure

    src/index.ts      — Hono app; must export a fetch handler
    wrangler.toml     — binding declarations; `name` must match deploy.gizmos.app
    package.json      — npm dependencies (resolved at bundle time)
    migrations/       — D1 SQL migrations, auto-applied on first request (if present)

Entry point must export a standard Cloudflare Worker fetch handler:

    export default { async fetch(request, env, ctx) { ... } }

## No build step

Do NOT add a compile or build step. Gizmos bundles TypeScript at runtime on
first request. Push source directly. The build stage writes source files —
it does not run tsc or any bundler.

## File tracking

`gizmos push` collects files via `git ls-files`. Every file the app needs must
be committed or staged (`git add`) before pushing. The build stage must ensure
all new files are tracked.

## State and persistence

No persistent filesystem. Declare bindings in `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "CACHE"                     # no ID needed — auto-namespaced per app

[[d1_databases]]
binding = "DB"
database_name = "my-db"
database_id = "auto-provisioned"      # Gizmos creates the Cloudflare D1 DB on
                                       # first request; this sentinel is required

[[r2_buckets]]
binding = "FILES"                     # auto-namespaced per app
```

## Secrets

App secrets (API keys, tokens) are set ONLY via the Gizmos Hub UI. They cannot
be set via `wrangler.toml`, environment variables at deploy time, or the gizmos
CLI. Non-secret config (feature flags, public URLs) can go in `[vars]` in
wrangler.toml.

## Health checks

The Gizmos platform requires `GET /` to return HTTP 200 with a non-empty body
(checked when app visibility changes). The Stagecraft smoke test additionally
probes `GET /healthz` — include this endpoint explicitly and return
`200 { "status": "ok" }`.

## Request model

- Stateless per request — no shared in-process state between requests
- CPU: ~30ms; wall-clock: 30s per request
- Use D1, KV, R2, or Durable Objects for any state that must survive across requests
```

---

### `core/deploy/cloud-run.conventions.md`

```markdown
# Deploy target: GCP Cloud Run

This project deploys to GCP Cloud Run via Artifact Registry. These constraints
are binding on requirements, design, and build decisions.

## Runtime

Any language supported by Docker. A `Dockerfile` at the project root is required
— the build stage must produce it.

## Required project structure

    Dockerfile        — at project root; required
    src/              — application source

The server must listen on the port given by the `PORT` environment variable;
Cloud Run sets this at runtime (default 8080).

## State and persistence

Cloud Run instances are stateless between requests. Use external GCP services:
- Cloud SQL or Spanner for relational data
- Cloud Storage for object storage
- Memorystore for caching

## Health check

Every app must expose `GET /healthz` returning HTTP 200. The deploy stage uses
this as the smoke test path after each revision deploy.
```

---

### `core/deploy/README.md` addition

After the "Built-in adapters" table, add a "Conventions files" section:

```markdown
## Conventions files

Each adapter may have a companion `core/deploy/<adapter>.conventions.md` file.
When `deploy.adapter` is set in `.devteam/config.yml`, devteam writes the
conventions as a delimited block into `pipeline/context.md` before stages 01–03
dispatch (via `devteam run` or `devteam stage`). This makes deployment target
constraints visible to requirements, design, and build agents without repeating
them in every `--feature` string.

The block is idempotent — writing it twice does not duplicate it. If the adapter
changes, `devteam restart stage-01 --cascade` clears pipeline state; the next
run seeds fresh conventions.

Keep conventions files focused on what design and build agents need: language,
runtime, required file structure, state options, and health check requirements.
Do not duplicate the deployment procedure from `<adapter>.md`.
```

---

### `core/config.js` change — expose `config.deploy`

In `loadConfig()`, after the `autonomy:` block is assembled, add `deploy` to the
result object (passthrough of `_raw.deploy`; null-safe):

```js
deploy: (parsed._raw && parsed._raw.deploy) ? parsed._raw.deploy : (parsed.deploy || null),
```

Wait — `parsed` is the result of `yaml.load(raw)`, not a config result object.
The correct addition is inside the `result = { ... }` block:

```js
deploy: (parsed.deploy && typeof parsed.deploy === "object") ? parsed.deploy : null,
```

Add it after the `autonomy:` key in the result object. No change needed for the
`DEFAULTS` branch (`_source: "defaults"`) — add `deploy: null` there too.

Also add `deploy: null` to the DEFAULTS constant so `loadConfig` always returns
a predictable shape.

Update `module.exports` — no change needed (loadConfig is already exported).

---

### `core/driver.js` — `seedDeployContext` function

Add immediately after the `writeRunBlockers` function (around line 240):

```js
const DEPLOY_CONTEXT_BEGIN = "<!-- devteam:deploy-target:begin -->";
const DEPLOY_CONTEXT_END   = "<!-- devteam:deploy-target:end -->";

/**
 * If deploy.adapter is configured and a conventions file exists, write a
 * deploy-target context block into pipeline/context.md before the first
 * stage dispatch. Uses upsertSection so it is idempotent — the block is
 * replaced on each call, never duplicated.
 *
 * Exported for use by the stage command and for unit testing.
 * opts.frameworkRoot overrides the resolved package root (for tests).
 */
function seedDeployContext(cwd, config, changeId, opts = {}) {
  const adapter = config.deploy && config.deploy.adapter;
  if (!adapter) return false;

  const frameworkRoot = opts.frameworkRoot || path.resolve(__dirname, "..");
  const conventionsPath = path.join(frameworkRoot, "core", "deploy", `${adapter}.conventions.md`);
  if (!fs.existsSync(conventionsPath)) return false;

  const conventions = fs.readFileSync(conventionsPath, "utf8");
  const contextPath = path.join(pipelineRoot(cwd, changeId), "context.md");

  const section = [
    DEPLOY_CONTEXT_BEGIN,
    "<!-- written by devteam before first stage dispatch; reflects deploy.adapter config -->",
    conventions.trim(),
    DEPLOY_CONTEXT_END,
  ].join("\n");

  let existing = "";
  try { existing = fs.readFileSync(contextPath, "utf8"); } catch { /* none yet */ }
  try {
    fs.mkdirSync(path.dirname(contextPath), { recursive: true });
    fs.writeFileSync(contextPath, upsertSection(existing, DEPLOY_CONTEXT_BEGIN, DEPLOY_CONTEXT_END, section));
    return true;
  } catch { return false; }
}
```

Add `seedDeployContext` to `module.exports`.

In the `run()` function, call it once immediately after `changeId` is resolved
(after the `const changeId = ...` assignment, around line 437):

```js
seedDeployContext(cwd, config, changeId);
```

---

### `core/cli/commands/stage.js` changes

At the top of `run()`, after `cwd` and config are loaded (after line 107,
before the stoplist check), add:

```js
const CONVENTION_STAGES = new Set(["requirements", "design", "build"]);
if (CONVENTION_STAGES.has(stageName)) {
  const { seedDeployContext } = require(path.join(__dirname, "..", "..", "driver"));
  seedDeployContext(cwd, loadConfig(cwd), null);
}
```

`null` as `changeId` is correct for the stage command's in-place mode;
`pipelineRoot(cwd, null)` resolves to `pipeline/` directly.

---

### `tests/deploy-conventions.test.js` — 6 tests

```js
"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { REPO_ROOT, cleanup } = require("./_helpers");
const { seedDeployContext } = require(path.join(REPO_ROOT, "core", "driver"));

let _dirs = [];
function track(d) { _dirs.push(d); return d; }
afterEach(() => { _dirs.forEach(cleanup); _dirs = []; });

function makeFrameworkRoot(adapterName, conventionsContent) {
  const fwRoot = track(fs.mkdtempSync(path.join(os.tmpdir(), "devteam-test-")));
  const deployDir = path.join(fwRoot, "core", "deploy");
  fs.mkdirSync(deployDir, { recursive: true });
  if (adapterName) {
    fs.writeFileSync(path.join(deployDir, `${adapterName}.conventions.md`), conventionsContent || `# ${adapterName} conventions\nTest content.`);
  }
  return fwRoot;
}

describe("seedDeployContext", () => {
  it("returns false when config.deploy is absent", () => {
    const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), "devteam-test-")));
    const result = seedDeployContext(cwd, { deploy: null }, null);
    assert.equal(result, false);
  });

  it("returns false when adapter is set but no conventions file exists", () => {
    const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), "devteam-test-")));
    const fwRoot = makeFrameworkRoot(null); // no conventions file
    const result = seedDeployContext(cwd, { deploy: { adapter: "gizmos" } }, null, { frameworkRoot: fwRoot });
    assert.equal(result, false);
  });

  it("returns true and writes delimited block to pipeline/context.md", () => {
    const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), "devteam-test-")));
    const fwRoot = makeFrameworkRoot("test-adapter", "# Test adapter\nSome constraints.");
    fs.mkdirSync(path.join(cwd, "pipeline"), { recursive: true });

    const result = seedDeployContext(cwd, { deploy: { adapter: "test-adapter" } }, null, { frameworkRoot: fwRoot });

    assert.equal(result, true);
    const ctx = fs.readFileSync(path.join(cwd, "pipeline", "context.md"), "utf8");
    assert.ok(ctx.includes("<!-- devteam:deploy-target:begin -->"));
    assert.ok(ctx.includes("<!-- devteam:deploy-target:end -->"));
    assert.ok(ctx.includes("# Test adapter"));
    assert.ok(ctx.includes("Some constraints."));
  });

  it("is idempotent — calling twice does not duplicate the block", () => {
    const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), "devteam-test-")));
    const fwRoot = makeFrameworkRoot("test-adapter");
    fs.mkdirSync(path.join(cwd, "pipeline"), { recursive: true });
    const config = { deploy: { adapter: "test-adapter" } };

    seedDeployContext(cwd, config, null, { frameworkRoot: fwRoot });
    seedDeployContext(cwd, config, null, { frameworkRoot: fwRoot });

    const ctx = fs.readFileSync(path.join(cwd, "pipeline", "context.md"), "utf8");
    const beginCount = (ctx.match(/<!-- devteam:deploy-target:begin -->/g) || []).length;
    assert.equal(beginCount, 1, "begin marker must appear exactly once");
  });

  it("updates block when conventions file changes between calls", () => {
    const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), "devteam-test-")));
    const fwRoot = makeFrameworkRoot("test-adapter", "# Version 1");
    fs.mkdirSync(path.join(cwd, "pipeline"), { recursive: true });
    const config = { deploy: { adapter: "test-adapter" } };

    seedDeployContext(cwd, config, null, { frameworkRoot: fwRoot });
    // Overwrite the conventions file
    fs.writeFileSync(path.join(fwRoot, "core", "deploy", "test-adapter.conventions.md"), "# Version 2");
    seedDeployContext(cwd, config, null, { frameworkRoot: fwRoot });

    const ctx = fs.readFileSync(path.join(cwd, "pipeline", "context.md"), "utf8");
    assert.ok(ctx.includes("# Version 2"), "updated content must appear");
    assert.ok(!ctx.includes("# Version 1"), "stale content must be replaced");
  });

  it("creates pipeline/ directory if it does not exist yet", () => {
    const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), "devteam-test-")));
    const fwRoot = makeFrameworkRoot("test-adapter");
    // Do NOT create pipeline/ — seedDeployContext must create it

    const result = seedDeployContext(cwd, { deploy: { adapter: "test-adapter" } }, null, { frameworkRoot: fwRoot });

    assert.equal(result, true);
    assert.ok(fs.existsSync(path.join(cwd, "pipeline", "context.md")));
  });
});
```

---

## What feature strings look like after this ships

**Before (current):**
```bash
devteam run \
  --feature "Build a Hono TypeScript Cloudflare Worker called 'short-url' for Gizmos
deployment. POST /shorten {url} returns short code. GET /:code redirects 302.
GET /stats/:code returns click count. Files: wrangler.toml (name=short-url,
kv_namespaces binding LINKS_KV), src/index.ts. GET /healthz returns 200." \
  --allow-stage sign-off,deploy --budget-usd 10
```

**After:**
```bash
devteam init --host claude-code --adapter gizmos
# edit deploy.gizmos.app in .devteam/config.yml

devteam run \
  --feature "URL shortener: POST /shorten {url, slug?} returns a short code,
GET /:code redirects 302, GET /stats/:code returns {slug, url, clicks, created_at}.
Use Workers KV for storage. App name: short-url." \
  --allow-stage sign-off,deploy --budget-usd 10
```

The stack (Hono, TypeScript), file structure (`wrangler.toml`, `src/`), binding
declaration syntax, no-build-step requirement, and `/healthz` endpoint are all
injected automatically from `gizmos.conventions.md` into `pipeline/context.md`
before the PM agent runs.

---

## Sequencing & exit criteria

Pre-work ✅ → 15.1 ✅ → 15.2.

**Phase exit:**
- `core/deploy/gizmos.md` does not reference `gizmos whoami`
- `core/deploy/gizmos.conventions.md` and `cloud-run.conventions.md` exist
- `devteam run` with `deploy.adapter: gizmos` writes a `<!-- devteam:deploy-target:begin -->`
  block into `pipeline/context.md` before the first stage dispatch
- `devteam stage requirements` with `deploy.adapter: gizmos` does the same
- Calling either command twice does not duplicate the block
- `npm test && npx eslint . && npm run consistency` all pass
