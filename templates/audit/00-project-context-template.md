# 00 — Project context

> Phase 0.1 output. Read by every subsequent audit phase. Replace placeholders with findings; remove any section that doesn't apply (and note why).

## Summary

One paragraph: what is this project, in plain language? If a new engineer joined tomorrow, what would they need to know in the first 30 seconds?

## Languages and frameworks

| Language | Version | Where it lives |
|---|---|---|
| | | |

Frameworks (web, ORM, test, build): name + version.

## Build & dependency manager

- Manager: <npm / pnpm / yarn / pip / poetry / cargo / go mod / …>
- Lockfile present: yes / no
- Notable: monorepo tooling (Nx, Turbo, Lerna, …)?

## Commands

The exact commands a new developer needs. Run them; verify they work; if they don't, that's a finding for `05-documentation.md`.

```sh
# install dependencies
<command>

# run the app locally
<command>

# run tests
<command>

# run linters / formatters
<command>

# build for production
<command>
```

## Deployment target

Cloud (AWS / GCP / Azure / …), container orchestration (k8s / ECS / Cloud Run / …), serverless (Lambda / Cloud Functions / …), on-prem, edge? CI/CD pipeline that ships it?

## Conventions

- **Documented:** what's explicitly stated in CONTRIBUTING / README / AGENTS / CLAUDE / inline.
- **Undocumented but implied:** patterns you can infer from the codebase (e.g. "all repository classes end in `Repo`", "errors always bubble up through one middleware").

## Codebase size

- Total file count: <N>
- Major directories: <list>
- Modules / services: <N>
- Lines of code (rough order of magnitude): <N>K
- Monorepo? yes / no — if yes, name the workspaces.

## AI / editor instructions present

What's already set up for AI-assisted work:

- `CLAUDE.md` — yes / no
- `AGENTS.md` — yes / no
- `.cursorrules` / `.windsurfrules` — yes / no
- `.github/copilot-instructions.md` — yes / no
- `.devteam/config.yml` (Stagecraft) — yes / no

## Surprises and open questions

Things that were unexpected or unclear during this phase. List them — the next phase or the user might answer them.

- <surprise>
- QUESTION: <open question>

## Project-Specific

> *(Appended by extensions if `docs/audit-extensions.md` declares any Phase 0 extensions.)*
