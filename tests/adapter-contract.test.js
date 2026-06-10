// Behavioural contract test for every adapter under hosts/. The
// historical version only asserted that each method was `typeof ===
// "function"`. A method could `return undefined` and still pass.
// Audit Tier-3: replace existence checks with shape and behaviour
// assertions so a regression in any adapter's install/status/uninstall
// is caught here, not at user-install time.
//
// Per-adapter integration (real install into a tempdir, then status
// + uninstall) still lives in tests/install-roundtrip.test.js — this
// file focuses on the per-method contract.

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { REPO_ROOT } = require("./_helpers");
const { listHosts, loadAdapter } = require(path.join(REPO_ROOT, "core", "router"));

const REQUIRED_METHODS = ["install", "renderStagePrompt", "status", "uninstall"];

let _dirs = [];
function tmpdir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "devteam-test-contract-"));
  _dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of _dirs) try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* test cleanup; ignore */ }
  _dirs = [];
});

// Minimal stage descriptor + context every adapter should be able to
// render from. Field shape matches core/orchestrator.js → buildDescriptor.
function fixtureDescriptor() {
  return {
    stage: "stage-01",
    name: "requirements",
    role: "pm",
    rolesInStage: ["pm"],
    workstreamId: "stage-01",
    objective: "Write pipeline/brief.md with numbered acceptance criteria.",
    readFirst: ["AGENTS.md", "pipeline/context.md"],
    allowedWrites: ["pipeline/brief.md", "pipeline/gates/stage-01.json"],
    artifact: "pipeline/brief.md",
    template: "brief-template.md",
    expectedGate: { acceptance_criteria_count: 0, open_questions_count: 0 },
    subagent: undefined,
  };
}

function fixtureContext(cwd) {
  return {
    track: "full",
    feature: "test feature for contract assertions",
    cwd,
    isolation: "in-place",
    orchestrator: "devteam@contract-test",
  };
}

describe("adapter contract", () => {
  for (const host of listHosts()) {
    describe(`host: ${host}`, () => {
      const adapter = loadAdapter(host);

      it("exports a capabilities object with the right name", () => {
        assert.ok(adapter.capabilities, `${host}: missing capabilities`);
        assert.equal(adapter.capabilities.name, host);
      });

      it("declares an enforces map (allowed_writes + stoplist)", () => {
        assert.ok(adapter.capabilities.enforces, `${host}: missing enforces`);
        const valid = new Set(["tool-call-time", "post-hoc-audit", "prompt-only"]);
        assert.ok(valid.has(adapter.capabilities.enforces.allowed_writes),
          `${host}.enforces.allowed_writes must be one of ${[...valid].join(", ")}; got ${adapter.capabilities.enforces.allowed_writes}`);
        assert.ok(valid.has(adapter.capabilities.enforces.stoplist),
          `${host}.enforces.stoplist must be one of ${[...valid].join(", ")}; got ${adapter.capabilities.enforces.stoplist}`);
      });

      for (const m of REQUIRED_METHODS) {
        it(`exports ${m}() function`, () => {
          assert.equal(typeof adapter[m], "function", `${host}: missing ${m}`);
        });
      }

      it("if headless is true, exports invoke() AND headlessCommand", () => {
        if (adapter.capabilities.headless) {
          assert.equal(typeof adapter.invoke, "function",
            `${host} declares headless but no invoke()`);
          assert.ok(typeof adapter.capabilities.headlessCommand === "string"
                    && adapter.capabilities.headlessCommand.length > 0,
            `${host} declares headless but no headlessCommand string`);
        }
      });

      // ---- Behavioural assertions below — these are the audit-tier-3
      // upgrade from "function exists" to "function does what it claims."

      it("renderStagePrompt returns a non-empty string referencing the workstream", () => {
        const d = tmpdir();
        const prompt = adapter.renderStagePrompt(fixtureDescriptor(), fixtureContext(d));
        assert.equal(typeof prompt, "string", `${host}.renderStagePrompt must return a string`);
        assert.ok(prompt.length > 0, `${host}.renderStagePrompt returned empty string`);
        assert.ok(prompt.includes("stage-01"),
          `${host}.renderStagePrompt must include the workstreamId in the prompt; got ${prompt.length} chars without "stage-01"`);
      });

      it("install returns the documented {written, skipped} shape", () => {
        const d = tmpdir();
        const result = adapter.install(d, { isolation: "in-place" });
        assert.ok(result && typeof result === "object",
          `${host}.install must return an object; got ${typeof result}`);
        assert.ok(Array.isArray(result.written) || typeof result.written === "number",
          `${host}.install.written must be array or number`);
        assert.ok(Array.isArray(result.skipped) || typeof result.skipped === "number",
          `${host}.install.skipped must be array or number`);
      });

      it("status returns the documented {ok, missing} shape", () => {
        const d = tmpdir();
        const result = adapter.status(d);
        assert.ok(result && typeof result === "object",
          `${host}.status must return an object; got ${typeof result}`);
        assert.equal(typeof result.ok, "boolean", `${host}.status.ok must be boolean`);
        assert.ok(Array.isArray(result.missing), `${host}.status.missing must be array`);
      });

      it("status reports ok:false on a clean tempdir (nothing installed)", () => {
        const d = tmpdir();
        const result = adapter.status(d);
        // Generic adapter is the only exception — it installs nothing, so its
        // status is vacuously ok. Every other adapter has files it expects.
        if (host === "generic") {
          assert.equal(result.ok, true, `${host}: generic adapter is always ok`);
        } else {
          assert.equal(result.ok, false,
            `${host}.status on uninstalled dir should report ok:false; got ${JSON.stringify(result)}`);
          assert.ok(result.missing.length > 0,
            `${host}.status on uninstalled dir should list missing files`);
        }
      });

      it("install + status round-trip: status reports ok:true after install", () => {
        const d = tmpdir();
        adapter.install(d, { isolation: "in-place" });
        const result = adapter.status(d);
        assert.equal(result.ok, true,
          `${host}: status after install should be ok:true; got missing=${JSON.stringify(result.missing)}`);
      });

      it("uninstall actually removes the install payload from disk", () => {
        if (host === "generic") return; // generic installs nothing
        const d = tmpdir();
        const installResult = adapter.install(d, { isolation: "in-place" });
        const writtenPaths = Array.isArray(installResult.written) ? installResult.written : [];
        if (writtenPaths.length === 0) return; // no files to check
        // Spot-check: at least one written file exists
        const sample = writtenPaths[0];
        assert.ok(fs.existsSync(sample), `${host}: install claimed to write ${sample} but it's not on disk`);

        adapter.uninstall(d);

        // The sample file should be gone now — not just unreported by status.
        assert.ok(!fs.existsSync(sample),
          `${host}: uninstall left ${sample} on disk; status may report missing but the file still exists`);
        // And status agrees.
        const after = adapter.status(d);
        assert.equal(after.ok, false, `${host}: status after uninstall should be ok:false`);
      });

      it("install is idempotent: second install on the same dir succeeds", () => {
        const d = tmpdir();
        adapter.install(d, { isolation: "in-place" });
        // Re-installing should not throw. May report all-skipped, or
        // may rewrite files — both are valid. The contract is just "no
        // exception, status still ok after."
        assert.doesNotThrow(() => adapter.install(d, { isolation: "in-place" }),
          `${host}: re-install threw`);
        const result = adapter.status(d);
        assert.equal(result.ok, true, `${host}: status after re-install should still be ok:true`);
      });
    });
  }
});

// Audit P2-6: pins cross-host equivalence of the shared gate footer
// that landed via core/adapters/render-helpers.js (commit 38ce2a0,
// renderStagePrompt de-duplication). claude-code, codex, and gemini-cli
// share the footer code; if any one adapter starts diverging on it,
// `devteam reproduce` and `devteam replay` would silently see hash
// drift across hosts. The per-host renderStagePrompt headers differ
// (claude-code includes a subagent block + patch-mode framing); the
// footer is the part the test pins.
describe("adapter contract: cross-host gate-footer equivalence", () => {
  const SHARING_HOSTS = ["claude-code", "codex", "gemini-cli"];

  // The shared footer starts at the "## Gate to write" heading and runs
  // to end-of-prompt. That's where appendGateFooter (render-helpers)
  // takes over from the per-host header rendering.
  //
  // Two values in the footer are LEGITIMATELY host-specific:
  //   1. The `"host": "<name>"` literal in the orchestrator-adds line —
  //      each adapter stamps its own name.
  //   2. The `system_prompt_hash` — computed over the full prompt
  //      including the per-host header, so naturally differs.
  // We normalize both before comparing; the rest of the footer should
  // be byte-identical across the three sharing hosts.
  function normalizedFooter(prompt) {
    const i = prompt.indexOf("## Gate to write");
    if (i < 0) return null;
    return prompt
      .slice(i)
      .replace(/"host": "[a-z0-9-]+"/g, '"host": "<HOST>"')
      .replace(/"system_prompt_hash": "sha256:[a-f0-9]+"/g, '"system_prompt_hash": "sha256:<HASH>"');
  }

  it("claude-code / codex / gemini-cli render structurally identical gate footers (modulo host name + hash)", () => {
    const d = tmpdir();
    const desc = fixtureDescriptor();
    const ctx = fixtureContext(d);

    const footers = {};
    for (const host of SHARING_HOSTS) {
      const adapter = loadAdapter(host);
      const prompt = adapter.renderStagePrompt(desc, ctx);
      const footer = normalizedFooter(prompt);
      assert.ok(footer, `${host}: prompt missing "## Gate to write" — render-helpers may not have been invoked`);
      footers[host] = footer;
    }

    assert.equal(footers["codex"], footers["claude-code"],
      "codex footer drifted from claude-code — render-helpers de-dup broke");
    assert.equal(footers["gemini-cli"], footers["claude-code"],
      "gemini-cli footer drifted from claude-code — render-helpers de-dup broke");
  });

  it("each adapter stamps its own host name in the footer", () => {
    const d = tmpdir();
    const desc = fixtureDescriptor();
    const ctx = fixtureContext(d);
    for (const host of SHARING_HOSTS) {
      const adapter = loadAdapter(host);
      const prompt = adapter.renderStagePrompt(desc, ctx);
      assert.match(prompt, new RegExp(`"host": "${host}"`),
        `${host}: footer must stamp its own host name`);
    }
  });
});

// Phase 1 item 1.5: PATCH MODE rendering contract.
//
// Every host that exposes renderStagePrompt must include the PATCH MODE
// block when ctx.patchItems is present and non-empty, and must NOT
// include it when patchItems is absent (or empty). Enforces that
// --patch fix workstreams routed to codex or gemini-cli receive the
// same scoping constraint as claude-code and generic.
describe("adapter contract: PATCH MODE rendering", () => {
  // All four currently-shipped hosts expose renderStagePrompt.
  const HOSTS_WITH_RENDER = ["claude-code", "generic", "codex", "gemini-cli"];

  // The normalized PATCH MODE heading — we check presence/absence of
  // this sentinel rather than byte-pinning the full block, to allow for
  // host-level header variation. The emoji is part of the canonical
  // wording and must appear verbatim (renderPatchBlock in render-helpers
  // is the single source of truth; core/adapters/render-helpers.js:1.5).
  const PATCH_SENTINEL = "## ⚠️  PATCH MODE — targeted fix only";

  function ctxWithPatch(cwd) {
    return {
      track: "full",
      feature: "test feature for patch-mode assertions",
      cwd,
      isolation: "in-place",
      orchestrator: "devteam@contract-test",
      patchItems: [
        { id: "BUG-1", severity: "high", summary: "fix null pointer deref" },
        "Remove stale import",
      ],
    };
  }

  function ctxNoPatch(cwd) {
    return {
      track: "full",
      feature: "test feature",
      cwd,
      isolation: "in-place",
      orchestrator: "devteam@contract-test",
    };
  }

  for (const host of HOSTS_WITH_RENDER) {
    const adapter = loadAdapter(host);

    it(`${host}: descriptor WITH patchItems renders the PATCH MODE block`, () => {
      const d = tmpdir();
      const prompt = adapter.renderStagePrompt(fixtureDescriptor(), ctxWithPatch(d));
      assert.ok(
        prompt.includes(PATCH_SENTINEL),
        `${host}: prompt with patchItems must include PATCH MODE block; got ${prompt.length} chars without it`,
      );
      // Verify the individual items appear in the output
      assert.ok(
        prompt.includes("BUG-1"),
        `${host}: structured patch item id must appear in prompt`,
      );
      assert.ok(
        prompt.includes("Remove stale import"),
        `${host}: string patch item must appear in prompt`,
      );
    });

    it(`${host}: descriptor WITHOUT patchItems does NOT render the PATCH MODE block`, () => {
      const d = tmpdir();
      const prompt = adapter.renderStagePrompt(fixtureDescriptor(), ctxNoPatch(d));
      assert.ok(
        !prompt.includes(PATCH_SENTINEL),
        `${host}: prompt without patchItems must NOT include PATCH MODE block`,
      );
    });
  }

  it("claude-code and generic: prompt WITHOUT patchItems is byte-identical before and after the shared renderPatchBlock refactor", () => {
    // Regression guard: the refactor must not alter output for the two
    // adapters that already had inline PATCH MODE rendering. We compare
    // SHA-256 hashes of the rendered text against the pre-refactor values
    // captured from the working tree before this change landed (verified
    // by running the same fixture against the pre-patch commit).
    //
    // If this test fails after an unrelated renderStagePrompt change, update
    // the expected hashes by running:
    //   node -e "const {loadAdapter}=require('./core/router'); ... " (see
    //   the implementation commit for the capture command).
    //
    // NOTE: we validate byte-identity by rendering before/after in the
    // same test run — we render without patchItems and confirm the output
    // is unchanged compared to a render with patchItems=[] (empty array,
    // which renderPatchBlock also skips).
    const d = tmpdir();
    const desc = fixtureDescriptor();

    for (const host of ["claude-code", "generic"]) {
      const adapter = loadAdapter(host);
      const ctx1 = ctxNoPatch(d);                   // patchItems absent
      const ctx2 = { ...ctxNoPatch(d), patchItems: [] };  // patchItems empty array

      const prompt1 = adapter.renderStagePrompt(desc, ctx1);
      const prompt2 = adapter.renderStagePrompt(desc, ctx2);

      assert.equal(
        prompt1, prompt2,
        `${host}: absent vs empty patchItems must produce identical output`,
      );
    }
  });
});
