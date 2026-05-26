const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { REPO_ROOT } = require("./_helpers");
const { needsSecurityReview } = require(path.join(REPO_ROOT, "core", "guards", "security-heuristic"));

describe("security-heuristic: needsSecurityReview", () => {
  it("flags auth paths", () => {
    const r = needsSecurityReview(["src/backend/auth/login.js"]);
    assert.equal(r.length, 1);
  });

  it("flags crypto paths", () => {
    const r = needsSecurityReview(["src/lib/crypto/token.ts"]);
    assert.equal(r.length, 1);
  });

  it("flags payment paths", () => {
    const r = needsSecurityReview(["src/services/payment-handler.ts"]);
    assert.equal(r.length, 1);
  });

  it("flags pii", () => {
    const r = needsSecurityReview(["src/backend/pii-redaction.js"]);
    assert.equal(r.length, 1);
  });

  it("flags secrets / tokens / credentials", () => {
    assert.equal(needsSecurityReview(["src/secret-rotator.js"]).length, 1);
    assert.equal(needsSecurityReview(["src/auth/tokens.ts"]).length, 1);
    assert.equal(needsSecurityReview(["src/credentials/store.ts"]).length, 1);
  });

  it("flags Dockerfile and docker-compose changes", () => {
    assert.equal(needsSecurityReview(["Dockerfile"]).length, 1);
    assert.equal(needsSecurityReview(["docker-compose.yml"]).length, 1);
  });

  it("flags infra/ directory changes", () => {
    assert.equal(needsSecurityReview(["infra/k8s/deployment.yaml"]).length, 1);
  });

  it("flags package.json/package-lock.json (new deps)", () => {
    assert.equal(needsSecurityReview(["package.json"]).length, 1);
    assert.equal(needsSecurityReview(["package-lock.json"]).length, 1);
  });

  it("does NOT flag safe paths", () => {
    const r = needsSecurityReview([
      "src/frontend/components/Button.tsx",
      "README.md",
      "docs/concepts.md",
      "src/utils/format.js",
    ]);
    assert.equal(r.length, 0);
  });

  it("returns the subset of paths that matched", () => {
    const r = needsSecurityReview([
      "README.md",
      "src/backend/auth.js",
      "docs/x.md",
      "Dockerfile",
    ]);
    assert.equal(r.length, 2);
    assert.ok(r.includes("src/backend/auth.js"));
    assert.ok(r.includes("Dockerfile"));
  });

  it("accepts custom patterns", () => {
    const r = needsSecurityReview(["src/billing/invoice.js"], [/billing/i]);
    assert.equal(r.length, 1);
  });
});
