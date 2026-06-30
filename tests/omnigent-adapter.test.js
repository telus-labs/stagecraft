const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { REPO_ROOT, makeTargetProject, cleanup } = require("./_helpers");

const adapter = require(path.join(REPO_ROOT, "hosts", "omnigent", "adapter.js"));

describe("omnigent adapter", () => {
  it("installs the Omnigent agent spec alongside markdown host assets", () => {
    const cwd = makeTargetProject();
    try {
      const result = adapter.install(cwd);
      const spec = path.join(cwd, ".omnigent", "stagecraft", "agent.yaml");
      assert.ok(result.written.includes(spec), "install result should include agent.yaml");
      assert.ok(fs.existsSync(spec), "agent.yaml should exist");
      assert.match(fs.readFileSync(spec, "utf8"), /name: stagecraft_workstream/);
      assert.equal(adapter.status(cwd).ok, true);
    } finally {
      cleanup(cwd);
    }
  });

  it("builds an Omnigent one-shot command by passing the rendered prompt via -p", () => {
    const built = adapter.buildOmnigentArgs(
      "omnigent run .omnigent/stagecraft/agent.yaml --no-session",
      "stage prompt",
    );
    assert.equal(built.bin, "omnigent");
    assert.deepEqual(built.args, [
      "run",
      ".omnigent/stagecraft/agent.yaml",
      "--no-session",
      "-p",
      "stage prompt",
    ]);
  });

  it("keeps the default launch profile backward-compatible", () => {
    const cwd = makeTargetProject({
      config: "routing:\n  default_host: omnigent\npipeline:\n  default_track: full\n",
    });
    const original = process.env.DEVTEAM_HEADLESS_COMMAND;
    try {
      delete process.env.DEVTEAM_HEADLESS_COMMAND;
      const built = adapter.buildOmnigentInvocation("stage prompt", { cwd });
      assert.equal(built.bin, "omnigent");
      assert.deepEqual(built.args, [
        "run",
        ".omnigent/stagecraft/agent.yaml",
        "--no-session",
        "-p",
        "stage prompt",
      ]);
    } finally {
      if (original !== undefined) process.env.DEVTEAM_HEADLESS_COMMAND = original;
      else delete process.env.DEVTEAM_HEADLESS_COMMAND;
      cleanup(cwd);
    }
  });

  it("builds an Omnigent command from hosts.omnigent launch profile config", () => {
    const cwd = makeTargetProject({
      config: [
        "routing:",
        "  default_host: omnigent",
        "pipeline:",
        "  default_track: full",
        "hosts:",
        "  omnigent:",
        "    agent_spec_path: .omnigent/custom/agent.yaml",
        "    harness: claude-sdk",
        "    model: claude-sonnet-4",
        "    server_url: https://omnigent.internal",
        "    session_mode: session",
        "    extra_args:",
        "      - --profile",
        "      - team-alpha",
        "",
      ].join("\n"),
    });
    const original = process.env.DEVTEAM_HEADLESS_COMMAND;
    try {
      delete process.env.DEVTEAM_HEADLESS_COMMAND;
      const built = adapter.buildOmnigentInvocation("stage prompt", { cwd });
      assert.equal(built.bin, "omnigent");
      assert.deepEqual(built.args, [
        "run",
        ".omnigent/custom/agent.yaml",
        "--harness",
        "claude-sdk",
        "--model",
        "claude-sonnet-4",
        "--server-url",
        "https://omnigent.internal",
        "--profile",
        "team-alpha",
        "-p",
        "stage prompt",
      ]);
      assert.equal(built.profile.sessionMode, "session");
    } finally {
      if (original !== undefined) process.env.DEVTEAM_HEADLESS_COMMAND = original;
      else delete process.env.DEVTEAM_HEADLESS_COMMAND;
      cleanup(cwd);
    }
  });

  it("supports explicit session resume launch profiles", () => {
    const built = adapter.buildOmnigentCommandFromProfile({
      agentSpecPath: ".omnigent/stagecraft/agent.yaml",
      sessionMode: "resume",
      sessionId: "sess_123",
      extraArgs: [],
    });
    assert.deepEqual(built.args, [
      "run",
      ".omnigent/stagecraft/agent.yaml",
      "--session",
      "sess_123",
    ]);
  });

  it("keeps DEVTEAM_HEADLESS_COMMAND as the highest-precedence override", () => {
    const cwd = makeTargetProject({
      config: [
        "routing:",
        "  default_host: omnigent",
        "pipeline:",
        "  default_track: full",
        "hosts:",
        "  omnigent:",
        "    harness: ignored",
        "    model: ignored",
        "",
      ].join("\n"),
    });
    const original = process.env.DEVTEAM_HEADLESS_COMMAND;
    try {
      process.env.DEVTEAM_HEADLESS_COMMAND = "omnigent run override.yaml --no-session --harness env";
      const built = adapter.buildOmnigentInvocation("stage prompt", { cwd });
      assert.equal(built.source, "env");
      assert.deepEqual(built.args, [
        "run",
        "override.yaml",
        "--no-session",
        "--harness",
        "env",
        "-p",
        "stage prompt",
      ]);
    } finally {
      if (original !== undefined) process.env.DEVTEAM_HEADLESS_COMMAND = original;
      else delete process.env.DEVTEAM_HEADLESS_COMMAND;
      cleanup(cwd);
    }
  });

  it("rejects extra_args that try to override prompt transport", () => {
    const cwd = makeTargetProject({
      config: [
        "routing:",
        "  default_host: omnigent",
        "pipeline:",
        "  default_track: full",
        "hosts:",
        "  omnigent:",
        "    extra_args:",
        "      - --prompt",
        "",
      ].join("\n"),
    });
    try {
      assert.throws(
        () => adapter.resolveLaunchProfile({ cwd }),
        /cannot override Stagecraft prompt transport/,
      );
    } finally {
      cleanup(cwd);
    }
  });

  it("renders prompts that point at Omnigent-installed role prompts", () => {
    const prompt = adapter.renderStagePrompt({
      stage: "stage-01",
      name: "requirements",
      role: "pm",
      rolesInStage: ["pm"],
      workstreamId: "stage-01",
      objective: "Write the brief.",
      readFirst: ["AGENTS.md"],
      allowedWrites: ["pipeline/brief.md", "pipeline/gates/stage-01.json"],
      artifact: "pipeline/brief.md",
      template: "brief-template.md",
      expectedGate: {},
    }, {
      track: "full",
      feature: "Omnigent adapter",
      cwd: REPO_ROOT,
      isolation: "in-place",
    });

    assert.match(prompt, /\.omnigent\/stagecraft\/roles\/pm\.md/);
    assert.match(prompt, /"host": "omnigent"/);
  });
});
