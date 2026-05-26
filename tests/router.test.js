const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { REPO_ROOT } = require("./_helpers");
const { listHosts, loadAdapter, resolveAdapter } = require(path.join(REPO_ROOT, "core", "router"));

describe("router: listHosts", () => {
  it("includes claude-code, codex, generic", () => {
    const hosts = listHosts();
    assert.ok(hosts.includes("claude-code"));
    assert.ok(hosts.includes("codex"));
    assert.ok(hosts.includes("generic"));
  });
});

describe("router: loadAdapter", () => {
  it("loads a known adapter", () => {
    const a = loadAdapter("generic");
    assert.equal(typeof a.install, "function");
    assert.equal(typeof a.renderStagePrompt, "function");
    assert.ok(a.capabilities);
  });

  it("throws a helpful error for an unknown adapter", () => {
    assert.throws(() => loadAdapter("nope"), /No adapter found for host "nope"/);
  });
});

describe("router: resolveAdapter", () => {
  const cfg = {
    routing: {
      default_host: "generic",
      roles: { backend: "codex" },
      stages: { "stage-08": "claude-code" },
    },
  };

  it("respects stage > role > default precedence", () => {
    const a = resolveAdapter(cfg, "stage-04", "backend");
    assert.equal(a.hostName, "codex");
    const b = resolveAdapter(cfg, "stage-08", "platform");
    assert.equal(b.hostName, "claude-code");
    const c = resolveAdapter(cfg, "stage-01", "pm");
    assert.equal(c.hostName, "generic");
  });

  it("throws when the resolved adapter doesn't exist", () => {
    const broken = { routing: { default_host: "imaginary-host", roles: {}, stages: {} } };
    assert.throws(() => resolveAdapter(broken, "stage-01", "pm"), /No adapter found/);
  });
});
