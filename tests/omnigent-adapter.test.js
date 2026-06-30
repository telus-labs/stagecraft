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
