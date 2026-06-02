---
name: security-checklist
description: "Security review checklist. Load this during design review, implementation, and code review. Every item is a potential BLOCKER if violated. Covers input validation, authentication/authorisation, data handling, secrets management, dependency hygiene, and logging. Use alongside the security role brief at Stage 4b."
---

# Security Checklist

Load this skill during design review, implementation, and code review.
Every item is a potential BLOCKER if violated. Each item is paired with
a concrete failure example so reviewers can recognise the shape.

## Input & Validation

- [ ] All user-supplied input is validated (type, length, format) **at the boundary**, not deep in business logic.

  ```ts
  // BAD: input flows untyped into business code; validation buried far from entry.
  app.post("/orders", async (req, res) => {
    const order = await createOrder(req.body); // req.body is `any`
  });
  // GOOD: schema validates at the handler; business code receives a typed value.
  const OrderInput = z.object({ items: z.array(ItemInput).min(1).max(50) });
  app.post("/orders", validateBody(OrderInput), async (req, res) => {
    const order = await createOrder(req.body); // typed and bounded
  });
  ```

- [ ] Validation errors return `400` (malformed) or `422` (well-formed but semantically invalid). Never `500`.
- [ ] File uploads validated for type AND size BEFORE processing.

  ```ts
  // BAD: read into memory first, then check size. OOM on a multi-GB upload.
  const data = await req.file.buffer();
  if (data.length > 10_000_000) throw new TooLarge();
  // GOOD: streaming with limits, enforced at the parser layer.
  const upload = multer({ limits: { fileSize: 10_000_000 }, fileFilter: typeAllowlist });
  ```

## Authentication & Authorisation

- [ ] All endpoints that require auth have auth middleware applied — **and** the same middleware applied to every route in the group (no per-route opt-in that's easy to forget).

  ```ts
  // BAD: each route opts in individually; easy to forget on the 17th route.
  app.get("/account", requireAuth, ...);
  app.get("/account/orders", requireAuth, ...);
  app.get("/account/preferences", ...); // ← oops, public
  // GOOD: router-level middleware; opt-out is loud, opt-in is the default.
  const account = express.Router();
  account.use(requireAuth);
  account.get("/", ...);
  account.get("/orders", ...);
  account.get("/preferences", ...);
  ```

- [ ] Authorisation checks verify the user **owns** or **can access** the specific resource, not just "is logged in."

  ```ts
  // BAD: any logged-in user can read any order.
  app.get("/orders/:id", requireAuth, async (req, res) => {
    res.send(await db.orders.find(req.params.id));
  });
  // GOOD: the query is scoped to the user.
  app.get("/orders/:id", requireAuth, async (req, res) => {
    const order = await db.orders.findOne({ id: req.params.id, userId: req.user.id });
    if (!order) return res.status(404).end(); // 404 not 403 — don't leak existence
  });
  ```

- [ ] Tokens are not logged, not stored in `localStorage`, not included in URLs (URLs end up in browser history, server logs, and Referer headers).

## Data

- [ ] No SQL string concatenation — parameterised queries only. See `code-conventions#parameterised-sql`.
- [ ] Sensitive fields (passwords, tokens, refresh tokens, password hashes, internal IDs you didn't mean to expose) are **never** returned in API responses.

  ```ts
  // BAD: returning the full user row leaks the hash.
  app.get("/me", requireAuth, async (req, res) => {
    res.send(await db.users.find(req.user.id));
  });
  // GOOD: explicit shape, no hash, no salt.
  app.get("/me", requireAuth, async (req, res) => {
    const u = await db.users.find(req.user.id);
    res.send({ id: u.id, email: u.email, name: u.name, createdAt: u.created_at });
  });
  ```

- [ ] PII fields are identified in the data model (`@pii` annotation, schema comment, or equivalent). Logging then knows to redact them.

## Secrets

- [ ] No credentials, API keys, or tokens in source code. The `secret-scan` PreToolUse hook (claude-code) blocks this at write time; on other hosts it's caught at Stage 4b. Don't rely on the hook for non-Claude work.

  ```ts
  // BAD: hard-coded.
  const stripe = new Stripe("sk_live_51HxxxxxxxxxxxxxxxxAB");
  // GOOD:
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? throwMissingEnv("STRIPE_SECRET_KEY"));
  ```

- [ ] Environment variables used for all secrets; `.env` is in `.gitignore`; `.env.example` documents the keys without values.

## Dependencies

- [ ] No new dependencies added without a noted reason in the PR (`pipeline/pr-*.md`).
- [ ] New dependencies checked for known CVEs via Stage 4a SCA scan.
- [ ] Pinned versions in `package.json` — `^` is OK for libraries, exact pin for security-critical (`bcrypt`, `jsonwebtoken`, `helmet`).

## Error Handling

- [ ] Error responses do not expose stack traces or internal paths. See `code-conventions#no-stack-leak`.

  ```ts
  // BAD: every detail of your project layout is now public.
  res.status(500).send({ error: err.stack });
  // GOOD: opaque to the user, full detail server-side.
  log.error({ err, requestId: req.id }, "unhandled error");
  res.status(500).send({ error: { code: "INTERNAL", requestId: req.id } });
  ```

## Gotchas

- **JWT verification**: verify signature **AND** expiry **AND** issuer. The first one is the one people remember; the other two get missed.

  ```ts
  // BAD: decoded, not verified — a forged token with the right shape passes.
  const claims = jwt.decode(token);
  // GOOD: signature + expiry + issuer.
  const claims = jwt.verify(token, PUBLIC_KEY, { algorithms: ["RS256"], issuer: "stagecraft" });
  ```

- **CORS**: do not set `Access-Control-Allow-Origin: *` in production with credentials. Either pin the origin or don't allow credentials.
- **Rate limiting**: auth endpoints (login, password reset, signup) MUST have it. Per-IP at the load balancer is the minimum; per-account is better.
- **Timing attacks on auth**: compare hashes with a constant-time function (`crypto.timingSafeEqual`), not `===`.

  ```ts
  // BAD: leaks how many characters matched.
  if (hash === expected) return ok();
  // GOOD:
  if (crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expected))) return ok();
  ```

- **Open redirects**: `?next=...` parameters must be validated against an allowlist. A redirect to `https://attacker.com` after login is a classic phishing assist.
