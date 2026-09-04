// Double-instruction fix for inlined prompts (post-37.2).
//
// With prompts.inline_framework (default), layer 1 inlines AGENTS.md and the
// rules files and layer 2 inlines the role brief. The rendered prompt still
// told the model to "Read the role prompt at <path>" and, inside the inlined
// brief, its "## Read First" list still named the very files layer 1 had just
// inlined. A live omp stage-01 dispatch obeyed both: 8 of 13 file reads were
// re-reads of inlined content. These tests pin the fix: no re-read
// instruction for inlined content, volatile Read-First entries preserved, the
// on-disk brief untouched, and the pre-inlining behaviour intact when
// inlining is off.

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { REPO_ROOT } = require("./_helpers");
const { loadAdapter } = require("./_host-plugins");
const { buildDescriptor } = require(path.join(REPO_ROOT, "core", "orchestrator"));
const { getStage, FRAMEWORK_READ_FIRST } = require(path.join(REPO_ROOT, "core", "pipeline", "stages"));
const { annotateInlinedReadFirst } = require(path.join(REPO_ROOT, "core", "adapters", "render-helpers"));

const dirs = [];
function mkProject(host) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `devteam-dbl-${host}-`));
  dirs.push(cwd);
  fs.mkdirSync(path.join(cwd, ".devteam"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".devteam", "config.yml"), `routing:\n  default_host: ${host}\n`);
  fs.writeFileSync(path.join(cwd, "AGENTS.md"), "# Project context\n");
  loadAdapter(host).install(cwd, { force: true });
  return cwd;
}
process.on("exit", () => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function render(host, ctxExtra = {}) {
  const cwd = mkProject(host);
  const adapter = loadAdapter(host);
  const descriptor = buildDescriptor(getStage("requirements"), "pm", { cwd });
  const ctx = { track: "loop", orchestrator: "devteam@test", cwd, feature: "x", ...ctxExtra };
  return { cwd, prompt: adapter.renderStagePrompt(descriptor, ctx) };
}

describe("annotateInlinedReadFirst", () => {
  const brief = [
    "# PM",
    "",
    "## Read First",
    "",
    "- `AGENTS.md`",
    "- `.devteam/rules/pipeline.md`",
    "- `.devteam/rules/gates-core.md`",
    "- `pipeline/context.md`",
    "- `pipeline/lessons-learned.md` (if present)",
    "",
    "## Writes",
    "",
    "- `pipeline/brief.md`",
  ].join("\n");

  test("drops bullets for inlined files, keeps the rest, adds one note", () => {
    const out = annotateInlinedReadFirst(brief, FRAMEWORK_READ_FIRST);
    assert.doesNotMatch(out, /^- `AGENTS\.md`$/m);
    assert.doesNotMatch(out, /^- `\.devteam\/rules\/pipeline\.md`$/m);
    assert.doesNotMatch(out, /^- `\.devteam\/rules\/gates-core\.md`$/m);
    assert.match(out, /^- `pipeline\/context\.md`$/m);
    assert.match(out, /^- `pipeline\/lessons-learned\.md` \(if present\)$/m);
    assert.match(out, /are already inlined above under "Framework" — do not re-read them\./);
    assert.match(out, /## Writes\n\n- `pipeline\/brief\.md`/, "sections after Read First are untouched");
    assert.equal((out.match(/already inlined above/g) || []).length, 1);
  });

  test("is a no-op without a Read First section, without inlined files, or when nothing matches", () => {
    assert.equal(annotateInlinedReadFirst("# X\n\n## Writes\n- `a`\n", FRAMEWORK_READ_FIRST), "# X\n\n## Writes\n- `a`\n");
    assert.equal(annotateInlinedReadFirst(brief, []), brief);
    assert.equal(annotateInlinedReadFirst(brief, ["not/inlined.md"]), brief);
    assert.equal(annotateInlinedReadFirst(null, FRAMEWORK_READ_FIRST), null);
  });

  test("singular wording when exactly one file was inlined", () => {
    const out = annotateInlinedReadFirst(brief, ["AGENTS.md"]);
    assert.match(out, /`AGENTS\.md` is already inlined above under "Framework" — do not re-read it\./);
    assert.match(out, /^- `\.devteam\/rules\/pipeline\.md`$/m, "non-inlined framework bullets stay");
  });
});

describe("markdown-host prompts do not tell the model to re-read inlined content", () => {
  for (const host of ["omp", "codex"]) {
    test(`${host}: inlined → no "Read the role prompt at", Read First annotated, volatile entries kept`, () => {
      const { prompt } = render(host);
      assert.match(prompt, /^## Framework \(inlined below/m, "precondition: inlining is on by default");
      assert.doesNotMatch(prompt, /Read the role prompt at/);
      assert.match(prompt, /Role brief for `pm` \(inlined below; source: `[^`]+` — already in this prompt, no need to read it\)\./);
      // The inlined brief's Read First no longer re-lists layer-1 files…
      const briefStart = prompt.indexOf("Role brief for `pm`");
      const readFirst = prompt.slice(briefStart).match(/## Read First\n([\s\S]*?)\n## /);
      assert.ok(readFirst, "inlined brief keeps its Read First heading");
      for (const f of FRAMEWORK_READ_FIRST) {
        assert.ok(!readFirst[1].includes(`- \`${f}\``), `Read First still instructs a re-read of ${f}`);
      }
      assert.match(readFirst[1], /already inlined above under "Framework"/);
      // …but the volatile ones it cannot inline are still there.
      assert.match(readFirst[1], /- `pipeline\/context\.md`/);
    });
  }

  test("inlining off → the original pointer and the brief's full Read First list are back", () => {
    const { prompt } = render("omp", { inlineFrameworkOverride: false });
    assert.match(prompt, /^## Framework \(read first — every stage, every role\)/m);
    assert.match(prompt, /Read the role prompt at `\.omp\/prompts\/roles\/pm\.md` before acting on this stage\./);
    assert.doesNotMatch(prompt, /inlined below; source:/);
    assert.doesNotMatch(prompt, /already inlined above/);
  });

  test("the installed brief on disk is untouched — only the inlined copy is annotated", () => {
    const { cwd } = render("omp");
    const onDisk = fs.readFileSync(path.join(cwd, ".omp", "prompts", "roles", "pm.md"), "utf8");
    assert.match(onDisk, /^- `AGENTS\.md`$/m);
    assert.doesNotMatch(onDisk, /already inlined above/);
  });
});

describe("claude-code keeps its subagent instruction but gets the same Read First annotation", () => {
  test("pointer sentence unchanged, inlined brief annotated", () => {
    const { prompt } = render("claude-code");
    assert.match(prompt, /Use the \*\*pm\*\* subagent \(`\.claude\/agents\/pm\.md`\) for this workstream\./);
    assert.doesNotMatch(prompt, /Read the role prompt at/);
    assert.match(prompt, /already inlined above under "Framework"/);
  });
});
