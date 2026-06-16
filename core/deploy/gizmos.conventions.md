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
