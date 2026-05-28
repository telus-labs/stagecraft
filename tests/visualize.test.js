// scripts/visualize.js — Mermaid renderer for the stage graph.
// Lightweight smoke tests: the script reads from core/pipeline/stages.js,
// renders to stdout, no side effects. We just verify the output shape.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "visualize.js");

function run(...args) {
  return spawnSync("node", [SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

test("default invocation renders the full track as Mermaid", () => {
  const r = run();
  assert.equal(r.status, 0, `visualize exited ${r.status}: ${r.stderr}`);
  // Mermaid diagrams start with a graph declaration. The script chooses
  // one of `graph LR`, `graph TD`, or `flowchart` — match any.
  assert.match(r.stdout, /(graph|flowchart)\s+(LR|TD)/);
  // Full track has stage-01 and stage-09 endpoints.
  assert.match(r.stdout, /stage-01/);
  assert.match(r.stdout, /stage-09/);
});

test("`--track nano` produces a smaller graph than full", () => {
  const full = run().stdout;
  const nano = run("--track", "nano").stdout;
  assert.ok(full.length > nano.length, "nano should be smaller than full");
  // Nano includes stage-04 + stage-06 but not stage-01 / stage-09.
  assert.match(nano, /stage-04/);
  assert.match(nano, /stage-06/);
  assert.doesNotMatch(nano, /stage-01/);
});

test("`--tracks` renders multiple track diagrams", () => {
  const r = run("--tracks");
  assert.equal(r.status, 0);
  // Should mention multiple track names somewhere in the output.
  const trackMentions = ["full", "quick", "nano", "hotfix"].filter((t) =>
    new RegExp(`\\b${t}\\b`).test(r.stdout),
  );
  assert.ok(trackMentions.length >= 3, `expected ≥3 track mentions, got ${trackMentions.length}`);
});

test("unknown track is handled gracefully (non-zero exit or fallback)", () => {
  const r = run("--track", "this-track-does-not-exist");
  // Either it exits non-zero with a clear message, OR it falls back to
  // some default. Both are reasonable. What we want to verify: the
  // script doesn't crash with a stack trace.
  if (r.status !== 0) {
    assert.match(r.stderr, /track|unknown/i, "non-zero exit needs a useful error");
  }
});
