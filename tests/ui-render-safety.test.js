"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { REPO_ROOT } = require("./_helpers");

class FakeElement {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.classList = { add() {}, remove() {}, toggle() {} };
    this.innerHTMLWrites = [];
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.innerHTMLWrites.push(this._innerHTML);
  }

  get innerHTML() { return this._innerHTML || ""; }
  get childElementCount() { return this.children.length; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

function loadRenderer() {
  const roots = [];
  const document = {
    addEventListener() {},
    createElement(tag) {
      const node = new FakeElement(tag);
      roots.push(node);
      return node;
    },
    createTextNode(text) {
      return { textContent: String(text) };
    },
    querySelector() { return new FakeElement(); },
    querySelectorAll() { return []; },
  };
  const context = vm.createContext({
    console,
    document,
    EventSource: class {},
    fetch: async () => { throw new Error("disabled in renderer test"); },
    navigator: { clipboard: { writeText: async () => {} } },
    setTimeout,
    clearTimeout,
  });
  const source = fs.readFileSync(
    path.join(REPO_ROOT, "core", "ui", "static", "app.js"),
    "utf8",
  ).replace(/\ninit\(\);\s*$/, "\n");
  vm.runInContext(source, context, { filename: "app.js" });
  return { context, roots };
}

function allHtml(nodes) {
  const seen = new Set();
  const out = [];
  function visit(node) {
    if (!node || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node.innerHTMLWrites)) out.push(...node.innerHTMLWrites);
    if (Array.isArray(node.children)) node.children.forEach(visit);
  }
  nodes.forEach(visit);
  return out.join("\n");
}

describe("pipeline UI hostile gate rendering", () => {
  it("never inserts model-authored markup as executable HTML", () => {
    const { context, roots } = loadRenderer();
    const parent = new FakeElement("section");
    roots.push(parent);
    const payload = '<img src=x onerror="globalThis.__xss=1">';
    const gate = {
      stage: "stage-04c",
      status: "FAIL",
      track: payload,
      workstream: payload,
      host: payload,
      findings_count: payload,
      severity_counts: { critical: payload },
      must_address_before_peer_review: [{
        id: payload,
        severity: payload,
        likelihood: payload,
        surface: payload,
        summary: payload,
      }],
      noted_for_followup: [{
        id: payload,
        severity: payload,
        surface: payload,
        summary: payload,
      }],
      blockers: [{ severity: payload, summary: payload }],
      warnings: [],
      workstreams: [{
        workstream: payload,
        host: payload,
        status: payload,
      }],
    };

    context.renderGate(parent, gate);

    const rendered = allHtml(roots);
    assert.doesNotMatch(rendered, /<img\b/i);
    assert.match(rendered, /&lt;img/);
    assert.equal(context.__xss, undefined);
  });

  it("escapes hostile QA and verification details", () => {
    const { context, roots } = loadRenderer();
    const payload = "<svg onload=globalThis.__xss=1>";

    for (const gate of [
      {
        stage: "stage-06",
        status: "FAIL",
        tests_total: payload,
        tests_passed: payload,
        tests_failed: payload,
        failing_tests: [{ file: payload, assigned_to: payload }],
      },
      {
        stage: "stage-06d",
        status: "FAIL",
        methods_skipped: [{ method: payload, reason: payload }],
        blocking_findings: [{ method: payload, summary: payload, file: payload }],
      },
    ]) {
      const parent = new FakeElement("section");
      roots.push(parent);
      context.renderGate(parent, gate);
    }

    const rendered = allHtml(roots);
    assert.doesNotMatch(rendered, /<svg\b/i);
    assert.match(rendered, /&lt;svg/);
    assert.equal(context.__xss, undefined);
  });
});
