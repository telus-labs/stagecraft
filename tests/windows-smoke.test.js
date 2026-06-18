"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runHeadless } = require("../core/adapters/headless");

const windowsOnly = process.platform === "win32" ? test : test.skip;

function adapter() {
  return {
    capabilities: { name: "windows-smoke", headlessCommand: "unused" },
    renderStagePrompt: () => "native Windows smoke\n",
  };
}

function descriptor() {
  return {
    stage: "stage-01",
    name: "requirements",
    role: "pm",
    rolesInStage: ["pm"],
    workstreamId: "stage-01",
    objective: "test native Windows dispatch",
    readFirst: [],
    allowedWrites: [],
    expectedGate: {},
  };
}

async function withHeadlessCommand(command, fn) {
  const previous = process.env.DEVTEAM_HEADLESS_COMMAND;
  process.env.DEVTEAM_HEADLESS_COMMAND = command;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.DEVTEAM_HEADLESS_COMMAND;
    else process.env.DEVTEAM_HEADLESS_COMMAND = previous;
  }
}

windowsOnly("runs a quoted executable path natively", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "stagecraft-windows-"));
  fs.mkdirSync(path.join(cwd, "pipeline", "gates"), { recursive: true });
  try {
    const result = await withHeadlessCommand(
      `"${process.execPath}" -e "process.exit(7)"`,
      () => runHeadless(adapter(), descriptor(), { cwd, track: "full", log: false }),
    );
    assert.equal(result.exitCode, 7);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

windowsOnly("terminates a timed-out native child", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "stagecraft-windows-"));
  fs.mkdirSync(path.join(cwd, "pipeline", "gates"), { recursive: true });
  try {
    const started = Date.now();
    const result = await withHeadlessCommand(
      `"${process.execPath}" -e "setInterval(() => {}, 1000)"`,
      () => runHeadless(adapter(), descriptor(), {
        cwd,
        track: "full",
        log: false,
        timeoutMs: 200,
      }),
    );
    assert.equal(result.timedOut, true);
    assert.ok(Date.now() - started < 6000, "timed-out child should terminate promptly");
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
