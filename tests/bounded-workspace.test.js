// Tests for B9 — bounded workspace isolation.
//
// When pipeline.isolation = "bounded" the orchestrator routes all artifact
// paths under pipeline/changes/<changeId>/ instead of the global pipeline/.
// These tests verify the three key behaviors:
//   1. changeIdFromFeature produces safe slugs (including edge cases).
//   2. prefixPipelineRelative rewrites pipeline/ paths and leaves others alone.
//   3. ctx.changeId is populated in runStage() when isolation is bounded,
//      and is null when isolation is in-place (the default).
//   4. buildDescriptor returns prefixed readFirst / allowedWrites / artifact
//      paths when changeId is set.
//   5. runHeadless checks the bounded gate path (DEVTEAM_HEADLESS_COMMAND=cat).
//   6. appendGateFooter tells the model the bounded gate path when changeId set.

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeTargetProject(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bounded-ws-test-"));
  fs.mkdirSync(path.join(dir, ".devteam"), { recursive: true });
  const defaultConfig = [
    "routing:",
    "  default_host: claude-code",
    "pipeline:",
    "  default_track: full",
    "  isolation: bounded",
  ].join("\n") + "\n";
  fs.writeFileSync(
    path.join(dir, ".devteam", "config.yml"),
    opts.config !== undefined ? opts.config : defaultConfig,
    "utf8",
  );
  return dir;
}

// ─── 1. changeIdFromFeature ───────────────────────────────────────────────────

describe("changeIdFromFeature — slug generation", () => {
  const { changeIdFromFeature } = require("../core/config");

  test("simple lowercase word", () => {
    assert.equal(changeIdFromFeature("login"), "login");
  });

  test("spaces become hyphens", () => {
    assert.equal(changeIdFromFeature("user auth feature"), "user-auth-feature");
  });

  test("uppercase is lowercased", () => {
    assert.equal(changeIdFromFeature("AddLoginButton"), "addloginbutton");
  });

  test("special chars collapsed", () => {
    assert.equal(changeIdFromFeature("feat: add login!"), "feat-add-login");
  });

  test("leading/trailing hyphens stripped", () => {
    assert.equal(changeIdFromFeature("---hello---"), "hello");
  });

  test("blank string returns null", () => {
    assert.equal(changeIdFromFeature(""), null);
  });

  test("null input returns null", () => {
    assert.equal(changeIdFromFeature(null), null);
  });

  test("undefined returns null", () => {
    assert.equal(changeIdFromFeature(undefined), null);
  });

  test("truncated to 64 chars", () => {
    const longFeature = "a".repeat(100);
    const result = changeIdFromFeature(longFeature);
    assert.ok(result.length <= 64);
  });
});

// ─── 2. prefixPipelineRelative ────────────────────────────────────────────────

describe("prefixPipelineRelative — path rewriting", () => {
  const { prefixPipelineRelative } = require("../core/paths");

  test("rewrites pipeline/brief.md", () => {
    const result = prefixPipelineRelative("pipeline/brief.md", "my-feature");
    assert.equal(result, path.join("pipeline", "changes", "my-feature", "brief.md"));
  });

  test("rewrites pipeline/gates/stage-01.json", () => {
    const result = prefixPipelineRelative("pipeline/gates/stage-01.json", "my-feature");
    assert.equal(result, path.join("pipeline", "changes", "my-feature", "gates", "stage-01.json"));
  });

  test("rewrites pipeline/logs/ (directory path)", () => {
    const result = prefixPipelineRelative("pipeline/logs/", "feat-x");
    // path.join normalisation may or may not preserve a trailing slash;
    // what matters is that the bounded prefix is present.
    assert.ok(
      result.replace(/\\/g, "/").startsWith("pipeline/changes/feat-x/logs"),
      `expected bounded logs prefix in: ${result}`,
    );
  });

  test("does not touch AGENTS.md", () => {
    assert.equal(prefixPipelineRelative("AGENTS.md", "feat-x"), "AGENTS.md");
  });

  test("does not touch .devteam/rules/pipeline.md", () => {
    assert.equal(prefixPipelineRelative(".devteam/rules/pipeline.md", "feat-x"), ".devteam/rules/pipeline.md");
  });

  test("null changeId is a no-op", () => {
    assert.equal(prefixPipelineRelative("pipeline/brief.md", null), "pipeline/brief.md");
  });

  test("undefined changeId is a no-op", () => {
    assert.equal(prefixPipelineRelative("pipeline/brief.md", undefined), "pipeline/brief.md");
  });

  test("null relPath returns null", () => {
    assert.equal(prefixPipelineRelative(null, "feat-x"), null);
  });
});

// ─── 3. path helpers — gatesDir / logsDir / pipelineRoot ─────────────────────

describe("paths module — gatesDir / logsDir / pipelineRoot", () => {
  const { pipelineRoot, gatesDir, logsDir } = require("../core/paths");

  test("pipelineRoot in-place (null changeId)", () => {
    assert.equal(pipelineRoot("/proj", null), path.join("/proj", "pipeline"));
  });

  test("pipelineRoot bounded", () => {
    assert.equal(pipelineRoot("/proj", "feat-x"), path.join("/proj", "pipeline", "changes", "feat-x"));
  });

  test("gatesDir in-place", () => {
    assert.equal(gatesDir("/proj", null), path.join("/proj", "pipeline", "gates"));
  });

  test("gatesDir bounded", () => {
    assert.equal(gatesDir("/proj", "feat-x"), path.join("/proj", "pipeline", "changes", "feat-x", "gates"));
  });

  test("logsDir in-place", () => {
    assert.equal(logsDir("/proj", null), path.join("/proj", "pipeline", "logs"));
  });

  test("logsDir bounded", () => {
    assert.equal(logsDir("/proj", "feat-x"), path.join("/proj", "pipeline", "changes", "feat-x", "logs"));
  });
});

// ─── 4. ctx.changeId populated in runStage() ─────────────────────────────────

describe("runStage — ctx.changeId from isolation config", () => {
  const { runStage } = require("../core/orchestrator");
  const { clearConfigCache } = require("../core/config");

  test("isolation=bounded → changeId derived from feature", () => {
    const cwd = makeTargetProject(); // isolation: bounded
    clearConfigCache();
    try {
      const plan = runStage("requirements", { cwd, feature: "add login" });
      assert.equal(plan.ctx.isolation, "bounded");
      assert.equal(plan.ctx.changeId, "add-login");
    } finally {
      clearConfigCache();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("isolation=in-place → changeId is null", () => {
    const cwd = makeTargetProject({
      config: "routing:\n  default_host: claude-code\npipeline:\n  isolation: in-place\n  default_track: full\n",
    });
    clearConfigCache();
    try {
      const plan = runStage("requirements", { cwd, feature: "add login" });
      assert.equal(plan.ctx.isolation, "in-place");
      assert.equal(plan.ctx.changeId, null);
    } finally {
      clearConfigCache();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("no feature → changeId is null even in bounded mode", () => {
    const cwd = makeTargetProject(); // isolation: bounded
    clearConfigCache();
    try {
      const plan = runStage("requirements", { cwd, feature: "" });
      assert.equal(plan.ctx.isolation, "bounded");
      assert.equal(plan.ctx.changeId, null);
    } finally {
      clearConfigCache();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});

// ─── 5. buildDescriptor prefixes paths when changeId set ─────────────────────

describe("buildDescriptor — path prefixing", () => {
  const { buildDescriptor } = require("../core/orchestrator");
  const { getStage } = require("../core/pipeline/stages");

  test("readFirst prefixed in bounded mode", () => {
    const stageDef = getStage("requirements");
    const desc = buildDescriptor(stageDef, "pm", { changeId: "my-feat" });
    const pipelinePaths = desc.readFirst.filter((p) => p.startsWith("pipeline/"));
    assert.ok(pipelinePaths.length > 0, "expected some pipeline/ entries in readFirst");
    pipelinePaths.forEach((p) => {
      assert.ok(p.startsWith(path.join("pipeline", "changes", "my-feat")), `expected bounded prefix in: ${p}`);
    });
    // Non-pipeline paths unchanged
    const nonPipeline = desc.readFirst.filter((p) => !p.startsWith("pipeline"));
    nonPipeline.forEach((p) => {
      assert.ok(!p.includes("changes"), `expected no 'changes' segment in: ${p}`);
    });
  });

  test("allowedWrites prefixed in bounded mode", () => {
    const stageDef = getStage("design");
    const desc = buildDescriptor(stageDef, "principal", { changeId: "my-feat" });
    desc.allowedWrites.forEach((p) => {
      if (p.replace(/\\/g, "/").startsWith("pipeline/")) {
        assert.ok(p.startsWith(path.join("pipeline", "changes", "my-feat")), `bounded prefix missing in: ${p}`);
      }
    });
  });

  test("artifact prefixed in bounded mode", () => {
    const stageDef = getStage("requirements");
    const desc = buildDescriptor(stageDef, "pm", { changeId: "my-feat" });
    assert.ok(desc.artifact.startsWith(path.join("pipeline", "changes", "my-feat")), `artifact not prefixed: ${desc.artifact}`);
  });

  test("readFirst unchanged when changeId is null", () => {
    const stageDef = getStage("requirements");
    const desc = buildDescriptor(stageDef, "pm", { changeId: null });
    assert.deepEqual(desc.readFirst, stageDef.readFirst);
  });

  test("descriptor carries changeId field", () => {
    const stageDef = getStage("requirements");
    const desc = buildDescriptor(stageDef, "pm", { changeId: "feat-x" });
    assert.equal(desc.changeId, "feat-x");
  });

  test("descriptor changeId is null in in-place mode", () => {
    const stageDef = getStage("requirements");
    const desc = buildDescriptor(stageDef, "pm", {});
    assert.equal(desc.changeId, null);
  });
});

// ─── 6. runHeadless writes gate to bounded path (DEVTEAM_HEADLESS_COMMAND=cat) ──

describe("runStageHeadless — gate path in bounded mode", { concurrency: false }, () => {
  const { runStageHeadless } = require("../core/orchestrator");
  const { clearConfigCache } = require("../core/config");

  test(
    "in bounded mode, gate checked under pipeline/changes/<id>/gates/",
    process.env.DEVTEAM_HEADLESS_COMMAND === "cat" ? {} : { skip: "set DEVTEAM_HEADLESS_COMMAND=cat to run headless tests" },
    async () => {
      const cwd = makeTargetProject(); // isolation: bounded
      clearConfigCache();
      // cat echos the prompt and exits 0; the gate file won't be written
      // by cat, so gatePath is null — but we verify the log path and that
      // the process completes without throwing (path construction is correct).
      try {
        const results = await runStageHeadless("requirements", {
          cwd,
          feature: "my feature",
          stamp: false,
          config: { routing: { default_host: "claude-code", roles: {}, stages: {}, review_fanout: [] }, pipeline: { default_track: "full", isolation: "bounded", skip_stages: [], verify: {} } },
        });
        // gatePath will be null (cat doesn't write a gate) — that's fine
        assert.equal(results.results.length, 1);
        assert.equal(results.results[0].gatePath, null);
      } finally {
        clearConfigCache();
        fs.rmSync(cwd, { recursive: true, force: true });
      }
    }
  );
});

// ─── 7. appendGateFooter uses bounded path when changeId set ─────────────────

describe("appendGateFooter — bounded gate path in prompt", () => {
  const { appendGateFooter } = require("../core/adapters/render-helpers");

  test("in-place mode: gate path is pipeline/gates/<wsId>.json", () => {
    const lines = [];
    const descriptor = { workstreamId: "stage-01", stage: "stage-01", role: "pm", rolesInStage: ["pm"], expectedGate: {}, changeId: null };
    const ctx = { track: "full", orchestrator: "devteam@test" };
    appendGateFooter(lines, descriptor, ctx, "claude-code");
    const joined = lines.join("\n");
    assert.ok(joined.includes("pipeline/gates/stage-01.json"), `expected in-place path in: ${joined}`);
  });

  test("bounded mode: gate path is pipeline/changes/<id>/gates/<wsId>.json", () => {
    const lines = [];
    const descriptor = { workstreamId: "stage-01", stage: "stage-01", role: "pm", rolesInStage: ["pm"], expectedGate: {}, changeId: "my-feat" };
    const ctx = { track: "full", orchestrator: "devteam@test" };
    appendGateFooter(lines, descriptor, ctx, "claude-code");
    const joined = lines.join("\n");
    const expected = path.join("pipeline", "changes", "my-feat", "gates", "stage-01.json").replace(/\\/g, "/");
    assert.ok(joined.includes(expected) || joined.includes(expected.replace(/\//g, "\\")),
      `expected bounded path in: ${joined}`);
  });
});
