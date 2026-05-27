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
const { runHeadless } = require("../core/adapters/headless");

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

test("splits the headlessCommand on whitespace and passes the tail as args", async () => {
  // `node -e process.exit(42)` survives a naive split(/\s+/) because the JS
  // script contains no whitespace. Verifies the split + arg-propagation
  // contract that real host commands depend on (`claude --print`,
  // `codex exec`, `gemini`).
  const ctx = makeCtx();
  try {
    const r = await withEnv("DEVTEAM_HEADLESS_COMMAND", "node -e process.exit(42)", () =>
      runHeadless(makeAdapter(), makeDescriptor(), ctx),
    );
    assert.equal(r.exitCode, 42);
  } finally {
    fs.rmSync(ctx.cwd, { recursive: true, force: true });
  }
});
