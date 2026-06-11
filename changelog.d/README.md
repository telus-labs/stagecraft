# changelog.d/ — per-PR changelog fragments

Each PR touching `core/`, `bin/`, `hosts/`, `rules/`, `roles/`, or `skills/` must add a file here named `<branch-slug>.md`, containing its entry in the existing CHANGELOG bullet style (see `CHANGELOG.md` for examples, including the "Honest scope note" convention where applicable).

At release time, `node scripts/release.js assemble <version>` concatenates all fragments here (alphabetical by filename) into the new version section and deletes them; `README.md` and `.gitkeep` are preserved.

Opt-out: add `[skip-changelog]` to the PR title or any commit message on the branch.
