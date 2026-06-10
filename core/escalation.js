// Typed escalation contract (ADR-003 / Phase 2, PR-C1).
//
// The Principal resolves an escalation by writing ONE of two lines into
// pipeline/context.md:
//
//   PRINCIPAL-RULING: <topic> → <decision> [class: <slug>]
//       A binding ruling. The optional `[class: <slug>]` tags the ruling with
//       a bounded category (e.g. formatting-only, doc-only,
//       known-safe-dependency-bump). The category is what an operator may
//       pre-authorize for autonomous resolution via `--auto-rule` (PR-C2).
//       A ruling with no class parses as "unclassified" — never auto-rulable.
//
//   PRINCIPAL-CANNOT-DECIDE: <authority|information|value> → <question>
//       The escalation is underdetermined and the Principal must NOT guess.
//       The three reason classes are the only sources of underdetermination
//       (ADR-003 §3.1): missing AUTHORITY (commits a resource not granted),
//       missing INFORMATION (the deciding fact is outside every readable
//       artifact), or an irreducible VALUE tradeoff (the brief doesn't rank
//       two legitimate objectives). These always require a human; the driver
//       never auto-resolves them.
//
// This module only PARSES and READS these lines. PR-C2 (the driver) decides
// what to do with them. Legacy untyped rulings remain valid (class
// "unclassified").

const fs = require("node:fs");
const path = require("node:path");

const RULING_PREFIX = "PRINCIPAL-RULING:";
const CANNOT_DECIDE_PREFIX = "PRINCIPAL-CANNOT-DECIDE:";
const REASON_CLASSES = ["authority", "information", "value"];

function contextPath(cwd) { return path.join(cwd, "pipeline", "context.md"); }

// Split a "<left> → <decision>" body on the first arrow (→ or ->).
function splitArrow(body) {
  const m = body.match(/^(.*?)(?:→|->)(.*)$/s);
  if (!m) return { left: body.trim(), right: "" };
  return { left: m[1].trim(), right: m[2].trim() };
}

/**
 * Parse a PRINCIPAL-RULING line into { topic, decision, class }.
 * Returns null if the line isn't a ruling. `class` defaults to "unclassified"
 * when no `[class: <slug>]` suffix is present.
 */
function parseRulingLine(line) {
  const trimmed = String(line).trim();
  if (!trimmed.startsWith(RULING_PREFIX)) return null;
  let body = trimmed.slice(RULING_PREFIX.length).trim();
  let cls = "unclassified";
  const classMatch = body.match(/\[class:\s*([a-z0-9][a-z0-9-]*)\s*\]\s*$/i);
  if (classMatch) {
    cls = classMatch[1].toLowerCase();
    body = body.slice(0, classMatch.index).trim();
  }
  const { left, right } = splitArrow(body);
  return { topic: left, decision: right, class: cls };
}

/**
 * Parse a PRINCIPAL-CANNOT-DECIDE line into { reason_class, question }.
 * Returns null if the line isn't a cannot-decide. reason_class falls back to
 * "unspecified" when the declared class isn't one of authority/information/value.
 */
function parseCannotDecideLine(line) {
  const trimmed = String(line).trim();
  if (!trimmed.startsWith(CANNOT_DECIDE_PREFIX)) return null;
  const body = trimmed.slice(CANNOT_DECIDE_PREFIX.length).trim();
  const { left, right } = splitArrow(body);
  const declared = left.toLowerCase();
  const reason_class = REASON_CLASSES.includes(declared) ? declared : "unspecified";
  return { reason_class, question: right };
}

function readContextLines(cwd) {
  const p = contextPath(cwd);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n");
}

/** All parsed rulings in context.md, in file order. */
function loadRulings(cwd) {
  return readContextLines(cwd).map(parseRulingLine).filter(Boolean);
}

/** All parsed cannot-decide declarations in context.md, in file order. */
function loadCannotDecide(cwd) {
  return readContextLines(cwd).map(parseCannotDecideLine).filter(Boolean);
}

/**
 * All Principal outputs (rulings AND cannot-decide), in file order, each tagged
 * with its type. Lets a caller (the driver) tell whether the *newest* output
 * since a known count was a ruling or a cannot-decide — context.md is
 * append-only, so the last entry is the latest decision.
 * @returns {Array<{type:"ruling"|"cannot-decide", [k:string]:any}>}
 */
function loadPrincipalOutputs(cwd) {
  const out = [];
  for (const line of readContextLines(cwd)) {
    const ruling = parseRulingLine(line);
    if (ruling) { out.push({ type: "ruling", ...ruling }); continue; }
    const cd = parseCannotDecideLine(line);
    if (cd) out.push({ type: "cannot-decide", ...cd });
  }
  return out;
}

module.exports = {
  RULING_PREFIX,
  CANNOT_DECIDE_PREFIX,
  REASON_CLASSES,
  parseRulingLine,
  parseCannotDecideLine,
  loadRulings,
  loadCannotDecide,
  loadPrincipalOutputs,
};
