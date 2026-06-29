"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { REPO_ROOT, makeTargetProject, cleanup } = require("./_helpers");

const DOCKER_DIR = path.join(REPO_ROOT, "hosts", "docker");
const DOCKERFILE = path.join(DOCKER_DIR, "Dockerfile");
const ENTRYPOINT = path.join(DOCKER_DIR, "entrypoint.sh");
const README = path.join(DOCKER_DIR, "README.md");

let _dirs = [];
function track(cwd) { _dirs.push(cwd); return cwd; }
test.afterEach(() => { _dirs.forEach(cleanup); _dirs = []; });

function runEntrypoint(args, opts = {}) {
  const result = spawnSync(ENTRYPOINT, args, {
    cwd: opts.cwd || REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      STAGECRAFT_HOME: REPO_ROOT,
      ...(opts.env || {}),
    },
  });
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

test("docker runner ships the expected packaging files", () => {
  assert.ok(fs.existsSync(DOCKERFILE), "Dockerfile should exist");
  assert.ok(fs.existsSync(ENTRYPOINT), "entrypoint should exist");
  assert.ok(fs.existsSync(README), "README should exist");

  const mode = fs.statSync(ENTRYPOINT).mode;
  assert.ok(mode & 0o111, "entrypoint should be executable");
});

test("Dockerfile uses non-root UID/GID build args and the runner entrypoint", () => {
  const dockerfile = fs.readFileSync(DOCKERFILE, "utf8");
  assert.match(dockerfile, /ARG STAGECRAFT_UID=1000/);
  assert.match(dockerfile, /ARG STAGECRAFT_GID=1000/);
  assert.match(dockerfile, /getent group "\$\{STAGECRAFT_GID\}"/);
  assert.match(dockerfile, /getent passwd "\$\{STAGECRAFT_UID\}"/);
  assert.match(dockerfile, /useradd --uid "\$\{STAGECRAFT_UID\}"/);
  assert.match(dockerfile, /USER \$\{STAGECRAFT_UID\}:\$\{STAGECRAFT_GID\}/);
  assert.match(dockerfile, /ENTRYPOINT \["\/stagecraft\/hosts\/docker\/entrypoint\.sh"\]/);
  assert.match(dockerfile, /npm ci --omit=dev --no-audit --no-fund/);
});

test("entrypoint prints usage and does not start a pipeline with no args", () => {
  const r = runEntrypoint([]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Stagecraft Docker runner/);
  assert.match(r.stdout, /No pipeline starts when no command is supplied/i);
});

test("entrypoint forwards plain devteam commands", () => {
  const r = runEntrypoint(["help"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /devteam/);
  assert.match(r.stdout, /run/);
});

test("entrypoint accepts an optional devteam prefix", () => {
  const r = runEntrypoint(["devteam", "help"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /devteam/);
  assert.match(r.stdout, /prototype/);
});

test("entrypoint reports stale locks without deleting them by default", () => {
  const cwd = track(makeTargetProject());
  const lock = path.join(cwd, "pipeline", "run.lock");
  fs.writeFileSync(lock, JSON.stringify({
    pid: 999999,
    host: "old-host",
    started_at: "2026-06-01T00:00:00.000Z",
  }));

  const r = runEntrypoint(["status", "--cwd", cwd]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /stale run\.lock detected/);
  assert.match(r.stderr, /--resume/);
  assert.match(r.stderr, /--force/);
  assert.ok(fs.existsSync(lock), "stale lock should not be deleted by default");
});

test("entrypoint reports active locks without deleting them", () => {
  const cwd = track(makeTargetProject());
  const lock = path.join(cwd, "pipeline", "run.lock");
  fs.writeFileSync(lock, JSON.stringify({
    pid: process.pid,
    host: "this-process",
    started_at: "2026-06-01T00:00:00.000Z",
  }));

  const r = runEntrypoint(["status", "--cwd", cwd]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /active run\.lock/);
  assert.match(r.stderr, /devteam status --cwd/);
  assert.ok(fs.existsSync(lock), "active lock should not be deleted");
});

test("entrypoint removes stale locks only when explicitly requested", () => {
  const cwd = track(makeTargetProject());
  const lock = path.join(cwd, "pipeline", "run.lock");
  fs.writeFileSync(lock, JSON.stringify({
    pid: 999999,
    host: "old-host",
    started_at: "2026-06-01T00:00:00.000Z",
  }));

  const r = runEntrypoint(["status", "--cwd", cwd], {
    env: { STAGECRAFT_RUNNER_CLEAR_STALE_LOCK: "1" },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /removed stale run\.lock/);
  assert.ok(!fs.existsSync(lock), "explicit cleanup should remove stale lock");
});
