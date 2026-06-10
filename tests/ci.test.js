// F4 — CI runner integration tests.
//
// The actual workflow runs in GitHub Actions (we can't exercise that
// here), so these tests focus on:
//   - The template file exists at the expected path with the expected
//     YAML structure (jobs, steps, env vars, permissions).
//   - `devteam ci install` writes the template into the target project's
//     .github/workflows/ correctly.
//   - --force overwrites; absent --force on a pre-existing file errors.
//   - --out lets the user redirect (test only — production use is rare).
//   - `devteam ci show` prints the template.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeTargetProject, cleanup, runCLI } = require("./_helpers");

const REPO_ROOT = path.resolve(__dirname, "..");
const TEMPLATE = path.join(REPO_ROOT, "templates", "ci", "github-actions", "stagecraft-pr-checks.yml");

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
test.afterEach?.(() => { _dirs.forEach(cleanup); _dirs = []; });

test("the workflow template file exists at the canonical path", () => {
  assert.ok(fs.existsSync(TEMPLATE), `template missing at ${TEMPLATE}`);
});

test("the workflow template declares the expected shape (name, on, jobs, steps)", () => {
  const text = fs.readFileSync(TEMPLATE, "utf8");
  // Light YAML-ish assertions; full YAML parsing would need js-yaml just
  // for the test, and the schema is stable enough that string matches
  // are honest.
  assert.match(text, /^name:\s+stagecraft pr-checks/m);
  assert.match(text, /^on:\s*$/m);
  assert.match(text, /^\s*pull_request:/m);
  assert.match(text, /^jobs:\s*$/m);
  assert.match(text, /^\s*validate-and-publish:/m);
  // Critical permissions for posting check runs:
  assert.match(text, /^\s*checks:\s+write/m);
  // Invokes Stagecraft's own validator + pr-publish:
  assert.match(text, /node \.stagecraft\/core\/gates\/validator\.js/);
  assert.match(text, /node \.stagecraft\/scripts\/pr-publish\.js/);
  // C4 drift check:
  assert.match(text, /node \.stagecraft\/bin\/devteam reproduce/);
  // C6 tamper-evident chain check:
  assert.match(text, /node \.stagecraft\/bin\/devteam verify-chain/);
});

test("the template pins specific action versions (v5 — Node 24 action runtime)", () => {
  const text = fs.readFileSync(TEMPLATE, "utf8");
  assert.match(text, /actions\/checkout@v5/);
  assert.match(text, /actions\/setup-node@v5/);
  // No bare-version usage (e.g. @main or @latest):
  assert.doesNotMatch(text, /actions\/(checkout|setup-node)@(main|latest)/);
});

test("the template carries explanatory comments about why it doesn't run the pipeline in CI", () => {
  const text = fs.readFileSync(TEMPLATE, "utf8");
  assert.match(text, /does NOT run the pipeline itself in CI/i);
  // Customization hints surfaced at the top.
  assert.match(text, /STAGECRAFT_REPO/);
  assert.match(text, /STAGECRAFT_REF/);
});

// CLI surface --------------------------------------------------------------

test("`devteam ci install` (no flags) drops the workflow file into .github/workflows/", () => {
  const cwd = track(makeTargetProject());
  const r = runCLI(["ci", "install"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  const expected = path.join(cwd, ".github", "workflows", "stagecraft-pr-checks.yml");
  assert.ok(fs.existsSync(expected), "workflow file was not written");
  // Body matches the template.
  assert.equal(
    fs.readFileSync(expected, "utf8"),
    fs.readFileSync(TEMPLATE, "utf8"),
  );
  // Next-steps hint shown to the user.
  assert.match(r.stdout, /Next steps:/);
  assert.match(r.stdout, /STAGECRAFT_REPO/);
});

test("`devteam ci install` refuses to overwrite without --force", () => {
  const cwd = track(makeTargetProject());
  const first = runCLI(["ci", "install"], { cwd });
  assert.equal(first.status, 0);
  const second = runCLI(["ci", "install"], { cwd });
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /already exists/);
  assert.match(second.stderr, /--force/);
});

test("`devteam ci install --force` overwrites an existing file", () => {
  const cwd = track(makeTargetProject());
  const target = path.join(cwd, ".github", "workflows", "stagecraft-pr-checks.yml");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "name: not-stagecraft\n");
  const r = runCLI(["ci", "install", "--force"], { cwd });
  assert.equal(r.status, 0);
  assert.match(fs.readFileSync(target, "utf8"), /stagecraft pr-checks/);
});

test("`devteam ci install --out <dir>` redirects the output path", () => {
  const cwd = track(makeTargetProject());
  const out = path.join(cwd, "ci-templates");
  const r = runCLI(["ci", "install", "--out", out], { cwd });
  assert.equal(r.status, 0);
  assert.ok(fs.existsSync(path.join(out, "stagecraft-pr-checks.yml")));
});

test("`devteam ci install --ci <unknown>` errors with the supported list", () => {
  const cwd = track(makeTargetProject());
  const r = runCLI(["ci", "install", "--ci", "circle-ci"], { cwd });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /github-actions/);
});

test("`devteam ci show` prints the template to stdout", () => {
  const r = runCLI(["ci", "show"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /name: stagecraft pr-checks/);
  assert.match(r.stdout, /checks: write/);
});

test("`devteam ci` with no subcommand prints usage", () => {
  const r = runCLI(["ci"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /devteam ci install/);
  assert.match(r.stderr, /devteam ci show/);
});

test("`devteam ci foo` (unknown sub) prints usage", () => {
  const r = runCLI(["ci", "foo"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Unknown ci subcommand/);
});
