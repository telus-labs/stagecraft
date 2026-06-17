const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { REPO_ROOT } = require("./_helpers");
const { upsertSection, stripSection } = require(path.join(REPO_ROOT, "core", "markers"));

const BEGIN = "<!-- begin -->";
const END   = "<!-- end -->";

// Helper: call fn() and collect any stderr [markers] warnings emitted to stderr.
// We redirect stderr temporarily so warnings don't pollute test output.
function capturingWarn(fn) {
  const saved = process.stderr.write.bind(process.stderr);
  const lines = [];
  process.stderr.write = (s) => { lines.push(s); return true; };
  try { return { result: fn(), warnings: lines }; }
  finally { process.stderr.write = saved; }
}

describe("upsertSection — normal cases", () => {
  it("appends body to empty text", () => {
    const out = upsertSection("", BEGIN, END, `${BEGIN}\nhello\n${END}`);
    assert.equal(out, `${BEGIN}\nhello\n${END}\n`);
  });

  it("appends body when no markers exist in non-empty text", () => {
    const existing = "some existing content";
    const body = `${BEGIN}\nnew section\n${END}`;
    const out = upsertSection(existing, BEGIN, END, body);
    assert.ok(out.startsWith("some existing content\n\n"));
    assert.ok(out.includes(body));
  });

  it("prepends body when requested and no markers exist", () => {
    const existing = "some existing content";
    const body = `${BEGIN}\nnew section\n${END}`;
    const out = upsertSection(existing, BEGIN, END, body, { insert: "prepend" });
    assert.equal(out, `${body}\n\nsome existing content`);
  });

  it("replaces existing section when markers are in correct order", () => {
    const existing = `before\n${BEGIN}\nold body\n${END}\nafter`;
    const body = `${BEGIN}\nnew body\n${END}`;
    const out = upsertSection(existing, BEGIN, END, body);
    assert.equal(out, `before\n${BEGIN}\nnew body\n${END}\nafter`);
  });

  it("empty body replaces the section content", () => {
    const existing = `${BEGIN}\nstuff\n${END}\ntrailing`;
    const body = `${BEGIN}\n${END}`;
    const out = upsertSection(existing, BEGIN, END, body);
    assert.equal(out, `${BEGIN}\n${END}\ntrailing`);
  });
});

describe("upsertSection — corrupt input", () => {
  it("handles inverted markers (end before begin) — removes orphan begin, appends fresh section, warns", () => {
    // end appears in the text before begin (e.g. hand-edited file)
    const text = `preamble\n${END}\nmiddle\n${BEGIN}\ntail`;
    const body = `${BEGIN}\nfresh\n${END}`;
    const { result, warnings } = capturingWarn(() => upsertSection(text, BEGIN, END, body));
    assert.equal(result, `preamble\n${END}\nmiddle\ntail\n\n${body}\n`);
    assert.ok(warnings.some((w) => w.includes("[markers] warning")));
    assert.ok(warnings.some((w) => w.includes("end before begin")));
  });

  it("handles missing end marker — removes orphan begin, appends fresh section, warns", () => {
    const text = `preamble\n${BEGIN}\norphaned content`;
    const body = `${BEGIN}\nreplacement\n${END}`;
    const { result, warnings } = capturingWarn(() => upsertSection(text, BEGIN, END, body));
    assert.equal(result, `preamble\norphaned content\n\n${body}\n`);
    assert.ok(warnings.some((w) => w.includes("missing end marker")));
  });

  it("handles missing end marker with prepend insertion without losing content", () => {
    const text = `preamble\n${BEGIN}\norphaned content`;
    const body = `${BEGIN}\nreplacement\n${END}`;
    const { result, warnings } = capturingWarn(() =>
      upsertSection(text, BEGIN, END, body, { insert: "prepend" }),
    );
    assert.equal(result, `${body}\n\npreamble\norphaned content`);
    assert.ok(warnings.some((w) => w.includes("missing end marker")));
  });

  it("duplicate sections — first pair matched, second is in the 'after' slice", () => {
    // indexOf finds the FIRST occurrence of each marker; behavior is deterministic
    const text = `${BEGIN}\nfirst\n${END}\n${BEGIN}\nsecond\n${END}`;
    const body = `${BEGIN}\nreplaced\n${END}`;
    const out = upsertSection(text, BEGIN, END, body);
    // first section replaced; content after first end marker is preserved
    assert.ok(out.startsWith(`${BEGIN}\nreplaced\n${END}`));
    assert.ok(out.includes("second"));
  });
});

describe("stripSection — normal cases", () => {
  it("returns text unchanged when begin marker is absent", () => {
    const text = "no markers here";
    assert.equal(stripSection(text, BEGIN, END), text);
  });

  it("strips a section and trims leading blank lines from remainder", () => {
    const text = `before\n${BEGIN}\nbody\n${END}\n\nafter`;
    const out = stripSection(text, BEGIN, END);
    assert.equal(out, "before\nafter");
  });

  it("strips section at start of text", () => {
    const text = `${BEGIN}\nbody\n${END}\n\nrest`;
    const out = stripSection(text, BEGIN, END);
    assert.equal(out, "rest");
  });

  it("empty text after section is an empty string", () => {
    const text = `${BEGIN}\nbody\n${END}`;
    const out = stripSection(text, BEGIN, END);
    assert.equal(out, "");
  });
});

describe("stripSection — corrupt input", () => {
  it("handles missing end marker — strips begin-to-EOF, warns", () => {
    const text = `before\n${BEGIN}\norphan content`;
    const { result, warnings } = capturingWarn(() => stripSection(text, BEGIN, END));
    assert.equal(result, "before\n");
    assert.ok(warnings.some((w) => w.includes("missing end marker")));
  });

  it("handles inverted markers (end before begin) — strips begin-to-EOF, warns", () => {
    const text = `preamble\n${END}\nmiddle\n${BEGIN}\ntail`;
    const { result, warnings } = capturingWarn(() => stripSection(text, BEGIN, END));
    assert.equal(result, `preamble\n${END}\nmiddle\n`);
    assert.ok(warnings.some((w) => w.includes("end before begin")));
  });
});
