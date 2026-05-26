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
- `404` — Not found
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
- `DELETE` should be idempotent — deleting a non-existent resource returns 204, not 404.
