# Adapter: npm

Publishes a Node.js package to an npm-compatible registry via `npm publish`.
Suitable for CLI tools, libraries, and any project whose deployment artifact
is an npm tarball.

## Assumptions

- `npm` (v7+) is on PATH
- Registry credentials are available — either via `~/.npmrc`, `NPM_TOKEN`
  in the environment, or `npm login` already performed
- `package.json` exists and declares `name`, `version`, and `main`/`bin`
- Git working tree is clean before publishing (npm enforces this by default)

## Config (`.devteam/config.yml`)

```yaml
deploy:
  adapter: npm
  environment: npm-registry          # gate label; default "npm-registry"
  npm:
    registry: https://registry.npmjs.org  # default; override for private registries
    tag: latest                           # dist-tag; default "latest"
    access: public                        # "public" or "restricted"; default "public"
    dry_run: false                        # set true to run --dry-run only (no publish)
```

## Artifact restriction

npm includes files in the tarball using one of two mechanisms, checked in
priority order:

1. **`"files"` whitelist** in `package.json` — only the listed paths are
   included. This takes precedence over `.npmignore`.
2. **`.npmignore`** — paths listed here are excluded from the default set
   (everything tracked by git, minus `node_modules/`).

Both are valid. A project with a `"files"` whitelist does not need
`.npmignore`. When verifying the artifact, accept whichever mechanism is in
place — do not require both.

## Procedure

Follow in order. On any step failure: capture the command's output, write
`status: FAIL` to `pipeline/gates/stage-08.json` with the output as a
blocker, and halt. **Do not auto-rollback** — `npm unpublish` is restricted
after 24 h; the runbook names the recovery procedure.

### 1. Preconditions

a. Read `pipeline/gates/stage-07.json`. Confirm `pm_signoff: true`.
   If missing or false: write `status: ESCALATE` with reason
   "PM sign-off missing — cannot publish to npm" and halt.

b. Confirm `pipeline/runbook.md` exists. If missing: write
   `status: ESCALATE` with reason "Runbook required for Stage 8".

c. Confirm `package.json` exists and is valid JSON. If missing or
   unparseable: write `status: ESCALATE` with reason
   "`package.json` missing or unparseable".

d. Confirm the git working tree is clean:

   ```bash
   git status --porcelain
   ```

   Any output (modified or untracked files) is a FAIL blocker:
   "git working tree not clean — commit or ignore all changes before publishing".

### 2. Registry credentials

```bash
npm whoami --registry <registry>
```

Non-zero exit: write `status: ESCALATE` with reason
"npm registry credentials not configured — run `npm login` or set NPM_TOKEN".

### 3. Dry-run artifact verification

```bash
npm pack --dry-run
```

Capture the list of files and the total unpacked size. Then:

**3a. Credential scan — read before flagging.**
For each file in the artifact whose path matches any of the following
patterns (case-insensitive): `*.env*`, `*credentials*`, `*secret*`,
`*token*`, `*auth*`, `*.key`, `*.pem`, `*.pfx`, `settings*.json`,
`config*.json`:

- **Read the file's actual contents.**
- Search for populated credential patterns:
  - A line where a key-like name (`[A-Za-z_-]*(TOKEN|KEY|SECRET|PASSWORD|AUTH|API)[A-Za-z_-]*`)
    is assigned a non-empty, non-placeholder value (not `""`, `''`, `<...>`,
    `your-*`, `replace-*`, or `changeme`).
- **Only raise a blocker if the file actually contains a populated credential.**
  Placeholder or empty values are documentation, not leaks.
- Configuration files that contain only structural fields (hooks, permissions,
  routing, feature flags, etc.) with no credential values must NOT be flagged.

**3b. Size check.**
If the artifact exceeds 50 MB unpacked: write a WARN (not a blocker) in
`pipeline/deploy-log.md`. Proceed; do not halt for size alone.

**3c. Expected file set.**
If `package.json` has a `"files"` field: note the whitelist. Expect the
artifact to contain only those paths plus `package.json` and `README.md`.
If additional files appear beyond that set, list them as warnings, not
blockers (the whitelist is already the gate).
If no `"files"` field exists: confirm `.npmignore` is present. If neither
exists, raise a FAIL blocker:
"`package.json` has no `"files"` whitelist and no `.npmignore` — artifact
scope is undefined; add one before publishing".

### 4. Version conflict check

```bash
npm view <name>@<version> version 2>/dev/null
```

If this returns a non-empty string, the version already exists on the
registry. Write `status: FAIL` with blocker:
"version `<version>` already published — bump `package.json` `version`".

### 5. Publish

```bash
npm publish --registry <registry> --tag <tag> --access <access>
```

If `deploy.npm.dry_run: true`, append `--dry-run` and skip steps 6–7.

Non-zero exit: write `status: FAIL` with the npm output as blocker. Halt.

### 6. Smoke test — install verification

```bash
npm install --global <name>@<version> --registry <registry> --dry-run
```

This confirms the published tarball is installable. Non-zero exit: write
`status: WARN` in the gate (publish succeeded; install smoke test failed).

### 7. Write outputs

Write `pipeline/deploy-log.md`:
```
# Deploy log — <name>@<version>

**Published:** <timestamp>
**Registry:** <registry>
**Dist-tag:** <tag>
**Files:** <count> files, <size> kB (unpacked)
**Runbook:** pipeline/runbook.md §Rollback

## Artifact contents
<npm pack --dry-run output>
```

Write `pipeline/gates/stage-08.json`:
```json
{
  "stage": "stage-08",
  "status": "PASS",
  "deploy_completed": true,
  "smoke_tests_passed": true,
  "rollback_executed": false,
  "deploy_adapter": "npm",
  "environment": "<tag> on <registry>",
  "runbook_referenced": true,
  "cost_delta_estimated": true,
  "cost_delta_multiplier": 1,
  "cost_gate_override": false,
  "adapter_result": {
    "package": "<name>@<version>",
    "registry": "<registry>",
    "dist_tag": "<tag>",
    "artifact_files": <count>,
    "artifact_kb": <unpacked_kb>,
    "dry_run": false
  }
}
```

## Gate body

`adapter_result` fields:

| Field | Description |
|---|---|
| `package` | `name@version` as published |
| `registry` | Registry URL used |
| `dist_tag` | npm dist-tag applied |
| `artifact_files` | File count from `npm pack --dry-run` |
| `artifact_kb` | Unpacked size in KB |
| `dry_run` | `true` if published with `--dry-run` |

## Runbook hooks

The adapter depends on these runbook sections:

- **`§Rollback`** — `npm deprecate <name>@<version> "DO NOT USE"` to
  soft-deprecate (hard unpublish is only available within 24 h and
  requires npm support after that). Include the command and when to use it.
- **`§Health signals`** — how to verify the package installs and runs
  correctly post-publish (e.g. `npx <name>@<version> --version`).
