# Stage 4.5b — Security review (conditional)

Invoke: `security-engineer` agent **only when** the triggering heuristic
fires. The heuristic matches any of:

- Paths: `src/backend/auth*`, `src/backend/crypto*`, `src/backend/payment*`,
  `src/backend/pii*`, `src/backend/session*`, or any file named with
  `*secret*` / `*token*` / `*credential*`
- New or upgraded dependencies in `package.json`, `requirements.txt`,
  `pyproject.toml`, `Gemfile`, `go.mod`, `composer.json`, `Pipfile`
- Changes to `Dockerfile` or `docker-compose*.yml` that add/modify a
  **service image, network, or volume** (environment-value-only changes
  that qualify for `/config-only` do not trigger)
- Files under `src/infra/` that affect **network topology, IAM/RBAC,
  TLS/certificates, secrets management, or CI/CD secret handling** — e.g.
  `**/iam*`, `**/rbac*`, `**/network*`, `**/firewall*`, `**/certs*`,
  `**/secrets*`, or any CI workflow file referencing `${{ secrets.* }}`
  (config-only infra edits such as port numbers or healthcheck intervals
  do **not** trigger)
- New or changed database migrations
- New environment variables or secret references in `.env.example`

If the heuristic does not fire, the security gate is skipped and the
orchestrator records the skip decision in `pipeline/context.md` under
`## Brief Changes` as `SECURITY-SKIP: <reason>`.

Output: `pipeline/gates/stage-04b.json`.
Gate key: `"status": "PASS"` with `"security_approved": true` and
`"veto": false`.

A `veto: true` gate halts the pipeline. No peer-review approval can
override a veto — the security-engineer must personally re-review the
fix and flip the flag. Rationale: the Stage 5 reviewers are area
specialists, not threat modellers; their "approved" on a
security-relevant diff doesn't speak to the threat model.

Security findings that are real but don't warrant a veto go in
`noted_for_followup[]` as structured objects (not prose) so `devteam advise`
can surface them for the stage manager:

```json
{
  "id": "SEC-02",
  "text": "Add Content-Security-Policy header to prevent XSS on the UI server.",
  "track_for": "ticket",
  "severity": "medium",
  "assigned_to": "platform"
}
```

Both 4.5a and 4.5b must pass (when applicable) before Stage 5 begins.
`/hotfix` skips 4.5a when the explicit blast-radius constraint in
`pipeline/hotfix-spec.md` already bounds the scope tightly; it does NOT
skip 4.5b when the heuristic fires (hotfixes *often* touch security
surfaces, and that's exactly when review is most needed).

