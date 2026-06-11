// tests/a11y-fixer.test.js
//
// Behavioral tests for core/a11y-fixer.js.
// Covers the pure-core functions (parseBlocker, buildA11yFixPrompt) plus the
// early-exit paths of fixA11yBlockers that don't require a live LLM.

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { REPO_ROOT, cleanup } = require("./_helpers");
const {
  parseBlocker,
  buildA11yFixPrompt,
  fixA11yBlockers,
} = require(path.join(REPO_ROOT, "core", "a11y-fixer"));

// Capture stderr writes temporarily so warnings don't pollute test output.
async function captureStderrAsync(fn) {
  const orig = process.stderr.write.bind(process.stderr);
  const lines = [];
  process.stderr.write = (s) => { lines.push(s); return true; };
  try { return { result: await fn(), lines }; }
  finally { process.stderr.write = orig; }
}

let _tmpDirs = [];
function makeTmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "devteam-test-"));
  _tmpDirs.push(d);
  return d;
}
afterEach(() => { _tmpDirs.forEach(cleanup); _tmpDirs = []; });

// Minimal adapter stub with headless capability and a command that exits 0.
function makeAdapter(overrides = {}) {
  return {
    capabilities: {
      headless: true,
      headlessCommand: "true",
      ...overrides,
    },
  };
}

// ---------------------------------------------------------------------------
// parseBlocker — pure function
// ---------------------------------------------------------------------------

describe("parseBlocker — object input", () => {
  it("extracts id, element, wcag, severity, and remediation from a well-formed object", () => {
    const b = {
      id: "A11Y-1",
      element: "button.submit",
      wcag: "4.1.2",
      severity: "critical",
      description: "Remediation: Add an aria-label attribute.",
    };
    const r = parseBlocker(b);
    assert.equal(r.id, "A11Y-1");
    assert.equal(r.element, "button.submit");
    assert.equal(r.wcag, "4.1.2");
    assert.equal(r.severity, "critical");
    assert.equal(r.remediation, "Add an aria-label attribute.");
  });

  it("falls back to the full description when no 'Remediation:' prefix is present", () => {
    const b = { id: "A11Y-2", description: "Missing alt text on image." };
    const r = parseBlocker(b);
    assert.equal(r.remediation, "Missing alt text on image.");
  });

  it("returns null for a null input", () => {
    assert.equal(parseBlocker(null), null);
  });

  it("returns null for a non-object, non-string input (number)", () => {
    assert.equal(parseBlocker(42), null);
  });

  it("returns defaults for missing fields (empty strings)", () => {
    const r = parseBlocker({});
    assert.equal(r.id, "");
    assert.equal(r.element, "");
    assert.equal(r.wcag, "");
    assert.equal(r.remediation, "");
    assert.equal(r.severity, "");
  });
});

describe("parseBlocker — string input", () => {
  it("parses a valid JSON string as if it were an object", () => {
    const raw = JSON.stringify({
      id: "A11Y-3",
      description: "Remediation: Set aria-required=true.",
    });
    const r = parseBlocker(raw);
    assert.equal(r.id, "A11Y-3");
    assert.equal(r.remediation, "Set aria-required=true.");
  });

  it("treats a non-JSON string as a plain remediation text (malformed input)", () => {
    const r = parseBlocker("not valid json {{");
    assert.equal(r.id, "");
    assert.equal(r.element, "");
    assert.equal(r.remediation, "not valid json {{");
  });

  it("treats an empty JSON string as a plain remediation text", () => {
    // JSON.parse("") throws — should fall back gracefully
    const r = parseBlocker("");
    assert.equal(r.remediation, "");
  });
});

// ---------------------------------------------------------------------------
// buildA11yFixPrompt — pure function
// ---------------------------------------------------------------------------

describe("buildA11yFixPrompt — empty / malformed input", () => {
  it("returns an empty string for an empty blockers array", () => {
    assert.equal(buildA11yFixPrompt([]), "");
  });

  it("returns an empty string when all blockers parse to null (only nulls)", () => {
    // parseBlocker(null) → null, parseBlocker(42) → null
    assert.equal(buildA11yFixPrompt([null, 42]), "");
  });
});

describe("buildA11yFixPrompt — single blocker", () => {
  it("includes the WCAG rules header and the fix instruction", () => {
    const blockers = [{ id: "A11Y-1", wcag: "4.1.2", element: "nav", description: "Remediation: Add aria-label." }];
    const prompt = buildA11yFixPrompt(blockers);
    assert.ok(prompt.includes("WCAG 2.1 AA"));
    assert.ok(prompt.includes("src/frontend/index.html"));
    assert.ok(prompt.includes("Fix 1"));
    assert.ok(prompt.includes("(A11Y-1)"));
    assert.ok(prompt.includes("WCAG 4.1.2"));
    assert.ok(prompt.includes("element: `nav`"));
    assert.ok(prompt.includes("Add aria-label."));
  });

  it("omits absent optional fields (no wcag, no element)", () => {
    const blockers = [{ id: "A11Y-X", description: "Remediation: Apply fix." }];
    const prompt = buildA11yFixPrompt(blockers);
    assert.ok(prompt.includes("Fix 1"));
    assert.ok(!prompt.includes("WCAG undefined"));
    assert.ok(!prompt.includes("element: ``"));
  });
});

describe("buildA11yFixPrompt — multiple blockers", () => {
  it("numbers each fix sequentially", () => {
    const blockers = [
      { id: "A-1", description: "Remediation: First fix." },
      { id: "A-2", description: "Remediation: Second fix." },
    ];
    const prompt = buildA11yFixPrompt(blockers);
    assert.ok(prompt.includes("Fix 1"));
    assert.ok(prompt.includes("Fix 2"));
    assert.ok(prompt.includes("First fix."));
    assert.ok(prompt.includes("Second fix."));
  });

  it("silently skips null-parsing blockers without breaking the numbering of valid ones", () => {
    // null → filtered before building, so only valid blockers are numbered
    const blockers = [null, { id: "A-1", description: "Remediation: Only fix." }];
    const prompt = buildA11yFixPrompt(blockers);
    assert.ok(prompt.includes("Fix 1"));
    assert.ok(prompt.includes("Only fix."));
    // Should not contain "Fix 2" since there's only one valid blocker
    assert.ok(!prompt.includes("Fix 2"));
  });
});

// ---------------------------------------------------------------------------
// fixA11yBlockers — structural-fix warning (isStructuralFix exercised via stderr)
// ---------------------------------------------------------------------------

describe("fixA11yBlockers — structural-fix warning", () => {
  it("emits a stderr warning when a blocker remediation mentions 'add a label'", async () => {
    const cwd = makeTmp();
    const blockers = [{ id: "A-S1", description: "Remediation: Add a label to the input." }];
    // Use adapter with no headlessCommand so dispatch fails fast after the warning.
    const adapter = makeAdapter({ headlessCommand: undefined });
    const { lines } = await captureStderrAsync(() =>
      fixA11yBlockers(cwd, blockers, { _adapter: adapter }),
    );
    assert.ok(
      lines.some((l) => l.includes("WARNING") && l.includes("structural HTML")),
      `expected structural warning; got: ${lines.join("")}`,
    );
  });

  it("emits a structural warning for 'skip-link' remediation text", async () => {
    const cwd = makeTmp();
    const blockers = [{ id: "A-S2", description: "Remediation: Add a skip navigation link." }];
    const adapter = makeAdapter({ headlessCommand: undefined });
    const { lines } = await captureStderrAsync(() =>
      fixA11yBlockers(cwd, blockers, { _adapter: adapter }),
    );
    assert.ok(lines.some((l) => l.includes("WARNING")));
  });
});

// ---------------------------------------------------------------------------
// fixA11yBlockers — early-exit paths (no real LLM invoked)
// ---------------------------------------------------------------------------

describe("fixA11yBlockers — early exits", () => {
  it("returns dispatch-failed immediately for an empty blockers array", async () => {
    const cwd = makeTmp();
    const { result } = await captureStderrAsync(() => fixA11yBlockers(cwd, []));
    assert.equal(result.status, "dispatch-failed");
    assert.equal(result.exitCode, 1);
    assert.ok(result.reason.includes("no blockers"));
  });

  it("returns dispatch-failed immediately for a non-array blockers argument", async () => {
    const cwd = makeTmp();
    const { result } = await captureStderrAsync(() => fixA11yBlockers(cwd, null));
    assert.equal(result.status, "dispatch-failed");
    assert.ok(result.reason.includes("no blockers"));
  });

  it("returns dispatch-failed when the adapter lacks headless capability", async () => {
    const cwd = makeTmp();
    const adapter = makeAdapter({ headless: false });
    const blockers = [{ id: "A-1", description: "Remediation: Fix it." }];
    const { result } = await captureStderrAsync(() =>
      fixA11yBlockers(cwd, blockers, { _adapter: adapter }),
    );
    assert.equal(result.status, "dispatch-failed");
    assert.ok(result.reason.includes("headless"));
    assert.deepEqual(result.remainingBlockers, blockers);
  });

  it("returns dispatch-failed when the adapter has no headlessCommand", async () => {
    const cwd = makeTmp();
    const adapter = makeAdapter({ headlessCommand: undefined });
    const blockers = [{ id: "A-1", description: "Remediation: Fix it." }];
    // Must unset DEVTEAM_HEADLESS_COMMAND — if set it would override the missing
    // headlessCommand and the dispatch would proceed instead of failing early.
    const prev = process.env.DEVTEAM_HEADLESS_COMMAND;
    delete process.env.DEVTEAM_HEADLESS_COMMAND;
    try {
      const { result } = await captureStderrAsync(() =>
        fixA11yBlockers(cwd, blockers, { _adapter: adapter }),
      );
      assert.equal(result.status, "dispatch-failed");
      assert.ok(result.reason.includes("headlessCommand"));
    } finally {
      if (prev !== undefined) process.env.DEVTEAM_HEADLESS_COMMAND = prev;
    }
  });
});

// ---------------------------------------------------------------------------
// fixA11yBlockers — dispatch path: agent exits non-zero
// ---------------------------------------------------------------------------

describe("fixA11yBlockers — agent exits non-zero", () => {
  it("returns dispatch-failed with the agent's exit code when command exits 1", async () => {
    const cwd = makeTmp();
    // Use DEVTEAM_HEADLESS_COMMAND=false: the `false` binary always exits 1.
    const prev = process.env.DEVTEAM_HEADLESS_COMMAND;
    process.env.DEVTEAM_HEADLESS_COMMAND = "false";
    try {
      const blockers = [{ id: "A-1", description: "Remediation: Add aria-label." }];
      const adapter = makeAdapter(); // headless:true, headlessCommand:"true" (overridden by env)
      const { result } = await captureStderrAsync(() =>
        fixA11yBlockers(cwd, blockers, { _adapter: adapter }),
      );
      assert.equal(result.status, "dispatch-failed");
      assert.equal(result.exitCode, 1);
      assert.deepEqual(result.remainingBlockers, blockers);
    } finally {
      if (prev === undefined) delete process.env.DEVTEAM_HEADLESS_COMMAND;
      else process.env.DEVTEAM_HEADLESS_COMMAND = prev;
    }
  });
});
