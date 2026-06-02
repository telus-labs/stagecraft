const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { makeTargetProject, seedGate, cleanup, runCLI } = require("./_helpers");

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

  it("stage prints an onboarding preamble + postamble in user-driven mode", () => {
    const cwd = track(makeTargetProject());
    const r = runCLI(["stage", "requirements", "--feature", "test feature"], { cwd });
    assert.equal(r.status, 0);
    // Preamble identifies the stage and explains what to do.
    assert.match(r.stdout, /Stage stage-01 \(requirements\)/);
    assert.match(r.stdout, /devteam does\s*\n\s*NOT call a model/);
    assert.match(r.stdout, /Inside Claude Code/);
    assert.match(r.stdout, /devteam stage requirements --feature "test feature" --headless/);
    // Postamble points to the next concrete action.
    assert.match(r.stdout, /Run `devteam next` to advance the pipeline/);
  });

  it("stage warns when invoked against an un-initialised target directory", () => {
    // A bare tempdir with no .devteam/config.yml — the user's first-run footgun.
    const cwd = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "devteam-no-init-"));
    _dirs.push(cwd);
    const r = runCLI(["stage", "requirements", "--feature", "x"], { cwd });
    // The prompt still renders (the CLI is permissive), but a warning fires.
    assert.match(r.stderr, /does not look like an initialised Stagecraft target project/);
    assert.match(r.stderr, /devteam init --host claude-code/);
  });

  it("stage suppresses the onboarding framing under --headless", () => {
    const cwd = track(makeTargetProject());
    const r = runCLI(
      ["stage", "requirements", "--feature", "x", "--headless"],
      { cwd, env: { ...process.env, DEVTEAM_HEADLESS_COMMAND: "true" } },
    );
    // No preamble / postamble in headless mode — the framing would
    // contaminate any downstream consumer of stdout.
    assert.doesNotMatch(r.stdout, /devteam does\s*\n\s*NOT call a model/);
    assert.doesNotMatch(r.stdout, /Run `devteam next` to advance/);
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

describe("cli: --patch blockers[] fallback", () => {
  it("--patch --from stage-04.qa reads blockers[] when must_address_before_peer_review absent", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-04.qa", {
      stage: "stage-04", workstream: "qa", status: "FAIL",
      blockers: ["express.static path wrong", "Dockerfile CMD wrong"],
    });
    const r = runCLI(["stage", "build", "--patch", "--from", "stage-04.qa"], { cwd });
    assert.match(r.stderr, /2 item\(s\) from stage-04\.qa gate \(blockers\)/);
  });

  it("--patch --from red-team still prefers must_address_before_peer_review over blockers[]", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-04c", {
      stage: "stage-04c", workstream: "red-team", status: "FAIL",
      blockers: ["generic blocker"],
      must_address_before_peer_review: [{ id: "RT-1", severity: "critical", likelihood: "high", summary: "SQL injection" }],
    });
    const r = runCLI(["stage", "build", "--patch", "--from", "red-team"], { cwd });
    assert.match(r.stderr, /1 item\(s\) from red-team gate \(must_address_before_peer_review\)/);
  });

  it("--patch --from a gate with neither field falls back gracefully", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-04.qa", {
      stage: "stage-04", workstream: "qa", status: "FAIL",
      blockers: [],
    });
    const r = runCLI(["stage", "build", "--patch", "--from", "stage-04.qa"], { cwd });
    assert.match(r.stderr, /no patch items in stage-04\.qa\.json — running full build/);
  });
});
