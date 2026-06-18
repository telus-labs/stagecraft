# 06 — Security review

## Summary

Stagecraft's security surface is **small and well-bounded** — it's a local CLI orchestrator that reads/writes files in the current project, spawns subprocesses, and doesn't accept network input from untrusted sources. `npm audit` reports **0 vulnerabilities** (critical/high/moderate/low/info all zero) across production dependencies. Two real but contained findings (one low-severity injection-shape, one missing size cap), three positive findings worth noting.

## Findings

### S-1 — `secret-scan` hook has no size cap on stdin payload (MEDIUM, HIGH confidence)

`core/hooks/secret-scan.js` is the PreToolUse hook that scans proposed file content for credentials before allowing a `Write` or `Edit` tool call to land. It reads the JSON payload from stdin (containing `tool_input.content`) and runs ~20 regex patterns against the content.

**The hook has no size limit.** By contrast:

| Component | Size guard |
|---|---|
| `core/guards/security-heuristic.js` | `MAX_SCAN_BYTES = 1_000_000` (1 MB) — skips file if larger |
| `core/hooks/approval-derivation.js` | `MAX_FILE_BYTES = 1_000_000` — skips review file if larger |
| `core/gates/validator.js` (`loadGate`) | `MAX_GATE_BYTES` cap before `JSON.parse` |
| **`core/hooks/secret-scan.js`** | **none — full content is regex-scanned** |

**Risk**:
- Tool call where the model attempts to write a very large file → hook scans entire content → potentially seconds of regex evaluation → Claude Code hook timeout → **fail-open**: the tool call could proceed without the safety net (hooks that don't respond in time are treated as non-blocking).
- A pathological regex backtracking case on adversarial content could hang the hook for minutes (none of the current patterns look catastrophic — they're mostly `\b<prefix>[A-Za-z0-9]{N}\b` shapes — but the guard isn't structural).
- Performance: a model legitimately writing a large file (e.g., a generated 5 MB JSON fixture) sees the Write tool call delayed.

**Recommended fix**: add `MAX_SCAN_BYTES = 1_000_000` (or similar) to `core/hooks/secret-scan.js`; if `tool_input.content.length` exceeds the cap, log a `[secret-scan] ⚠️ content exceeds Nm bytes; skipping scan` warning and exit 0 (allow — consistent with the existing conservative-on-error policy). 1MB is plenty for ordinary source files and matches the cap used elsewhere. **~5 lines of code; very low risk.**

Same hardening pattern can also be applied to `core/config.js`'s `yaml.load(raw)` — currently no stat-size check before loading the YAML — but that's a much less common attack surface (config files are typically operator-written, not model-written).

### S-2 — `core/ui/server.js` `tryOpen` uses `exec` with shell interpolation (LOW, HIGH confidence)

`core/ui/server.js:236`:

```js
function tryOpen(url) {
  const cmd = process.platform === "darwin" ? `open "${url}"`
           : process.platform === "win32" ? `start "" "${url}"`
           : `xdg-open "${url}"`;
  try { exec(cmd); } catch { /* not fatal */ }
}
```

The URL is constructed from `server.address()`, which is set by Node's HTTP server after binding. **Today this is safe** — `server.address().port` is a number (clamped by Node) and `server.address().address` is the bound interface (default `127.0.0.1` for the loopback case). User input via `--port N` is coerced to `Number()` in `bin/devteam` before reaching the server.

**The risk is structural, not active**: the pattern `exec("<cmd> \"" + url + "\"")` is the standard shell-injection shape. If a future refactor changes the URL source (e.g., accepts a hostname flag, reads a config-file URL), the shape will silently become exploitable. Defense-in-depth would use `spawn` with array arguments instead:

```js
const args = process.platform === "darwin" ? ["open", url]
           : process.platform === "win32" ? ["cmd", "/c", "start", "", url]
           : ["xdg-open", url];
try { spawn(args[0], args.slice(1), { detached: true, stdio: "ignore" }).unref(); }
catch { /* not fatal */ }
```

**Recommended fix**: switch `exec(cmd)` to `spawn(arg0, args, { detached: true, stdio: "ignore" })`. Eliminates the entire injection-shape class regardless of future URL sources. ~10 lines.

### S-3 — Secret-scan magic-comment override (POSITIVE, no action — verifying intent)

`core/hooks/secret-scan.js` honors a magic-comment override: any line containing `devteam-allow-secret: <reason>` (case-insensitive) bypasses the scan. This is the documented escape hatch for verified false positives (test fixtures, `.env.example` files, doc snippets containing pattern-shaped strings).

**Verified intent**: the override is conservative — only the specific marker triggers it, not e.g. comments saying "this looks like a secret but isn't." The `reason` text is required (the regex captures it), giving an audit trail.

**Observation, not a finding**: the security-heuristic does *not* have an equivalent override. If `core/guards/security-heuristic.js`'s content-pattern scanning falsely flags a file (e.g., a documentation file that mentions `bcrypt` triggering the password-hashing pattern → `security_review_required: true` → stage-04b fires unnecessarily), there's no clean way to suppress. Worth a future `devteam-no-security-review:` magic comment for parity. Tracked in `08-code-quality.md` as Q-4.

### S-4 — Subprocess invocation discipline (POSITIVE, no action)

All operational subprocess spawning uses `child_process.spawn` with array arguments — the safe pattern. Confirmed sites:

- `core/verify/runner.js:38` — `spawn(cmd, args, { ... })` with command and args separated. Used by `devteam verify` / orchestrator-stamped Stage 4a/6.
- `core/adapters/headless.js` — `spawn` of host CLI for `--headless` mode. Args separated; stdin piped (no shell interpretation of stdin content).
- `core/hooks/approval-derivation.js` — invoked *as* a spawned process by Claude Code; doesn't itself spawn.

The only `exec` (shell-string) call is the `tryOpen` finding (S-2). No `child_process.execSync` with shell-interpolated user input found anywhere in `core/` or `bin/`.

### S-5 — js-yaml v4 used in safe mode (POSITIVE, no action)

`core/config.js:46` uses `yaml.load(raw)`. In js-yaml v4 (currently `4.1.1` per `package-lock.json`), the `load()` function is **safe-by-default** — the unsafe constructors that historically caused RCEs in YAML parsers (`!!js/function`, etc.) were removed entirely in the v4 API. The dangerous `yaml.load` of v3 was renamed to `yaml.loadAll`-with-schema-arg, and the default schema (`DEFAULT_SCHEMA`) is the JSON-compatible safe one.

**Verified**: `yaml.load(raw)` here is equivalent to v3's `yaml.safeLoad(raw)` and is the correct call. No action needed.

### S-6 — File-on-disk size caps in approval-derivation + security-heuristic (POSITIVE, no action)

Cross-reference with S-1. Two of the three file-touching components correctly bound their read sizes:

- `core/guards/security-heuristic.js` — `MAX_SCAN_BYTES = 1_000_000` (1 MB). Files larger than this aren't scanned; the heuristic returns no findings.
- `core/hooks/approval-derivation.js` — `MAX_FILE_BYTES = 1_000_000` for both review-file reads and gate-file reads.

The pattern is the right one — fail-soft (skip-and-log) rather than fail-hard (error). Worth extending to secret-scan (S-1).

### S-7 — `npm audit` clean (POSITIVE, no action)

```
Total deps audited: (omit=dev, prod only)
Vulnerabilities: critical=0, high=0, moderate=0, low=0, info=0
```

Stagecraft's dependency footprint is small (3 unique top-level prod packages: `@huggingface/transformers`, `js-yaml`, plus 6 `@opentelemetry/*` packages). All are mature, widely-used. The OpenTelemetry packages have `~` version pins (patch-only updates), giving stable surface; transformers has `^` (minor-compatible) which is the right setting for an ML library where models may evolve.

## Network surface

- **Outbound network**: only via host CLIs (`claude --print`, `codex exec`, `gemini -p`) and the OpenTelemetry exporter (when `OTEL_EXPORTER_OTLP_ENDPOINT` is set). The orchestrator never makes network calls itself. The memory embedder downloads the model on first ingest (~33MB from HuggingFace Hub) then runs offline.
- **Inbound network**: only `core/ui/server.js` (bound to `127.0.0.1` by default). No CORS handling, no auth — but the loopback bind makes that appropriate. **Worth verifying**: does the UI server accept a `--host` flag for binding to a non-loopback interface? If so, the no-auth posture becomes a problem in multi-user environments. Spot-check: `bin/devteam` `cmdUI` reads `--port` only — not `--host`. The server bind address is fixed in code. **Safe today; flag if a `--host` flag is added later.**

## Hot-loaded code patterns

- No `eval()` anywhere in `core/`, `bin/`, or `hosts/`.
- No `new Function()` from user input.
- No dynamic `require()` from user input (`require()` calls all reference fixed module paths or host-name-validated paths).
- One `Function()`-shaped concern: the memory embedder's transformers library does load model weights — but that's a vetted upstream library, not our code, and the model identifier comes from config (`Xenova/bge-small-en-v1.5` default), not user input.

## Auth and credential handling

- **Stagecraft handles no credentials directly.** Host CLIs (`claude`, `codex`, `gemini`) own their own auth via their own env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.). Stagecraft never reads these.
- **The secret-scan hook is preventive**, not reactive — it blocks Write/Edit tool calls that contain credentials before they land on disk. Combined with the magic-comment escape hatch (verified intent, S-3), this is the right shape.
- **Per-project credentials in `.devteam/config.yml`**: none defined in the schema. Routing config carries host names only.

## Review of recent additions (since 2026-05-28)

- **`devteam ruling`**: spawns the configured host's headless command with a prompt on stdin. Same spawn discipline as the rest of headless infrastructure. No new injection surface.
- **`devteam derive-approvals`**: spawns `core/hooks/approval-derivation.js` with stdin payload built from operator-provided file path. The file path is validated against the `pipeline/code-review/` directory and the `by-<reviewer>.md` pattern before spawning — see `bin/devteam:cmdDeriveApprovals`. No traversal escape.
- **Orchestrator-stamped verification (`devteam verify`)**: invokes operator-configured lint and test commands. Commands come from `.devteam/config.yml` `pipeline.verify.*` or `package.json` scripts. The operator has full trust over these commands — no privilege boundary crossed. If config is shared (e.g., committed in a repo), an attacker who can land a malicious PR could inject a verify command, but at that point they already have code-modification privileges so the surface isn't additional.
- **Auto-injected blocker sections + idempotent strip**: writes to `pipeline/context.md` within the project. Marker tags (`<!-- devteam:red-team-blockers -->`) are well-formed; bytes between markers are blocker text from gates that the orchestrator just produced. No untrusted-input path.

## Recommendation summary

| # | Finding | Severity | Effort | Priority |
|---|---|---|---|---|
| S-1 | Add `MAX_SCAN_BYTES` to `core/hooks/secret-scan.js` | MEDIUM | XS (5 lines) | P1 |
| S-2 | Replace `exec` with `spawn(array)` in `core/ui/server.js:tryOpen` | LOW | XS (10 lines) | P2 |
| (S-3) | Optional: add `devteam-no-security-review:` magic comment to security-heuristic | LOW | XS | P3 — tracked in 08-code-quality.md Q-4 |
| Future | If `core/ui/server.js` ever gains a `--host` flag, add basic auth | — | — | Track but not actionable now |

Net: the security surface is in good shape. The two real findings are hardening rather than active exploitation paths — important to address as cheap insurance, neither is "fix now."
