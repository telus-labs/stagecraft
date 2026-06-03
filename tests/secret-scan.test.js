const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { REPO_ROOT, cleanup } = require("./_helpers");
const { scanContent, isAllowlistedPath } =
  require(path.join(REPO_ROOT, "core", "hooks", "secret-scan"));

const HOOK = path.join(REPO_ROOT, "core", "hooks", "secret-scan.js");

function runHook(stdin) {
  const r = spawnSync("node", [HOOK], {
    input: stdin,
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function preToolUse(tool_name, file_path, content) {
  return JSON.stringify({ tool_name, tool_input: { file_path, content } });
}

describe("secret-scan: scanContent — high-confidence patterns", () => {
  it("catches AWS Access Key", () => {
    const r = scanContent('export AWS_KEY="AKIAIOSFODNN7EXAMPLE"');
    assert.ok(r.length > 0);
    assert.equal(r[0].name, "AWS Access Key ID");
  });

  it("catches GitHub Personal Token", () => {
    const r = scanContent("token = ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789");
    assert.ok(r.length > 0);
    assert.equal(r[0].name, "GitHub Personal Token");
  });

  it("catches Anthropic API key", () => {
    const r = scanContent("ANTHROPIC_API_KEY=sk-ant-api03-aBcDeFgHiJkLmNoPqRsTuVwXyZ-aBcDeFgHiJ");
    assert.ok(r.length > 0);
    assert.equal(r[0].name, "Anthropic API Key");
  });

  it("catches OpenAI API key (and doesn't double-flag Anthropic as OpenAI)", () => {
    const anthropic = scanContent("k=sk-ant-api03-aBcDeFgHiJkLmNoPqRsTuVwXyZ-aBcDeFgHiJ");
    assert.deepEqual(anthropic.map((x) => x.name), ["Anthropic API Key"]);
    const openai = scanContent("k=sk-aBcDeFgHiJkLmNoPqRsTuVwXyZ012345");
    assert.deepEqual(openai.map((x) => x.name), ["OpenAI API Key"]);
  });

  it("catches Slack tokens (bot/user/app)", () => {
    assert.ok(scanContent("xoxb-1234567890-abcdefg").length > 0);
    assert.ok(scanContent("xoxp-1234567890-abcdefg").length > 0);
    assert.ok(scanContent("xapp-1-A12345-1234567890-abcdefg").length > 0);
  });

  it("catches Slack webhook URL", () => {
    const r = scanContent("https://hooks.slack.com/services/TABCDEF12/B0123456789/abcdefghijklmnopqrstuvwx");
    assert.ok(r.length > 0);
    assert.equal(r[0].name, "Slack Webhook URL");
  });

  it("catches Stripe live secret", () => {
    const r = scanContent("sk_live_abcdefghijklmnop12345678");
    assert.ok(r.length > 0);
  });

  it("catches private key blocks", () => {
    const r = scanContent("-----BEGIN RSA PRIVATE KEY-----\nMIIEow...");
    assert.ok(r.length > 0);
    assert.equal(r[0].name, "Private Key Block");
  });

  it("catches Google API key", () => {
    const r = scanContent("apiKey: 'AIzaSyABCDEFghIjKlMnOpQrStUvWxYz0123456'");
    assert.ok(r.length > 0);
  });

  it("catches Postgres URL with embedded password", () => {
    const r = scanContent("DB=postgres://user:supersecretpw@db.example.com:5432/myapp");
    assert.ok(r.length > 0);
    assert.equal(r[0].name, "Postgres URL w/ password");
  });

  it("catches JWT-shaped token", () => {
    const r = scanContent("token=eyJhbGciOiJIUzI1NiIs.eyJzdWIiOiIxMjM0NTY3.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c");
    assert.ok(r.length > 0);
  });
});

describe("secret-scan: scanContent — low-noise (no false positives)", () => {
  it("ignores plain prose", () => {
    assert.deepEqual(scanContent("This is just a documentation paragraph with no secrets."), []);
  });

  it("ignores AKIA-in-prose", () => {
    // AKIA followed by uppercase 16 chars IS a match; we'd want a real
    // false positive to test, so use AKIA followed by mixed case.
    assert.deepEqual(scanContent("Avoid storing AKIAakia-style placeholders inline"), []);
  });

  it("ignores placeholder API_KEY assignments", () => {
    const text = "API_KEY=YOUR_KEY_HERE\nAPI_KEY=changeme\nAPI_KEY=xxx";
    assert.deepEqual(scanContent(text), []);
  });

  it("ignores function names mentioning auth keywords", () => {
    assert.deepEqual(scanContent("function makeApiKey() { return 'test'; }"), []);
  });

  it("ignores README snippets describing patterns", () => {
    const text = "Don't commit `sk_live_*` keys. Use placeholders like sk_test_xxx instead.";
    // sk_test_ isn't in the SECRET_PATTERNS list, and sk_live_xxx has wildcard
    // not real chars so won't match the live regex
    assert.deepEqual(scanContent(text), []);
  });
});

describe("secret-scan: magic-comment override", () => {
  it("bypasses the scan when devteam-allow-secret marker present", () => {
    const text = "# devteam-allow-secret: test fixture\nAWS_KEY=AKIAIOSFODNN7EXAMPLE";
    assert.deepEqual(scanContent(text), []);
  });

  it("override is case-insensitive", () => {
    const text = "DEVTEAM-ALLOW-SECRET: test\ntoken=ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789";
    assert.deepEqual(scanContent(text), []);
  });

  it("override requires the colon", () => {
    const text = "devteam allow secret\ntoken=ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789";
    assert.ok(scanContent(text).length > 0);
  });
});

describe("secret-scan: path allowlist", () => {
  it("skips .env.example, .env.sample, .template, .dist", () => {
    assert.equal(isAllowlistedPath(".env.example"), true);
    assert.equal(isAllowlistedPath("config/.env.sample"), true);
    assert.equal(isAllowlistedPath("config.json.template"), true);
    assert.equal(isAllowlistedPath("config.json.dist"), true);
  });

  it("skips docs/* and examples/* markdown", () => {
    assert.equal(isAllowlistedPath("docs/observability.md"), true);
    assert.equal(isAllowlistedPath("examples/sms-opt-in/brief.md"), true);
  });

  it("skips test files and snapshots", () => {
    assert.equal(isAllowlistedPath("tests/secret-scan.test.js"), true);
    assert.equal(isAllowlistedPath("__snapshots__/x.snap"), true);
  });

  it("does NOT skip src/", () => {
    assert.equal(isAllowlistedPath("src/backend/auth.js"), false);
    assert.equal(isAllowlistedPath("config/production.json"), false);
  });
});

describe("secret-scan: PreToolUse hook (end-to-end via stdin)", () => {
  it("clean Write → exit 0", () => {
    const r = runHook(preToolUse("Write", "src/x.js", "function foo() { return 42; }"));
    assert.equal(r.status, 0);
  });

  it("dirty Write → exit 2 with reason in stderr", () => {
    const r = runHook(preToolUse("Write", "src/x.js", "const k = 'AKIAIOSFODNN7EXAMPLE';"));
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Blocked.*1 secret-like pattern/);
    assert.match(r.stderr, /AWS Access Key ID/);
  });

  it("dirty Edit (new_string) → exit 2", () => {
    const stdin = JSON.stringify({
      tool_name: "Edit",
      tool_input: {
        file_path: "src/x.js",
        old_string: "const k = 1;",
        new_string: "const k = 'sk-ant-api03-aBcDeFgHiJkLmNoPqRsTuVwXyZ-aBcDeFgHiJ';",
      },
    });
    const r = runHook(stdin);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Anthropic/);
  });

  it("Write to .env.example → exit 0 (allowlisted path)", () => {
    const r = runHook(preToolUse("Write", ".env.example", "AWS_KEY=AKIAIOSFODNN7EXAMPLE"));
    assert.equal(r.status, 0);
  });

  it("Write with devteam-allow-secret marker → exit 0", () => {
    const r = runHook(preToolUse("Write", "src/x.js", "# devteam-allow-secret: fixture\nk=AKIAIOSFODNN7EXAMPLE"));
    assert.equal(r.status, 0);
  });

  it("non-Write/Edit tool → exit 0 (we don't scan Read, Bash, etc.)", () => {
    const r = runHook(JSON.stringify({ tool_name: "Read", tool_input: { file_path: "x.js" } }));
    assert.equal(r.status, 0);
  });

  it("empty stdin → exit 0", () => {
    const r = runHook("");
    assert.equal(r.status, 0);
  });

  it("malformed JSON stdin → exit 0 (don't block on hook bugs)", () => {
    const r = runHook("{this is not json");
    assert.equal(r.status, 0);
  });

  it("content over MAX_SCAN_BYTES → exit 0 with warning (fail-soft on size)", () => {
    // 1.7 MB of plausible source text with an AWS key buried inside. The cap
    // is 1 MB; this content should be skipped, the key NOT detected, and the
    // hook should exit 0 (allow) so a hook-timeout-fail-open can't happen
    // under load.
    //
    // Implementation note: spawnSync's `input` option EPIPEs the parent
    // when the child consumes stdin and exits before the parent finishes
    // writing — happens reliably for inputs ≳ 500KB. Real Claude Code use
    // is a streamed pipe and doesn't hit this. We mirror the streamed shape
    // by writing to a temp file and passing its file descriptor as the
    // child's stdin (`stdio: [fd, ...]`) — no shell involved.
    const filler = "function f() { return 42; }\n".repeat(60_000); // ~1.7 MB
    const content = filler + "\nconst k = 'AKIAIOSFODNN7EXAMPLE';\n";
    const stdin = preToolUse("Write", "src/big.js", content);
    const tmpDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "secret-scan-"));
    const tmp = path.join(tmpDir, "in.json");
    fs.writeFileSync(tmp, stdin);
    const fd = fs.openSync(tmp, "r");
    try {
      const r = spawnSync("node", [HOOK], {
        stdio: [fd, "pipe", "pipe"],
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      });
      assert.equal(r.status, 0, "oversize content should be skipped (allow)");
      assert.match(r.stderr, /\[secret-scan\] ⚠️.*skipping scan/);
      assert.match(r.stderr, /cap 1000000/);
      // The buried AWS key should NOT have been reported — we skipped the scan.
      assert.doesNotMatch(r.stderr, /AWS Access Key ID/);
    } finally {
      fs.closeSync(fd);
      cleanup(tmpDir);
    }
  });

  it("content just under MAX_SCAN_BYTES still scans normally", () => {
    // ~250 KB of clean content — well under the 1 MB cap; should scan and
    // pass clean (no warning, no findings).
    const content = "const x = " + "1, ".repeat(50_000) + "0;\n";
    const r = runHook(preToolUse("Write", "src/medium.js", content));
    assert.equal(r.status, 0, "under-cap clean content should scan and pass");
    assert.doesNotMatch(r.stderr, /skipping scan/);
  });
});

describe("secret-scan: snippet redaction", () => {
  it("findings include a redacted snippet, not the full secret", () => {
    const findings = scanContent("AWS_KEY=AKIAIOSFODNN7EXAMPLE");
    assert.equal(findings.length, 1);
    assert.match(findings[0].snippet, /\*\*\*/);
    // We don't want the whole match echoed back
    assert.ok(!findings[0].snippet.includes("AKIAIOSFODNN7EXAMPLE") || findings[0].snippet.length < "AKIAIOSFODNN7EXAMPLE".length);
  });
});
