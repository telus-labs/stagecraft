# Security Checklist

Load this skill during design review, implementation, and code review.
Every item is a potential BLOCKER if violated.

## Input & Validation

- [ ] All user-supplied input is validated (type, length, format)
- [ ] Validation errors return appropriate HTTP status codes (400, 422)
- [ ] File uploads validated for type and size before processing

## Authentication & Authorisation

- [ ] All endpoints that require auth have auth middleware applied
- [ ] Authorisation checks verify the user owns/can access the resource
- [ ] Tokens are not logged, stored in localStorage, or included in URLs

## Data

- [ ] No SQL string concatenation — parameterised queries only
- [ ] Sensitive fields (passwords, tokens) are never returned in API responses
- [ ] PII fields are identified in the data model

## Secrets

- [ ] No credentials, API keys, or tokens in source code
- [ ] Environment variables used for all secrets
- [ ] `.env` files are in `.gitignore`

## Dependencies

- [ ] No new dependencies added without a noted reason in the PR
- [ ] New dependencies checked for known CVEs

## Error Handling

- [ ] Error responses do not expose stack traces
- [ ] Error responses do not expose internal file paths or DB schema details

## Gotchas

- JWT tokens: verify signature AND expiry. Both. Always.
- CORS: do not set `Access-Control-Allow-Origin: *` in production.
- Rate limiting: auth endpoints must have it. Period.
