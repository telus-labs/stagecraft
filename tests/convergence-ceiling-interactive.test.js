// Tests for Phase 5.3: archive-before-overwrite in runStageHeadless.
//
// The interactive path (devteam stage / devteam next) must accumulate archives
// so countArchivedAttempts() sees the attempts and the convergence ceiling trips.
// These tests verify that runStageHeadless itself archives a pre-existing FAIL
// gate before dispatching, and that next() detects convergence-exhausted after
// maxRetries+1 identical-blocker failures.

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { REPO_ROOT, makeTargetProject, cleanup } = require("./_helpers");
const { runStageHeadless, next } = require(path.join(REPO_ROOT, "core", "orchestrator"));
const { listArchives } = require(path.join(REPO_ROOT, "core", "gates", "archive"));

// claude-code host has headless: true — generic has headless: false and would throw.
const CLAUDE_CODE_CONFIG = "routing:\n  default_host: claude-code\npipeline:\n  default_track: full\n";

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
afterEach(() => { _dirs.forEach(cleanup); _dirs = []; });

describe("5.3: archive-before-overwrite — interactive convergence ceiling", () => {
  it("runStageHeadless archives a pre-existing FAIL gate before dispatch", async () => {
    const cwd = track(makeTargetProject({ config: CLAUDE_CODE_CONFIG }));
    const gd = path.join(cwd, "pipeline", "gates");

    // Agent writes a FAIL gate for requirements (stage-01).
    // headless.js spawns with cwd: ctx.cwd so 'pipeline/gates/...' is relative to cwd.
    const agentScript = path.join(cwd, "fail-gate-agent.js");
    fs.writeFileSync(agentScript, [
      "const fs = require('node:fs');",
      "fs.mkdirSync('pipeline/gates', { recursive: true });",
      "fs.writeFileSync('pipeline/gates/stage-01.json', JSON.stringify({",
      "  stage: 'stage-01', status: 'FAIL',",
      "  orchestrator: 'test', track: 'full', host: 'claude-code',",
      "  timestamp: new Date().toISOString(),",
      "  blockers: ['persistent blocker'], warnings: []",
      "}, null, 2));",
    ].join("\n"));

    const savedCmd = process.env.DEVTEAM_HEADLESS_COMMAND;
    const savedNoLog = process.env.DEVTEAM_NO_LOG;
    process.env.DEVTEAM_HEADLESS_COMMAND = `node ${agentScript}`;
    process.env.DEVTEAM_NO_LOG = "1";

    try {
      // Dispatch 1: no pre-existing FAIL gate → no archive; agent writes FAIL gate.
      await runStageHeadless("requirements", { cwd, stamp: false });
      assert.equal(listArchives(gd, "stage-01").length, 0,
        "no archive after first dispatch (no pre-existing FAIL gate to archive)");

      // Dispatch 2: FAIL gate now exists → archive-before-overwrite fires → attempt-1 archived.
      await runStageHeadless("requirements", { cwd, stamp: false });
      assert.equal(listArchives(gd, "stage-01").length, 1,
        "one archive after second dispatch (pre-existing FAIL gate archived as attempt-1)");

      // Dispatch 3: FAIL gate exists again → archived as attempt-2.
      await runStageHeadless("requirements", { cwd, stamp: false });
      assert.equal(listArchives(gd, "stage-01").length, 2,
        "two archives after third dispatch — no double-archiving per dispatch");
    } finally {
      if (savedCmd === undefined) delete process.env.DEVTEAM_HEADLESS_COMMAND;
      else process.env.DEVTEAM_HEADLESS_COMMAND = savedCmd;
      if (savedNoLog === undefined) delete process.env.DEVTEAM_NO_LOG;
      else process.env.DEVTEAM_NO_LOG = savedNoLog;
    }
  });

  it("interactive loop maxRetries+1 identical failures → next() returns convergence-exhausted", async () => {
    const cwd = track(makeTargetProject({ config: CLAUDE_CODE_CONFIG }));
    const gd = path.join(cwd, "pipeline", "gates");

    const agentScript = path.join(cwd, "fail-gate-agent.js");
    fs.writeFileSync(agentScript, [
      "const fs = require('node:fs');",
      "fs.mkdirSync('pipeline/gates', { recursive: true });",
      "fs.writeFileSync('pipeline/gates/stage-01.json', JSON.stringify({",
      "  stage: 'stage-01', status: 'FAIL',",
      "  orchestrator: 'test', track: 'full', host: 'claude-code',",
      "  timestamp: new Date().toISOString(),",
      "  blockers: ['persistent blocker'], warnings: []",
      "}, null, 2));",
    ].join("\n"));

    const savedCmd = process.env.DEVTEAM_HEADLESS_COMMAND;
    const savedNoLog = process.env.DEVTEAM_NO_LOG;
    process.env.DEVTEAM_HEADLESS_COMMAND = `node ${agentScript}`;
    process.env.DEVTEAM_NO_LOG = "1";

    try {
      // maxRetries=2 means 3 dispatches total (initial + 2 retries).
      // Archive accumulates: attempt-1 after dispatch-2, attempt-2 after dispatch-3.
      // detectNoProgress fires when archives 1 & 2 have identical blockers.
      await runStageHeadless("requirements", { cwd, stamp: false });
      await runStageHeadless("requirements", { cwd, stamp: false });
      await runStageHeadless("requirements", { cwd, stamp: false });

      assert.equal(listArchives(gd, "stage-01").length, 2, "two archives accumulated");

      const r = next({ cwd });
      assert.equal(r.action, "resolve-escalation", "next() returns resolve-escalation");
      assert.equal(r.failure_class, "convergence-exhausted", "failure_class is convergence-exhausted");
      assert.ok(r.no_progress_evidence, "no_progress_evidence is populated");
      assert.match(String(r.no_progress_evidence), /persistent blocker/,
        "evidence names the stuck blocker");
    } finally {
      if (savedCmd === undefined) delete process.env.DEVTEAM_HEADLESS_COMMAND;
      else process.env.DEVTEAM_HEADLESS_COMMAND = savedCmd;
      if (savedNoLog === undefined) delete process.env.DEVTEAM_NO_LOG;
      else process.env.DEVTEAM_NO_LOG = savedNoLog;
    }
  });
});
