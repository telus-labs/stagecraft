"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { REPO_ROOT } = require("./_helpers");

const { terminateChild } = require(path.join(REPO_ROOT, "core", "process-kill"));

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("terminateChild", () => {
  it("uses SIGTERM followed by SIGKILL on POSIX platforms", async () => {
    const signals = [];
    const timer = terminateChild({
      kill(signal) { signals.push(signal); },
    }, { platform: "linux", graceMs: 1 });

    assert.deepEqual(signals, ["SIGTERM"]);
    await delay(10);
    assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
    clearTimeout(timer);
  });

  it("uses a single signal-less terminate call on Windows", async () => {
    const signals = [];
    const timer = terminateChild({
      kill(signal) { signals.push(signal); },
    }, { platform: "win32", graceMs: 1 });

    assert.equal(timer, null);
    assert.deepEqual(signals, [undefined]);
    await delay(10);
    assert.deepEqual(signals, [undefined]);
  });

  it("swallows already-exited child errors", async () => {
    assert.doesNotThrow(() => terminateChild({
      kill() { throw new Error("already exited"); },
    }, { platform: "linux", graceMs: 1 }));
    await delay(10);
  });
});
