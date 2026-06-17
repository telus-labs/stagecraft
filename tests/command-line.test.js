"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCommandLine, splitCommand } = require("../core/command-line");

test("parseCommandLine preserves quoted arguments with spaces", () => {
  assert.deepEqual(
    parseCommandLine(`"C:\\Program Files\\Stagecraft\\host.exe" --print "hello world"`),
    ["C:\\Program Files\\Stagecraft\\host.exe", "--print", "hello world"],
  );
});

test("parseCommandLine preserves Windows backslashes inside quoted paths", () => {
  assert.deepEqual(
    parseCommandLine(`"C:\\Users\\mumit\\bin\\codex.exe" exec`),
    ["C:\\Users\\mumit\\bin\\codex.exe", "exec"],
  );
});

test("parseCommandLine handles quoted node snippets", () => {
  assert.deepEqual(
    parseCommandLine(`node -e "process.exit(42)"`),
    ["node", "-e", "process.exit(42)"],
  );
});

test("parseCommandLine preserves empty quoted args", () => {
  assert.deepEqual(parseCommandLine(`tool "" next`), ["tool", "", "next"]);
});

test("parseCommandLine throws on unterminated quotes", () => {
  assert.throws(
    () => parseCommandLine(`node -e "process.exit(42)`),
    /unterminated double quote/,
  );
});

test("splitCommand returns bin and args", () => {
  assert.deepEqual(
    splitCommand(`codex exec --dangerously-bypass-approvals-and-sandbox`),
    {
      bin: "codex",
      args: ["exec", "--dangerously-bypass-approvals-and-sandbox"],
    },
  );
});
