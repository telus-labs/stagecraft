// core/adapters/headless.js — shared headless-invoke helper.
//
// runHeadless(adapter, descriptor, ctx) wraps spawn() + stdin pipe + gate
// detection. These tests cover the contract every host adapter relies on:
//
//   - Resolves capabilities.headlessCommand correctly
//   - DEVTEAM_HEADLESS_COMMAND overrides the declared command
//   - Throws (rejects) when no headlessCommand is available
//   - Returns the spawned process's exit code
//   - gatePath is set when the workstream gate exists, null otherwise
//   - Spawn ENOENT (binary not on PATH) rejects with a clear message
//   - Stdin EPIPE (child exits before reading) is swallowed, not propagated
//
// We stub the command via DEVTEAM_HEADLESS_COMMAND so the tests never touch
// a real model — `true` for clean exit, `false` for non-zero, `cat` to echo
// the prompt, `sh -c ...` for richer control.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runHeadless, rotateLog } = require("../core/adapters/headless");

function makeAdapter({ headlessCommand = "true", name = "test-host" } = {}) {
  return {
    capabilities: { name, headlessCommand },
    renderStagePrompt: (descriptor) =>
      `# stage ${descriptor.stage} (${descriptor.workstreamId})\nprompt body\n`,
  };
}

function makeCtx(overrides = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "headless-test-"));
  fs.mkdirSync(path.join(cwd, "pipeline", "gates"), { recursive: true });
  return { track: "full", feature: "test", cwd, isolation: "in-place", ...overrides };
}

function makeDescriptor(workstreamId = "stage-01") {
  return {
    stage: "stage-01",
    name: "requirements",
    role: "pm",
    rolesInStage: ["pm"],
    workstreamId,
    objective: "test objective",
    readFirst: [],
    allowedWrites: [],
    artifact: "pipeline/brief.md",
    template: "brief-template.md",
    expectedGate: {},
  };
}

function withEnv(key, value, fn) {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  return Promise.resolve(fn()).finally(() => {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  });
}

test("resolves capabilities.headlessCommand and exits with the child's code", async () => {
  const ctx = makeCtx();
  try {
    const r = await withEnv("DEVTEAM_HEADLESS_COMMAND", undefined, () =>
      runHeadless(makeAdapter({ headlessCommand: "true" }), makeDescriptor(), ctx),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.gatePath, null, "no gate file was written, so gatePath is null");
    assert.ok(typeof r.durationMs === "number" && r.durationMs >= 0);
  } finally {
    fs.rmSync(ctx.cwd, { recursive: true, force: true });
  }
});

test("DEVTEAM_HEADLESS_COMMAND overrides the adapter's declared headlessCommand", async () => {
  const ctx = makeCtx();
  try {
    // The adapter declares 'this-command-does-not-exist'; the env var redirects to 'true'.
    const r = await withEnv("DEVTEAM_HEADLESS_COMMAND", "true", () =>
      runHeadless(makeAdapter({ headlessCommand: "this-command-does-not-exist" }), makeDescriptor(), ctx),
    );
    assert.equal(r.exitCode, 0);
  } finally {
    fs.rmSync(ctx.cwd, { recursive: true, force: true });
  }
});

test("rejects when neither the adapter nor the env var declares a headlessCommand", async () => {
  const ctx = makeCtx();
  // Note: pass null (not undefined) — destructuring defaults swallow undefined,
  // which would silently fall back to "true" and mask the missing-command path.
  try {
    await withEnv("DEVTEAM_HEADLESS_COMMAND", undefined, () =>
      assert.rejects(
        () => runHeadless(makeAdapter({ headlessCommand: null }), makeDescriptor(), ctx),
        /declares no headlessCommand/,
      ),
    );
  } finally {
    fs.rmSync(ctx.cwd, { recursive: true, force: true });
  }
});

test("returns the non-zero exit code when the headless command fails", async () => {
  const ctx = makeCtx();
  try {
    const r = await withEnv("DEVTEAM_HEADLESS_COMMAND", "false", () =>
      runHeadless(makeAdapter(), makeDescriptor(), ctx),
    );
    assert.notEqual(r.exitCode, 0);
    assert.equal(r.gatePath, null);
  } finally {
    fs.rmSync(ctx.cwd, { recursive: true, force: true });
  }
});

test("rejects with a clear message when the headless binary is not on PATH", async () => {
  const ctx = makeCtx();
  try {
    await withEnv("DEVTEAM_HEADLESS_COMMAND", "stagecraft-no-such-binary-xyzzy", () =>
      assert.rejects(
        () => runHeadless(makeAdapter(), makeDescriptor(), ctx),
        (err) => {
          assert.match(err.message, /failed to spawn/);
          assert.match(err.message, /Is .* installed and on PATH/);
          return true;
        },
      ),
    );
  } finally {
    fs.rmSync(ctx.cwd, { recursive: true, force: true });
  }
});

test("returns gatePath when the workstream gate file exists in pipeline/gates/", async () => {
  const ctx = makeCtx();
  const desc = makeDescriptor("stage-04.backend");
  // Pre-seed the gate file so the post-spawn existsSync check finds it.
  const gateFile = path.join(ctx.cwd, "pipeline", "gates", `${desc.workstreamId}.json`);
  fs.writeFileSync(gateFile, JSON.stringify({ stage: "stage-04", status: "PASS" }));
  try {
    const r = await withEnv("DEVTEAM_HEADLESS_COMMAND", "true", () =>
      runHeadless(makeAdapter(), desc, ctx),
    );
    assert.equal(r.exitCode, 0);
    assert.equal(r.gatePath, gateFile);
  } finally {
    fs.rmSync(ctx.cwd, { recursive: true, force: true });
  }
});

test("swallows stdin EPIPE when the child exits before reading the prompt", async () => {
  // `true` is famous for ignoring stdin and exiting immediately, so the
  // helper's stdin.write() races against the child closing its end of the
  // pipe. The helper has to swallow that EPIPE — if it didn't, this test
  // would surface as an unhandled error.
  const ctx = makeCtx();
  try {
    const r = await withEnv("DEVTEAM_HEADLESS_COMMAND", "true", () =>
      runHeadless(makeAdapter(), makeDescriptor(), ctx),
    );
    assert.equal(r.exitCode, 0);
  } finally {
    fs.rmSync(ctx.cwd, { recursive: true, force: true });
  }
});

test("parses headlessCommand quotes and passes the tail as args", async () => {
  const ctx = makeCtx();
  try {
    const r = await withEnv("DEVTEAM_HEADLESS_COMMAND", `node -e "process.exit(42)"`, () =>
      runHeadless(makeAdapter(), makeDescriptor(), ctx),
    );
    assert.equal(r.exitCode, 42);
  } finally {
    fs.rmSync(ctx.cwd, { recursive: true, force: true });
  }
});

test("supports quoted script paths that contain spaces", async () => {
  const ctx = makeCtx();
  const scriptDir = path.join(ctx.cwd, "script dir");
  const scriptPath = path.join(scriptDir, "exit code.js");
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.writeFileSync(scriptPath, "process.exit(7);\n");
  try {
    const r = await withEnv("DEVTEAM_HEADLESS_COMMAND", `"${process.execPath}" "${scriptPath}"`, () =>
      runHeadless(makeAdapter(), makeDescriptor(), ctx),
    );
    assert.equal(r.exitCode, 7);
  } finally {
    fs.rmSync(ctx.cwd, { recursive: true, force: true });
  }
});

test("ctx.timeoutMs kills a hung child and reports timedOut: true", async () => {
  // `sleep 30` would hang the test for 30 seconds without a timeout.
  // We pass timeoutMs: 200 → kill after 200ms → resolve with timedOut.
  const ctx = makeCtx({ timeoutMs: 200 });
  try {
    const start = Date.now();
    const r = await withEnv("DEVTEAM_HEADLESS_COMMAND", "sleep 30", () =>
      runHeadless(makeAdapter(), makeDescriptor(), ctx),
    );
    const elapsed = Date.now() - start;
    assert.equal(r.timedOut, true);
    assert.equal(r.exitCode, null);
    // Should resolve within a reasonable margin of the timeout (allow up
    // to ~5s for the SIGKILL grace window in case SIGTERM is ignored).
    assert.ok(elapsed < 6000, `expected resolution within 6s, took ${elapsed}ms`);
  } finally {
    fs.rmSync(ctx.cwd, { recursive: true, force: true });
  }
});

test("ctx.timeoutMs: 0 disables the timeout", async () => {
  // With timeoutMs: 0, even an immediately-resolving command should
  // succeed (we don't want a 0 to be misread as "kill immediately").
  const ctx = makeCtx({ timeoutMs: 0 });
  try {
    const r = await withEnv("DEVTEAM_HEADLESS_COMMAND", "true", () =>
      runHeadless(makeAdapter(), makeDescriptor(), ctx),
    );
    assert.equal(r.timedOut, false);
    assert.equal(r.exitCode, 0);
  } finally {
    fs.rmSync(ctx.cwd, { recursive: true, force: true });
  }
});

test("writes pipeline/logs/<workstreamId>.log by default (tee behavior)", async () => {
  const ctx = makeCtx();
  try {
    // `cat` echoes our prompt back to stdout, which gets teed to the log.
    const r = await withEnv("DEVTEAM_HEADLESS_COMMAND", "cat", () =>
      runHeadless(makeAdapter(), makeDescriptor("stage-01"), ctx),
    );
    assert.equal(r.exitCode, 0);
    const expectedLog = path.join(ctx.cwd, "pipeline", "logs", "stage-01.log");
    assert.equal(r.logPath, expectedLog, "logPath returned from runHeadless");
    assert.ok(fs.existsSync(expectedLog), "log file written to disk");
    const content = fs.readFileSync(expectedLog, "utf8");
    // Header
    assert.match(content, /# Stage transcript: stage-01/);
    assert.match(content, /# Host: test-host/);
    assert.match(content, /# Command: cat/);
    assert.match(content, /# Started:/);
    // The piped prompt content
    assert.match(content, /stage stage-01/);
    assert.match(content, /prompt body/);
    // Trailer
    assert.match(content, /# Ended:/);
    assert.match(content, /# Exit: 0/);
  } finally {
    fs.rmSync(ctx.cwd, { recursive: true, force: true });
  }
});

test("DEVTEAM_NO_LOG=1 disables the tee; no log file is written", async () => {
  const ctx = makeCtx();
  try {
    const r = await withEnv("DEVTEAM_HEADLESS_COMMAND", "true", async () => {
      const prev = process.env.DEVTEAM_NO_LOG;
      process.env.DEVTEAM_NO_LOG = "1";
      try {
        return await runHeadless(makeAdapter(), makeDescriptor("stage-01"), ctx);
      } finally {
        if (prev === undefined) delete process.env.DEVTEAM_NO_LOG;
        else process.env.DEVTEAM_NO_LOG = prev;
      }
    });
    assert.equal(r.exitCode, 0);
    assert.equal(r.logPath, null, "logPath must be null when logging disabled");
    const logsDir = path.join(ctx.cwd, "pipeline", "logs");
    assert.ok(!fs.existsSync(logsDir), "no logs dir should be created");
  } finally {
    fs.rmSync(ctx.cwd, { recursive: true, force: true });
  }
});

test("log file is closed cleanly even when the spawn fails (no async write-after-end)", async () => {
  const ctx = makeCtx();
  try {
    await assert.rejects(
      withEnv("DEVTEAM_HEADLESS_COMMAND", "stagecraft-no-such-binary-xyz", () =>
        runHeadless(makeAdapter(), makeDescriptor("stage-01"), ctx),
      ),
      /failed to spawn/,
    );
    // The log file should exist (we opened it before spawn) with a
    // "spawn error" trailer rather than being left half-written.
    const logPath = path.join(ctx.cwd, "pipeline", "logs", "stage-01.log");
    assert.ok(fs.existsSync(logPath));
    const content = fs.readFileSync(logPath, "utf8");
    assert.match(content, /Exit: spawn error:/);
  } finally {
    fs.rmSync(ctx.cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Log rotation tests
// ---------------------------------------------------------------------------

test("rotateLog: on second run the previous log is moved to .1.log", async () => {
  const ctx = makeCtx();
  try {
    const logsPath = path.join(ctx.cwd, "pipeline", "logs");
    fs.mkdirSync(logsPath, { recursive: true });
    // Simulate a first run by pre-seeding the log file.
    const logFile = path.join(logsPath, "stage-01.log");
    fs.writeFileSync(logFile, "first run content");

    await withEnv("DEVTEAM_HEADLESS_COMMAND", "true", () =>
      withEnv("DEVTEAM_LOG_HISTORY", "3", () =>
        runHeadless(makeAdapter(), makeDescriptor("stage-01"), ctx),
      ),
    );

    // The previous log must have been rotated to .1.log.
    const slot1 = path.join(logsPath, "stage-01.1.log");
    assert.ok(fs.existsSync(slot1), ".1.log should exist after rotation");
    assert.equal(fs.readFileSync(slot1, "utf8"), "first run content");

    // The new current log is written by this run.
    assert.ok(fs.existsSync(logFile), "new stage-01.log must exist");
    assert.match(fs.readFileSync(logFile, "utf8"), /# Stage transcript: stage-01/);
  } finally {
    fs.rmSync(ctx.cwd, { recursive: true, force: true });
  }
});

test("rotateLog: history shifts correctly across three runs", async () => {
  const ctx = makeCtx();
  try {
    const logsPath = path.join(ctx.cwd, "pipeline", "logs");
    fs.mkdirSync(logsPath, { recursive: true });
    const logFile = path.join(logsPath, "stage-01.log");

    // Run 1: seed a log
    fs.writeFileSync(logFile, "run-1");
    // Run 2: rotate; run-1 → .1.log
    fs.writeFileSync(path.join(logsPath, "stage-01.1.log"), "will-be-shifted");
    rotateLog(logFile, 3);
    assert.equal(fs.readFileSync(path.join(logsPath, "stage-01.1.log"), "utf8"), "run-1");
    assert.equal(fs.readFileSync(path.join(logsPath, "stage-01.2.log"), "utf8"), "will-be-shifted");
    assert.ok(!fs.existsSync(logFile), "current log consumed by rotation");

    // Run 3: rotate again
    fs.writeFileSync(logFile, "run-3");
    rotateLog(logFile, 3);
    assert.equal(fs.readFileSync(path.join(logsPath, "stage-01.1.log"), "utf8"), "run-3");
    assert.equal(fs.readFileSync(path.join(logsPath, "stage-01.2.log"), "utf8"), "run-1");
    assert.equal(fs.readFileSync(path.join(logsPath, "stage-01.3.log"), "utf8"), "will-be-shifted");
  } finally {
    fs.rmSync(ctx.cwd, { recursive: true, force: true });
  }
});

test("rotateLog: oldest slot is pruned when maxHistory is exceeded", async () => {
  const ctx = makeCtx();
  try {
    const logsPath = path.join(ctx.cwd, "pipeline", "logs");
    fs.mkdirSync(logsPath, { recursive: true });
    const logFile = path.join(logsPath, "stage-01.log");

    // Fill all history slots (maxHistory=2): .1.log and .2.log exist.
    fs.writeFileSync(logFile, "current");
    fs.writeFileSync(path.join(logsPath, "stage-01.1.log"), "prior-1");
    fs.writeFileSync(path.join(logsPath, "stage-01.2.log"), "prior-2");

    rotateLog(logFile, 2);

    // .2.log (the oldest allowed slot) now holds what was in .1.log.
    assert.equal(fs.readFileSync(path.join(logsPath, "stage-01.1.log"), "utf8"), "current");
    assert.equal(fs.readFileSync(path.join(logsPath, "stage-01.2.log"), "utf8"), "prior-1");
    // prior-2 must have been pruned.
    assert.ok(!fs.existsSync(path.join(logsPath, "stage-01.3.log")), "pruned slot must not exist");
  } finally {
    fs.rmSync(ctx.cwd, { recursive: true, force: true });
  }
});

test("DEVTEAM_LOG_HISTORY=0 disables rotation; current log is overwritten", async () => {
  const ctx = makeCtx();
  try {
    const logsPath = path.join(ctx.cwd, "pipeline", "logs");
    fs.mkdirSync(logsPath, { recursive: true });
    const logFile = path.join(logsPath, "stage-01.log");
    fs.writeFileSync(logFile, "old content");

    await withEnv("DEVTEAM_HEADLESS_COMMAND", "true", () =>
      withEnv("DEVTEAM_LOG_HISTORY", "0", () =>
        runHeadless(makeAdapter(), makeDescriptor("stage-01"), ctx),
      ),
    );

    // No rotation files should exist.
    assert.ok(!fs.existsSync(path.join(logsPath, "stage-01.1.log")), ".1.log must not exist");
    // Current log overwritten with the new run.
    assert.ok(fs.existsSync(logFile));
    assert.match(fs.readFileSync(logFile, "utf8"), /# Stage transcript: stage-01/);
  } finally {
    fs.rmSync(ctx.cwd, { recursive: true, force: true });
  }
});
