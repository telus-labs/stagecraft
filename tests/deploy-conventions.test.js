"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { REPO_ROOT, cleanup } = require("./_helpers");
const { seedDeployContext } = require(path.join(REPO_ROOT, "core", "driver"));

let _dirs = [];
function track(d) { _dirs.push(d); return d; }
afterEach(() => { _dirs.forEach(cleanup); _dirs = []; });

function makeFrameworkRoot(adapterName, conventionsContent) {
  const fwRoot = track(fs.mkdtempSync(path.join(os.tmpdir(), "devteam-test-")));
  const deployDir = path.join(fwRoot, "core", "deploy");
  fs.mkdirSync(deployDir, { recursive: true });
  if (adapterName) {
    fs.writeFileSync(path.join(deployDir, `${adapterName}.conventions.md`), conventionsContent || `# ${adapterName} conventions\nTest content.`);
  }
  return fwRoot;
}

describe("seedDeployContext", () => {
  it("returns false when config.deploy is absent", () => {
    const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), "devteam-test-")));
    const result = seedDeployContext(cwd, { deploy: null }, null);
    assert.equal(result, false);
  });

  it("returns false when adapter is set but no conventions file exists", () => {
    const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), "devteam-test-")));
    const fwRoot = makeFrameworkRoot(null); // no conventions file
    const result = seedDeployContext(cwd, { deploy: { adapter: "gizmos" } }, null, { frameworkRoot: fwRoot });
    assert.equal(result, false);
  });

  it("returns true and writes delimited block to pipeline/context.md", () => {
    const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), "devteam-test-")));
    const fwRoot = makeFrameworkRoot("test-adapter", "# Test adapter\nSome constraints.");
    fs.mkdirSync(path.join(cwd, "pipeline"), { recursive: true });

    const result = seedDeployContext(cwd, { deploy: { adapter: "test-adapter" } }, null, { frameworkRoot: fwRoot });

    assert.equal(result, true);
    const ctx = fs.readFileSync(path.join(cwd, "pipeline", "context.md"), "utf8");
    assert.ok(ctx.includes("<!-- devteam:deploy-target:begin -->"));
    assert.ok(ctx.includes("<!-- devteam:deploy-target:end -->"));
    assert.ok(ctx.includes("# Test adapter"));
    assert.ok(ctx.includes("Some constraints."));
  });

  it("is idempotent — calling twice does not duplicate the block", () => {
    const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), "devteam-test-")));
    const fwRoot = makeFrameworkRoot("test-adapter");
    fs.mkdirSync(path.join(cwd, "pipeline"), { recursive: true });
    const config = { deploy: { adapter: "test-adapter" } };

    seedDeployContext(cwd, config, null, { frameworkRoot: fwRoot });
    seedDeployContext(cwd, config, null, { frameworkRoot: fwRoot });

    const ctx = fs.readFileSync(path.join(cwd, "pipeline", "context.md"), "utf8");
    const beginCount = (ctx.match(/<!-- devteam:deploy-target:begin -->/g) || []).length;
    assert.equal(beginCount, 1, "begin marker must appear exactly once");
  });

  it("updates block when conventions file changes between calls", () => {
    const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), "devteam-test-")));
    const fwRoot = makeFrameworkRoot("test-adapter", "# Version 1");
    fs.mkdirSync(path.join(cwd, "pipeline"), { recursive: true });
    const config = { deploy: { adapter: "test-adapter" } };

    seedDeployContext(cwd, config, null, { frameworkRoot: fwRoot });
    // Overwrite the conventions file
    fs.writeFileSync(path.join(fwRoot, "core", "deploy", "test-adapter.conventions.md"), "# Version 2");
    seedDeployContext(cwd, config, null, { frameworkRoot: fwRoot });

    const ctx = fs.readFileSync(path.join(cwd, "pipeline", "context.md"), "utf8");
    assert.ok(ctx.includes("# Version 2"), "updated content must appear");
    assert.ok(!ctx.includes("# Version 1"), "stale content must be replaced");
  });

  it("creates pipeline/ directory if it does not exist yet", () => {
    const cwd = track(fs.mkdtempSync(path.join(os.tmpdir(), "devteam-test-")));
    const fwRoot = makeFrameworkRoot("test-adapter");
    // Do NOT create pipeline/ — seedDeployContext must create it

    const result = seedDeployContext(cwd, { deploy: { adapter: "test-adapter" } }, null, { frameworkRoot: fwRoot });

    assert.equal(result, true);
    assert.ok(fs.existsSync(path.join(cwd, "pipeline", "context.md")));
  });
});
