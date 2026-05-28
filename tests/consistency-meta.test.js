// Meta-test: ensure `scripts/consistency.js` exits 0 as part of `npm test`.
// Without this, the consistency lint runs only in CI (via npm run consistency)
// and a developer running `npm test` locally could land a contract drift
// that only CI catches. The cost is one subprocess spawn (~50ms).

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");

test("scripts/consistency.js exits 0 (cross-artifact contracts are intact)", () => {
  const r = spawnSync("node", [path.join(REPO_ROOT, "scripts", "consistency.js")], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(
    r.status,
    0,
    `consistency.js failed (exit ${r.status}):\n${r.stdout}\n${r.stderr}`,
  );
  // Sanity: confirm it actually ran (some output indicating checks)
  assert.match(r.stdout, /consistency:.*checks passed/);
});
