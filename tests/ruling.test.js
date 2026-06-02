// `devteam ruling --topic "..."` — ad-hoc Principal subagent dispatch
// for escalation resolutions that need a Principal call without
// re-running an entire stage. Tier-4 closes the "no clean headless
// path for ad-hoc Principal rulings" gap from the user-report
// follow-up.

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { BIN, makeTargetProject, cleanup } = require("./_helpers");

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
afterEach(() => { _dirs.forEach(cleanup); _dirs = []; });

function run(args, opts = {}) {
  const env = { ...process.env, ...(opts.env || {}) };
  const r = spawnSync("node", [BIN, ...args], {
    cwd: opts.cwd, encoding: "utf8", env,
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

describe("ruling: argument handling", () => {
  it("prints usage when --topic is missing (exit 2)", () => {
    const cwd = track(makeTargetProject());
    const r = run(["ruling"], { cwd });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Usage: devteam ruling/);
    assert.match(r.stderr, /--topic/);
  });

  it("--help-style error references the escalation runbook", () => {
    const cwd = track(makeTargetProject());
    const r = run(["ruling"], { cwd });
    assert.match(r.stderr, /docs\/runbooks\/escalation\.md/);
  });
});

describe("ruling: user-driven mode (no --headless)", () => {
  it("prints the prompt to stdout with an onboarding preamble on stderr", () => {
    const cwd = track(makeTargetProject());
    const r = run(["ruling", "--topic", "F-12 must-fix vs defer"], { cwd });
    assert.equal(r.status, 0);
    // Prompt body lands on stdout
    assert.match(r.stdout, /# Principal Ruling Request/);
    assert.match(r.stdout, /F-12 must-fix vs defer/);
    assert.match(r.stdout, /## Principal Rulings/);
    assert.match(r.stdout, /PRINCIPAL-RULING:/);
    // Onboarding framing lands on stderr so `> prompt.md` captures just the prompt
    assert.match(r.stderr, /Paste the prompt below/);
    assert.match(r.stderr, /F-12 must-fix vs defer/);
  });

  it("includes --context paths in the prompt's read-first list", () => {
    const cwd = track(makeTargetProject());
    const r = run([
      "ruling",
      "--topic", "F-12 ruling",
      "--context", "pipeline/red-team-report.md,pipeline/code-review/by-platform.md",
    ], { cwd });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /pipeline\/red-team-report\.md/);
    assert.match(r.stdout, /pipeline\/code-review\/by-platform\.md/);
  });

  it("includes --target-gate in the prompt with instructions to read it", () => {
    const cwd = track(makeTargetProject());
    const r = run([
      "ruling",
      "--topic", "F-12 ruling",
      "--target-gate", "pipeline/gates/stage-05.json",
    ], { cwd });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /pipeline\/gates\/stage-05\.json/);
    assert.match(r.stdout, /escalation_reason/);
    assert.match(r.stdout, /decision_needed/);
  });

  it("instructs Principal NOT to edit the gate's status", () => {
    const cwd = track(makeTargetProject());
    const r = run(["ruling", "--topic", "anything"], { cwd });
    assert.match(r.stdout, /Do not edit the escalating gate's status/);
  });

  it("instructs Principal NOT to write source code", () => {
    const cwd = track(makeTargetProject());
    const r = run(["ruling", "--topic", "anything"], { cwd });
    assert.match(r.stdout, /Do not write new source code/i);
  });
});

describe("ruling: --headless mode", () => {
  it("pipes the prompt through the host's headless command", () => {
    const cwd = track(makeTargetProject({
      // Route principal to a host with capabilities.headless: true.
      // codex/claude-code/gemini-cli all qualify; codex is fine.
      config: "routing:\n  default_host: codex\npipeline:\n  default_track: full\n",
    }));
    // DEVTEAM_HEADLESS_COMMAND = cat → the prompt we pipe in comes back on stdout
    const r = run([
      "ruling",
      "--topic", "F-12 must-fix vs defer",
      "--headless",
    ], { cwd, env: { DEVTEAM_HEADLESS_COMMAND: "cat" } });
    assert.equal(r.status, 0, `non-zero exit; stderr: ${r.stderr}`);
    // The prompt body should appear in stdout (echoed by cat from stdin)
    assert.match(r.stdout, /# Principal Ruling Request/);
    assert.match(r.stdout, /F-12 must-fix vs defer/);
    // Status-line framing on stderr
    assert.match(r.stderr, /dispatching principal-ruling/);
    assert.match(r.stderr, /principal-ruling complete/);
  });

  it("propagates non-zero exit from the host command", () => {
    const cwd = track(makeTargetProject({
      config: "routing:\n  default_host: codex\npipeline:\n  default_track: full\n",
    }));
    // `false` exits non-zero
    const r = run([
      "ruling",
      "--topic", "x",
      "--headless",
    ], { cwd, env: { DEVTEAM_HEADLESS_COMMAND: "false" } });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /principal-ruling exited/);
  });

  it("errors clearly when the host can't be loaded", () => {
    const cwd = track(makeTargetProject({
      config: "routing:\n  default_host: not-a-real-host\npipeline:\n  default_track: full\n",
    }));
    const r = run([
      "ruling",
      "--topic", "x",
      "--headless",
    ], { cwd });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Could not load adapter/);
  });

  it("errors clearly when the routed host does not support headless", () => {
    const cwd = track(makeTargetProject({
      // generic has headless: false
      config: "routing:\n  default_host: generic\npipeline:\n  default_track: full\n",
    }));
    const r = run([
      "ruling",
      "--topic", "x",
      "--headless",
    ], { cwd });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /does not support --headless/);
  });
});

describe("ruling: routing", () => {
  it("uses routing.roles.principal when set, not default_host", () => {
    const cwd = track(makeTargetProject({
      config:
        "routing:\n" +
        "  default_host: not-a-real-host\n" +
        "  roles:\n" +
        "    principal: codex\n" +
        "pipeline:\n  default_track: full\n",
    }));
    // default_host is bogus and would fail to load.
    // If routing.roles.principal wins (the right behavior), codex loads + cat
    // is used as the headless command stub.
    const r = run([
      "ruling",
      "--topic", "x",
      "--headless",
    ], { cwd, env: { DEVTEAM_HEADLESS_COMMAND: "cat" } });
    assert.equal(r.status, 0, "routing.roles.principal must win over default_host");
  });
});
