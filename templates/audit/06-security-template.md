# 06 — Security review

> Phase 2.1 output. Read `00-project-context.md` and `01-architecture.md` first. Adapt to the project's language and framework. Every finding gets a Severity AND a Confidence rating.

## Summary

One paragraph: the security posture of this codebase. Are there obvious holes, or is it tidy? What's the biggest concern?

## Rating scales

- **Severity:** critical / high / medium / low
- **Confidence:** HIGH / MEDIUM / LOW

## Findings

### Secrets hygiene

#### Finding S1: <short title>

- **Where:** `path/to/file.ext:NN` (or `.git/` history if relevant)
- **Issue:** <hardcoded API key / token in source / credential in error message / …>
- **Severity:** critical / high / medium / low
- **Confidence:** HIGH / MEDIUM / LOW
- **Suggested fix:** <move to env var / vault / .env.gitignored / …>

### Input handling

Injection risks — SQL, command, template, path traversal, XSS, SSRF, deserialization.

…

### Auth & authz

Unprotected endpoints, inconsistent auth, IDOR, missing role checks.

…

### Dependency vulnerabilities

- Lockfiles present: yes / no
- Audit tooling: <npm audit / pip-audit / cargo audit / govulncheck / …>
- Known CVEs from a fresh audit run: <N critical, M high, L medium>
- Notable: <CVE-XXXX-NNNN in package@version — what it allows>

### Data exposure

PII / credentials in logs, error messages, API responses, telemetry.

…

### Cryptography

Algorithms used (and whether they're current), key management, hardcoded IVs / nonces, weak hashes, any homegrown crypto.

…

## Project-Specific

> *(Appended by extensions if applicable. Likely to include compliance-framework checks: PCI / HIPAA / SOC 2 / GDPR / etc.)*
