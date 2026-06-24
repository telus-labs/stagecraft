"use strict";

// Offline tests for hosts/cloud-runner-github/adapter.js.
// A minimal HTTP server mimics the GitHub Actions API; no real network calls
// are made. Tests cover:
//   - happy path (dispatch → correlate → poll → download → validate → apply)
//   - consequence-stage refusal (stage-07, stage-08)
//   - missing token
//   - prompt too large
//   - correlation timeout (run never appears)
//   - run poll timeout (run never completes)
//   - failed run conclusion (not success)
//   - artifact missing
//   - corrupt result artifact
//   - unauthorized write in result
//   - parseResultArtifact unit tests

const { describe, it, before, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { REPO_ROOT } = require("./_helpers");

const adapterPath = path.join(REPO_ROOT, "hosts", "cloud-runner-github", "adapter.js");
const zipPath = path.join(REPO_ROOT, "hosts", "cloud-runner-github", "zip.js");

const adapter = require(adapterPath);
const { makeZip } = require(zipPath);
const { parseResultArtifact, loadConfig, parseConfig, CONSEQUENCE_STAGES, GITHUB_INPUT_LIMIT } = adapter;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _dirs = [];
function tmpdir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "devteam-test-cloud-gh-"));
  _dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of _dirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  _dirs = [];
});

function makeDevteamDir(cwd, cloudRunnerOpts = {}) {
  const dir = path.join(cwd, ".devteam");
  fs.mkdirSync(dir, { recursive: true });
  const config = {
    owner: cloudRunnerOpts.owner || "test-org",
    repo: cloudRunnerOpts.repo || "stagecraft-runner",
    workflow: cloudRunnerOpts.workflow || "stagecraft-runner.yml",
    auth_env: cloudRunnerOpts.auth_env || "TEST_RUNNER_TOKEN",
    ref: cloudRunnerOpts.ref || "main",
    poll_interval_ms: 0,   // no actual delay in tests
    correlation_timeout_ms: cloudRunnerOpts.correlation_timeout_ms ?? 500,
    ...cloudRunnerOpts,
  };
  fs.writeFileSync(
    path.join(dir, "config.yml"),
    `cloud_runner:\n  owner: ${config.owner}\n  repo: ${config.repo}\n  workflow: ${config.workflow}\n  auth_env: ${config.auth_env}\n  ref: ${config.ref}\n  poll_interval_ms: ${config.poll_interval_ms}\n  correlation_timeout_ms: ${config.correlation_timeout_ms}\n`,
    "utf8",
  );
}

function makeResultZip(result) {
  const data = Buffer.from(JSON.stringify(result), "utf8");
  return makeZip([{ name: "result.json", data }]);
}

function makeGoodResult(idempotencyKey, overrides = {}) {
  return {
    schema: "1",
    idempotencyKey,
    exitCode: 0,
    durationMs: 100,
    files: [],
    ...overrides,
  };
}

function fixtureDescriptor(stage = "stage-01") {
  return {
    stage,
    name: "requirements",
    role: "pm",
    rolesInStage: ["pm"],
    workstreamId: stage,
    objective: "Write acceptance criteria.",
    readFirst: ["AGENTS.md"],
    allowedWrites: [`pipeline/gates/${stage}.json`],
    artifact: `pipeline/gates/${stage}.json`,
    template: "brief-template.md",
    expectedGate: {},
    subagent: undefined,
  };
}

function fixtureCtx(cwd, extra = {}) {
  return {
    track: "full",
    feature: "test feature",
    cwd,
    isolation: "in-place",
    orchestrator: "devteam@test",
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Fake GitHub API server
// ---------------------------------------------------------------------------

class FakeGitHub {
  constructor() {
    this._handlers = [];
    this.requests = [];
    this.server = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        req.body = Buffer.concat(chunks).toString("utf8");
        this.requests.push({ method: req.method, url: req.url, body: req.body });
        for (const { method, pattern, handler } of this._handlers) {
          if ((method === "*" || method === req.method) && pattern.test(req.url)) {
            return handler(req, res);
          }
        }
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: `no handler for ${req.method} ${req.url}` }));
      });
    });
  }

  on(method, pattern, handler) {
    this._handlers.push({ method, pattern, handler });
    return this;
  }

  json(res, status, body) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  start() {
    return new Promise((resolve) => this.server.listen(0, "127.0.0.1", () => resolve(this)));
  }

  stop() {
    return new Promise((resolve) => this.server.close(resolve));
  }

  get baseUrl() {
    const addr = this.server.address();
    return `http://127.0.0.1:${addr.port}`;
  }

  reset() {
    this._handlers = [];
    this.requests = [];
  }
}

// Registers the standard happy-path sequence on a fake GitHub server:
//   1. POST /dispatches → 204
//   2. GET /runs → returns one run named `idempotencyKey`
//   3. GET /runs/:runId → completed/success
//   4. GET /runs/:runId/artifacts → one artifact named "stagecraft-result-<key>"
//   5. GET /artifacts/:artifactId/zip → zip buffer
function registerHappyPath(server, idempotencyKey, zipBuf) {
  const runId = 42;
  const artifactId = 99;
  let dispatchDone = false;

  server
    .on("POST", /\/dispatches$/, (req, res) => {
      dispatchDone = true;
      res.writeHead(204);
      res.end();
    })
    .on("GET", /\/actions\/runs(\?|$)/, (req, res) => {
      server.json(res, 200, {
        workflow_runs: dispatchDone
          ? [{ id: runId, name: idempotencyKey, status: "queued" }]
          : [],
      });
    })
    .on("GET", new RegExp(`/actions/runs/${runId}$`), (req, res) => {
      server.json(res, 200, { id: runId, status: "completed", conclusion: "success" });
    })
    .on("GET", new RegExp(`/actions/runs/${runId}/artifacts`), (req, res) => {
      server.json(res, 200, {
        artifacts: [{ id: artifactId, name: `stagecraft-result-${idempotencyKey}` }],
      });
    })
    .on("GET", new RegExp(`/artifacts/${artifactId}/zip`), (req, res) => {
      res.writeHead(200, { "Content-Type": "application/zip" });
      res.end(zipBuf);
    });
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let server;
before(async () => { server = await new FakeGitHub().start(); });
after(async () => { await server.stop(); });
afterEach(() => server.reset());

// ---------------------------------------------------------------------------
// Unit: parseResultArtifact
// ---------------------------------------------------------------------------

describe("parseResultArtifact", () => {
  it("extracts entries from a well-formed zip", () => {
    const content = Buffer.from("hello world", "utf8");
    const contentBase64 = content.toString("base64");
    const sha256 = require("node:crypto").createHash("sha256").update(content).digest("hex");
    const result = {
      schema: "1",
      idempotencyKey: "abc",
      exitCode: 0,
      durationMs: 50,
      files: [{ path: "pipeline/gates/stage-01.json", sha256, contentBase64 }],
    };
    const zipBuf = makeResultZip(result);
    const { exitCode, entries } = parseResultArtifact(zipBuf);
    assert.equal(exitCode, 0);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].path, "pipeline/gates/stage-01.json");
    assert.equal(entries[0].sha256, sha256);
    assert.deepEqual(entries[0].content, content);
  });

  it("throws when result.json is absent from zip", () => {
    const zipBuf = makeZip([{ name: "other.txt", data: Buffer.from("x") }]);
    assert.throws(() => parseResultArtifact(zipBuf), /does not contain result\.json/);
  });

  it("throws when result.json is invalid JSON", () => {
    const zipBuf = makeZip([{ name: "result.json", data: Buffer.from("not json") }]);
    assert.throws(() => parseResultArtifact(zipBuf), /not valid JSON/);
  });

  it("throws when schema is not '1'", () => {
    const zipBuf = makeResultZip({ schema: "2", exitCode: 0, files: [] });
    assert.throws(() => parseResultArtifact(zipBuf), /unknown schema/);
  });

  it("defaults exitCode to 1 when missing", () => {
    const zipBuf = makeResultZip({ schema: "1", files: [] });
    const { exitCode } = parseResultArtifact(zipBuf);
    assert.equal(exitCode, 1);
  });
});

// ---------------------------------------------------------------------------
// Unit: loadConfig + parseConfig
// ---------------------------------------------------------------------------

describe("loadConfig", () => {
  it("returns null when .devteam/config.yml does not exist", () => {
    const d = tmpdir();
    assert.equal(loadConfig(d), null);
  });

  it("returns null when config.yml has no cloud_runner section", () => {
    const d = tmpdir();
    fs.mkdirSync(path.join(d, ".devteam"));
    fs.writeFileSync(path.join(d, ".devteam", "config.yml"), "other: value\n", "utf8");
    assert.equal(loadConfig(d), null);
  });

  it("returns the cloud_runner object when present", () => {
    const d = tmpdir();
    makeDevteamDir(d);
    const raw = loadConfig(d);
    assert.equal(raw.owner, "test-org");
  });
});

describe("parseConfig", () => {
  it("throws when any required field is missing", () => {
    assert.throws(() => parseConfig({ owner: "x", repo: "y" }), /workflow/);
    assert.throws(() => parseConfig({ owner: "x", repo: "y", workflow: "w.yml" }), /auth_env/);
  });

  it("returns parsed config with defaults", () => {
    const cfg = parseConfig({ owner: "o", repo: "r", workflow: "w.yml", auth_env: "TOKEN" });
    assert.equal(cfg.ref, "main");
    assert.equal(cfg.owner, "o");
  });
});

// ---------------------------------------------------------------------------
// install / status / uninstall
// ---------------------------------------------------------------------------

describe("install", () => {
  it("creates .devteam/config.yml with cloud_runner stub on a fresh dir", () => {
    const d = tmpdir();
    const result = adapter.install(d);
    assert.ok(Array.isArray(result.written));
    assert.equal(result.written.length, 1);
    const yml = fs.readFileSync(path.join(d, ".devteam", "config.yml"), "utf8");
    assert.ok(yml.includes("cloud_runner:"));
  });

  it("skips when cloud_runner section already exists", () => {
    const d = tmpdir();
    makeDevteamDir(d);
    const result = adapter.install(d);
    assert.ok(result.skipped.length > 0);
    assert.equal(result.written.length, 0);
  });

  it("is idempotent — second call skips", () => {
    const d = tmpdir();
    adapter.install(d);
    assert.doesNotThrow(() => adapter.install(d));
  });
});

describe("status", () => {
  it("reports ok:false on empty dir", () => {
    const d = tmpdir();
    const s = adapter.status(d);
    assert.equal(s.ok, false);
    assert.ok(s.missing.length > 0);
  });

  it("reports ok:true after install even without token", () => {
    const d = tmpdir();
    adapter.install(d);
    const s = adapter.status(d);
    assert.equal(s.ok, true);
    const tokenNote = s.notes.find((n) => n.includes("NOT SET"));
    assert.ok(tokenNote, "should note the missing token");
  });

  it("notes token present when env var is set", () => {
    const d = tmpdir();
    makeDevteamDir(d);
    process.env.TEST_RUNNER_TOKEN = "ghp_test";
    try {
      const s = adapter.status(d);
      const note = s.notes.find((n) => n.includes("present"));
      assert.ok(note, "should note token is present");
    } finally {
      delete process.env.TEST_RUNNER_TOKEN;
    }
  });
});

describe("uninstall", () => {
  it("removes cloud_runner section; status becomes ok:false", () => {
    const d = tmpdir();
    adapter.install(d);
    assert.equal(adapter.status(d).ok, true);
    adapter.uninstall(d);
    assert.equal(adapter.status(d).ok, false);
  });
});

// ---------------------------------------------------------------------------
// invoke — consequence stages
// ---------------------------------------------------------------------------

describe("invoke — consequence stage refusal", () => {
  for (const stage of ["stage-07", "stage-08"]) {
    it(`rejects ${stage}`, async () => {
      const d = tmpdir();
      makeDevteamDir(d);
      await assert.rejects(
        adapter.invoke(fixtureDescriptor(stage), fixtureCtx(d), "prompt"),
        /consequence-stage boundary/,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// invoke — missing token
// ---------------------------------------------------------------------------

describe("invoke — missing token", () => {
  it("throws when auth env var is not set", async () => {
    const d = tmpdir();
    makeDevteamDir(d);
    delete process.env.TEST_RUNNER_TOKEN;
    await assert.rejects(
      adapter.invoke(fixtureDescriptor(), fixtureCtx(d), "prompt"),
      /auth token env var.*is not set/,
    );
  });
});

// ---------------------------------------------------------------------------
// invoke — prompt too large
// ---------------------------------------------------------------------------

describe("invoke — prompt too large", () => {
  it("throws when base64(prompt) exceeds GITHUB_INPUT_LIMIT", async () => {
    const d = tmpdir();
    makeDevteamDir(d);
    process.env.TEST_RUNNER_TOKEN = "ghp_test";
    try {
      const hugePrompt = "x".repeat(GITHUB_INPUT_LIMIT);
      await assert.rejects(
        adapter.invoke(fixtureDescriptor(), fixtureCtx(d), hugePrompt),
        /exceeds.*input limit/,
      );
    } finally {
      delete process.env.TEST_RUNNER_TOKEN;
    }
  });
});

// ---------------------------------------------------------------------------
// invoke — correlation timeout
// ---------------------------------------------------------------------------

describe("invoke — correlation timeout", () => {
  it("returns timedOut:true when run never correlates", async () => {
    const d = tmpdir();
    makeDevteamDir(d, { correlation_timeout_ms: 50, poll_interval_ms: 0 });
    process.env.TEST_RUNNER_TOKEN = "ghp_test";
    process.env.STAGECRAFT_GITHUB_API_URL = server.baseUrl;
    try {
      server.on("POST", /\/dispatches$/, (req, res) => { res.writeHead(204); res.end(); });
      server.on("GET", /\/actions\/runs(\?|$)/, (req, res) => {
        server.json(res, 200, { workflow_runs: [] });
      });
      const result = await adapter.invoke(fixtureDescriptor(), fixtureCtx(d), "prompt");
      assert.equal(result.timedOut, true);
    } finally {
      delete process.env.TEST_RUNNER_TOKEN;
      delete process.env.STAGECRAFT_GITHUB_API_URL;
    }
  });
});

// ---------------------------------------------------------------------------
// invoke — helper to wire baseUrl through config
// ---------------------------------------------------------------------------

function makeDevteamDirWithBaseUrl(cwd, serverBaseUrl) {
  const dir = path.join(cwd, ".devteam");
  fs.mkdirSync(dir, { recursive: true });
  const yaml = [
    "cloud_runner:",
    "  owner: test-org",
    "  repo: stagecraft-runner",
    "  workflow: stagecraft-runner.yml",
    "  auth_env: TEST_RUNNER_TOKEN",
    "  ref: main",
    "  poll_interval_ms: 0",
    "  correlation_timeout_ms: 5000",
    `  base_url: ${serverBaseUrl}`,
  ].join("\n") + "\n";
  fs.writeFileSync(path.join(dir, "config.yml"), yaml, "utf8");
}

// The adapter's clientCfg uses cfg.baseUrl if present. But parseConfig doesn't
// currently capture base_url. Add it so tests can wire the server URL.
// We monkey-patch parseConfig via the adapter's exported interface — instead
// let's set STAGECRAFT_GITHUB_API_URL per-test.

// ---------------------------------------------------------------------------
// invoke — run poll timeout
// ---------------------------------------------------------------------------

describe("invoke — run poll timeout", () => {
  it("cancels and returns timedOut:true when run never completes", async () => {
    const d = tmpdir();
    makeDevteamDir(d);
    process.env.TEST_RUNNER_TOKEN = "ghp_test";
    process.env.STAGECRAFT_GITHUB_API_URL = server.baseUrl;
    try {
      const runId = 1;
      server
        .on("POST", /\/dispatches$/, (req, res) => { res.writeHead(204); res.end(); })
        .on("GET", /\/actions\/runs(\?|$)/, (req, res) => {
          server.json(res, 200, { workflow_runs: [{ id: runId, name: "PLACEHOLDER_KEY" }] });
        })
        .on("GET", new RegExp(`/actions/runs/${runId}$`), (req, res) => {
          server.json(res, 200, { id: runId, status: "in_progress" });
        })
        .on("POST", new RegExp(`/actions/runs/${runId}/cancel`), (req, res) => {
          res.writeHead(202); res.end();
        });

      // The correlation must match the actual idempotency key dispatched.
      // Override the run listing to match any name so the test doesn't depend
      // on the generated key.
      server.reset();
      let capturedKey = null;
      server
        .on("POST", /\/dispatches$/, (req, res) => {
          const body = JSON.parse(req.body || "{}");
          capturedKey = body.inputs && body.inputs.idempotency_key;
          res.writeHead(204); res.end();
        })
        .on("GET", /\/actions\/runs(\?|$)/, (req, res) => {
          server.json(res, 200, {
            workflow_runs: capturedKey ? [{ id: runId, name: capturedKey }] : [],
          });
        })
        .on("GET", new RegExp(`/actions/runs/${runId}$`), (req, res) => {
          server.json(res, 200, { id: runId, status: "in_progress" });
        })
        .on("POST", new RegExp(`/actions/runs/${runId}/cancel`), (req, res) => {
          res.writeHead(202); res.end();
        });

      const result = await adapter.invoke(
        fixtureDescriptor(),
        fixtureCtx(d, { timeoutMs: 100 }),
        "prompt",
      );
      assert.equal(result.timedOut, true);
    } finally {
      delete process.env.TEST_RUNNER_TOKEN;
      delete process.env.STAGECRAFT_GITHUB_API_URL;
    }
  });
});

// ---------------------------------------------------------------------------
// invoke — run failure (non-success conclusion)
// ---------------------------------------------------------------------------

describe("invoke — run failure", () => {
  it("returns exitCode:1 when conclusion is failure", async () => {
    const d = tmpdir();
    makeDevteamDir(d);
    process.env.TEST_RUNNER_TOKEN = "ghp_test";
    process.env.STAGECRAFT_GITHUB_API_URL = server.baseUrl;
    try {
      const runId = 7;
      let capturedKey = null;
      server
        .on("POST", /\/dispatches$/, (req, res) => {
          const body = JSON.parse(req.body || "{}");
          capturedKey = body.inputs && body.inputs.idempotency_key;
          res.writeHead(204); res.end();
        })
        .on("GET", /\/actions\/runs(\?|$)/, (req, res) => {
          server.json(res, 200, {
            workflow_runs: capturedKey ? [{ id: runId, name: capturedKey }] : [],
          });
        })
        .on("GET", new RegExp(`/actions/runs/${runId}$`), (req, res) => {
          server.json(res, 200, { id: runId, status: "completed", conclusion: "failure" });
        });

      const result = await adapter.invoke(fixtureDescriptor(), fixtureCtx(d), "prompt");
      assert.equal(result.exitCode, 1);
      assert.equal(result.timedOut, false);
    } finally {
      delete process.env.TEST_RUNNER_TOKEN;
      delete process.env.STAGECRAFT_GITHUB_API_URL;
    }
  });
});

// ---------------------------------------------------------------------------
// invoke — artifact missing
// ---------------------------------------------------------------------------

describe("invoke — artifact missing", () => {
  it("returns exitCode:1 when result artifact is absent", async () => {
    const d = tmpdir();
    makeDevteamDir(d);
    process.env.TEST_RUNNER_TOKEN = "ghp_test";
    process.env.STAGECRAFT_GITHUB_API_URL = server.baseUrl;
    try {
      const runId = 8;
      let capturedKey = null;
      server
        .on("POST", /\/dispatches$/, (req, res) => {
          const body = JSON.parse(req.body || "{}");
          capturedKey = body.inputs && body.inputs.idempotency_key;
          res.writeHead(204); res.end();
        })
        .on("GET", /\/actions\/runs(\?|$)/, (req, res) => {
          server.json(res, 200, {
            workflow_runs: capturedKey ? [{ id: runId, name: capturedKey }] : [],
          });
        })
        .on("GET", new RegExp(`/actions/runs/${runId}$`), (req, res) => {
          server.json(res, 200, { id: runId, status: "completed", conclusion: "success" });
        })
        .on("GET", new RegExp(`/actions/runs/${runId}/artifacts`), (req, res) => {
          server.json(res, 200, { artifacts: [] });  // no artifacts
        });

      const result = await adapter.invoke(fixtureDescriptor(), fixtureCtx(d), "prompt");
      assert.equal(result.exitCode, 1);
    } finally {
      delete process.env.TEST_RUNNER_TOKEN;
      delete process.env.STAGECRAFT_GITHUB_API_URL;
    }
  });
});

// ---------------------------------------------------------------------------
// invoke — corrupt result artifact
// ---------------------------------------------------------------------------

describe("invoke — corrupt result artifact", () => {
  it("throws when result zip is invalid JSON", async () => {
    const d = tmpdir();
    makeDevteamDir(d);
    process.env.TEST_RUNNER_TOKEN = "ghp_test";
    process.env.STAGECRAFT_GITHUB_API_URL = server.baseUrl;
    try {
      const runId = 9;
      const artifactId = 901;
      let capturedKey = null;
      server
        .on("POST", /\/dispatches$/, (req, res) => {
          const body = JSON.parse(req.body || "{}");
          capturedKey = body.inputs && body.inputs.idempotency_key;
          res.writeHead(204); res.end();
        })
        .on("GET", /\/actions\/runs(\?|$)/, (req, res) => {
          server.json(res, 200, {
            workflow_runs: capturedKey ? [{ id: runId, name: capturedKey }] : [],
          });
        })
        .on("GET", new RegExp(`/actions/runs/${runId}$`), (req, res) => {
          server.json(res, 200, { id: runId, status: "completed", conclusion: "success" });
        })
        .on("GET", new RegExp(`/actions/runs/${runId}/artifacts`), (req, res) => {
          server.json(res, 200, {
            artifacts: capturedKey
              ? [{ id: artifactId, name: `stagecraft-result-${capturedKey}` }]
              : [],
          });
        })
        .on("GET", new RegExp(`/artifacts/${artifactId}/zip`), (req, res) => {
          const badZip = makeZip([{ name: "result.json", data: Buffer.from("not json") }]);
          res.writeHead(200); res.end(badZip);
        });

      await assert.rejects(
        adapter.invoke(fixtureDescriptor(), fixtureCtx(d), "prompt"),
        /not valid JSON/,
      );
    } finally {
      delete process.env.TEST_RUNNER_TOKEN;
      delete process.env.STAGECRAFT_GITHUB_API_URL;
    }
  });
});

// ---------------------------------------------------------------------------
// invoke — unauthorized write in result
// ---------------------------------------------------------------------------

describe("invoke — unauthorized write in result", () => {
  it("throws when result contains a file outside allowedWrites", async () => {
    const d = tmpdir();
    makeDevteamDir(d);
    process.env.TEST_RUNNER_TOKEN = "ghp_test";
    process.env.STAGECRAFT_GITHUB_API_URL = server.baseUrl;
    try {
      const runId = 10;
      const artifactId = 1001;
      let capturedKey = null;
      server
        .on("POST", /\/dispatches$/, (req, res) => {
          const body = JSON.parse(req.body || "{}");
          capturedKey = body.inputs && body.inputs.idempotency_key;
          res.writeHead(204); res.end();
        })
        .on("GET", /\/actions\/runs(\?|$)/, (req, res) => {
          server.json(res, 200, {
            workflow_runs: capturedKey ? [{ id: runId, name: capturedKey }] : [],
          });
        })
        .on("GET", new RegExp(`/actions/runs/${runId}$`), (req, res) => {
          server.json(res, 200, { id: runId, status: "completed", conclusion: "success" });
        })
        .on("GET", new RegExp(`/actions/runs/${runId}/artifacts`), (req, res) => {
          server.json(res, 200, {
            artifacts: capturedKey
              ? [{ id: artifactId, name: `stagecraft-result-${capturedKey}` }]
              : [],
          });
        })
        .on("GET", new RegExp(`/artifacts/${artifactId}/zip`), (req, res) => {
          const content = Buffer.from("{}", "utf8");
          const sha256 = require("node:crypto").createHash("sha256").update(content).digest("hex");
          const badResult = {
            schema: "1",
            exitCode: 0,
            files: [
              {
                path: "etc/passwd",
                sha256,
                contentBase64: content.toString("base64"),
              },
            ],
          };
          const badZip = makeResultZip(badResult);
          res.writeHead(200); res.end(badZip);
        });

      await assert.rejects(
        adapter.invoke(fixtureDescriptor(), fixtureCtx(d), "prompt"),
        /result validation failed/,
      );
    } finally {
      delete process.env.TEST_RUNNER_TOKEN;
      delete process.env.STAGECRAFT_GITHUB_API_URL;
    }
  });
});

// ---------------------------------------------------------------------------
// invoke — happy path
// ---------------------------------------------------------------------------

describe("invoke — happy path", () => {
  it("dispatches, correlates, polls, applies, returns exitCode:0", async () => {
    const d = tmpdir();
    makeDevteamDir(d);
    process.env.TEST_RUNNER_TOKEN = "ghp_test";
    process.env.STAGECRAFT_GITHUB_API_URL = server.baseUrl;
    try {
      // Create the pipeline/gates dir so applyResult can write there
      fs.mkdirSync(path.join(d, "pipeline", "gates"), { recursive: true });

      const gateContent = Buffer.from(JSON.stringify({ stage: "stage-01", status: "PASS" }), "utf8");
      const sha256 = require("node:crypto").createHash("sha256").update(gateContent).digest("hex");

      let capturedKey = null;
      const runId = 55;
      const artifactId = 555;

      server
        .on("POST", /\/dispatches$/, (req, res) => {
          const body = JSON.parse(req.body || "{}");
          capturedKey = body.inputs && body.inputs.idempotency_key;
          res.writeHead(204); res.end();
        })
        .on("GET", /\/actions\/runs(\?|$)/, (req, res) => {
          server.json(res, 200, {
            workflow_runs: capturedKey ? [{ id: runId, name: capturedKey }] : [],
          });
        })
        .on("GET", new RegExp(`/actions/runs/${runId}$`), (req, res) => {
          server.json(res, 200, { id: runId, status: "completed", conclusion: "success" });
        })
        .on("GET", new RegExp(`/actions/runs/${runId}/artifacts`), (req, res) => {
          server.json(res, 200, {
            artifacts: capturedKey
              ? [{ id: artifactId, name: `stagecraft-result-${capturedKey}` }]
              : [],
          });
        })
        .on("GET", new RegExp(`/artifacts/${artifactId}/zip`), (req, res) => {
          const result = {
            schema: "1",
            exitCode: 0,
            durationMs: 200,
            files: [
              {
                path: "pipeline/gates/stage-01.json",
                sha256,
                contentBase64: gateContent.toString("base64"),
              },
            ],
          };
          res.writeHead(200); res.end(makeResultZip(result));
        });

      const invokeResult = await adapter.invoke(fixtureDescriptor(), fixtureCtx(d), "A prompt");
      assert.equal(invokeResult.exitCode, 0);
      assert.equal(invokeResult.timedOut, false);
      assert.ok(invokeResult.gatePath && invokeResult.gatePath.includes("stage-01.json"));
      // Verify the gate file was actually written to disk
      const written = fs.readFileSync(path.join(d, "pipeline", "gates", "stage-01.json"), "utf8");
      assert.ok(written.includes("PASS"));
    } finally {
      delete process.env.TEST_RUNNER_TOKEN;
      delete process.env.STAGECRAFT_GITHUB_API_URL;
    }
  });

  it("derives stage-05 gate via approval-derivation hook when result contains review file but no gate (remote runner peer-review)", async () => {
    // Regression: the approval-derivation PostToolUse hook doesn't run on
    // GitHub Actions (hooks: false). The remote model writes a review file but
    // no gate. Fix: after applyResult, run the hook locally so stage-05 gates
    // are derived before the driver checks for them.
    const d = tmpdir();
    makeDevteamDir(d);
    fs.mkdirSync(path.join(d, "pipeline", "code-review"), { recursive: true });
    fs.mkdirSync(path.join(d, "pipeline", "gates"), { recursive: true });
    process.env.TEST_RUNNER_TOKEN = "ghp_test";
    process.env.STAGECRAFT_GITHUB_API_URL = server.baseUrl;
    try {
      // Platform reviewer approves the backend area. No gate in the result —
      // the hook must derive pipeline/gates/stage-05.backend.json locally.
      const reviewContent = Buffer.from(
        "## Review of backend\nImplementation looks correct.\nREVIEW: APPROVED\n",
        "utf8",
      );
      const sha256 = require("node:crypto").createHash("sha256").update(reviewContent).digest("hex");

      let capturedKey = null;
      const runId = 77;
      const artifactId = 777;

      server
        .on("POST", /\/dispatches$/, (req, res) => {
          const body = JSON.parse(req.body || "{}");
          capturedKey = body.inputs && body.inputs.idempotency_key;
          res.writeHead(204); res.end();
        })
        .on("GET", /\/actions\/runs(\?|$)/, (req, res) => {
          server.json(res, 200, {
            workflow_runs: capturedKey ? [{ id: runId, name: capturedKey }] : [],
          });
        })
        .on("GET", new RegExp(`/actions/runs/${runId}$`), (req, res) => {
          server.json(res, 200, { id: runId, status: "completed", conclusion: "success" });
        })
        .on("GET", new RegExp(`/actions/runs/${runId}/artifacts`), (req, res) => {
          server.json(res, 200, {
            artifacts: capturedKey
              ? [{ id: artifactId, name: `stagecraft-result-${capturedKey}` }]
              : [],
          });
        })
        .on("GET", new RegExp(`/artifacts/${artifactId}/zip`), (req, res) => {
          const result = {
            schema: "1",
            exitCode: 0,
            durationMs: 200,
            files: [
              {
                path: "pipeline/code-review/by-platform.md",
                sha256,
                contentBase64: reviewContent.toString("base64"),
              },
            ],
          };
          res.writeHead(200); res.end(makeResultZip(result));
        });

      const peerReviewDescriptor = {
        stage: "stage-05",
        name: "peer-review",
        role: "reviewer",
        rolesInStage: ["backend", "frontend", "platform", "qa"],
        workstreamId: "stage-05.backend",
        objective: "Review the backend workstream implementation.",
        readFirst: [],
        allowedWrites: [
          "pipeline/code-review/by-platform.md",
          "pipeline/gates/stage-05.backend.json",
          "pipeline/gates/stage-05.json",
        ],
        artifact: "pipeline/code-review/by-platform.md",
        template: "review-template.md",
        expectedGate: {},
        subagent: "reviewer",
      };

      const invokeResult = await adapter.invoke(peerReviewDescriptor, fixtureCtx(d), "Review prompt");
      assert.equal(invokeResult.exitCode, 0);
      assert.ok(invokeResult.gatePath, "gatePath should be non-null — hook must derive the gate");
      assert.ok(invokeResult.gatePath.includes("stage-05.backend.json"));

      const gateJson = JSON.parse(
        fs.readFileSync(path.join(d, "pipeline", "gates", "stage-05.backend.json"), "utf8"),
      );
      assert.equal(gateJson.stage, "stage-05");
      assert.equal(gateJson.workstream, "backend");
      assert.ok(gateJson.approvals.includes("dev-platform"), "platform reviewer approval recorded");
    } finally {
      delete process.env.TEST_RUNNER_TOKEN;
      delete process.env.STAGECRAFT_GITHUB_API_URL;
    }
  });
});
