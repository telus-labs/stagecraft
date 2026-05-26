#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_PATTERNS = [
  /auth/i,
  /crypto/i,
  /payment/i,
  /pii/i,
  /secret/i,
  /token/i,
  /credential/i,
  /dockerfile/i,
  /docker-compose/i,
  /(^|\/)infra\//i,
  /package-lock\.json$/i,
  /package\.json$/i,
];

function changedPathsFromArgs(args) {
  if (args.length > 0) return args;
  const diffFile = path.join(process.cwd(), "pipeline", "changed-files.txt");
  if (!fs.existsSync(diffFile)) return [];
  return fs.readFileSync(diffFile, "utf8").split(/\r?\n/).filter(Boolean);
}

function needsSecurityReview(paths, patterns = DEFAULT_PATTERNS) {
  return paths.filter((filePath) => patterns.some((pattern) => pattern.test(filePath)));
}

function main() {
  const paths = changedPathsFromArgs(process.argv.slice(2));
  const matches = needsSecurityReview(paths);

  if (matches.length === 0) {
    console.log("SECURITY_REVIEW: skip");
    return 0;
  }

  console.log("SECURITY_REVIEW: required");
  for (const match of matches) console.log(`- ${match}`);
  return 2;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { needsSecurityReview };
