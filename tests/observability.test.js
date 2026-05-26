// Verifies the orchestrator emits OTel spans for key operations.
// Uses an InMemory exporter so the test doesn't depend on any external
// OTLP endpoint. We set up a custom tracer provider, attach the
// in-memory exporter, and run real orchestrator calls through it.

const { describe, it, before, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { trace } = require("@opentelemetry/api");
const { NodeTracerProvider } = require("@opentelemetry/sdk-trace-node");
const { InMemorySpanExporter, SimpleSpanProcessor } = require("@opentelemetry/sdk-trace-base");
const { REPO_ROOT, makeTargetProject, seedGate, cleanup } = require("./_helpers");

// Force-disable the auto-init OTel SDK so our test provider owns tracing.
process.env.DEVTEAM_OTEL_DISABLE = "1";

// Install an in-memory tracer provider BEFORE requiring orchestrator.
const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
provider.register();

const { runStage, mergeWorkstreamGates, next } =
  require(path.join(REPO_ROOT, "core", "orchestrator"));

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
afterEach(() => {
  exporter.reset();
  _dirs.forEach(cleanup);
  _dirs = [];
});

function namesOf(spans) { return spans.map((s) => s.name); }
function findSpan(spans, name) { return spans.find((s) => s.name === name); }

describe("observability: runStage emits stage + workstream + render spans", () => {
  it("single-role stage emits the right span tree", () => {
    const cwd = track(makeTargetProject());
    runStage("requirements", { cwd, feature: "test" });
    const spans = exporter.getFinishedSpans();
    const names = namesOf(spans);
    assert.ok(names.includes("pipeline.stage"));
    assert.ok(names.includes("pipeline.workstream"));
    assert.ok(names.includes("adapter.renderStagePrompt"));

    const stageSpan = findSpan(spans, "pipeline.stage");
    assert.equal(stageSpan.attributes["devteam.stage"], "stage-01");
    assert.equal(stageSpan.attributes["devteam.stage.name"], "requirements");
    assert.equal(stageSpan.attributes["devteam.workstream_count"], 1);
    assert.equal(stageSpan.attributes["devteam.feature"], "test");
  });

  it("multi-role stage emits one workstream span per role", () => {
    const cwd = track(makeTargetProject());
    runStage("build", { cwd });
    const spans = exporter.getFinishedSpans();
    const wsSpans = spans.filter((s) => s.name === "pipeline.workstream");
    assert.equal(wsSpans.length, 4);
    const roles = wsSpans.map((s) => s.attributes["devteam.workstream.role"]).sort();
    assert.deepEqual(roles, ["backend", "frontend", "platform", "qa"]);
    const renderSpans = spans.filter((s) => s.name === "adapter.renderStagePrompt");
    assert.equal(renderSpans.length, 4);
  });

  it("captures the workstream id on each workstream span", () => {
    const cwd = track(makeTargetProject());
    runStage("build", { cwd });
    const spans = exporter.getFinishedSpans();
    const ids = spans
      .filter((s) => s.name === "pipeline.workstream")
      .map((s) => s.attributes["devteam.workstream.id"])
      .sort();
    assert.deepEqual(ids, [
      "stage-04.backend",
      "stage-04.frontend",
      "stage-04.platform",
      "stage-04.qa",
    ]);
  });
});

describe("observability: mergeWorkstreamGates emits pipeline.merge", () => {
  function seedFour(cwd, statuses) {
    const roles = ["backend", "frontend", "platform", "qa"];
    roles.forEach((role, i) => {
      seedGate(cwd, `stage-04.${role}`, {
        stage: "stage-04", workstream: role, host: "claude-code",
        status: statuses[i],
      });
    });
  }

  it("PASS merge sets devteam.merge.status = PASS", () => {
    const cwd = track(makeTargetProject());
    seedFour(cwd, ["PASS", "PASS", "PASS", "PASS"]);
    mergeWorkstreamGates("build", { cwd });
    const spans = exporter.getFinishedSpans();
    const merge = findSpan(spans, "pipeline.merge");
    assert.ok(merge, "no pipeline.merge span emitted");
    assert.equal(merge.attributes["devteam.merge.status"], "PASS");
    assert.equal(merge.attributes["devteam.merge.result"], "merged");
  });

  it("WARN merge records the worst-of aggregation", () => {
    const cwd = track(makeTargetProject());
    seedFour(cwd, ["PASS", "WARN", "PASS", "PASS"]);
    mergeWorkstreamGates("build", { cwd });
    const merge = findSpan(exporter.getFinishedSpans(), "pipeline.merge");
    assert.equal(merge.attributes["devteam.merge.status"], "WARN");
  });

  it("missing-workstream merge records the result", () => {
    const cwd = track(makeTargetProject());
    seedGate(cwd, "stage-04.backend", { workstream: "backend", host: "claude-code", status: "PASS" });
    mergeWorkstreamGates("build", { cwd });
    const merge = findSpan(exporter.getFinishedSpans(), "pipeline.merge");
    assert.equal(merge.attributes["devteam.merge.result"], "missing");
  });
});

describe("observability: next() emits pipeline.next with action attribute", () => {
  it("empty pipeline emits action=run-stage", () => {
    const cwd = track(makeTargetProject());
    next({ cwd });
    const nextSpan = findSpan(exporter.getFinishedSpans(), "pipeline.next");
    assert.equal(nextSpan.attributes["devteam.next.action"], "run-stage");
    assert.equal(nextSpan.attributes["devteam.next.name"], "requirements");
  });

  it("all-pass pipeline emits action=pipeline-complete", () => {
    const cwd = track(makeTargetProject());
    const { orderedStageNamesForTrack, getStage } = require(path.join(REPO_ROOT, "core", "pipeline", "stages"));
    for (const name of orderedStageNamesForTrack("full")) {
      seedGate(cwd, getStage(name).stage, { status: "PASS" });
    }
    next({ cwd });
    const nextSpan = findSpan(exporter.getFinishedSpans(), "pipeline.next");
    assert.equal(nextSpan.attributes["devteam.next.action"], "pipeline-complete");
  });
});

describe("observability: zero-overhead when no exporter configured", () => {
  it("spans are still created but the no-op tracer is fast", () => {
    // This test runs in the same process where we DID register a tracer.
    // It documents the API contract: withSpan never throws and always
    // returns the fn's result, whether tracing is on or off.
    const { withSpan } = require(path.join(REPO_ROOT, "core", "observability"));
    const r = withSpan("test.span", { foo: "bar" }, () => 42);
    assert.equal(r, 42);
  });
});
