#!/usr/bin/env node
// docs-generate.js — runs all documentation generators and writes output in-place.
//
// Generators run:
//   1. scripts/generate-tracks-matrix.js  → docs/tracks.md (embedded block)
//   2. scripts/generate-stages-ref.js     → docs/reference/stages.md
//   3. scripts/generate-hosts-ref.js      → docs/reference/hosts.md
//
// Usage:
//   npm run docs:generate
//   node scripts/docs-generate.js

"use strict";

const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

// Each generator is expected to be importable without side-effects and to
// provide a generateBlock() function.  The --write CLI path in each script
// is what we replicate here.
const generators = [
  {
    name: "tracks matrix",
    script: path.join(ROOT, "scripts", "generate-tracks-matrix.js"),
    // tracks-matrix uses a write-in-place strategy: reads docs/tracks.md and
    // replaces the fenced block.  Call the same logic here.
    run(mod) {
      const fs = require("node:fs");
      const tracksPath = path.join(ROOT, "docs", "tracks.md");
      const src = fs.readFileSync(tracksPath, "utf8");
      const { FENCE_OPEN, FENCE_CLOSE, generateBlock } = mod;
      const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const fenceRe = new RegExp(
        `${escapeRe(FENCE_OPEN)}[\\s\\S]*?${escapeRe(FENCE_CLOSE)}`, "g"
      );
      const block = generateBlock();
      const updated = fenceRe.test(src)
        ? src.replace(new RegExp(`${escapeRe(FENCE_OPEN)}[\\s\\S]*?${escapeRe(FENCE_CLOSE)}`, "g"), block)
        : src;
      if (updated === src && !src.includes(block)) {
        console.error("ERROR: could not find the matrix block to replace in docs/tracks.md");
        process.exit(1);
      }
      fs.writeFileSync(tracksPath, updated);
      console.log("  ✓ docs/tracks.md");
    },
  },
  {
    name: "stages reference",
    script: path.join(ROOT, "scripts", "generate-stages-ref.js"),
    run(mod) {
      const fs = require("node:fs");
      const outPath = path.join(ROOT, "docs", "reference", "stages.md");
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, mod.generateBlock() + "\n");
      console.log("  ✓ docs/reference/stages.md");
    },
  },
  {
    name: "hosts reference",
    script: path.join(ROOT, "scripts", "generate-hosts-ref.js"),
    run(mod) {
      const fs = require("node:fs");
      const outPath = path.join(ROOT, "docs", "reference", "hosts.md");
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, mod.generateBlock() + "\n");
      console.log("  ✓ docs/reference/hosts.md");
    },
  },
];

console.log("docs:generate — writing reference output...");

let anyError = false;
for (const gen of generators) {
  try {
    const mod = require(gen.script);
    gen.run(mod);
  } catch (err) {
    console.error(`  ✗ ${gen.name}: ${err.message}`);
    anyError = true;
  }
}

if (anyError) {
  console.error("docs:generate failed — see errors above.");
  process.exit(1);
} else {
  console.log("docs:generate done. Run `npm run consistency` to verify.");
}
