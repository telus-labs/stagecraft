"use strict";

const fs = require("node:fs");
const path = require("node:path");

function applyFeatureFile(flags, commandName) {
  if (!flags.featureFile) return flags;

  if (flags.feature) {
    process.stderr.write(`devteam ${commandName}: --feature and --feature-file are mutually exclusive\n`);
    process.exit(2);
  }

  const filePath = path.resolve(flags.featureFile);
  try {
    flags.feature = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    process.stderr.write(`devteam ${commandName}: could not read --feature-file ${filePath}: ${err.message}\n`);
    process.exit(1);
  }

  return flags;
}

module.exports = { applyFeatureFile };
