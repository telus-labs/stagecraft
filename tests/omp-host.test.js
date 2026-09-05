// hosts/omp — dispatch config overlay and host notes.
//
// A real QA dispatch through omp timed out at 600 s: the model started the
// server in the foreground ten times, and omp only auto-backgrounds a
// command after 60 s. Two guards came out of it — a per-run settings overlay
// (`--config .devteam/omp/dispatch.yml`, which omp hard-errors on if missing,
// so install/status/uninstall own it) and host notes rendered into every
// prompt telling the model to background servers. These tests pin both.

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { REPO_ROOT } = require("./_helpers");
const { loadAdapter } = require("./_host-plugins");
const { buildDescriptor } = require(path.join(REPO_ROOT, "core", "orchestrator"));
const { getStage } = require(path.join(REPO_ROOT, "core", "pipeline", "stages"));
const { splitCommand } = require(path.join(REPO_ROOT, "core", "command-line"));

const dirs = [];
function mkProject() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "devteam-omp-host-"));
  dirs.push(cwd);
  fs.mkdirSync(path.join(cwd, ".devteam"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".devteam", "config.yml"), "routing:\n  default_host: omp\n");
  fs.writeFileSync(path.join(cwd, "AGENTS.md"), "# Project context\n");
  return cwd;
}
process.on("exit", () => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

const adapter = loadAdapter("omp");
const caps = adapter.capabilities;
const overlayRel = caps.dispatchConfigPath;

describe("hosts/omp dispatch config overlay", () => {
  test("headlessCommand passes the overlay path that install() writes", () => {
    const { args } = splitCommand(caps.headlessCommand, "headlessCommand");
    const i = args.indexOf("--config");
    assert.ok(i >= 0, "headlessCommand must carry --config");
    assert.equal(args[i + 1], overlayRel);
    assert.equal(overlayRel, ".devteam/omp/dispatch.yml");
  });

  test("install writes it, status sees it, uninstall removes it", () => {
    const cwd = mkProject();
    const r = adapter.install(cwd, { force: true });
    const abs = path.join(cwd, overlayRel);
    assert.ok(r.written.includes(abs), "install must report the overlay as written");
    assert.ok(fs.existsSync(abs));
    const body = fs.readFileSync(abs, "utf8");
    assert.match(body, /^tools:\n {2}maxTimeout: 120/m);
    assert.equal(adapter.status(cwd).ok, true);

    fs.unlinkSync(abs);
    const st = adapter.status(cwd);
    assert.equal(st.ok, false);
    assert.ok(st.missing.includes(abs), "status must name the missing overlay — omp hard-errors without it");

    adapter.install(cwd, { force: true });
    adapter.uninstall(cwd);
    assert.equal(fs.existsSync(abs), false);
    assert.equal(fs.existsSync(path.dirname(abs)), false, "empty .devteam/omp/ is removed too");
  });

  test("an operator's edited overlay survives a non-force re-install", () => {
    const cwd = mkProject();
    adapter.install(cwd, { force: true });
    const abs = path.join(cwd, overlayRel);
    fs.writeFileSync(abs, "tools:\n  maxTimeout: 45\n");
    const r = adapter.install(cwd, {});
    assert.ok(r.skipped.includes(abs));
    assert.match(fs.readFileSync(abs, "utf8"), /maxTimeout: 45/);
  });
});

describe("hosts/omp host notes in the rendered prompt", () => {
  test("rendered inside layer 2, after the role brief, naming the host", () => {
    const cwd = mkProject();
    adapter.install(cwd, { force: true });
    const descriptor = buildDescriptor(getStage("qa"), "qa", { cwd });
    const ctx = { track: "loop", orchestrator: "devteam@test", cwd, feature: "x" };
    const { layers } = adapter.renderStagePromptLayers(descriptor, ctx);
    assert.match(layers[1], /## Host notes \(Oh My Pi\)/);
    assert.match(layers[1], /Never start a server, file watcher, or REPL in the foreground/);
    assert.match(layers[1], /`async: true`/);
    assert.match(layers[1], /capped at 120 s by `\.devteam\/omp\/dispatch\.yml`/);
    assert.ok(layers[1].indexOf("## Host notes") > layers[1].indexOf("Role brief for `qa`"), "host notes follow the brief");
    assert.doesNotMatch(layers[3], /## Host notes/, "host notes are not repeated in the volatile tail");
  });

  test("a host without promptNotes renders no Host notes section", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "devteam-codex-host-"));
    dirs.push(cwd);
    fs.mkdirSync(path.join(cwd, ".devteam"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".devteam", "config.yml"), "routing:\n  default_host: codex\n");
    fs.writeFileSync(path.join(cwd, "AGENTS.md"), "# Project context\n");
    const codex = loadAdapter("codex");
    codex.install(cwd, { force: true });
    const descriptor = buildDescriptor(getStage("qa"), "qa", { cwd });
    const prompt = codex.renderStagePrompt(descriptor, { track: "loop", orchestrator: "devteam@test", cwd, feature: "x" });
    assert.doesNotMatch(prompt, /## Host notes/);
  });
});
