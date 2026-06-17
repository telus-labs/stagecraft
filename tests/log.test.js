// `devteam log` — chronological event timeline of pipeline state.
// Tests cover both the journal module's event-building logic and the
// CLI command's rendering / --json / --follow behavior.

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { REPO_ROOT, BIN, makeTargetProject, seedGate, cleanup } = require("./_helpers");
const { buildEvents, summarizeGate } = require(path.join(REPO_ROOT, "core", "log", "journal"));

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
afterEach(() => { _dirs.forEach(cleanup); _dirs = []; });

function run(args, opts = {}) {
  const r = spawnSync("node", [BIN, ...args], {
    cwd: opts.cwd, encoding: "utf8", env: { ...process.env, ...(opts.env || {}) },
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function writeArtifact(cwd, rel, content) {
  const full = path.join(cwd, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

// Tiny helper: set a known mtime so chronological ordering is testable
// without relying on real-time gaps.
function setMtime(p, isoString) {
  const d = new Date(isoString);
  fs.utimesSync(p, d, d);
}

describe("journal: buildEvents", () => {
  it("returns empty list for a fresh project with no pipeline/", () => {
    const cwd = track(makeTargetProject({ gates: false }));
    // Remove the pipeline/ dir if makeTargetProject created it
    const p = path.join(cwd, "pipeline");
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true });
    assert.deepEqual(buildEvents(cwd), []);
  });

  it("returns gate events from pipeline/gates/", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { stage: "stage-01", status: "PASS" });
    const events = buildEvents(cwd);
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "gate");
    assert.equal(events[0].gate.stage, "stage-01");
    assert.equal(events[0].gate.status, "PASS");
  });

  it("returns artifact events for known markdown files", () => {
    const cwd = track(makeTargetProject());
    writeArtifact(cwd, "pipeline/brief.md", "# Brief\n");
    writeArtifact(cwd, "pipeline/pr-backend.md", "# PR backend\n");
    writeArtifact(cwd, "pipeline/code-review/by-frontend.md", "# review\n");
    const events = buildEvents(cwd);
    const artifacts = events.filter((e) => e.kind === "artifact");
    assert.equal(artifacts.length, 3);
    const briefEvent = artifacts.find((e) => e.path.endsWith("brief.md"));
    assert.equal(briefEvent.owner, "pm");
    assert.equal(briefEvent.artifactKind, "brief");
    const prEvent = artifacts.find((e) => e.path.endsWith("pr-backend.md"));
    assert.equal(prEvent.owner, "backend");
    const reviewEvent = artifacts.find((e) => e.path.endsWith("by-frontend.md"));
    assert.equal(reviewEvent.owner, "frontend", "review file owner derives from by-<name>.md");
  });

  it("skips pipeline/context.md (would flood the timeline)", () => {
    const cwd = track(makeTargetProject());
    writeArtifact(cwd, "pipeline/context.md", "lots of mutations\n");
    writeArtifact(cwd, "pipeline/brief.md", "# Brief\n");
    const events = buildEvents(cwd);
    const artifacts = events.filter((e) => e.kind === "artifact");
    assert.equal(artifacts.length, 1);
    assert.ok(artifacts[0].path.endsWith("brief.md"));
  });

  it("skips pipeline/logs/ (would be self-referential)", () => {
    const cwd = track(makeTargetProject());
    writeArtifact(cwd, "pipeline/logs/stage-01.log", "transcript\n");
    writeArtifact(cwd, "pipeline/brief.md", "# Brief\n");
    const events = buildEvents(cwd);
    const artifacts = events.filter((e) => e.kind === "artifact");
    assert.equal(artifacts.length, 1);
    assert.ok(artifacts[0].path.endsWith("brief.md"));
  });

  it("skips unknown files in pipeline/ (random debug output, etc.)", () => {
    const cwd = track(makeTargetProject());
    writeArtifact(cwd, "pipeline/notes.txt", "scratch\n");
    writeArtifact(cwd, "pipeline/brief.md", "# Brief\n");
    const events = buildEvents(cwd);
    const artifacts = events.filter((e) => e.kind === "artifact");
    assert.equal(artifacts.length, 1);
  });

  it("sorts events by mtime ascending", () => {
    const cwd = track(makeTargetProject());
    const brief = writeArtifact(cwd, "pipeline/brief.md", "1");
    const designSpec = writeArtifact(cwd, "pipeline/design-spec.md", "2");
    setMtime(brief, "2026-06-02T10:00:00Z");
    setMtime(designSpec, "2026-06-02T10:05:00Z");
    const events = buildEvents(cwd);
    assert.ok(events[0].mtime < events[1].mtime);
    assert.ok(events[0].path.endsWith("brief.md"));
    assert.ok(events[1].path.endsWith("design-spec.md"));
  });

  it("skips malformed gate JSON without crashing", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { stage: "stage-01", status: "PASS" });
    fs.writeFileSync(path.join(cwd, "pipeline", "gates", "stage-02.json"), "{not json");
    const events = buildEvents(cwd);
    // Only stage-01 survives
    const gates = events.filter((e) => e.kind === "gate");
    assert.equal(gates.length, 1);
    assert.equal(gates[0].gate.stage, "stage-01");
  });

  it("derives ADR artifacts from pipeline/adr/*.md", () => {
    const cwd = track(makeTargetProject());
    writeArtifact(cwd, "pipeline/adr/0001-event-bus.md", "# ADR 0001\n");
    const events = buildEvents(cwd);
    const adrs = events.filter((e) => e.kind === "artifact" && e.artifactKind === "adr");
    assert.equal(adrs.length, 1);
    assert.equal(adrs[0].owner, "principal");
  });

  it("suppresses artifacts older than brief.md (prior-run artifacts)", () => {
    const cwd = track(makeTargetProject());
    // Simulate first-run artifacts written at t0, then brief.md for second
    // feature written at t1 > t0. Old artifacts must not appear in the log.
    const adr = writeArtifact(cwd, "pipeline/adr/0001-old.md", "# old ADR\n");
    const designSpec = writeArtifact(cwd, "pipeline/design-spec.md", "# old design\n");
    setMtime(adr, "2026-06-10T17:00:00Z");
    setMtime(designSpec, "2026-06-10T19:00:00Z");
    const brief = writeArtifact(cwd, "pipeline/brief.md", "# new feature brief\n");
    setMtime(brief, "2026-06-10T22:50:00Z");
    const events = buildEvents(cwd);
    const artifacts = events.filter((e) => e.kind === "artifact");
    assert.equal(artifacts.length, 1, "only brief.md survives; stale adr and design-spec are hidden");
    assert.ok(artifacts[0].path.endsWith("brief.md"));
  });

  it("shows all artifacts when no brief.md exists (epoch = 0, no filtering)", () => {
    const cwd = track(makeTargetProject());
    // Project with no brief yet — epoch is 0, nothing is filtered.
    const adr = writeArtifact(cwd, "pipeline/adr/0001-new.md", "# ADR\n");
    setMtime(adr, "2026-06-10T17:00:00Z");
    const events = buildEvents(cwd);
    const artifacts = events.filter((e) => e.kind === "artifact");
    assert.equal(artifacts.length, 1);
    assert.ok(artifacts[0].path.endsWith("0001-new.md"));
  });

  it("brief.md itself is always shown (mtime equals epoch, not older than it)", () => {
    const cwd = track(makeTargetProject());
    const brief = writeArtifact(cwd, "pipeline/brief.md", "# Brief\n");
    setMtime(brief, "2026-06-10T22:50:00Z");
    const events = buildEvents(cwd);
    const artifacts = events.filter((e) => e.kind === "artifact");
    assert.equal(artifacts.length, 1);
    assert.ok(artifacts[0].path.endsWith("brief.md"));
  });
});

describe("journal: summarizeGate (per-stage extras)", () => {
  it("stage-04a shows lint / tests / deps marks", () => {
    const s = summarizeGate({
      stage: "stage-04a", status: "PASS",
      lint_passed: true, tests_passed: false, dependency_review_passed: true,
    });
    assert.equal(s.icon, "✓");
    assert.match(s.extras, /lint ✓/);
    assert.match(s.extras, /tests ✗/);
    assert.match(s.extras, /deps ✓/);
  });

  it("stage-04 reports workstream counts from workstreams[]", () => {
    const s = summarizeGate({
      stage: "stage-04", status: "PASS",
      workstreams: [
        { workstream: "backend",  status: "PASS" },
        { workstream: "frontend", status: "PASS" },
        { workstream: "platform", status: "WARN" },
        { workstream: "qa",       status: "PASS" },
      ],
    });
    assert.match(s.extras, /3\/4 workstreams/);
  });

  it("stage-06 reports tests + AC outcome", () => {
    const s = summarizeGate({
      stage: "stage-06", status: "PASS",
      tests_total: 42, tests_passed: 42, all_acceptance_criteria_met: true,
    });
    assert.match(s.extras, /42\/42 tests/);
    assert.match(s.extras, /AC ✓/);
  });

  it("stage-07 shows auto-fold when applicable", () => {
    const s = summarizeGate({
      stage: "stage-07", status: "PASS",
      auto_from_stage_06: true, pm_signoff: true,
    });
    assert.match(s.extras, /auto-fold/);
    assert.match(s.extras, /PM signoff/);
  });

  it("ESCALATE uses the alert icon", () => {
    const s = summarizeGate({ stage: "stage-05", status: "ESCALATE" });
    assert.equal(s.icon, "🚨");
  });

  it("blockers and warnings are surfaced", () => {
    const s = summarizeGate({
      stage: "stage-04", status: "FAIL",
      blockers: ["a", "b"], warnings: ["w"],
    });
    assert.match(s.extras, /2 blockers/);
    assert.match(s.extras, /1 warning/);
  });
});

describe("devteam log CLI", () => {
  it("empty pipeline → empty output, exit 0", () => {
    const cwd = track(makeTargetProject({ gates: false }));
    fs.rmSync(path.join(cwd, "pipeline"), { recursive: true, force: true });
    const r = run(["log"], { cwd });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });

  it("renders one line per gate in chronological order", () => {
    const cwd = track(makeTargetProject());
    const g1 = seedGate(cwd, "stage-01", { stage: "stage-01", status: "PASS" });
    const g2 = seedGate(cwd, "stage-02", { stage: "stage-02", status: "PASS" });
    setMtime(g1, "2026-06-02T10:00:00Z");
    setMtime(g2, "2026-06-02T10:05:00Z");
    const r = run(["log"], { cwd });
    assert.equal(r.status, 0);
    const lines = r.stdout.trim().split("\n");
    assert.equal(lines.length, 2);
    assert.match(lines[0], /stage-01/);
    assert.match(lines[1], /stage-02/);
    // Lines start with HH:MM:SS time
    assert.match(lines[0], /^\d{2}:\d{2}:\d{2}/);
  });

  it("renders artifact lines with owner attribution", () => {
    const cwd = track(makeTargetProject());
    writeArtifact(cwd, "pipeline/pr-backend.md", "line 1\nline 2\nline 3\n");
    const r = run(["log"], { cwd });
    assert.match(r.stdout, /📝/);
    assert.match(r.stdout, /pr-backend\.md/);
    assert.match(r.stdout, /\(backend\)/);
  });

  it("--json emits one JSON object per line (NDJSON)", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { stage: "stage-01", workstream: "pm", status: "PASS" });
    writeArtifact(cwd, "pipeline/brief.md", "# Brief\n");
    const r = run(["log", "--json"], { cwd });
    assert.equal(r.status, 0);
    const lines = r.stdout.trim().split("\n");
    for (const line of lines) {
      const obj = JSON.parse(line);
      assert.ok(obj.ts && obj.kind && obj.path);
    }
    const gateLine = lines.map(JSON.parse).find((o) => o.kind === "gate");
    assert.equal(gateLine.stage, "stage-01");
    assert.equal(gateLine.status, "PASS");
    const artifactLine = lines.map(JSON.parse).find((o) => o.kind === "artifact");
    assert.equal(artifactLine.owner, "pm");
  });

  it("renders the right status icon per gate", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-01", { stage: "stage-01", status: "PASS" });
    seedGate(cwd, "stage-02", { stage: "stage-02", status: "FAIL", blockers: ["b"] });
    seedGate(cwd, "stage-03", { stage: "stage-03", status: "ESCALATE" });
    const r = run(["log"], { cwd });
    assert.match(r.stdout, /✓.*stage-01/);
    assert.match(r.stdout, /✗.*stage-02/);
    assert.match(r.stdout, /🚨.*stage-03/);
  });
});

describe("devteam log documentation", () => {
  it("documents the --json NDJSON event shape", () => {
    const doc = fs.readFileSync(path.join(REPO_ROOT, "docs", "observability.md"), "utf8");
    assert.match(doc, /## Pipeline log JSON/);
    for (const field of ["`ts`", "`kind`", "`path`", "`stage`", "`workstream`", "`status`", "`owner`", "`artifactKind`"]) {
      assert.match(doc, new RegExp(field.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&")));
    }
    assert.match(doc, /newline-delimited JSON \(NDJSON\)/);
  });
});
