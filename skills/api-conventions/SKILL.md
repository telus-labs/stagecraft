---
name: api-conventions
description: "Project-wide API design standards. Load this when designing or implementing REST endpoints, request/response shapes, status codes, versioning, or pagination. Defines conventions for resource naming, HTTP method usage, error response format, and header requirements."
---

# API Conventions

Load this skill when designing or implementing API endpoints.

## REST Conventions

- Resources are plural nouns: `/users`, `/orders`, not `/getUser`
- HTTP methods map to actions:
  - `GET` — read (idempotent, no side effects)
  - `POST` — create
  - `PUT` — full replace
  - `PATCH` — partial update
  - `DELETE` — remove
- Nested resources for ownership: `GET /users/{id}/orders`

## Request / Response Shape

- All responses are JSON with `Content-Type: application/json`
- Success responses include a `data` key
- Error responses use this shape:
  ```json
  { "error": { "code": "RESOURCE_NOT_FOUND", "message": "User 42 not found" } }
  ```
- Timestamps are ISO 8601 UTC: `"2026-03-26T12:00:00Z"`
- IDs are strings (not integers) in responses

## HTTP Status Codes

- `200` — OK (GET, PATCH, PUT success)
- `201` — Created (POST success)
- `204` — No content (DELETE success)
- `400` — Bad request (validation failure)
- `401` — Unauthenticated
- `403` — Unauthorised (authenticated but forbidden)
- `404` — Not found (returned by `GET`, `PATCH`, `PUT` when the addressed resource does not exist; see §Gotchas for the `DELETE` exception)
- `409` — Conflict (duplicate, state violation)
- `422` — Unprocessable entity (semantically invalid)
- `500` — Internal server error (never expose details)

## Pagination

- Use cursor-based pagination for lists: `?cursor=xxx&limit=20`
- Response includes `next_cursor` and `has_more`
- Default limit: 20. Max limit: 100.

## Versioning

- Version in URL path: `/api/v1/`
- Breaking changes require a new version

## Gotchas

- Never return `null` where an empty array `[]` is more appropriate.
- **DELETE is idempotent in this project.** A `DELETE` on a resource that does not exist returns `204 No Content`, the same response as deleting an extant resource. Rationale: the client's intent ("ensure this resource is absent") is satisfied either way, and idempotent DELETEs play nicely with at-least-once retry policies. Note that this is a deliberate project choice — RFC 9110 allows but does not require it, and some APIs (GitHub, Stripe) return `404` instead. Reviewers should not BLOCKER `404` from `DELETE` in third-party code we depend on; they *should* BLOCKER it in code we own.
