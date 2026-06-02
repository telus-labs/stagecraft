---
name: api-conventions
description: "Project-wide API design standards. Load this when designing or implementing REST endpoints, request/response shapes, status codes, versioning, or pagination. Defines conventions for resource naming, HTTP method usage, error response format, and header requirements."
---

# API Conventions

Load this skill when designing or implementing API endpoints. Each
rule has a concrete example so reviewers can recognise the shape.

## REST Conventions

- Resources are plural nouns. Actions live on HTTP methods, not in the path.

  ```
  GOOD:   GET    /users
          POST   /users
          GET    /users/42
          DELETE /users/42

  BAD:    GET    /getUser?id=42
          POST   /createUser
          GET    /user/delete?id=42       # never, ever
  ```

- HTTP methods map to actions. Pick one row and stick to it.

  | Method   | Semantics                              | Idempotent | Has body? |
  |----------|----------------------------------------|------------|-----------|
  | `GET`    | Read; no side effects                  | yes        | no        |
  | `POST`   | Create (or non-idempotent action)      | no         | yes       |
  | `PUT`    | Full replace                           | yes        | yes       |
  | `PATCH`  | Partial update                         | usually    | yes       |
  | `DELETE` | Remove                                 | yes (here) | no        |

- Nested resources express ownership. One level deep is plenty.

  ```
  GOOD: GET /users/42/orders
  BAD:  GET /users/42/orders/17/items/3/refunds   # design smell — flatten to /refunds/{id}
  ```

## Request / Response Shape

- All responses are JSON with `Content-Type: application/json; charset=utf-8`.
- Success responses include a `data` key:

  ```json
  { "data": { "id": "usr_42", "email": "a@b.com" } }
  ```

- Error responses use this exact shape (top-level `error` object):

  ```json
  { "error": { "code": "RESOURCE_NOT_FOUND", "message": "User 42 not found" } }
  ```

  Codes are `SCREAMING_SNAKE_CASE` strings (machine-readable). The
  `message` is human-readable but does not include stack traces, paths,
  or query fragments. See `security-checklist#error-handling`.

- Timestamps are ISO 8601 UTC with the `Z` suffix:

  ```
  GOOD: "2026-03-26T12:00:00Z"
  GOOD: "2026-03-26T12:00:00.123Z"
  BAD:  "2026-03-26 12:00:00"            # not ISO 8601
  BAD:  "2026-03-26T12:00:00+00:00"      # use Z for UTC, not +00:00
  BAD:  1711454400                        # Unix epoch — pick ISO and stick to it
  ```

- IDs are strings, not integers, in responses. Prefix with a resource
  type when the surface has many ID kinds:

  ```json
  { "data": { "id": "usr_42", "order_id": "ord_17" } }
  ```

  Rationale: callers serializing IDs through JavaScript can't safely
  carry integers beyond 2^53. Strings are unambiguous, future-proof,
  and let you switch to ULIDs/UUIDs later without a breaking change.

## HTTP Status Codes

| Code | When |
|---|---|
| `200` | OK — `GET`/`PATCH`/`PUT` success |
| `201` | Created — `POST` success that produced a new resource |
| `204` | No content — `DELETE` success (and our `DELETE`-on-missing — see §Gotchas) |
| `400` | Malformed request (bad JSON, missing required field) |
| `401` | Unauthenticated — no/expired credential |
| `403` | Unauthorised — authenticated but forbidden |
| `404` | Not found — applies to `GET`, `PATCH`, `PUT` on a missing resource. See §Gotchas for `DELETE`. |
| `409` | Conflict — duplicate, state violation, optimistic-lock failure |
| `422` | Unprocessable entity — well-formed but semantically invalid |
| `500` | Internal server error — never expose details (use `requestId`) |

```ts
// BAD: 200 with an `error` payload — clients have to inspect the body to know it failed.
app.post("/users", async (req, res) => {
  try { ... }
  catch (err) { res.status(200).send({ error: "..." }); }
});
// GOOD: HTTP status reflects the outcome; body is the detail.
app.post("/users", async (req, res) => {
  try { res.status(201).send({ data: user }); }
  catch (err) { res.status(422).send({ error: { code: "INVALID_EMAIL", message: "..." } }); }
});
```

## Pagination

- Cursor-based for lists. Page-based pagination is a refactor trap; don't add it.

  ```
  GOOD: GET /orders?cursor=eyJpZCI6IjEyMyJ9&limit=20
        → { "data": [...], "next_cursor": "eyJpZCI6IjE0MyJ9", "has_more": true }

  BAD:  GET /orders?page=3&per_page=20
        # broken when items shift between requests; cursors don't have that problem
  ```

- Defaults: `limit=20`, `max_limit=100`. Reject `limit > 100` with `400`.

## Versioning

- Version in URL path: `/api/v1/`. Header-based versioning is supported but URL is the default and the one we test.
- Breaking changes require a new version. Adding a new optional field is not breaking; removing or renaming a field, or tightening validation, is.

  ```
  GOOD: /api/v1/orders adds an optional `tip_amount` field — non-breaking.
  BAD:  /api/v1/orders renames `subtotal` → `subtotal_cents` — this is /api/v2/.
  ```

## Gotchas

- **Never return `null` where `[]` is more appropriate.** A missing list-of-things is empty, not absent.

  ```json
  // BAD: caller has to .map(orders ?? []).
  { "data": { "user_id": "usr_42", "orders": null } }
  // GOOD: caller can just .map.
  { "data": { "user_id": "usr_42", "orders": [] } }
  ```

- **`DELETE` is idempotent in this project.** A `DELETE` on a resource that does not exist returns `204 No Content`, the same response as deleting an extant resource.

  ```
  DELETE /users/42  → 204            (user existed and was removed)
  DELETE /users/42  → 204 (again)    (user did not exist; intent satisfied)
  ```

  Rationale: the client's intent (*ensure this resource is absent*) is satisfied either way, and idempotent DELETEs play nicely with at-least-once retry policies. This is a deliberate project choice — RFC 9110 allows but does not require it; some APIs (GitHub, Stripe) return `404` instead. **Reviewer guidance:** BLOCKER `404` from `DELETE` in code we own; do NOT block when calling third-party APIs that chose otherwise.

- **Don't leak existence via 404 vs 403.** When an authenticated user requests a resource they don't have access to, return `404` (not `403`). The latter confirms the resource exists; the former doesn't.

  ```ts
  // BAD: leaks that order 17 exists, just not for this user.
  if (order.userId !== req.user.id) return res.status(403).end();
  // GOOD: the 404 is identical to a never-existed order.
  const order = await db.orders.findOne({ id: req.params.id, userId: req.user.id });
  if (!order) return res.status(404).end();
  ```

- **`POST` is for "create one" — `PUT` to a known URL is also valid for create.** Use `PUT /resource/{id}` when the client picks the ID (e.g., idempotent provisioning with a pre-allocated UUID); use `POST /resource` when the server picks the ID.
