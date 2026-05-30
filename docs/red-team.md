# Red-team stage

Stage 4c. Runs between build and peer-review on the `full` and `hotfix` tracks. Always-on (not conditional). The red-team role is explicitly routed to a different host than the build agents.

---

## What it does

The red-team role conducts adversarial review of the build. Its job is not general code review (that's stage-05 peer-review) — it's to find the strongest security and reliability objections to the change before review.

### Attack surfaces (10)

The verifier walks each surface systematically and produces concrete reproducers, not abstract observations:

1. **Input boundaries** — values at and beyond valid bounds, malformed input, oversized payloads
2. **State** — invalid state transitions, race conditions, stale state bugs
3. **Sequence** — operations in wrong order, missing prerequisites, partial completion
4. **Integrations** — downstream failures, unexpected response shapes, timeout behaviour
5. **Auth edges** — missing authorization checks, privilege escalation, IDOR patterns
6. **Resource exhaustion** — unbounded loops, memory leaks, connection pool exhaustion
7. **Failure modes mid-operation** — what happens when the third step of five fails
8. **Abuse cases** — legitimate-looking inputs that produce unintended effects
9. **Downstream effects** — side effects on other systems, audit log gaps, notification storms
10. **Observability gaps** — errors swallowed silently, metrics not emitted, tracing not propagated

Each finding is triaged by severity × likelihood × scope.

---

## Gate fields

| Field | Type | Notes |
|---|---|---|
| `surfaces_walked` | string[] | Which of the 10 surfaces were assessed |
| `findings_count` | number | Total findings across all surfaces |
| `severity_breakdown` | object | `critical`, `high`, `medium`, `low` counts |
| `must_address_before_peer_review` | string[] | Blocking findings; non-empty → FAIL |
| `noted_for_followup` | string[] | Non-blocking findings to track |

**FAIL condition:** `must_address_before_peer_review` is non-empty. The implementer addresses each item, re-runs build, red-team re-runs, eventually PASS.

---

## Why it's separate from security-review (stage 4b)

| | Stage 4b — security review | Stage 4c — red team |
|---|---|---|
| Trigger | Conditional — fires when pre-review (4a) flags `security_review_required: true` | Always-on for `full` and `hotfix` tracks |
| Remit | Narrow — security-specific review of flagged paths | Broad — all 10 attack surfaces |
| Power | Has veto (`veto: true` halts pipeline) | Blocking findings must be addressed before peer-review, but no veto |
| Role | Security | Red-team |

---

## Routing

Route red-team to a **different host than your build agents**. The value of adversarial review comes from different training data and different blind spots — the same model that built the code will rationalize the same mistakes.

```yaml
# .devteam/config.yml
routing:
  default_host: claude-code
  roles:
    red-team: gemini-cli   # or codex — different family than the builder
```

---

## References

- Role brief: `roles/red-team.md`
- Related: [docs/FEATURES.md](FEATURES.md) § Advanced AI capabilities
- Related: [docs/user-guide.md](user-guide.md) § Per-stage details — Stage 4c
