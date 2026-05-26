const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { REPO_ROOT, makeTargetProject, cleanup } = require("./_helpers");
const { loadConfig, resolveHost, renderDefaultConfig, writeConfigIfAbsent, DEFAULTS } =
  require(path.join(REPO_ROOT, "core", "config"));

let _tmpDirs = [];
function track(cwd) { _tmpDirs.push(cwd); return cwd; }
afterEach(() => { _tmpDirs.forEach(cleanup); _tmpDirs = []; });

describe("config: loadConfig", () => {
  it("returns DEFAULTS when no file exists", () => {
    const cwd = track(makeTargetProject({ config: false }));
    const c = loadConfig(cwd);
    assert.equal(c._source, "defaults");
    assert.equal(c.routing.default_host, DEFAULTS.routing.default_host);
  });

  it("parses a valid config", () => {
    const cwd = track(makeTargetProject({
      config: "routing:\n  default_host: claude-code\n  roles:\n    backend: codex\npipeline:\n  default_track: hotfix\n",
    }));
    const c = loadConfig(cwd);
    assert.equal(c._source, "file");
    assert.equal(c.routing.default_host, "claude-code");
    assert.equal(c.routing.roles.backend, "codex");
    assert.equal(c.pipeline.default_track, "hotfix");
  });

  it("fills in defaults for missing fields", () => {
    const cwd = track(makeTargetProject({
      config: "routing:\n  default_host: codex\n",
    }));
    const c = loadConfig(cwd);
    assert.equal(c.pipeline.default_track, "full"); // default
    assert.deepEqual(c.routing.roles, {}); // default
  });
});

describe("config: resolveHost precedence", () => {
  const cfg = {
    routing: {
      default_host: "generic",
      roles: { backend: "codex", qa: "claude-code" },
      stages: { "stage-08": "claude-code" },
    },
  };

  it("default_host wins when nothing else matches", () => {
    assert.equal(resolveHost(cfg, "stage-01", "pm"), "generic");
  });

  it("role override beats default", () => {
    assert.equal(resolveHost(cfg, "stage-04", "backend"), "codex");
    assert.equal(resolveHost(cfg, "stage-06", "qa"), "claude-code");
  });

  it("stage override beats role override", () => {
    // stage-08 is in stages override; even if role were matched, stage wins
    assert.equal(resolveHost(cfg, "stage-08", "platform"), "claude-code");
    assert.equal(resolveHost(cfg, "stage-08", "backend"), "claude-code");
  });
});

describe("config: renderDefaultConfig + writeConfigIfAbsent", () => {
  it("renders parseable YAML for single host", () => {
    const text = renderDefaultConfig(["claude-code"]);
    assert.match(text, /default_host: claude-code/);
    assert.match(text, /default_track: full/);
  });

  it("renders multi-host hints", () => {
    const text = renderDefaultConfig(["claude-code", "codex"]);
    assert.match(text, /default_host: claude-code/);
    assert.match(text, /multi-host/);
    assert.match(text, /codex/);
  });

  it("throws on empty host list", () => {
    assert.throws(() => renderDefaultConfig([]));
  });

  it("writeConfigIfAbsent is idempotent without --force", () => {
    const cwd = track(makeTargetProject({ config: false }));
    const r1 = writeConfigIfAbsent(cwd, ["claude-code"]);
    assert.equal(r1.written, true);
    const r2 = writeConfigIfAbsent(cwd, ["claude-code"]);
    assert.equal(r2.written, false);
    assert.equal(r2.reason, "exists");
  });

  it("writeConfigIfAbsent --force overrides", () => {
    const cwd = track(makeTargetProject({ config: false }));
    writeConfigIfAbsent(cwd, ["claude-code"]);
    const r2 = writeConfigIfAbsent(cwd, ["codex"], { force: true });
    assert.equal(r2.written, true);
    const content = fs.readFileSync(r2.path, "utf8");
    assert.match(content, /default_host: codex/);
  });
});
