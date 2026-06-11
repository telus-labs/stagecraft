#!/usr/bin/env node
// changelog-guard.js — CI check that PRs touching core code include a changelog.d/ fragment.
// Closes BACKLOG C8.
//
// Decision logic is exported as `evaluate()` for unit tests; the CLI wrapper reads
// env vars set by the .github/workflows/test.yml step so the YAML stays dumb.

const GUARDED_PREFIXES = ["core/", "bin/", "hosts/", "rules/", "roles/", "skills/"];

// evaluate — pure function; returns {pass: bool, reason: string}.
//   changedPaths  — repo-relative paths changed in the PR
//   fragmentPaths — changelog.d/*.md paths added/modified in the PR
//   skipText      — concatenated PR title + commit messages (searched for [skip-changelog])
function evaluate(changedPaths, fragmentPaths, skipText) {
  const required = changedPaths.some((p) =>
    GUARDED_PREFIXES.some((g) => p.startsWith(g)),
  );
  if (!required) return { pass: true, reason: "no guarded paths changed" };

  if (skipText && skipText.includes("[skip-changelog]")) {
    return { pass: true, reason: "opt-out: [skip-changelog] marker found" };
  }

  const hasFragment = fragmentPaths.some(
    (p) =>
      p.startsWith("changelog.d/") &&
      p.endsWith(".md") &&
      !p.endsWith("/README.md") &&
      p !== "changelog.d/README.md",
  );
  if (hasFragment) return { pass: true, reason: "changelog.d/ fragment present" };

  return {
    pass: false,
    reason:
      "PR touches guarded paths (core/, bin/, hosts/, rules/, roles/, skills/) but " +
      "adds no changelog.d/ fragment — add one, or add [skip-changelog] to the PR " +
      "title or a commit message to opt out",
  };
}

function main() {
  const changedPaths = (process.env.GUARD_CHANGED || "").split("\n").filter(Boolean);
  const fragmentPaths = (process.env.GUARD_FRAGMENTS || "").split("\n").filter(Boolean);
  const skipText = process.env.GUARD_SKIP || "";

  const result = evaluate(changedPaths, fragmentPaths, skipText);

  if (result.pass) {
    console.log(`✓ changelog guard: ${result.reason}`);
    process.exit(0);
  } else {
    console.error(`✗ changelog guard: ${result.reason}`);
    process.exit(1);
  }
}

module.exports = { evaluate, GUARDED_PREFIXES };

if (require.main === module) main();
