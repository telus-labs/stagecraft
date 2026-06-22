// Tests for core/adapters/remote-bundle.js (BACKLOG A3 / ADR-013 phase 21.1).
//
// Sections:
//   1. safePath — pure predicate
//   2. isDenied — denylist filtering
//   3. validateResult — hostile result fixtures
//   4. applyResult — staging and serial application
//   5. buildManifest — git-backed discovery with real temp repo

const { describe, test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync, spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const {
  safePath,
  isDenied,
  validateResult,
  applyResult,
  buildManifest,
  sha256,
  DEFAULT_MAX_BUNDLE_BYTES,
} = require(path.join(REPO_ROOT, "core", "adapters", "remote-bundle"));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "devteam-bundle-test-"));
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
}

function makeEntry(relPath, text) {
  const content = Buffer.from(text, "utf8");
  return { path: relPath, sizeBytes: content.length, sha256: sha256(content), content };
}

// Initialize a minimal git repo for buildManifest tests.
function makeGitRepo(dir, files = {}) {
  spawnSync("git", ["init", "-b", "main"], { cwd: dir, stdio: "ignore" });
  spawnSync("git", ["config", "user.email", "test@test.com"], { cwd: dir, stdio: "ignore" });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: dir, stdio: "ignore" });
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text, "utf8");
    spawnSync("git", ["add", rel], { cwd: dir, stdio: "ignore" });
  }
  if (Object.keys(files).length > 0) {
    spawnSync("git", ["commit", "-m", "init", "--allow-empty-message"], { cwd: dir, stdio: "ignore" });
  }
  return dir;
}

// ─── 1. safePath ─────────────────────────────────────────────────────────────

describe("safePath — path safety predicate", () => {
  test("accepts simple relative path", () => {
    assert.ok(safePath("src/index.js"));
  });

  test("accepts nested relative path", () => {
    assert.ok(safePath("a/b/c/d.txt"));
  });

  test("rejects absolute path (Unix)", () => {
    assert.ok(!safePath("/etc/passwd"));
  });

  test("rejects Windows drive letter", () => {
    assert.ok(!safePath("C:\\Windows\\System32\\cmd.exe"));
    assert.ok(!safePath("C:/Windows/foo"));
  });

  test("rejects path with null byte", () => {
    assert.ok(!safePath("src/foo\0bar.js"));
  });

  test("rejects traversal — leading dots", () => {
    assert.ok(!safePath("../../../etc/passwd"));
  });

  test("rejects traversal — normalized form escapes", () => {
    assert.ok(!safePath("a/../../etc/passwd"));
  });

  test("rejects empty string", () => {
    assert.ok(!safePath(""));
  });

  test("rejects null", () => {
    assert.ok(!safePath(null));
  });

  test("accepts dot-file in project", () => {
    assert.ok(safePath(".eslintrc.json"));
  });
});

// ─── 2. isDenied ─────────────────────────────────────────────────────────────

describe("isDenied — bundle denylist", () => {
  test("denies .git/config", () => assert.ok(isDenied(".git/config")));
  test("denies node_modules/lodash/index.js", () => assert.ok(isDenied("node_modules/lodash/index.js")));
  test("denies pipeline/run-state.json", () => assert.ok(isDenied("pipeline/run-state.json")));
  test("denies pipeline/run-log.jsonl", () => assert.ok(isDenied("pipeline/run-log.jsonl")));
  test("denies pipeline/run.lock", () => assert.ok(isDenied("pipeline/run.lock")));
  test("denies pipeline/logs/ws.log", () => assert.ok(isDenied("pipeline/logs/ws.log")));
  test("denies pipeline/gates/archive/stage-04.json", () => assert.ok(isDenied("pipeline/gates/archive/stage-04.json")));
  test("denies .env", () => assert.ok(isDenied(".env")));
  test("denies .env.local", () => assert.ok(isDenied(".env.local")));
  test("denies .env.production", () => assert.ok(isDenied(".env.production")));
  test("allows .env.example", () => assert.ok(!isDenied(".env.example")));
  test("allows .env.sample", () => assert.ok(!isDenied(".env.sample")));
  test("denies secrets.pem", () => assert.ok(isDenied("secrets.pem")));
  test("denies private.key", () => assert.ok(isDenied("private.key")));
  test("denies cert.p12", () => assert.ok(isDenied("cert.p12")));
  test("denies yarn.lock", () => assert.ok(isDenied("yarn.lock")));
  test("denies package-lock.json", () => assert.ok(isDenied("package-lock.json")));
  test("denies pnpm-lock.yaml", () => assert.ok(isDenied("pnpm-lock.yaml")));
  test("allows src/index.js", () => assert.ok(!isDenied("src/index.js")));
  test("allows pipeline/brief.md", () => assert.ok(!isDenied("pipeline/brief.md")));
  test("allows pipeline/gates/stage-04a.json", () => assert.ok(!isDenied("pipeline/gates/stage-04a.json")));
  test("denies .devteam/memory/foo.json", () => assert.ok(isDenied(".devteam/memory/foo.json")));
  test("allows .devteam/config.yml", () => assert.ok(!isDenied(".devteam/config.yml")));
});

// ─── 3. validateResult — hostile result fixtures ──────────────────────────────

describe("validateResult — path safety", () => {
  test("rejects path traversal", () => {
    const entry = makeEntry("../../../etc/passwd", "pwned");
    const { ok, errors } = validateResult([entry], { allowedWrites: ["../../../etc/"] });
    assert.ok(!ok);
    assert.ok(errors.some((e) => e.type === "unsafe-path"));
  });

  test("rejects absolute path", () => {
    const entry = makeEntry("/etc/passwd", "pwned");
    const { ok, errors } = validateResult([entry], { allowedWrites: ["/etc/"] });
    assert.ok(!ok);
    assert.ok(errors.some((e) => e.type === "unsafe-path"));
  });

  test("rejects Windows drive letter path", () => {
    const entry = makeEntry("C:/Windows/foo", "data");
    const { ok, errors } = validateResult([entry]);
    assert.ok(!ok);
    assert.ok(errors.some((e) => e.type === "unsafe-path"));
  });
});

describe("validateResult — authorization", () => {
  test("rejects file outside allowedWrites and not gate", () => {
    const entry = makeEntry("src/evil.js", "evil");
    const { ok, errors } = validateResult([entry], {
      allowedWrites: ["pipeline/"],
      gatePath: "pipeline/gates/ws-1.json",
    });
    assert.ok(!ok);
    assert.ok(errors.some((e) => e.type === "unauthorized-write" && e.path === "src/evil.js"));
  });

  test("allows file inside allowedWrites", () => {
    const entry = makeEntry("src/feature.js", "export const x = 1;");
    const { ok } = validateResult([entry], { allowedWrites: ["src/"] });
    assert.ok(ok);
  });

  test("always allows the declared gate path", () => {
    const entry = makeEntry("pipeline/gates/ws-1.json", '{"status":"PASS"}');
    const { ok } = validateResult([entry], {
      allowedWrites: [],
      gatePath: "pipeline/gates/ws-1.json",
    });
    assert.ok(ok);
  });
});

describe("validateResult — corrupt digest", () => {
  test("rejects file whose content does not match declared digest", () => {
    const content = Buffer.from("real content", "utf8");
    const entry = {
      path: "src/file.js",
      sizeBytes: content.length,
      sha256: "000000000000000000000000000000000000000000000000000000000000dead",
      content,
    };
    const { ok, errors } = validateResult([entry], { allowedWrites: ["src/"] });
    assert.ok(!ok);
    assert.ok(errors.some((e) => e.type === "corrupt-digest"));
  });

  test("accepts file with correct digest", () => {
    const entry = makeEntry("src/file.js", "export const x = 1;");
    const { ok } = validateResult([entry], { allowedWrites: ["src/"] });
    assert.ok(ok);
  });
});

describe("validateResult — case collision", () => {
  test("detects case collision between two result paths", () => {
    const a = makeEntry("src/File.js", "a");
    const b = makeEntry("src/file.js", "b");
    const { ok, errors } = validateResult([a, b], { allowedWrites: ["src/"] });
    assert.ok(!ok);
    assert.ok(errors.some((e) => e.type === "case-collision"));
  });

  test("accepts two files that differ beyond case", () => {
    const a = makeEntry("src/fileA.js", "a");
    const b = makeEntry("src/fileB.js", "b");
    const { ok } = validateResult([a, b], { allowedWrites: ["src/"] });
    assert.ok(ok);
  });
});

describe("validateResult — duplicate path", () => {
  test("rejects the same path appearing twice", () => {
    const a = makeEntry("src/index.js", "a");
    const b = makeEntry("src/index.js", "b");
    const { ok, errors } = validateResult([a, b], { allowedWrites: ["src/"] });
    assert.ok(!ok);
    assert.ok(errors.some((e) => e.type === "duplicate-path"));
  });
});

describe("validateResult — size limits", () => {
  test("rejects result that exceeds byte ceiling", () => {
    const content = Buffer.alloc(1024, "x");
    const entry = { path: "src/big.bin", sizeBytes: 1024, sha256: sha256(content), content };
    const { ok, errors } = validateResult([entry], {
      allowedWrites: ["src/"],
      maxOutputBytes: 100,
    });
    assert.ok(!ok);
    assert.ok(errors.some((e) => e.type === "size-exceeded"));
  });

  test("rejects result that exceeds file count limit", () => {
    const entries = Array.from({ length: 3 }, (_, i) => makeEntry(`src/f${i}.js`, "x"));
    const { ok, errors } = validateResult(entries, {
      allowedWrites: ["src/"],
      maxOutputFiles: 2,
    });
    assert.ok(!ok);
    assert.ok(errors.some((e) => e.type === "file-count-exceeded"));
  });
});

describe("validateResult — local edit conflict", () => {
  test("detects conflict when file changed locally and remote returned different bytes", () => {
    const originalContent = Buffer.from("original", "utf8");
    const remoteContent = Buffer.from("remote change", "utf8");
    const submittedDigest = sha256(originalContent);

    const entry = {
      path: "src/file.js",
      sizeBytes: remoteContent.length,
      sha256: sha256(remoteContent),
      content: remoteContent,
    };

    // submittedDigests contains the hash AT dispatch time; adapter only adds
    // entries for paths that have since changed locally.
    const submittedDigests = new Map([["src/file.js", submittedDigest]]);
    const { ok, errors } = validateResult([entry], {
      allowedWrites: ["src/"],
      submittedDigests,
    });
    assert.ok(!ok);
    assert.ok(errors.some((e) => e.type === "local-edit-conflict" && e.path === "src/file.js"));
  });

  test("no conflict when remote returned identical bytes to submission", () => {
    const content = Buffer.from("same content", "utf8");
    const submittedDigest = sha256(content);

    const entry = { path: "src/file.js", sizeBytes: content.length, sha256: sha256(content), content };
    // File changed locally, but remote returned the same bytes — safe to apply.
    const submittedDigests = new Map([["src/file.js", submittedDigest]]);
    const { ok } = validateResult([entry], { allowedWrites: ["src/"], submittedDigests });
    assert.ok(ok);
  });
});

// ─── 4. applyResult ───────────────────────────────────────────────────────────

describe("applyResult — normal application", () => {
  test("writes files to correct locations", () => {
    const dir = tmpDir();
    try {
      const entries = [
        makeEntry("src/index.js", "export const x = 1;"),
        makeEntry("src/utils/helpers.js", "export const y = 2;"),
      ];
      const { applied } = applyResult(entries, dir);
      assert.deepEqual(applied.sort(), ["src/index.js", "src/utils/helpers.js"].sort());
      assert.equal(fs.readFileSync(path.join(dir, "src", "index.js"), "utf8"), "export const x = 1;");
      assert.equal(fs.readFileSync(path.join(dir, "src", "utils", "helpers.js"), "utf8"), "export const y = 2;");
    } finally {
      cleanup(dir);
    }
  });

  test("creates parent directories as needed", () => {
    const dir = tmpDir();
    try {
      const entries = [makeEntry("a/b/c/d/file.txt", "deep")];
      applyResult(entries, dir);
      assert.equal(fs.readFileSync(path.join(dir, "a", "b", "c", "d", "file.txt"), "utf8"), "deep");
    } finally {
      cleanup(dir);
    }
  });

  test("overwrites existing files", () => {
    const dir = tmpDir();
    try {
      fs.mkdirSync(path.join(dir, "src"), { recursive: true });
      fs.writeFileSync(path.join(dir, "src", "file.js"), "old content");
      const entries = [makeEntry("src/file.js", "new content")];
      applyResult(entries, dir);
      assert.equal(fs.readFileSync(path.join(dir, "src", "file.js"), "utf8"), "new content");
    } finally {
      cleanup(dir);
    }
  });

  test("temp dir is cleaned up on success", () => {
    const tempBase = tmpDir();
    const dest = tmpDir();
    try {
      const entries = [makeEntry("src/ok.js", "ok")];
      applyResult(entries, dest, { tempDir: tempBase });
      // No devteam-result- dirs should remain
      const remaining = fs.readdirSync(tempBase).filter((n) => n.startsWith("devteam-result-"));
      assert.equal(remaining.length, 0);
    } finally {
      cleanup(tempBase);
      cleanup(dest);
    }
  });
});

describe("applyResult — failure handling", () => {
  test("rejects entry with corrupt digest during staging", () => {
    const dir = tmpDir();
    try {
      const content = Buffer.from("actual content", "utf8");
      const entry = {
        path: "src/file.js",
        sizeBytes: content.length,
        sha256: "000000000000000000000000000000000000000000000000000000000000dead",
        content,
      };
      assert.throws(() => applyResult([entry], dir), /digest mismatch/i);
    } finally {
      cleanup(dir);
    }
  });

  test("preserves temp dir on failure and includes path in error", () => {
    const tempBase = tmpDir();
    const dest = tmpDir();
    try {
      const content = Buffer.from("x", "utf8");
      const entry = {
        path: "src/bad.js",
        sizeBytes: content.length,
        sha256: "badhash000000000000000000000000000000000000000000000000000000000",
        content,
      };
      let thrownErr;
      try {
        applyResult([entry], dest, { tempDir: tempBase });
      } catch (err) {
        thrownErr = err;
      }
      assert.ok(thrownErr, "expected an error");
      assert.ok(thrownErr.message.includes("Staged files preserved at:"), "error includes temp dir path");
      assert.ok(thrownErr.tempDir, "error has tempDir property");
    } finally {
      cleanup(tempBase);
      cleanup(dest);
    }
  });

  test("rejects unsafe path during staging", () => {
    const dir = tmpDir();
    try {
      const content = Buffer.from("evil", "utf8");
      const entry = { path: "../escape.js", sizeBytes: content.length, sha256: sha256(content), content };
      assert.throws(() => applyResult([entry], dir), /unsafe path/i);
    } finally {
      cleanup(dir);
    }
  });
});

// ─── 5. buildManifest — git-backed discovery ─────────────────────────────────

describe("buildManifest — basic discovery", () => {
  let repoDir;
  before(() => {
    repoDir = tmpDir();
    makeGitRepo(repoDir, {
      "src/index.js": "export const x = 1;",
      "src/utils.js": "export const y = 2;",
      "README.md": "# Hello",
    });
  });
  after(() => cleanup(repoDir));

  test("includes tracked files", () => {
    const { entries } = buildManifest(repoDir, { skipSecretScan: true });
    const paths = entries.map((e) => e.path);
    assert.ok(paths.includes("src/index.js"), "includes src/index.js");
    assert.ok(paths.includes("README.md"), "includes README.md");
  });

  test("entries are sorted by path", () => {
    const { entries } = buildManifest(repoDir, { skipSecretScan: true });
    const paths = entries.map((e) => e.path);
    assert.deepEqual(paths, [...paths].sort());
  });

  test("each entry has path, sizeBytes, sha256, content", () => {
    const { entries } = buildManifest(repoDir, { skipSecretScan: true });
    for (const e of entries) {
      assert.ok(e.path, "has path");
      assert.ok(typeof e.sizeBytes === "number", "has sizeBytes");
      assert.ok(typeof e.sha256 === "string" && e.sha256.length === 64, "has sha256");
      assert.ok(Buffer.isBuffer(e.content), "has content Buffer");
    }
  });

  test("sha256 matches content", () => {
    const { entries } = buildManifest(repoDir, { skipSecretScan: true });
    for (const e of entries) {
      assert.equal(sha256(e.content), e.sha256);
    }
  });

  test("totalBytes equals sum of entry sizes", () => {
    const { entries, totalBytes } = buildManifest(repoDir, { skipSecretScan: true });
    const sum = entries.reduce((acc, e) => acc + e.sizeBytes, 0);
    assert.equal(totalBytes, sum);
  });
});

describe("buildManifest — denylist filtering", () => {
  let repoDir;
  before(() => {
    repoDir = tmpDir();
    makeGitRepo(repoDir, {
      "src/index.js": "ok",
      ".env": "SECRET=hunter2",
      "pipeline/run-state.json": '{"running":true}',
    });
    // Add node_modules dir (untracked, gitignored by convention)
    fs.mkdirSync(path.join(repoDir, "node_modules", "pkg"), { recursive: true });
    fs.writeFileSync(path.join(repoDir, "node_modules", "pkg", "index.js"), "module.exports={}");
    // Add gitignore so node_modules isn't picked up as untracked
    fs.writeFileSync(path.join(repoDir, ".gitignore"), "node_modules/\n");
    spawnSync("git", ["add", ".gitignore"], { cwd: repoDir, stdio: "ignore" });
    spawnSync("git", ["commit", "-m", "add gitignore"], { cwd: repoDir, stdio: "ignore" });
  });
  after(() => cleanup(repoDir));

  test("excludes .env from manifest", () => {
    const { entries } = buildManifest(repoDir, { skipSecretScan: true });
    assert.ok(!entries.some((e) => e.path === ".env"));
  });

  test("excludes pipeline/run-state.json from manifest", () => {
    const { entries } = buildManifest(repoDir, { skipSecretScan: true });
    assert.ok(!entries.some((e) => e.path === "pipeline/run-state.json"));
  });

  test("excludes node_modules/ from manifest", () => {
    const { entries } = buildManifest(repoDir, { skipSecretScan: true });
    assert.ok(!entries.some((e) => e.path.startsWith("node_modules/")));
  });

  test("includes src/index.js", () => {
    const { entries } = buildManifest(repoDir, { skipSecretScan: true });
    assert.ok(entries.some((e) => e.path === "src/index.js"));
  });
});

describe("buildManifest — byte ceiling", () => {
  let repoDir;
  before(() => {
    repoDir = tmpDir();
    makeGitRepo(repoDir, { "big.bin": "x".repeat(200) });
  });
  after(() => cleanup(repoDir));

  test("throws when bundle exceeds maxBundleBytes", () => {
    assert.throws(
      () => buildManifest(repoDir, { skipSecretScan: true, maxBundleBytes: 50 }),
      /byte ceiling/i,
    );
  });

  test("succeeds when maxBundleBytes is sufficient", () => {
    const { entries } = buildManifest(repoDir, { skipSecretScan: true, maxBundleBytes: 10_000 });
    assert.ok(entries.some((e) => e.path === "big.bin"));
  });
});

describe("buildManifest — secret scanning", () => {
  let repoDir;
  before(() => {
    repoDir = tmpDir();
    // A file with a real secret pattern
    makeGitRepo(repoDir, {
      // AKIAIOSFODNN7EXAMPLE is exactly AKIA + 16 uppercase-alphanumeric chars —
      // the minimum to match the AWS Access Key ID pattern.
      "src/config.js": `const key = "AKIAIOSFODNN7EXAMPLE";`,
    });
  });
  after(() => cleanup(repoDir));

  test("throws when a tracked file contains a secret", () => {
    assert.throws(
      () => buildManifest(repoDir),  // skipSecretScan NOT set
      /secret detected/i,
    );
  });

  test("skipSecretScan bypasses the check (tests only)", () => {
    const { entries } = buildManifest(repoDir, { skipSecretScan: true });
    assert.ok(entries.some((e) => e.path === "src/config.js"));
  });
});

describe("buildManifest — symlink safety", () => {
  let repoDir;
  before(() => {
    repoDir = tmpDir();
    makeGitRepo(repoDir, { "safe.txt": "ok" });
    // Create a symlink that escapes the project root
    const linkPath = path.join(repoDir, "escape-link");
    try {
      fs.symlinkSync(os.tmpdir(), linkPath);
      spawnSync("git", ["add", "escape-link"], { cwd: repoDir, stdio: "ignore" });
    } catch { /* symlinks may not be supported on all platforms */ }
  });
  after(() => cleanup(repoDir));

  test("skips symlinks that point outside project root with a warning", () => {
    const { entries, warnings } = buildManifest(repoDir, { skipSecretScan: true });
    // The link should not appear in entries
    assert.ok(!entries.some((e) => e.path === "escape-link"));
    // A warning should be emitted
    assert.ok(warnings.some((w) => w.includes("escape-link") || w.includes("symlink")));
  });
});

describe("buildManifest — extraPaths", () => {
  let repoDir;
  before(() => {
    repoDir = tmpDir();
    makeGitRepo(repoDir, { "src/index.js": "ok" });
    // pipeline/brief.md exists on disk but is normally excluded from commits
    fs.mkdirSync(path.join(repoDir, "pipeline"), { recursive: true });
    fs.writeFileSync(path.join(repoDir, "pipeline", "brief.md"), "# Brief");
  });
  after(() => cleanup(repoDir));

  test("includes explicitly listed extra paths even if denied by default", () => {
    const { entries } = buildManifest(repoDir, {
      skipSecretScan: true,
      extraPaths: ["pipeline/brief.md"],
    });
    assert.ok(entries.some((e) => e.path === "pipeline/brief.md"));
  });
});

describe("buildManifest — error on non-repo", () => {
  test("throws when projectRoot is not a git repository", () => {
    const dir = tmpDir();
    try {
      assert.throws(() => buildManifest(dir, { skipSecretScan: true }), /git unavailable|not a repository/i);
    } finally {
      cleanup(dir);
    }
  });
});
