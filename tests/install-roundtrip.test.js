const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { REPO_ROOT, makeTargetProject, cleanup } = require("./_helpers");
const { listHosts, loadAdapter } = require(path.join(REPO_ROOT, "core", "router"));

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
afterEach(() => { _dirs.forEach(cleanup); _dirs = []; });

describe("install round-trip per adapter", () => {
  for (const host of listHosts()) {
    describe(`host: ${host}`, () => {
      it("install lays down files (or no-ops cleanly)", () => {
        const cwd = track(makeTargetProject());
        const adapter = loadAdapter(host);
        const r = adapter.install(cwd);
        assert.ok(Array.isArray(r.written));
        assert.ok(Array.isArray(r.skipped));
        // generic install is a noop (returns empty written) but the call must succeed
        if (host !== "generic") {
          assert.ok(r.written.length > 0, `${host} install wrote nothing`);
        }
      });

      it("install is idempotent (second call skips)", () => {
        const cwd = track(makeTargetProject());
        const adapter = loadAdapter(host);
        const r1 = adapter.install(cwd);
        const r2 = adapter.install(cwd);
        if (host === "generic") {
          // both calls return empty; nothing to assert about skip
          assert.equal(r2.written.length, 0);
        } else {
          assert.equal(r2.written.length, 0, "second install should write nothing");
          assert.equal(r2.skipped.length, r1.written.length, "second install should skip everything from the first");
        }
      });

      it("force overrides idempotency", () => {
        const cwd = track(makeTargetProject());
        const adapter = loadAdapter(host);
        const r1 = adapter.install(cwd);
        const r2 = adapter.install(cwd, { force: true });
        if (host === "generic") return; // nothing to force
        assert.equal(r2.written.length, r1.written.length, "force should overwrite everything");
      });

      it("status after install reports ok", () => {
        const cwd = track(makeTargetProject());
        const adapter = loadAdapter(host);
        adapter.install(cwd);
        const s = adapter.status(cwd);
        assert.equal(s.ok, true, `${host} status not ok: missing=${s.missing.join(", ")}`);
      });

      it("markdown hosts install artifact templates under .devteam/templates", () => {
        const cwd = track(makeTargetProject());
        const adapter = loadAdapter(host);
        if (adapter.capabilities.skillFormat !== "markdown") return;

        adapter.install(cwd);
        const templatePath = path.join(cwd, ".devteam", "templates", "brief-template.md");
        assert.ok(fs.existsSync(templatePath), `${host} did not install brief-template.md`);

        fs.unlinkSync(templatePath);
        const status = adapter.status(cwd);
        assert.equal(status.ok, false, `${host} status should notice missing installed template`);
        assert.ok(
          status.missing.includes(templatePath),
          `${host} status missing list did not include ${templatePath}`,
        );
      });

      it("uninstall removes the install payload", () => {
        const cwd = track(makeTargetProject());
        const adapter = loadAdapter(host);
        adapter.install(cwd);
        adapter.uninstall(cwd);
        // After uninstall, status should report missing (except for generic which installs nothing)
        const s = adapter.status(cwd);
        if (host === "generic") {
          assert.equal(s.ok, true); // still ok because nothing was supposed to be there
        } else {
          assert.equal(s.ok, false, `${host} status still ok after uninstall`);
          assert.ok(s.missing.length > 0);
        }
      });
    });
  }
});
