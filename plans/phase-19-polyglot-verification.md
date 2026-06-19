# Phase 19 — Polyglot Verification

**Status:** Item 19.1 implemented; pending merge.
**Backlog item:** B7 multi-language QA.
**Purpose:** make orchestrator-stamped verification cover mixed Node, Python, and Go
projects without requiring a hand-composed shell command.

---

## 1. Contract

When `pipeline.verify.test_command` is absent, Stagecraft discovers test suites from
bounded root-level project signals and runs every discovered command sequentially in
stable Node, Python, Go order. A configured non-empty command remains an exclusive
override; explicit `null` disables test execution. Existing `discoverScripts()`,
`resolveCommands()`, gate fields, and single-command stamp shape remain compatible.

For multiple suites, `_orchestrator_stamped.runs.test` retains an aggregate command,
exit code, and duration while adding `suites[]` with per-language details. All suites
are attempted, and any failed suite fails the gate with a language-named blocker.

## 2. Work item 19.1

- Discover `package.json` `scripts.test`, explicit pytest signals, and `go.mod`.
- Bound Python test discovery by directory, depth, and inspected-file count; reject
  symlink traversal.
- Use `python3 -m pytest` on POSIX and `py -m pytest` on Windows.
- Aggregate the same suite set in pre-review, QA, and repair red/green verification.
- Preserve explicit override/disable behavior and the legacy single-suite stamp.
- Document configuration, audit output, limitations, and backlog completion.

## 3. Acceptance criteria

1. Mixed Node/Python/Go fixtures produce three ordered suite records.
2. A failed suite does not prevent later suites from running and fails the gate.
3. A generic `pyproject.toml` does not cause a pytest false positive.
4. Symlinked test directories are not traversed.
5. Existing configured single-command projects retain their prior stamp shape.
6. Full tests, lint, consistency, and changelog guard pass.

## 4. Deliberate limits

Rust, Java, .NET, nested workspaces, and arbitrary framework inference are not guessed.
Those projects should set `pipeline.verify.test_command` to their canonical aggregate
command until a later evidence-backed discovery rule is added.
