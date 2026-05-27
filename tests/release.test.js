// scripts/release.js — release-notes extraction + pre-release check.
//
// The `notes` subcommand has eaten two real bugs:
//   1. A lookahead regex that failed when the requested section was the
//      last one in the file (no following `## [` to anchor against).
//   2. Calling `node scripts/release.js notes` without a version argument
//      pulls from [Unreleased] — fine in general, but when tagging we
//      need to extract the version we just promoted, e.g. notes 0.1.0.
//
// These tests pin both of those behaviors via subprocess invocation.
// `check` is deliberately not tested here — it shells out to git + npm
// test, which would make the test suite recursive and slow.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const RELEASE_SCRIPT = path.join(REPO_ROOT, "scripts", "release.js");

function runNotes(changelogText, ...args) {
  // Write a temp changelog, run `release.js notes ...` against a working
  // copy of the script that reads CHANGELOG.md from REPO_ROOT. To isolate
  // we copy the script to a tempdir, replace REPO_ROOT with the tempdir's
  // root, and write CHANGELOG.md there. Cleaner: just invoke the real
  // script with the live CHANGELOG.md temporarily swapped out via a
  // sentinel file approach. But the cleanest approach is to re-require
  // the script's exported `notes` function and feed it a CHANGELOG. The
  // file doesn't lend itself to that (notes reads CHANGELOG.md by
  // absolute path) — so we use a subprocess against a fixture tempdir.

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "release-test-"));
  try {
    // Make a fake repo root: copy release.js + write CHANGELOG.md
    fs.mkdirSync(path.join(tmp, "scripts"), { recursive: true });
    const scriptText = fs.readFileSync(RELEASE_SCRIPT, "utf8");
    // release.js computes REPO_ROOT as path.resolve(__dirname, "..") — so
    // dropping it into <tmp>/scripts/release.js makes <tmp> its REPO_ROOT.
    fs.writeFileSync(path.join(tmp, "scripts", "release.js"), scriptText);
    fs.writeFileSync(path.join(tmp, "CHANGELOG.md"), changelogText);
    // package.json is read by `check`, not by `notes`, but write a stub
    // so we don't accidentally break anything.
    fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ version: "0.0.0-test" }));

    return spawnSync("node", [path.join(tmp, "scripts", "release.js"), "notes", ...args], {
      encoding: "utf8",
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const SAMPLE = `# Changelog

---

## [Unreleased]

### Added

- new feature in progress

---

## [0.2.0] — 2026-05-27

Ten priority items shipped.

### Added

- OTel tracing
- Secret scanning

### Changed

- Project renamed

---

## [0.1.0] — 2026-05-26

First tagged release.

### Added

- initial core
`;

test("notes (no arg) extracts the [Unreleased] section", () => {
  const r = runNotes(SAMPLE);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /new feature in progress/);
  assert.doesNotMatch(r.stdout, /OTel tracing/, "must not leak into [0.2.0]");
  assert.doesNotMatch(r.stdout, /initial core/, "must not leak into [0.1.0]");
});

test("notes 0.2.0 extracts the middle [0.2.0] section", () => {
  const r = runNotes(SAMPLE, "0.2.0");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /OTel tracing/);
  assert.match(r.stdout, /Project renamed/);
  assert.doesNotMatch(r.stdout, /new feature in progress/, "must not leak from [Unreleased]");
  assert.doesNotMatch(r.stdout, /initial core/, "must not leak from [0.1.0]");
});

test("notes 0.1.0 extracts the LAST section in the file (no trailing header to anchor to)", () => {
  // Regression: an earlier implementation used a lookahead like (?=^##\s+\[)
  // which never matched when the requested section had no successor.
  // This test pins the line-walk implementation that handles that case.
  const r = runNotes(SAMPLE, "0.1.0");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /First tagged release/);
  assert.match(r.stdout, /initial core/);
  assert.doesNotMatch(r.stdout, /OTel tracing/, "must not leak from [0.2.0]");
});

test("notes <missing-version> exits non-zero with a clear error", () => {
  const r = runNotes(SAMPLE, "9.9.9");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /No \[9\.9\.9\] section/);
});

test("notes extracts a section that immediately follows another with no blank line", () => {
  // Edge case: sections back-to-back. The line-walk must stop at the next
  // `## [` header regardless of preceding whitespace.
  const dense = `# Changelog
## [Unreleased]
- in-flight item
## [0.1.0] — 2026-05-26
- first item
`;
  const r = runNotes(dense, "0.1.0");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /first item/);
  assert.doesNotMatch(r.stdout, /in-flight item/);
});

test("notes preserves blank lines inside the extracted section", () => {
  // The output is fed verbatim into `git tag -a -F` for the annotated tag
  // message. Stripping interior blank lines would mangle the formatting.
  const r = runNotes(SAMPLE, "0.2.0");
  assert.equal(r.status, 0);
  // The body has empty lines between subsections (Added / Changed); make
  // sure at least one of those survives.
  assert.match(r.stdout, /\n\n### Changed/);
});

test("notes trims trailing whitespace and a final --- separator from the section body", () => {
  // notes() calls .trim() on the joined body, so a stray `---` separator
  // immediately before the next header doesn't leak into the output.
  const r = runNotes(SAMPLE, "0.2.0");
  // The fixture has `---\n` between sections; the trim should kill it.
  assert.doesNotMatch(r.stdout, /---\s*$/);
});
