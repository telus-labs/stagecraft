# 00 — Project context

## Summary

Stagecraft is a model-agnostic AI dev-team pipeline orchestrator. It installs role briefs, slash commands, hooks, and rules into a target project, then orchestrates a 13-stage software-development pipeline across one or more AI coding tools (Claude Code, Codex CLI, Gemini CLI, generic). It also ships a codebase audit feature (the one running right now). The CLI is `devteam`; the project is "Stagecraft."

This audit is unusual: it's a **self-audit** — Stagecraft auditing itself to dogfood the new audit feature.

## Languages and frameworks

| Language | Version | Where |
|---|---|---|
| JavaScript (Node) | ≥20 (engines.node) | `core/`, `bin/`, `hosts/`, `scripts/`, `tests/` |
| Markdown | — | `docs/`, `rules/`, `roles/`, `skills/`, `templates/`, root |
| JSON Schema | draft 2020-12 | `core/gates/schemas/` (14 schemas) |
| YAML | — | host adapter capabilities, `.devteam/config.yml` (in target projects) |

**Frameworks:** none. No web framework, no test framework beyond `node --test` (built-in), no ORM. All deliberate — this is an orchestrator, not an application.

## Build & dependency manager

- Manager: `npm`
- Lockfile present: yes (`package-lock.json`)
- Notable: no build step. Pure Node, no transpilation, no bundler.

## Commands

```sh
# install dependencies
npm install

# run the test suite (378 tests, ~1.5s wall-clock)
npm test

# cross-artifact consistency lint (185 checks)
npm run consistency

# run the CLI
./bin/devteam help
# or after `npm link`:
devteam help
```

Other scripts (npm run …): `visualize`, `pr-pack`, `pr-publish`, `dashboard`, `budget`, `release:check`, `release:notes`.

## Deployment target

Not deployed. This is a developer tool installed via `npm link` (or `npm install -g` in future). Users `git clone` the framework, run `npm install`, then run `devteam init` in target projects to install per-host surfaces.

CI: `.github/workflows/test.yml` runs `npm test` + `npm run consistency` + a CLI smoke check on Node 20 / 22 / 24.

## Conventions

**Documented:**
- `AGENTS.md` — repo-level instructions for an LLM working on Stagecraft itself.
- `CONTRIBUTING.md` — 4 recipes (add adapter, add stage, edit rules, add role).
- `ARCHITECTURE.md` — 11 locked design decisions.
- Commit messages: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:`, `ci:`) — observed in `git log`.

**Undocumented but implied (from observation):**
- All `core/` modules use `node:` prefix for built-ins (`require("node:fs")`).
- Test files use `node:test` + `node:assert/strict`; no external test runner.
- Per-host adapters live in `hosts/<name>/` with `adapter.js` + `capabilities.json` + `install/` payload — strict shape.
- Role briefs (`roles/*.md`) are the single source of truth; host adapters render them into host-specific paths at install time.
- Gate schemas live one-per-stage in `core/gates/schemas/stage-NN.schema.json`.

## Codebase size

- Total files (excluding `node_modules`, `.git`): ~150
- JS lines: **9,182** (8 core + 25 tests + helper scripts + 4 host adapters)
- Markdown lines: **11,771** (docs, rules, roles, skills, templates, root docs)
- JSON / YAML config: ~881 lines
- Major directories: `core/` (39 files), `hosts/` (11 files across 4 adapters), `tests/` (26 files), `docs/` (19 files), `templates/` (23 files including templates/audit/), `roles/` (9 files), `rules/` (10 files), `skills/` (9 skill directories)
- Monorepo? No — single project. Multiple host adapters but one core, one repo.

## AI / editor instructions present

- `CLAUDE.md` — **not present** (the framework has no `CLAUDE.md`; `AGENTS.md` serves the role).
- `AGENTS.md` — yes, at root. Repo-level instructions for an LLM.
- `.cursorrules` / `.windsurfrules` — no.
- `.github/copilot-instructions.md` — no.
- `.devteam/config.yml` (target projects only) — n/a; this is the framework, not a target.

## Surprises and open questions

- **Self-audit is mildly recursive.** The audit feature is part of Stagecraft; auditing Stagecraft means auditing the feature that's analyzing it. The auditor role brief explicitly says "Don't audit Stagecraft itself unless that's literally what you've been asked to do" — this audit was explicitly asked for, so it proceeds, but the recursion is worth noting.
- **No `src/` directory.** Unlike most projects, the application code lives in `core/` and `bin/`. `src/` is reserved for *target projects* — `roles/dev-backend.md` owns `src/backend/` in a target, etc.
- **Templates serve dual purpose.** `templates/<artifact>-template.md` files are referenced by role briefs ("Produce `pipeline/brief.md` using `templates/brief-template.md`") but aren't installed into target projects. The agent invoking the role must have read access to the framework directory. This works in practice (Claude Code's subagents share the user's filesystem) but is an undocumented constraint.
- QUESTION: should `templates/audit/*` get installed into target projects' `docs/audit/` as starting scaffolds? Currently they're framework-side reference only; the audit skill is self-contained. Decision was deliberate but worth revisiting if audit users request it.
