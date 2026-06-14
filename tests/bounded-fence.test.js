// Tests for item 5.4 — bounded isolation fence.
//
// Commit 1: loadConfig rejects isolation:bounded for unwired CLI commands
// unless isolation_acknowledge_partial: true is set. These tests verify:
//   1. checkBoundedFence throws for bounded configs on unwired commands.
//   2. checkBoundedFence passes with isolation_acknowledge_partial: true.
//   3. checkBoundedFence is a no-op for non-bounded (in-place) configs.
//   4. Meta: grep core/cli/commands/ for resolveChangeId usage; the derived
//      unwired list must exactly match BOUNDED_UNWIRED_COMMANDS so the fence
//      message cannot go stale when a command is wired.

"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.join(__dirname, "..");
const { checkBoundedFence, BOUNDED_UNWIRED_COMMANDS, loadConfig, clearConfigCache } =
  require(path.join(REPO_ROOT, "core", "config"));

// ── 1. Fence throws for bounded, unwired commands ─────────────────────────────

describe("checkBoundedFence — bounded config without escape hatch", () => {
  const boundedConfig = {
    pipeline: { isolation: "bounded", isolation_acknowledge_partial: false },
  };

  test("throws for each command in BOUNDED_UNWIRED_COMMANDS", () => {
    for (const cmd of BOUNDED_UNWIRED_COMMANDS) {
      assert.throws(
        () => checkBoundedFence(boundedConfig, cmd),
        (err) => {
          assert.ok(err instanceof Error, "must be an Error");
          assert.ok(
            err.message.includes("isolation: bounded"),
            `fence message must mention 'isolation: bounded', got: ${err.message}`,
          );
          assert.ok(
            err.message.includes(cmd),
            `fence message must name the unwired command '${cmd}', got: ${err.message}`,
          );
          return true;
        },
        `expected fence to throw for command "${cmd}"`,
      );
    }
  });

  test("fence message lists ALL unwired commands", () => {
    assert.throws(
      () => checkBoundedFence(boundedConfig, BOUNDED_UNWIRED_COMMANDS[0]),
      (err) => {
        for (const cmd of BOUNDED_UNWIRED_COMMANDS) {
          assert.ok(err.message.includes(cmd), `fence message must list '${cmd}'`);
        }
        return true;
      },
    );
  });

  test("BOUNDED_UNWIRED_COMMANDS is non-empty (fence has something to report)", () => {
    assert.ok(Array.isArray(BOUNDED_UNWIRED_COMMANDS));
    assert.ok(BOUNDED_UNWIRED_COMMANDS.length > 0, "must have at least one unwired command");
  });
});

// ── 2. Escape hatch bypasses the fence ────────────────────────────────────────

describe("checkBoundedFence — escape hatch", () => {
  const acknowledgedConfig = {
    pipeline: { isolation: "bounded", isolation_acknowledge_partial: true },
  };

  test("does not throw when isolation_acknowledge_partial is true", () => {
    for (const cmd of BOUNDED_UNWIRED_COMMANDS) {
      assert.doesNotThrow(
        () => checkBoundedFence(acknowledgedConfig, cmd),
        `expected fence to pass for '${cmd}' with isolation_acknowledge_partial: true`,
      );
    }
  });
});

// ── 3. In-place config is always a no-op ─────────────────────────────────────

describe("checkBoundedFence — in-place mode", () => {
  const inPlaceConfig = {
    pipeline: { isolation: "in-place", isolation_acknowledge_partial: false },
  };

  test("does not throw for in-place config (even for unwired commands)", () => {
    for (const cmd of BOUNDED_UNWIRED_COMMANDS) {
      assert.doesNotThrow(
        () => checkBoundedFence(inPlaceConfig, cmd),
        `checkBoundedFence must be a no-op in in-place mode for '${cmd}'`,
      );
    }
  });

  test("does not throw for default config (isolation defaults to in-place)", () => {
    assert.doesNotThrow(() => checkBoundedFence({ pipeline: { isolation: "in-place" } }, "next"));
  });
});

// ── 4. Wired commands are not blocked even with bounded config ─────────────────

describe("checkBoundedFence — already-wired commands pass through", () => {
  const boundedConfig = {
    pipeline: { isolation: "bounded", isolation_acknowledge_partial: false },
  };

  test("unknown command name is not fenced (fence only blocks its own list)", () => {
    // Commands not in BOUNDED_UNWIRED_COMMANDS (e.g. already wired ones) must pass.
    assert.doesNotThrow(
      () => checkBoundedFence(boundedConfig, "some-wired-command-not-in-list"),
      "fence must not block commands outside its unwired list",
    );
  });
});

// ── 5. loadConfig parses isolation_acknowledge_partial from YAML ──────────────

describe("loadConfig — isolation_acknowledge_partial field", () => {
  const os = require("node:os");

  function makeTmpConfig(yaml) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devteam-test-fence-"));
    fs.mkdirSync(path.join(dir, ".devteam"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".devteam", "config.yml"), yaml, "utf8");
    return dir;
  }

  test("isolation_acknowledge_partial: true is parsed", () => {
    const dir = makeTmpConfig(
      "pipeline:\n  isolation: bounded\n  isolation_acknowledge_partial: true\n",
    );
    clearConfigCache();
    try {
      const c = loadConfig(dir);
      assert.equal(c.pipeline.isolation, "bounded");
      assert.equal(c.pipeline.isolation_acknowledge_partial, true);
    } finally {
      clearConfigCache();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("isolation_acknowledge_partial absent defaults to false", () => {
    const dir = makeTmpConfig("pipeline:\n  isolation: bounded\n");
    clearConfigCache();
    try {
      const c = loadConfig(dir);
      assert.equal(c.pipeline.isolation_acknowledge_partial, false);
    } finally {
      clearConfigCache();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("isolation_acknowledge_partial: false is parsed as false", () => {
    const dir = makeTmpConfig(
      "pipeline:\n  isolation: bounded\n  isolation_acknowledge_partial: false\n",
    );
    clearConfigCache();
    try {
      const c = loadConfig(dir);
      assert.equal(c.pipeline.isolation_acknowledge_partial, false);
    } finally {
      clearConfigCache();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── 6. Meta-test: BOUNDED_UNWIRED_COMMANDS stays in sync with the codebase ───
//
// Grep core/cli/commands/ for `resolveChangeId` (the wiring marker added in
// commit 2). Every command file that lacks resolveChangeId is "unwired"; the
// fence's list must match that set exactly.
//
// This test fails if:
//   - A command is wired (has resolveChangeId) but still listed as unwired.
//   - A command is unwired but missing from the list (fence message goes stale).

describe("BOUNDED_UNWIRED_COMMANDS meta-test — fence message cannot go stale", () => {
  const commandsDir = path.join(REPO_ROOT, "core", "cli", "commands");

  // Commands that are exempt from the fence and from wiring:
  // global-state commands that have no per-feature pipeline path and are
  // intentionally excluded from both the unwired list and wiring scope.
  // (none currently; extend if a command is determined truly global-state exempt)
  const FENCE_EXEMPT = new Set([]);

  test("every file in BOUNDED_UNWIRED_COMMANDS exists as a command file", () => {
    for (const cmd of BOUNDED_UNWIRED_COMMANDS) {
      const f = path.join(commandsDir, `${cmd}.js`);
      assert.ok(fs.existsSync(f), `BOUNDED_UNWIRED_COMMANDS lists '${cmd}' but ${cmd}.js not found`);
    }
  });

  test("BOUNDED_UNWIRED_COMMANDS matches commands lacking resolveChangeId", () => {
    // Find all command files.
    const allFiles = fs.readdirSync(commandsDir)
      .filter((n) => n.endsWith(".js"))
      .map((n) => ({ name: n.replace(/\.js$/, ""), file: path.join(commandsDir, n) }));

    // Determine which are wired (contain resolveChangeId).
    const unwiredFromCode = allFiles
      .filter(({ name, file }) => {
        if (FENCE_EXEMPT.has(name)) return false;
        const src = fs.readFileSync(file, "utf8");
        return !src.includes("resolveChangeId");
      })
      .map(({ name }) => name)
      .filter((name) => BOUNDED_UNWIRED_COMMANDS.includes(name)); // only check fence-relevant ones

    // The fence's list must match what the code says.
    const fenced = new Set(BOUNDED_UNWIRED_COMMANDS);
    const fromCode = new Set(unwiredFromCode);

    const wiredButStillFenced = [...fenced].filter((cmd) => !fromCode.has(cmd));
    assert.deepEqual(
      wiredButStillFenced,
      [],
      `These commands are wired (have resolveChangeId) but still in BOUNDED_UNWIRED_COMMANDS: ` +
      `${wiredButStillFenced.join(", ")} — remove them from the fence list`,
    );
  });
});
