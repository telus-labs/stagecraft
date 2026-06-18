# 06 — Security review

## Summary

No dependency vulnerabilities, committed real secrets, unsafe gate-path traversal,
or host-command shell interpolation were verified. Security posture is stronger than
the previous audit: CodeQL, `eslint-plugin-security`, secret hooks, write auditing,
least-privilege Actions permissions, and bounded gate parsing are all active. One
concrete stored-XSS surface remains in the local dashboard.

## Findings

### S-1 — Model-authored gate strings are inserted into dashboard `innerHTML`

- **Severity:** medium.
- **Locations:** `core/ui/static/app.js:178-184`, `665-705`, `797-809`, `851-895`,
  and additional `addFieldRow()` callers.
- **Issue:** gate fields such as finding summary, file, method, host, workstream,
  failing test, and observability signal are interpolated into HTML without
  `escHtml()`. Gate JSON is project/model-authored input, not trusted application
  constants. A value such as `<img src=x onerror=...>` is parsed as markup when the
  gate is viewed.
- **Exposure:** default loopback binding limits remote reach, but the payload executes
  in the developer's browser and can access every unauthenticated UI endpoint. Remote
  binding is explicitly supported via opt-in, increasing impact for shared hosts.
- **Suggested fix:** make text rendering use `textContent`; where structured markup is
  necessary, escape every dynamic token before interpolation. Add a malicious-gate
  browser/DOM regression test and a restrictive CSP.
- **verified_by:** direct taint trace from `loadGateFile()` JSON through `/api/gate/*`
  to the listed renderers; `escHtml()` has only three uses, all in fix-step rendering.
  Existing UI tests contain no sanitization/XSS case.
- **Confidence:** HIGH.

## Verified clean areas

- **Dependencies:** `npm audit --omit=dev` reported `found 0 vulnerabilities` on
  2026-06-18; `package-lock.json` is committed.
- **Secrets:** repository pattern scan found only explicit secret-scan fixtures;
  `.env*`, keys, pipeline state, and host-local settings are ignored or guarded.
- **Command execution:** headless commands use the quote-aware `splitCommand()` and
  `spawn(bin, args)`; browser launch uses argv. Verification commands may use a shell
  only when project configuration contains shell operators, which is an intentional
  local-code execution boundary.
- **Path handling:** UI gate and role identifiers are allowlisted; static traversal is
  rejected and tested.
- **Remote UI:** non-loopback binding is refused unless
  `STAGECRAFT_UI_ALLOW_REMOTE=1`, with an explicit no-auth warning.
- **Cryptography:** SHA-256 is used for integrity/fingerprints, not password storage;
  no homegrown encryption was found.

## Project-specific extensions

No `docs/audit-extensions.md` file is present.
