// Fixes from three omp `loop` runs of a hello-world (plans/loop baselines,
// 2026-09-04/05): the reviewer placeholder is filled for single-reviewer
// stages, and timed-out dispatches' usage is priced instead of dropped.

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { REPO_ROOT } = require("./_helpers");
const { buildDescriptor } = require(path.join(REPO_ROOT, "core", "orchestrator"));
const { getStage } = require(path.join(REPO_ROOT, "core", "pipeline", "stages"));
const { dispatchObservation, accumulateUngated } = require(path.join(REPO_ROOT, "core", "driver"));

describe("peer-review write target names the reviewer on single-reviewer stages", () => {
  const stage = getStage("peer-review");

  test("loop-shaped (one role in stage): <reviewer> becomes the role", () => {
    const d = buildDescriptor(stage, "backend", { rolesInStage: ["backend"], track: "loop" });
    assert.ok(d.allowedWrites.includes("pipeline/code-review/by-backend.md"), JSON.stringify(d.allowedWrites));
    assert.ok(!d.allowedWrites.some((p) => p.includes("<reviewer>")));
    assert.equal(d.artifact, "pipeline/code-review/by-backend.md");
    assert.match(d.objective, /by-backend\.md/);
  });

  test("review-pr keeps its by-reviewer.md name (role is literally \"reviewer\")", () => {
    const d = buildDescriptor(stage, "reviewer", { rolesInStage: ["reviewer"], track: "review-pr" });
    assert.equal(d.artifact, "pipeline/code-review/by-reviewer.md");
  });

  test("full-track matrix (four reviewers) keeps the placeholder", () => {
    const d = buildDescriptor(stage, "backend", { rolesInStage: ["backend", "frontend", "platform", "qa"], track: "full" });
    assert.equal(d.artifact, "pipeline/code-review/by-<reviewer>.md");
    assert.ok(d.allowedWrites.includes("pipeline/code-review/by-<reviewer>.md"));
  });

  test("review_fanout keeps the placeholder even with one area", () => {
    const config = { routing: { review_fanout: ["claude-code", "codex"] } };
    const d = buildDescriptor(stage, "backend", { rolesInStage: ["backend"], track: "loop", config });
    assert.equal(d.artifact, "pipeline/code-review/by-<reviewer>.md");
  });
});

describe("dispatch-observation prices usage when a dispatch produced no gate", () => {
  const base = { iteration: 5, stage: "stage-05", name: "peer-review", action: "run-stage" };
  const usage = { tokensIn: 1_500_000, tokensOut: 20_000, cachedTokens: 0, costUsd: null, model: "claude-sonnet-5", inputAccounting: "exclusive", source: "omp:json" };

  test("no gate + host usage → model, tokens, derived cost, ungated flag", () => {
    const obs = dispatchObservation(base, { role: "backend", host: "omp", gatePath: null, timedOut: true, durationMs: 600_000, usage }, 1);
    assert.equal(obs.gate_written, false);
    assert.equal(obs.timed_out, true);
    assert.equal(obs.model, "claude-sonnet-5", "model comes from the usage, not \"unknown\"");
    assert.equal(obs.tokens_in, 1_500_000);
    assert.equal(obs.tokens_out, 20_000);
    assert.equal(obs.cost_basis, "derived-ungated");
    assert.ok(obs.cost_usd > 1, `expected a real derived cost, got ${obs.cost_usd}`);
    assert.equal(obs.ungated, true);
  });

  test("host-reported cost wins over the pricing table", () => {
    const obs = dispatchObservation(base, { role: "backend", host: "omp", gatePath: null, timedOut: true, usage: { ...usage, costUsd: 4.25 } }, 0);
    assert.equal(obs.cost_usd, 4.25);
    assert.equal(obs.cost_basis, "observed-ungated");
  });

  test("routed model prices a host that reports tokens but no model", () => {
    const obs = dispatchObservation(base, { role: "backend", host: "codex", gatePath: null, timedOut: true, routedModel: "claude-sonnet-5", usage: { ...usage, model: null } }, 0);
    assert.equal(obs.model, "claude-sonnet-5");
    assert.equal(obs.cost_basis, "derived-ungated");
  });

  test("no gate and no usage stays as before: unknown model, no cost, not ungated", () => {
    const obs = dispatchObservation(base, { role: "backend", host: "omp", gatePath: null, timedOut: true }, 0);
    assert.equal(obs.model, "unknown");
    assert.equal("cost_usd" in obs, false);
    assert.equal("ungated" in obs, false);
  });

  test("accumulateUngated sums only ungated observations into run state", () => {
    const state = {};
    accumulateUngated(state, dispatchObservation(base, { role: "backend", host: "omp", gatePath: null, timedOut: true, usage }, 0));
    accumulateUngated(state, dispatchObservation(base, { role: "backend", host: "omp", gatePath: null, timedOut: true, usage }, 1));
    accumulateUngated(state, dispatchObservation(base, { role: "backend", host: "omp", gatePath: null, timedOut: true }, 2));
    assert.equal(state.ungated_usage.dispatches, 2);
    assert.equal(state.ungated_usage.tokens_in, 3_000_000);
    assert.ok(state.ungated_usage.cost_usd > 2);
  });
});
