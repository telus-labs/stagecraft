---
name: red-team
description: "Run an adversarial review on what was just built. Use this skill when the user says 'red team this', 'find what could break', '/red-team', or when the orchestrator invokes the red-team role for stage-04c. The skill walks 10 attack surfaces, produces concrete reproducers (not vibes), triages findings by severity × likelihood × scope, and writes pipeline/red-team-report.md + pipeline/gates/stage-04c.json. Output is read by the implementer to address must-fix items before Stage 5 peer review begins."
---

# Red Team a Change

A structured adversarial review that runs between build (Stage 4) and peer review (Stage 5). The reviewer in Stage 5 looks for what the code is doing wrong; the red team looks for what an adversary, a hostile user, a corner-case input, or a hostile environment can do to make the code fail.

## When to use this

- Orchestrator invokes the `red-team` role for **stage-04c** (this is the normal path).
- User explicitly asks for an adversarial review of a change ("red team this", "find what could break").

When **not** to use this:
- Security-specific concerns (auth, crypto, PII, secrets) — that's the `security-engineer` role at stage-04b.
- Code style, conventions, correctness review — that's the `reviewer` role at stage-05.
- Test coverage gaps — that's QA at stage-06.

## Phase 1 — Load context

Read in this order:
1. `pipeline/brief.md` — what was promised.
2. `pipeline/design-spec.md` — how it was designed (including §Open Technical Questions and §Risk notes — those are red-team gold).
3. `pipeline/pr-backend.md`, `pipeline/pr-frontend.md`, `pipeline/pr-platform.md`, `pipeline/pr-qa.md` — what was actually built.
4. `pipeline/pre-review.md` (Stage 4a) — what's already been caught by lint / typecheck / dep audit.
5. `pipeline/security-review.md` (Stage 4b, if present) — what security has already flagged. **Do not re-find what they found.**
6. `src/**` — the code itself. Read the changed paths fully.

The point is to come in with full context. A red-team finding that the brief explicitly declared out-of-scope is wasted; flag it under `noted_for_followup`, not `must-fix`.

## Phase 2 — Walk the attack surfaces

For each surface below, generate 2–5 concrete scenarios. Skip surfaces that don't apply (e.g. no input boundary for a pure config change). For each scenario produce: **the exact input/state/sequence that reproduces it** + **the resulting failure**.

### 2.1 — Input boundaries

For every external input (HTTP body, query param, file upload, env var, stdin, message-queue payload):
- Empty / null / missing / type-wrong / length-overflow
- Unicode edge cases: surrogate pairs, RTL marks, NULL bytes, BOM, normalization forms
- Injection vectors: SQL fragments, shell metacharacters, path traversal (`../`), template engine syntax, XSS, SSRF urls
- Numeric edges: 0, -1, MAX_INT, MIN_INT, Infinity, NaN, floating-point precision drift
- Date edges: epoch, far-future, DST boundaries, leap seconds, locale-specific format ambiguity

### 2.2 — State boundaries

- Concurrency: 1 / 100 / 10k callers. What state shared between them?
- Time: zero rows, max rows, mid-migration database, time-warped clock
- Cache: cold / warm / stale / poisoned
- Memory: small / large / fragmented heap

### 2.3 — Sequence boundaries

- A called twice in a row (idempotency)
- A and B in parallel (race condition)
- A called, connection drops, A retried (replay safety)
- B called before A (ordering assumption)
- A called after B failed (cleanup after partial failure)

### 2.4 — Integration boundaries

For every external dependency the code talks to:
- Slow / timeout / hang
- 500 / 503 / 429 / network-reset
- 200 with malformed body / wrong content-type / wrong schema
- Returns success for an invalid request (silent fail in the dep)
- Goes away entirely (DNS fails, IP routes to nothing)

### 2.5 — Auth / authz edge cases

NOT the standard "auth missing" case (that's stage-04b). The weirder ones:
- Expired-but-not-revoked tokens, lingering grace periods
- Role escalation through indirection (lookup chains, group membership)
- IDOR via predictable IDs (sequential integers, UUIDs derived from username)
- Cross-tenant leakage through a shared cache, log line, error message

### 2.6 — Resource exhaustion

- Quadratic / cubic algorithms on user-controlled input size
- Unbounded queues, lists, in-memory caches
- Leaked DB connections / file handles / sockets on the error path
- Memory growth across long-running connections

### 2.7 — Failure modes mid-operation

What gets written to disk / sent over the wire / left in cache when an error fires mid-operation?
- Half-committed transactions
- Orphaned files, dangling DB rows
- Stale cache entries that outlive the writer
- Retry loops with no backoff / no cap

### 2.8 — Abuse cases

Features used hostilely — not bugs, but allowed-by-design behaviors weaponized:
- A user who legitimately uses the API 10,000×/sec
- A user who creates 100k records to slow shared queries
- A user who triggers an email-sending path repeatedly
- A user who chains features to amplify cost (cron + heavy query + email)

### 2.9 — Downstream effects

This change might be locally correct but break elsewhere:
- API surface deprecated / signature changed → downstream services break
- Database default changed → existing rows behave differently
- Permission narrowed → automated process loses access
- Log format changed → log-parsing alerts go silent

### 2.10 — Observability gaps

If this code starts misbehaving in production, what's the signal?
- Metrics on the error path?
- Logs on the abuse cases?
- Traces on the slow paths?
- If you can't tell from outside the system that something is wrong, that's a finding.

(Cross-references stage-06c observability-gate: red-team finds the gap, observability-gate enforces brief §9.)

## Phase 3 — Triage

For each scenario you found, rate:

| Field | Values |
|---|---|
| **Severity** | `critical` (data loss, privilege escalation, full outage) / `high` (partial outage, shipped-behavior regression) / `medium` (degraded behavior, recoverable) / `low` (cosmetic, deep edge) |
| **Likelihood** | `expected` (will happen) / `plausible` (might happen) / `theoretical` (possible, not seen) |
| **Effort to fix** | `XS` (one line) / `S` (one file) / `M` (a few files) / `L` (a stage) / `XL` (epic) |
| **Scope** | `must-fix` / `should-fix` / `out-of-scope-but-track` |

**Promotion rule for `must-fix`:** severity ≥ `high` AND likelihood ≥ `plausible`. Lower-severity findings go into `should-fix` (warnings) or `out-of-scope-but-track` (noted, not blocking).

Don't promote on speculation. A `theoretical` `critical` finding is a `should-fix` unless you can demonstrate a concrete reproducer. The audit-skill discipline ("verify before promoting") applies here too.

## Phase 4 — Write the report

Use `templates/red-team-report-template.md`. Structure:

1. **Summary** — 1 paragraph: what you looked at, what you found in headline form.
2. **Surfaces walked** — table of which surfaces you considered.
3. **Findings** — one entry per scenario, grouped by surface. Each entry has: Severity, Likelihood, Effort, Scope, **the reproducer**, the fix suggestion.
4. **Out-of-scope but tracked** — findings that aren't in-scope for this PR but are worth recording.
5. **Surfaces with no findings** — explicit list of "I looked here and didn't find anything" surfaces. This is auditable; it lets the next red-team know what's been checked.

## Phase 5 — Write the gate

`pipeline/gates/stage-04c.json`. Fields per stage-04c schema:

```json
{
  "stage": "stage-04c",
  "workstream": "red-team",
  "status": "PASS|WARN|FAIL",
  "orchestrator": "<filled by orchestrator>",
  "host": "<filled by orchestrator>",
  "track": "<full|hotfix>",
  "timestamp": "<ISO-8601>",
  "blockers": [],
  "warnings": [],
  "surfaces_walked": ["input_boundaries", "state_boundaries", "..."],
  "findings_count": 0,
  "severity_breakdown": { "critical": 0, "high": 0, "medium": 0, "low": 0 },
  "must_address_before_peer_review": [],
  "noted_for_followup": []
}
```

- **PASS** — `must_address_before_peer_review` is empty.
- **WARN** — empty `must_address_before_peer_review`, non-empty `noted_for_followup` OR `warnings`.
- **FAIL** — non-empty `must_address_before_peer_review`. Each item also goes into `blockers` with file:line + scenario summary.

The implementer addresses `must-fix` items by re-running stage-04 (build), which overwrites the workstream gates. Then red-team re-runs, finds fewer items, gate flips to PASS.

## A note on diversity

Red-team is most valuable when the **model running the red team is different from the model that built the change**. If backend was built by Codex, run red-team on Claude or Gemini. If the entire build ran on Claude Code, run red-team on Codex. The "diversity beats monoculture" bet in `docs/BACKLOG.md` is what makes the adversarial review actually catch what the build missed.

In `.devteam/config.yml`:
```yaml
routing:
  default_host: claude-code
  roles:
    backend: claude-code
    red-team: codex      # explicitly different from backend
```

When `review_fanout` lands (BACKLOG D3-adjacent), red-team is a natural fanout candidate — run the adversarial review across all three hosts in parallel for high-stakes changes.

## What this skill is NOT

- Not a substitute for security review (stage-04b). Their remit is narrower (auth/crypto/PII) but has veto power.
- Not a code review (stage-05). Stage 5 looks at the code; stage-04c looks at the behavior under hostile conditions.
- Not a test plan. QA at stage-06 writes and runs tests. Red-team finds what tests are missing.
- Not a place to second-guess the brief. Out-of-scope-by-design isn't a red-team finding; it's an existing decision.

## Where the report goes

`pipeline/red-team-report.md`. Lives next to the other stage-04-range artifacts (`pipeline/build-plan.md`, `pipeline/pre-review.md`, `pipeline/security-review.md`). Read by the implementer to address `must-fix` items, by Stage 5 reviewers as context, and by Stage 9 retrospective synthesis to surface recurring patterns ("we keep missing this surface — promote a lesson").
