// Per-stage role-brief trimming (core/pipeline/brief-sections.js): the inlined
// copy of a role brief keeps only the task sections for the stage being
// dispatched. The brief on disk is untouched. Measured on the loop track:
// requirements 26,994 → 22,991 prompt bytes, build 25,729 → 22,009 — re-sent on
// every model turn of every dispatch.

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { REPO_ROOT } = require("./_helpers");
const { loadAdapter } = require("./_host-plugins");
const { buildDescriptor } = require(path.join(REPO_ROOT, "core", "orchestrator"));
const { getStage, STAGES } = require(path.join(REPO_ROOT, "core", "pipeline", "stages"));
const { BRIEF_TASK_SECTIONS, splitTopLevelSections, isTaskHeading, trimBriefForStage } = require(path.join(REPO_ROOT, "core", "pipeline", "brief-sections"));

const BRIEF = [
  "# Backend",
  "intro line",
  "",
  "## Read First",
  "- `AGENTS.md`",
  "",
  "## Standing Rules (apply to every task)",
  "always",
  "",
  "## On a Build Task",
  "build steps",
  "",
  "## On a Code Review Task",
  "review steps. Write this format:",
  "",
  "```markdown",
  "## Review of frontend",
  "<comments>",
  "```",
  "",
  "## On a Test Fix Task",
  "fix steps",
  "",
  "## On a Retrospective Task",
  "retro steps",
  "",
  "## Gate Writing Rules",
  "gate rules",
].join("\n");

describe("splitTopLevelSections", () => {
  test("splits at ## headings and ignores headings inside code fences", () => {
    const sections = splitTopLevelSections(BRIEF);
    assert.deepEqual(sections.map((s) => s.heading), [
      null, "Read First", "Standing Rules (apply to every task)", "On a Build Task",
      "On a Code Review Task", "On a Test Fix Task", "On a Retrospective Task", "Gate Writing Rules",
    ]);
    const review = sections.find((s) => s.heading === "On a Code Review Task");
    assert.ok(review.lines.includes("## Review of frontend"), "fenced example heading stays inside its section");
  });

  test("isTaskHeading recognises the On … convention only", () => {
    assert.equal(isTaskHeading("On a Build Task"), true);
    assert.equal(isTaskHeading("On an Executable-Spec Request (stage-03b, G2)"), true);
    assert.equal(isTaskHeading("On Chairing a Design Review"), true);
    assert.equal(isTaskHeading("Standing Rules (apply to every task)"), false);
    assert.equal(isTaskHeading("Gate Writing Rules"), false);
    assert.equal(isTaskHeading(null), false);
  });
});

describe("trimBriefForStage", () => {
  test("stage-04 keeps Build and Test Fix, drops Code Review and Retrospective, keeps every common section", () => {
    const { text, omitted } = trimBriefForStage(BRIEF, "stage-04");
    assert.deepEqual(omitted, ["On a Code Review Task", "On a Retrospective Task"]);
    for (const kept of ["# Backend", "intro line", "## Read First", "## Standing Rules", "## On a Build Task", "build steps", "## On a Test Fix Task", "## Gate Writing Rules", "gate rules"]) {
      assert.ok(text.includes(kept), `missing: ${kept}`);
    }
    assert.ok(!text.includes("review steps"));
    assert.ok(!text.includes("## Review of frontend"), "the fenced example goes with its section");
    assert.ok(!text.includes("retro steps"));
  });

  test("stage-05 keeps Code Review (with its fenced example) and drops Build/Test Fix/Retro", () => {
    const { text, omitted } = trimBriefForStage(BRIEF, "stage-05");
    assert.deepEqual(omitted, ["On a Build Task", "On a Test Fix Task", "On a Retrospective Task"]);
    assert.ok(text.includes("## Review of frontend"));
    assert.ok(!text.includes("build steps"));
  });

  test("a multi-stage section is kept for each of its stages", () => {
    assert.ok(trimBriefForStage(BRIEF, "stage-04").text.includes("fix steps"));
    assert.ok(trimBriefForStage(BRIEF, "stage-06").text.includes("fix steps"));
    assert.ok(!trimBriefForStage(BRIEF, "stage-09").text.includes("fix steps"));
  });

  test("a stage with no task section in this brief drops the others and keeps the rest", () => {
    const { text, omitted } = trimBriefForStage(BRIEF, "stage-06b");
    assert.equal(omitted.length, 4);
    assert.ok(text.includes("## Standing Rules"));
  });

  test("nothing to drop → input returned unchanged; bad inputs pass through", () => {
    const common = "# QA\n\n## Read First\n- x\n\n## Task Skills\ntable\n";
    assert.deepEqual(trimBriefForStage(common, "stage-06"), { text: common, omitted: [] });
    assert.deepEqual(trimBriefForStage(BRIEF, null), { text: BRIEF, omitted: [] });
    assert.deepEqual(trimBriefForStage(null, "stage-04"), { text: null, omitted: [] });
  });

  test("an unmapped task heading is kept, not dropped", () => {
    const b = "# R\n\n## On a Mystery Task\nmystery\n\n## On a Build Task\nbuild\n";
    const { text, omitted } = trimBriefForStage(b, "stage-01");
    assert.ok(text.includes("mystery"), "unknown task sections are kept (the drift guard below makes them a failure instead)");
    assert.deepEqual(omitted, ["On a Build Task"]);
  });
});

describe("drift guard: every task heading in roles/*.md is mapped to exactly one entry", () => {
  const rolesDir = path.join(REPO_ROOT, "roles");
  for (const file of fs.readdirSync(rolesDir).filter((f) => f.endsWith(".md"))) {
    test(file, () => {
      const sections = splitTopLevelSections(fs.readFileSync(path.join(rolesDir, file), "utf8"));
      for (const s of sections) {
        if (!isTaskHeading(s.heading)) continue;
        const matches = BRIEF_TASK_SECTIONS.filter((e) => e.match.test(s.heading));
        assert.equal(matches.length, 1, `${file}: "## ${s.heading}" matches ${matches.length} entries in BRIEF_TASK_SECTIONS (expected exactly 1)`);
        for (const stage of matches[0].stages) {
          assert.ok(Object.values(STAGES).some((d) => d.stage === stage), `${file}: entry for "${s.heading}" names unknown stage ${stage}`);
        }
      }
    });
  }
});

describe("rendered prompts carry only the dispatched stage's sections", () => {
  const dirs = [];
  function mkProject(extraConfig = "") {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "devteam-trim-"));
    dirs.push(cwd);
    fs.mkdirSync(path.join(cwd, ".devteam"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".devteam", "config.yml"), `routing:\n  default_host: omp\n${extraConfig}`);
    fs.writeFileSync(path.join(cwd, "AGENTS.md"), "# Project context\n");
    loadAdapter("omp").install(cwd, { force: true });
    return cwd;
  }
  process.on("exit", () => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
  const render = (cwd, stageName, role, extraCtx = {}) => {
    const adapter = loadAdapter("omp");
    const stage = getStage(stageName);
    const descriptor = buildDescriptor(stage, role, { cwd, track: "loop", rolesInStage: [role] });
    return adapter.renderStagePromptLayers(descriptor, { track: "loop", orchestrator: "devteam@test", cwd, feature: "x", ...extraCtx });
  };

  test("requirements (pm): brief section kept, sign-off/retro/spec dropped and named", () => {
    const cwd = mkProject();
    const { layers } = render(cwd, "requirements", "pm");
    const brief = layers[1];
    assert.match(brief, /## On a Brief Request/);
    assert.doesNotMatch(brief, /## On a Sign-off Request/);
    assert.doesNotMatch(brief, /## On a Retrospective Task/);
    assert.match(brief, /\(Sections for other stages omitted from this inlined copy: .*On a Sign-off Request.*Full brief: `\.omp\/prompts\/roles\/pm\.md`\.\)/);
    assert.match(brief, /## Gate Writing Rules/, "common sections stay");
  });

  test("build (backend): Build and Test Fix kept, Code Review and Retro dropped", () => {
    const cwd = mkProject();
    const brief = render(cwd, "build", "backend").layers[1];
    assert.match(brief, /## On a Build Task/);
    assert.match(brief, /## On a Test Fix Task/);
    assert.doesNotMatch(brief, /## On a Code Review Task/);
    assert.doesNotMatch(brief, /## On a Retrospective Task/);
  });

  test("qa: brief has no task sections, so nothing is dropped and no note is added", () => {
    const cwd = mkProject();
    const brief = render(cwd, "qa", "qa").layers[1];
    assert.doesNotMatch(brief, /Sections for other stages omitted/);
    assert.match(brief, /## Task Skills/);
  });

  test("trim_role_brief: false inlines the whole brief", () => {
    const cwd = mkProject("prompts:\n  trim_role_brief: false\n");
    const brief = render(cwd, "requirements", "pm").layers[1];
    assert.match(brief, /## On a Sign-off Request/);
    assert.doesNotMatch(brief, /Sections for other stages omitted/);
  });

  test("layer 2 is byte-identical across two dispatches of the same role and stage", () => {
    const cwd = mkProject();
    const a = render(cwd, "build", "backend", { feature: "first" }).layers[1];
    const b = render(cwd, "build", "backend", { feature: "second" }).layers[1];
    assert.equal(a, b);
  });

  test("the installed brief on disk is untouched", () => {
    const cwd = mkProject();
    render(cwd, "requirements", "pm");
    const onDisk = fs.readFileSync(path.join(cwd, ".omp", "prompts", "roles", "pm.md"), "utf8");
    assert.match(onDisk, /## On a Sign-off Request/);
    assert.doesNotMatch(onDisk, /Sections for other stages omitted/);
  });
});
