const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeTargetProject, cleanup, runCLI } = require("./_helpers");

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
test.afterEach?.(() => { _dirs.forEach(cleanup); _dirs = []; });

function read(cwd, relPath) {
  return fs.readFileSync(path.join(cwd, relPath), "utf8");
}

function writeAgent(cwd, source) {
  const file = path.join(cwd, "agent.js");
  fs.writeFileSync(file, source);
  return file;
}

test("devteam prototype start creates a pre-SDLC prototype packet", () => {
  const cwd = track(makeTargetProject());
  const r = runCLI([
    "prototype", "start", "dashboard concept",
    "--feature", "Try a dense dashboard for pipeline liveness.",
  ], { cwd });

  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Created prototype packet/);

  const base = path.join(cwd, "pipeline", "prototypes", "dashboard-concept");
  for (const file of ["prototype.json", "intent.md", "build-prompt.md", "feedback.md", "promotion.md"]) {
    assert.ok(fs.existsSync(path.join(base, file)), `${file} should exist`);
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(base, "prototype.json"), "utf8"));
  assert.equal(manifest.id, "dashboard-concept");
  assert.equal(manifest.status, "prototype");
  assert.match(read(cwd, "pipeline/prototypes/dashboard-concept/intent.md"), /dense dashboard/);
  assert.match(read(cwd, "pipeline/prototypes/dashboard-concept/build-prompt.md"), /not production readiness/i);
});

test("devteam prototype start refuses to overwrite unless --force is passed", () => {
  const cwd = track(makeTargetProject());
  const first = runCLI(["prototype", "start", "demo"], { cwd });
  assert.equal(first.status, 0, first.stderr);

  const second = runCLI(["prototype", "start", "demo"], { cwd });
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /already exists/);

  const forced = runCLI(["prototype", "start", "demo", "--force"], { cwd });
  assert.equal(forced.status, 0, forced.stderr);
});

test("devteam prototype note appends timestamped feedback", () => {
  const cwd = track(makeTargetProject());
  assert.equal(runCLI(["prototype", "start", "flow sketch"], { cwd }).status, 0);

  const r = runCLI([
    "prototype", "note", "flow-sketch",
    "--feedback", "Users found the review step too hidden.",
  ], { cwd });

  assert.equal(r.status, 0, r.stderr);
  const feedback = read(cwd, "pipeline/prototypes/flow-sketch/feedback.md");
  assert.match(feedback, /Users found the review step too hidden/);
  assert.match(feedback, /## 20\d\d-/);
});

test("devteam prototype promote writes a normal-track handoff command", () => {
  const cwd = track(makeTargetProject());
  assert.equal(runCLI(["prototype", "start", "handoff demo"], { cwd }).status, 0);

  const r = runCLI(["prototype", "promote", "handoff-demo", "--track", "quick"], { cwd });

  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /devteam run --feature-file pipeline\/prototypes\/handoff-demo\/promotion\.md --track quick/);

  const promotion = read(cwd, "pipeline/prototypes/handoff-demo/promotion.md");
  assert.match(promotion, /## Promotion Command/);
  assert.match(promotion, /--track quick/);

  const manifest = JSON.parse(read(cwd, "pipeline/prototypes/handoff-demo/prototype.json"));
  assert.equal(manifest.status, "promotion-ready");
  assert.equal(manifest.promotion_track, "quick");
});

test("devteam prototype start and promote support JSON output", () => {
  const cwd = track(makeTargetProject());
  const start = runCLI(["prototype", "start", "json demo", "--json"], { cwd });
  assert.equal(start.status, 0, start.stderr);
  const payload = JSON.parse(start.stdout);
  assert.equal(payload.id, "json-demo");
  assert.ok(payload.files.includes("pipeline/prototypes/json-demo/promotion.md"));

  const promote = runCLI(["prototype", "promote", "json-demo", "--json"], { cwd });
  assert.equal(promote.status, 0, promote.stderr);
  const promoted = JSON.parse(promote.stdout);
  assert.equal(promoted.track, "full");
  assert.match(promoted.command, /--track full/);
});

test("devteam prototype build runs in the packet workspace by default", () => {
  const cwd = track(makeTargetProject({
    config: "routing:\n  default_host: codex\npipeline:\n  default_track: full\n",
  }));
  assert.equal(runCLI(["prototype", "start", "runner demo"], { cwd }).status, 0);
  const agent = writeAgent(cwd, `
const fs = require("node:fs");
const path = require("node:path");
const prompt = fs.readFileSync(0, "utf8");
fs.writeFileSync("index.html", "<h1>prototype</h1>\\n");
fs.appendFileSync(path.join("..", "promotion.md"), "\\n## Demo Command\\n\\nopen workspace/index.html\\n");
if (!prompt.includes("not gate evidence")) process.exit(7);
`);

  const r = runCLI(["prototype", "build", "runner-demo", "--json"], {
    cwd,
    env: { DEVTEAM_HEADLESS_COMMAND: `"${process.execPath}" "${agent}"` },
  });

  assert.equal(r.status, 0, r.stderr);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.status, "built");
  assert.equal(payload.host, "codex");
  assert.equal(payload.workspace, "pipeline/prototypes/runner-demo/workspace");
  assert.equal(payload.apply_to_project, false);
  assert.ok(fs.existsSync(path.join(cwd, "pipeline/prototypes/runner-demo/workspace/index.html")));
  assert.ok(!fs.existsSync(path.join(cwd, "index.html")), "default build should not write project root");

  const manifest = JSON.parse(read(cwd, "pipeline/prototypes/runner-demo/prototype.json"));
  assert.equal(manifest.status, "prototype-built");
  assert.equal(manifest.last_build.workspace, "pipeline/prototypes/runner-demo/workspace");
  assert.equal(manifest.last_build.apply_to_project, false);
  assert.equal(manifest.builds.length, 1);
});

test("devteam prototype build refuses a non-headless host", () => {
  const cwd = track(makeTargetProject());
  assert.equal(runCLI(["prototype", "start", "manual demo"], { cwd }).status, 0);

  const r = runCLI(["prototype", "build", "manual-demo"], { cwd });

  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /cannot run prototype builds headlessly/);
});

test("devteam prototype build --apply-to-project runs from the project root", () => {
  const cwd = track(makeTargetProject({
    config: "routing:\n  default_host: codex\npipeline:\n  default_track: full\n",
  }));
  assert.equal(runCLI(["prototype", "start", "apply demo"], { cwd }).status, 0);
  const agent = writeAgent(cwd, `
const fs = require("node:fs");
fs.writeFileSync("prototype-output.txt", "project-root\\n");
`);

  const r = runCLI(["prototype", "build", "apply-demo", "--apply-to-project", "--json"], {
    cwd,
    env: { DEVTEAM_HEADLESS_COMMAND: `"${process.execPath}" "${agent}"` },
  });

  assert.equal(r.status, 0, r.stderr);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.workspace, ".");
  assert.equal(payload.apply_to_project, true);
  assert.ok(fs.existsSync(path.join(cwd, "prototype-output.txt")));

  const manifest = JSON.parse(read(cwd, "pipeline/prototypes/apply-demo/prototype.json"));
  assert.equal(manifest.last_build.apply_to_project, true);
});

test("devteam prototype promote rejects unknown tracks", () => {
  const cwd = track(makeTargetProject());
  assert.equal(runCLI(["prototype", "start", "bad track"], { cwd }).status, 0);

  const r = runCLI(["prototype", "promote", "bad-track", "--track", "prototype"], { cwd });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown promotion track/);
});
