---
name: code-conventions
description: "Project-wide coding standards for naming, formatting, error handling, security, and testing. Load this when writing or reviewing code. Covers all layers (files, functions, classes, constants, database columns) and languages in use. Do not duplicate these rules in agent prompts — load this skill instead."
---

# Code Conventions

This skill contains project-wide coding standards. Agents load this when
writing or reviewing code. Do not duplicate these rules in agent prompts.

Each rule is paired with a concrete example. Reviewers cite the rule
name (e.g. "BLOCKER: code-conventions #magic-number") so the author
can find the rule and the example without context-switching.

## General

- **#explicit-over-clever** — Code is read more than it is written.
  ```ts
  // BAD: clever — what does the !! do? what's the precedence?
  const isReady = !!user && !!user.config && !!user.config.ready;
  // GOOD: explicit — reads top-to-bottom.
  const isReady = user != null && user.config != null && user.config.ready === true;
  ```

- **#docstring** — Every exported function has a docstring/JSDoc.
- **#magic-number** — Use a named constant when a literal would otherwise be unexplained.
  ```ts
  // BAD: what is 86400000?
  setTimeout(reload, 86400000);
  // GOOD:
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  setTimeout(reload, MS_PER_DAY);
  ```
- **#no-commented-code** — No commented-out code in commits.
  Use git history if you need to remember what was there.

## Naming

| Layer | Convention | Example |
|---|---|---|
| Files | `kebab-case` (all languages) | `user-store.ts`, `user_store.py`, `UserStore.kt` is wrong |
| Classes / Types | `PascalCase` | `UserStore`, `OrderId` |
| Functions / variables | `camelCase` | `getUser`, `orderCount` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_RETRIES`, `JWT_SECRET` |
| Database columns | `snake_case` | `user_id`, `created_at` |

## Error Handling

- **#no-silent-swallow** — Never swallow an error without a comment explaining why.
  ```ts
  // BAD: error vanishes — why?
  try { await unlink(tmp); } catch {}
  // GOOD: intent stated; reviewer can verify it.
  try { await unlink(tmp); } catch { /* tmp already gone — best-effort cleanup */ }
  ```

- **#typed-errors** — Don't throw bare strings; throw `Error` (or a subclass).
  ```ts
  // BAD: caller can't .message or .stack on a string.
  if (!user) throw "user not found";
  // GOOD:
  if (!user) throw new NotFoundError(`user ${id} not found`);
  ```

- **#no-stack-leak** — User-facing errors must not expose stack traces or internal paths.
  ```ts
  // BAD: leaks /opt/app/src/auth/jwt.ts in the response.
  res.status(500).send(err.stack);
  // GOOD: log the stack server-side; return an opaque id to the user.
  log.error({ err, requestId: req.id }, "request failed");
  res.status(500).send({ error: { code: "INTERNAL", requestId: req.id } });
  ```

## Security (non-negotiable)

- **#no-hardcoded-secrets** — No secrets, tokens, or credentials in source.
  Use environment variables or a secrets manager. Stage 4a's secret-scan hook
  enforces this at write time; this rule is so reviewers also catch it in PRs
  where the hook didn't fire (e.g. config moved into a new file type).

- **#input-validation** — Validate user input at the system boundary, not in business logic.
  ```ts
  // BAD: business logic guards against shapes it shouldn't have to.
  function createOrder(body: any) {
    if (typeof body?.items !== "object" || !Array.isArray(body.items)) return 400;
    // ...
  }
  // GOOD: schema validates at the handler boundary; business code trusts the shape.
  const OrderInput = z.object({ items: z.array(ItemInput).min(1) });
  app.post("/orders", validateBody(OrderInput), async (req, res) => {
    const order = await createOrder(req.body); // typed and trusted
    res.status(201).send(order);
  });
  ```

- **#parameterised-sql** — SQL queries use parameter placeholders. No concatenation.
  ```ts
  // BAD: classic SQLi.
  const sql = `SELECT * FROM users WHERE id = ${userId}`;
  // GOOD: driver substitutes safely.
  const result = await db.query("SELECT * FROM users WHERE id = $1", [userId]);
  ```

## Testing

- **#test-with-behaviour** — New behaviour requires new tests. PRs that add
  behaviour without tests are BLOCKERs at peer review.
- **#test-file-colocation** — `foo.ts` → `foo.test.ts`, in the same directory.
- **#descriptive-test-names** — Names describe behaviour, not test number.
  ```ts
  // BAD:
  it("test1", () => { ... });
  // GOOD:
  it("returns 404 when user not found", () => { ... });
  ```

## Git

- Branch names: `feature/short-description` or `fix/short-description`
- Commit messages: imperative mood, ≤72-char subject. Example: `Add rate limiting to auth endpoint`
- One logical change per commit.

## Gotchas (add failures here over time)

- **#no-any** — Do not use `any` in TypeScript. Reviewers BLOCKER this.
  ```ts
  // BAD: defeats the type checker.
  function parse(input: any): any { return JSON.parse(input); }
  // GOOD: explicit unknown forces the caller to narrow.
  function parse(input: string): unknown { return JSON.parse(input); }
  // BEST: a typed parser when the shape is known.
  function parse<T>(input: string, schema: z.ZodType<T>): T { return schema.parse(JSON.parse(input)); }
  ```

- **#no-select-star** — `SELECT *` makes refactors silent and adds unindexed I/O.
  ```sql
  -- BAD: now adding a column secretly breaks the consumer.
  SELECT * FROM users WHERE id = $1;
  -- GOOD:
  SELECT id, email, created_at FROM users WHERE id = $1;
  ```

- **#no-direct-main** — All changes go through PRs. No `git push origin main`.
