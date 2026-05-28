# 06 — Security review

## Summary

Security posture is good. `npm audit` reports **0 vulnerabilities** (resolved during the v0.2.0+ audit pass that dropped `@opentelemetry/sdk-node` to eliminate the Prometheus-exporter advisory). No shell injection patterns. No untrusted network input. The UI has a bind guard. Secrets are user-supplied via host CLIs, not stored in the framework.

The notable issues are second-order: subprocess invocation patterns that are safe today but could become unsafe if extended carelessly, and a dependency surface (Hugging Face Transformers) that downloads a model from a remote URL the first time memory is used.

## Rating scales

- **Severity:** critical / high / medium / low
- **Confidence:** HIGH / MEDIUM / LOW

## Findings

### Secrets hygiene

#### Finding S1: no hardcoded credentials in source

- **Where:** verified via grep across `core/`, `bin/`, `hosts/`, `scripts/` — no patterns matching AWS keys, GitHub PATs, Anthropic keys, OpenAI keys, Slack tokens, Stripe keys, private-key headers, or postgres URLs with embedded passwords.
- **Severity:** n/a (positive finding).
- **Confidence:** HIGH.
- **Notes:** Stagecraft itself uses no credentials. Host CLIs (`claude`, `codex`, `gemini`, `gh`) handle their own auth. The secret-scanning hook (`core/hooks/secret-scan.js`) protects *target projects* — Stagecraft itself doesn't need to be scanned because there's no surface to leak from.

#### Finding S2: `.gitignore` coverage spot-check

- **Where:** `.gitignore` at repo root.
- **Issue:** doesn't include `.devteam/memory/` (the memory store contains plaintext copies of indexed artifacts — briefs, design specs, etc.).
- **Mitigation in place:** `docs/memory.md` documents this and advises users to add `.devteam/memory/` to their *target project's* `.gitignore`. Stagecraft itself has no `.devteam/` to ignore (the framework isn't a target). So this isn't a real issue *here*.
- **Severity:** low / non-issue for this repo. Documented for target projects.
- **Confidence:** HIGH.

### Input handling

#### Finding S3: subprocess spawns use array args (no shell)

- **Where:** 11 `spawn` / `spawnSync` call sites across `core/adapters/headless.js`, `bin/devteam`, `scripts/release.js`, `scripts/budget.js`, `scripts/pr-publish.js`, `scripts/consistency.js`, `tests/_helpers.js`.
- **Pattern:** every call uses `spawn(cmd, [...args], opts)` form. Zero `shell: true` flags. Zero string-form `exec(cmd)`. Zero string concatenation into command lines.
- **Risk:** none under current code.
- **Caveat:** **`core/adapters/headless.js`** splits the configured `headlessCommand` on whitespace and passes the tail as args. If a user sets `DEVTEAM_HEADLESS_COMMAND` to a value with shell metacharacters intending shell semantics, those would be passed as literal argv — surprising but not unsafe. Documented in `tests/headless.test.js`.
- **Severity:** low (defense in depth is correct).
- **Confidence:** HIGH.

#### Finding S4: UI server static-file path traversal is blocked

- **Where:** `core/ui/server.js` `serveStatic()` function (lines 37-49).
- **Pattern:** `path.normalize(file).replace(/^[\/\\]+/, "")` strips leading slashes; rejects any normalized path containing `..`.
- **Tests:** `tests/ui.test.js` includes an explicit `rejects path traversal attempts on /static/` test.
- **Severity:** n/a (positive finding).
- **Confidence:** HIGH.

#### Finding S5 (CLOSED — non-issue after verification)

- **Initial concern:** UI API endpoints accept stage / role names as URL params (`/api/gate/<stageId>`, `/api/role/<name>`) which become part of a file path; a malicious name like `../../etc/passwd` could traverse outside the intended dir.
- **Verification (during this audit):** both functions DO validate input before file access:
  - `loadGateFile()`: `if (!/^stage-[a-z0-9.-]+$/i.test(stageId)) return null;` — rejects anything not matching `stage-<alphanumeric/dot/hyphen>`.
  - `loadRoleBrief()`: `if (!/^[a-z][a-z0-9-]*$/i.test(role)) return null;` — rejects anything not matching `<lowercase>(<alphanumeric/hyphen>)*`.
- **Live exploit attempt:** confirmed via curl against a running UI that `/api/gate/..%2F..%2F..%2Fetc%2Fpasswd` and `/api/role/..%2F..%2F..%2Fetc%2Fpasswd` both return HTTP 404 with an error JSON. The URL-encoded `..` is rejected by the regex before any file system access.
- **Verdict:** **non-issue**. The defense is in place and tested by the live exploit attempt.
- **Process lesson:** this finding was originally promoted to "medium severity / needs fix" based on signature-only reasoning (looking at route definitions without reading the helpers). The verification step caught the error before the finding propagated to the backlog. **Future audits should verify before promoting.**
- **Confidence (final):** HIGH.

### Auth & authz

#### Finding S6: the UI has no auth

- **Where:** `core/ui/server.js`.
- **Issue:** the UI exposes full pipeline state (artifacts, gate JSON, role briefs) to anyone who can connect.
- **Mitigation in place:**
  - Loopback bind by default (`127.0.0.1`).
  - Non-loopback bind refused unless `STAGECRAFT_UI_ALLOW_REMOTE=1`.
  - When opt-in is given, a loud stderr warning prints at startup.
- **Severity:** low — the mitigations are appropriate for a developer-local tool.
- **Confidence:** HIGH.
- **Suggested action:** keep loopback default; do not add auth (out of scope for v0.x; would be premature complexity for a local dev tool).

### Dependency vulnerabilities

#### Finding S7: npm audit reports 0 vulnerabilities

- **Where:** `npm audit` against the current `package-lock.json`.
- **Status:** **clean**. The previous high-severity advisory (`GHSA-q7rr-3cgh-j5r3` in `@opentelemetry/sdk-node`) was resolved by removing the affected package entirely during P2.
- **Severity:** n/a (positive).
- **Confidence:** HIGH.

#### Finding S8: `@huggingface/transformers` downloads a model from huggingface.co on first use

- **Where:** `core/memory/embed.js` (lazy `require`).
- **Pattern:** the default embedder (`Xenova/bge-small-en-v1.5`) downloads ~33MB from the Hugging Face CDN on first ingest. Cached to `~/.cache/huggingface/` after.
- **Risk:** supply-chain — a compromised CDN or DNS attack could inject a malicious model. The model is loaded and executed (inference) on user input.
- **Mitigation in place:** `DEVTEAM_EMBEDDING_PROVIDER=stub` bypasses the download entirely for CI / constrained environments. `DEVTEAM_EMBEDDING_MODEL` overrides the model URL.
- **Severity:** low — the attack surface requires Hugging Face CDN compromise or active MitM on the user's network.
- **Confidence:** MEDIUM.
- **Suggested action:** **document the trust model in `docs/memory.md`** — say explicitly "you trust the Hugging Face CDN when using local embedder." Optionally add a hash-verification step (BACKLOG candidate).

### Data exposure

#### Finding S9: memory store is plaintext

- **Where:** `core/memory/store.js`, `.devteam/memory/chunks-<kind>.json` in target projects.
- **Pattern:** indexed chunks (from briefs, design specs, retros, ADRs) are stored as plaintext JSON with embedding vectors. Sensitive content from the source artifacts is preserved verbatim.
- **Risk:** if a user commits `.devteam/memory/` to git, they've committed potentially sensitive content.
- **Mitigation in place:** `docs/memory.md` explicitly advises gitignoring the directory and provides the `stagecraft-no-memory` per-file opt-out marker.
- **Severity:** low (well-documented).
- **Confidence:** HIGH.

#### Finding S10: gate JSON files may contain sensitive content

- **Where:** `pipeline/gates/*.json` written by agents during pipeline runs.
- **Pattern:** the `blockers` and `warnings` arrays are free-form strings. An agent could inadvertently write a secret it just saw into a blocker message.
- **Mitigation in place:** secret-scan hook (`core/hooks/secret-scan.js`) blocks `Write` / `Edit` of files containing recognized credential patterns. The hook fires *before* the write lands.
- **Severity:** low — the hook covers the common cases (AWS, GitHub, Anthropic, OpenAI, Slack, Stripe, private keys, JWTs, postgres URLs).
- **Confidence:** HIGH.

### Cryptography

#### Finding S11: no cryptography used in the framework

- **Where:** verified via grep — no `crypto` / `crypto/scrypt` / `bcrypt` / `argon2` / similar imports.
- **Severity:** n/a (positive).
- **Confidence:** HIGH.
- **Notes:** Stagecraft doesn't authenticate, doesn't encrypt anything at rest, doesn't sign anything. The hosts and the user's CI handle credentials. No homegrown crypto risk because there's no crypto.

## Summary table

| Finding | Severity | Confidence | Status |
|---|---|---|---|
| S1: no hardcoded creds | n/a | HIGH | clean |
| S2: gitignore (memory dir) | low (target-side) | HIGH | documented |
| S3: subprocess discipline | low | HIGH | clean |
| S4: static-file traversal | n/a | HIGH | tested |
| S5: UI API path traversal (CLOSED) | non-issue | HIGH | verified via live exploit attempt |
| S6: UI has no auth | low | HIGH | mitigated by loopback bind guard |
| S7: npm audit | n/a | HIGH | clean |
| S8: HF CDN trust | low | MEDIUM | documentable |
| S9: memory plaintext | low | HIGH | documented |
| S10: gate content secret leak | low | HIGH | hook-mitigated |
| S11: no crypto | n/a | HIGH | clean |

**No P0 security items.** All findings are either positive (clean), already mitigated, or document-only. The codebase audits cleanly on the security front.

## Project-Specific

*(No `docs/audit-extensions.md` for compliance frameworks. If this codebase were subject to SOC 2 / HIPAA / PCI, this section would enumerate framework-specific controls.)*
