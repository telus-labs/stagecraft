"use strict";

function parseCommandLine(command) {
  const input = String(command || "").trim();
  if (!input) return [];

  const parts = [];
  let current = "";
  let quote = null;
  let tokenStarted = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      if (ch === "\\" && input[i + 1] === quote) {
        current += input[i + 1];
        i++;
        continue;
      }
      current += ch;
      tokenStarted = true;
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      tokenStarted = true;
      continue;
    }

    if (/\s/.test(ch)) {
      if (tokenStarted) {
        parts.push(current);
        current = "";
        tokenStarted = false;
      }
      continue;
    }

    current += ch;
    tokenStarted = true;
  }

  if (quote) {
    throw new Error(`unterminated ${quote === "'" ? "single" : "double"} quote in command`);
  }
  if (tokenStarted) parts.push(current);
  return parts;
}

function splitCommand(command, label = "command") {
  const parts = parseCommandLine(command);
  if (parts.length === 0) throw new Error(`${label} is empty`);
  return { bin: parts[0], args: parts.slice(1) };
}

module.exports = { parseCommandLine, splitCommand };
