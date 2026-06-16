// Tests for driver.js behaviours not already covered by run.test.js.

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { REPO_ROOT, makeTargetProject, seedGate, cleanup } = require("./_helpers");
const { run } = require(path.join(REPO_ROOT, "core", "driver"));

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
afterEach(() => { _dirs.forEach(cleanup); _dirs = []; });

describe("driver: budget warning", () => {
  it("writes budget warning to stderr when budgetUsd is not set", async () => {
    const cwd = track(makeTargetProject());
    // Seed stage-01 as ESCALATE so the run halts quickly without dispatching anything.
    seedGate(cwd, "stage-01", { status: "ESCALATE", escalation_reason: "test" });

    const chunks = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk, ...rest) => {
      chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
      return orig(chunk, ...rest);
    };

    try {
      await run({ cwd });
    } finally {
      process.stderr.write = orig;
    }

    const combined = chunks.join("");
    assert.ok(
      combined.includes("[devteam run] Warning: no --budget-usd cap set"),
      `Expected budget warning in stderr but got: ${combined}`
    );
    assert.ok(
      combined.includes("Use --budget-usd <amount> to prevent runaway cost"),
      `Expected second line of budget warning in stderr but got: ${combined}`
    );
  });

  it("does NOT write budget warning when budgetUsd is set", async () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { status: "ESCALATE", escalation_reason: "test" });

    const chunks = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk, ...rest) => {
      chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
      return orig(chunk, ...rest);
    };

    try {
      await run({ cwd, budgetUsd: 10 });
    } finally {
      process.stderr.write = orig;
    }

    const combined = chunks.join("");
    assert.ok(
      !combined.includes("[devteam run] Warning: no --budget-usd cap set"),
      `Unexpected budget warning in stderr: ${combined}`
    );
  });
});
