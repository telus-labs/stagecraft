const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeTargetProject, cleanup, runCLI } = require("./_helpers");

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
afterEach(() => { _dirs.forEach(cleanup); _dirs = []; });

describe("cli: help + listing", () => {
  it("help exits 0 and lists subcommands", () => {
    const r = runCLI(["help"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /init/);
    assert.match(r.stdout, /stage/);
    assert.match(r.stdout, /next/);
    assert.match(r.stdout, /merge/);
    assert.match(r.stdout, /summary/);
    assert.match(r.stdout, /doctor/);
  });

  it("stages lists known stage names", () => {
    const r = runCLI(["stages"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /requirements/);
    assert.match(r.stdout, /security-review/);
    assert.match(r.stdout, /retrospective/);
  });

  it("hosts lists adapters", () => {
    const r = runCLI(["hosts"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /claude-code/);
    assert.match(r.stdout, /codex/);
    assert.match(r.stdout, /generic/);
  });

  it("unknown command exits 2", () => {
    const r = runCLI(["bogus-command"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Unknown command/);
  });
});

describe("cli: init", () => {
  it("init without --host exits 2 with usage", () => {
    const cwd = track(makeTargetProject({ config: false }));
    const r = runCLI(["init"], { cwd });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--host/);
  });

  it("init --host bogus exits 2", () => {
    const cwd = track(makeTargetProject({ config: false }));
    const r = runCLI(["init", "--host", "bogus"], { cwd });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Unknown host/);
  });

  it("init --host generic creates config + workspace", () => {
    const cwd = track(makeTargetProject({ config: false, gates: false }));
    const r = runCLI(["init", "--host", "generic"], { cwd });
    assert.equal(r.status, 0);
    assert.ok(fs.existsSync(path.join(cwd, ".devteam", "config.yml")));
    assert.ok(fs.existsSync(path.join(cwd, "pipeline", "gates")));
  });
});

describe("cli: stage", () => {
  it("stage without name exits 2", () => {
    const cwd = track(makeTargetProject());
    const r = runCLI(["stage"], { cwd });
    assert.equal(r.status, 2);
  });

  it("stage <known> renders prompt to stdout", () => {
    const cwd = track(makeTargetProject());
    const r = runCLI(["stage", "requirements", "--feature", "test feature"], { cwd });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /workstream: pm/);
    assert.match(r.stdout, /test feature/);
  });
});

describe("cli: stoplist guard", () => {
  it("nano + stoplist-matching feature exits 2", () => {
    const cwd = track(makeTargetProject({
      config: "routing:\n  default_host: generic\npipeline:\n  default_track: nano\n",
    }));
    const r = runCLI(["stage", "build", "--feature", "add auth middleware"], { cwd });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /stoplist/i);
  });

  it("nano + --force bypasses stoplist", () => {
    const cwd = track(makeTargetProject({
      config: "routing:\n  default_host: generic\npipeline:\n  default_track: nano\n",
    }));
    const r = runCLI(["stage", "build", "--feature", "add auth", "--force"], { cwd });
    assert.equal(r.status, 0);
  });

  it("full track is exempt from stoplist", () => {
    const cwd = track(makeTargetProject({
      config: "routing:\n  default_host: generic\npipeline:\n  default_track: full\n",
    }));
    const r = runCLI(["stage", "requirements", "--feature", "add auth"], { cwd });
    assert.equal(r.status, 0);
  });
});

describe("cli: next + summary --json", () => {
  it("next --json returns parseable JSON", () => {
    const cwd = track(makeTargetProject());
    const r = runCLI(["next", "--json"], { cwd });
    assert.equal(r.status, 0);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.action, "run-stage");
  });

  it("summary --json returns parseable JSON with rows", () => {
    const cwd = track(makeTargetProject());
    const r = runCLI(["summary", "--json"], { cwd });
    assert.equal(r.status, 0);
    const parsed = JSON.parse(r.stdout);
    assert.ok(Array.isArray(parsed.rows));
    assert.ok(parsed.rows.length > 0);
  });
});

describe("cli: doctor", () => {
  it("doctor on uninitialized dir exits 1", () => {
    const cwd = track(makeTargetProject({ config: false, gates: false }));
    const r = runCLI(["doctor"], { cwd });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /critical failure/);
  });

  it("doctor on initialized dir exits 0", () => {
    const cwd = track(makeTargetProject({ config: false, gates: false }));
    runCLI(["init", "--host", "generic"], { cwd });
    const r = runCLI(["doctor"], { cwd });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /everything looks good|warning/);
  });
});
