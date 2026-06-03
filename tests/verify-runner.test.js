const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runCommand, discoverScripts, resolveCommands } = require("../core/verify/runner");

let _dirs = [];
function tmpdir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "devteam-test-verify-"));
  _dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of _dirs) try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* test cleanup; ignore */ }
  _dirs = [];
});

function writeScript(d, name, code) {
  const file = path.join(d, name);
  fs.writeFileSync(file, code);
  return file;
}

describe("verify/runner: runCommand", () => {
  it("captures stdout and exit 0 from a passing command", async () => {
    const d = tmpdir();
    const f = writeScript(d, "ok.js", "console.log('ok')");
    const r = await runCommand(`node ${f}`);
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /ok/);
    assert.ok(r.durationMs >= 0);
    assert.equal(r.timedOut, false);
  });

  it("captures non-zero exit codes", async () => {
    const d = tmpdir();
    const f = writeScript(d, "exit7.js", "process.exit(7)");
    const r = await runCommand(`node ${f}`);
    assert.equal(r.exitCode, 7);
  });

  it("captures stderr from a failing command", async () => {
    const d = tmpdir();
    const f = writeScript(d, "fail.js", "console.error('bad'); process.exit(1)");
    const r = await runCommand(`node ${f}`);
    assert.equal(r.exitCode, 1);
    assert.match(r.stderr, /bad/);
  });

  it("returns spawnError on a missing binary, not throwing", async () => {
    const r = await runCommand("this-binary-does-not-exist-anywhere-12345");
    assert.equal(r.exitCode, null);
    assert.ok(r.spawnError);
  });

  it("times out a hung process", async () => {
    const d = tmpdir();
    const f = writeScript(d, "hang.js", "setInterval(()=>{},1000)");
    const r = await runCommand(`node ${f}`, { timeoutMs: 200 });
    assert.equal(r.timedOut, true);
    assert.ok(r.durationMs < 4000, `expected fast timeout, got ${r.durationMs}ms`);
  });

  it("uses shell when command contains shell operators", async () => {
    // `&&` requires shell:true; this verifies the shell branch fires.
    const d = tmpdir();
    const a = writeScript(d, "a.js", "console.log(1)");
    const b = writeScript(d, "b.js", "console.log(2)");
    const r = await runCommand(`node ${a} && node ${b}`);
    assert.equal(r.exitCode, 0);
    assert.match(r.stdout, /1/);
    assert.match(r.stdout, /2/);
  });
});

describe("verify/runner: discoverScripts", () => {
  it("returns null/null when no package.json", () => {
    const d = tmpdir();
    assert.deepEqual(discoverScripts(d), { lint: null, test: null });
  });

  it("reads scripts.lint and scripts.test from package.json", () => {
    const d = tmpdir();
    fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({
      scripts: { lint: "eslint .", test: "jest" },
    }));
    const r = discoverScripts(d);
    assert.equal(r.lint, "npm run lint");
    assert.equal(r.test, "npm test");
  });

  it("returns null for missing scripts", () => {
    const d = tmpdir();
    fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({
      scripts: { build: "tsc" },
    }));
    assert.deepEqual(discoverScripts(d), { lint: null, test: null });
  });

  it("returns null/null on malformed package.json (doesn't throw)", () => {
    const d = tmpdir();
    fs.writeFileSync(path.join(d, "package.json"), "{ not json");
    assert.deepEqual(discoverScripts(d), { lint: null, test: null });
  });
});

describe("verify/runner: resolveCommands", () => {
  it("config wins over package.json discovery", () => {
    const d = tmpdir();
    fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({
      scripts: { lint: "eslint .", test: "jest" },
    }));
    const r = resolveCommands(d, {
      pipeline: { verify: { lint_command: "custom-lint --strict", test_command: "pytest" } },
    });
    assert.equal(r.lint, "custom-lint --strict");
    assert.equal(r.test, "pytest");
  });

  it("falls back to package.json when config is absent", () => {
    const d = tmpdir();
    fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({
      scripts: { lint: "eslint .", test: "jest" },
    }));
    const r = resolveCommands(d, {});
    assert.equal(r.lint, "npm run lint");
    assert.equal(r.test, "npm test");
  });

  it("config null explicitly disables (different from omitted)", () => {
    const d = tmpdir();
    fs.writeFileSync(path.join(d, "package.json"), JSON.stringify({
      scripts: { lint: "eslint .", test: "jest" },
    }));
    const r = resolveCommands(d, {
      pipeline: { verify: { lint_command: null } },
    });
    assert.equal(r.lint, null, "explicit null = skip lint");
    assert.equal(r.test, "npm test", "test still falls back");
  });

  it("returns null when neither config nor package.json provides", () => {
    const d = tmpdir();
    const r = resolveCommands(d, {});
    assert.deepEqual(r, { lint: null, test: null });
  });
});
