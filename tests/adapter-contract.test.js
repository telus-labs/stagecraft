const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { REPO_ROOT } = require("./_helpers");
const { listHosts, loadAdapter } = require(path.join(REPO_ROOT, "core", "router"));

const REQUIRED_METHODS = ["install", "renderStagePrompt", "status", "uninstall"];

describe("adapter contract", () => {
  for (const host of listHosts()) {
    describe(`host: ${host}`, () => {
      const adapter = loadAdapter(host);

      it("exports capabilities object", () => {
        assert.ok(adapter.capabilities, `${host}: missing capabilities`);
        assert.equal(adapter.capabilities.name, host);
      });

      it("declares enforces map", () => {
        assert.ok(adapter.capabilities.enforces, `${host}: missing enforces`);
      });

      for (const m of REQUIRED_METHODS) {
        it(`exports ${m}() function`, () => {
          assert.equal(typeof adapter[m], "function", `${host}: missing ${m}`);
        });
      }

      it("if headless is true, exports invoke()", () => {
        if (adapter.capabilities.headless) {
          assert.equal(typeof adapter.invoke, "function", `${host} declares headless but no invoke()`);
        }
      });
    });
  }
});
