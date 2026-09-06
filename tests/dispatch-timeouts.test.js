// pipeline.dispatch_timeout_ms / pipeline.dispatch_timeouts — per-dispatch
// wall-clock caps in config, so an operator whose peer review needs 14 minutes
// against the 10-minute default does not have to pass --timeout-ms on every run.

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { REPO_ROOT, makeTargetProject, cleanup } = require("./_helpers");
const { loadConfig, clearConfigCache, resolveDispatchTimeoutMs, DEFAULTS, renderDefaultConfig } = require(path.join(REPO_ROOT, "core", "config"));
const { getStage } = require(path.join(REPO_ROOT, "core", "pipeline", "stages"));

let dirs = [];
function track(cwd) { dirs.push(cwd); return cwd; }
afterEach(() => { dirs.forEach(cleanup); dirs = []; clearConfigCache?.(); });

describe("config: dispatch timeouts", () => {
  it("defaults to null / {} so headless keeps its 10-minute default", () => {
    const cwd = track(makeTargetProject({ config: "routing:\n  default_host: generic\n" }));
    const c = loadConfig(cwd);
    assert.equal(c.pipeline.dispatch_timeout_ms, null);
    assert.deepEqual(c.pipeline.dispatch_timeouts, {});
    assert.equal(DEFAULTS.pipeline.dispatch_timeout_ms, null);
  });

  it("parses the run-wide default and per-stage entries; drops junk", () => {
    const cwd = track(makeTargetProject({
      config: "pipeline:\n  dispatch_timeout_ms: 900000\n  dispatch_timeouts:\n    peer-review: 1200000\n    stage-04c: 0\n    red-team: fast\n    qa: -5\n",
    }));
    const c = loadConfig(cwd);
    assert.equal(c.pipeline.dispatch_timeout_ms, 900000);
    assert.deepEqual(c.pipeline.dispatch_timeouts, { "peer-review": 1200000, "stage-04c": 0 });
  });

  it("ignores a non-integer run-wide value", () => {
    const cwd = track(makeTargetProject({ config: "pipeline:\n  dispatch_timeout_ms: soon\n" }));
    assert.equal(loadConfig(cwd).pipeline.dispatch_timeout_ms, null);
  });

  it("the rendered default config documents the keys", () => {
    const text = renderDefaultConfig();
    assert.match(text, /# dispatch_timeout_ms: 600000/);
    assert.match(text, /# dispatch_timeouts:/);
  });
});

describe("resolveDispatchTimeoutMs precedence", () => {
  const review = getStage("peer-review");
  const build = getStage("build");
  const config = { pipeline: { dispatch_timeout_ms: 900000, dispatch_timeouts: { "peer-review": 1200000, "stage-04": 300000 } } };

  it("--timeout-ms wins over everything", () => {
    assert.equal(resolveDispatchTimeoutMs(60000, config, review, "peer-review"), 60000);
    assert.equal(resolveDispatchTimeoutMs(0, config, review, "peer-review"), 0, "0 is an explicit no-cap, not absence");
  });

  it("per-stage by name, then by id, then run-wide", () => {
    assert.equal(resolveDispatchTimeoutMs(undefined, config, review, "peer-review"), 1200000);
    assert.equal(resolveDispatchTimeoutMs(undefined, config, build, "build"), 300000, "no name entry → id entry");
    assert.equal(resolveDispatchTimeoutMs(undefined, config, getStage("qa"), "qa"), 900000, "neither → run-wide");
  });

  it("undefined when nothing is configured, so headless applies its default", () => {
    assert.equal(resolveDispatchTimeoutMs(undefined, { pipeline: { dispatch_timeout_ms: null, dispatch_timeouts: {} } }, review, "peer-review"), undefined);
    assert.equal(resolveDispatchTimeoutMs(undefined, {}, review, "peer-review"), undefined);
    assert.equal(resolveDispatchTimeoutMs(undefined, null, null, undefined), undefined);
  });
});
