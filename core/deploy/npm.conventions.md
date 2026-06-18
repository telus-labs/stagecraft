# npm adapter — conventions for design and build agents

This project publishes to an npm registry. Design and build agents must
satisfy these constraints:

## Required files

- `package.json` — must declare `name`, `version`, `main` or `bin`,
  and either a `"files"` whitelist or rely on `.npmignore`
- `bin/<entrypoint>.js` — CLI scripts must have a `#!/usr/bin/env node`
  shebang on line 1
- `pipeline/runbook.md` — must include `§Rollback` (npm deprecate command)
  and `§Health signals` (install-and-run verification)

## Artifact scope — required for every npm project

Restrict the published artifact to source files only. Use one of:

**Option A — `"files"` whitelist in `package.json`** (preferred):
```json
"files": ["bin/", "src/", "lib/"]
```

**Option B — `.npmignore`**:
```
.claude/
.devteam/
pipeline/
src/tests/
src/infra/
jest.config.js
*.config.js
```

Do not ship: `.claude/`, `.devteam/`, `pipeline/`, test directories,
dev-only config files, or any file matching `*.env*`.

## No credentials in source

`src/infra/.env.example` may document required environment variables
(with placeholder values only — no real tokens). The tool must read
env vars at runtime; do not embed credentials in source or configuration.

## Version management

Do not hardcode the version string in non-`package.json` source files.
Read `package.json` at runtime if the tool needs to report its own version.
