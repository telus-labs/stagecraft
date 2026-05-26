# Code Conventions

This skill contains project-wide coding standards. Agents load this when
writing or reviewing code. Do not duplicate these rules in agent prompts.

## General

- Prefer explicit over clever. Code is read more than it is written.
- Every public function/method has a docstring or JSDoc comment.
- No magic numbers — use named constants.
- No commented-out code in commits.

## Naming

- Files: `kebab-case` for all languages
- Classes/Types: `PascalCase`
- Functions/variables: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`
- Database columns: `snake_case`

## Error Handling

- Never swallow errors silently.
- All async operations have explicit error handling.
- Errors surfaced to users must never expose stack traces or internal paths.

## Security (non-negotiable)

- No secrets, tokens, or credentials in source code.
- All user input is validated before use.
- SQL queries use parameterised statements only — no string concatenation.

## Testing

- New behaviour = new tests. PRs that add behaviour without tests are BLOCKERs.
- Test file lives next to the source file it tests: `foo.ts` → `foo.test.ts`
- Test names describe behaviour: `"returns 404 when user not found"` not `"test1"`

## Git

- Branch names: `feature/short-description` or `fix/short-description`
- Commit messages: imperative mood, 72-char subject line
  Example: `Add rate limiting to auth endpoint`
- One logical change per commit.

## Gotchas (add failures here over time)

- Do not use `any` type in TypeScript. Reviewers should BLOCKER this.
- Do not use `SELECT *` in SQL. Always name columns explicitly.
- Do not push to `main` directly. All changes go through PRs.
