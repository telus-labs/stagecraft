/**
 * core/markers.js — canonical begin/end-marker section helpers.
 *
 * Both functions operate on text strings; callers own file I/O.
 *
 * Semantics:
 *   upsertSection(text, begin, end, body)
 *     If begin is absent: appends body (preserving existing trailing whitespace).
 *     If both markers are present and begin precedes end: replaces the region
 *       [begin, end+end.length) with body (normal round-trip).
 *     Corrupt input (end missing, or end appears before begin in the text):
 *       replaces from the begin-marker to EOF with body and warns on stderr.
 *       This fixes the verified bug in the original upsertSection where inverted
 *       or missing end markers caused a duplicate section to be appended.
 *
 *   stripSection(text, begin, end)
 *     If begin is absent: returns text unchanged (idempotent no-op).
 *     If both markers are present and begin precedes end: removes the region
 *       [begin, end+end.length) and trims any leading blank lines from the
 *       remainder (validator behavior — least-surprise for hook callers).
 *     Corrupt input (end missing, or end before begin):
 *       strips from the begin-marker to EOF and warns on stderr.
 */
"use strict";

function _warn(msg) {
  process.stderr.write(`[markers] warning: ${msg}\n`);
}

/**
 * Replace or append a marker-delimited section in text.
 * @param {string} text   Existing file content (may be empty string)
 * @param {string} begin  Begin marker
 * @param {string} end    End marker
 * @param {string} body   Replacement block (caller includes markers in body)
 * @returns {string}
 */
function upsertSection(text, begin, end, body) {
  const b = text.indexOf(begin);
  if (b === -1) {
    return (text ? text.replace(/\s*$/, "") + "\n\n" : "") + body + "\n";
  }
  const e = text.indexOf(end);
  if (e === -1 || e < b) {
    _warn(`corrupt marker section (${e === -1 ? "missing end marker" : "end before begin"}) — replacing from begin-marker to EOF`);
    return text.slice(0, b) + body + "\n";
  }
  return text.slice(0, b) + body + text.slice(e + end.length);
}

/**
 * Remove a marker-delimited section from text.
 * @param {string} text   File content
 * @param {string} begin  Begin marker
 * @param {string} end    End marker
 * @returns {string}      Text with section removed, or original if absent
 */
function stripSection(text, begin, end) {
  const startIdx = text.indexOf(begin);
  if (startIdx === -1) return text;
  const endIdx = text.indexOf(end);
  if (endIdx < 0 || endIdx < startIdx) {
    _warn(`corrupt marker section (${endIdx < 0 ? "missing end marker" : "end before begin"}) — stripping from begin-marker to EOF`);
    return text.slice(0, startIdx);
  }
  const after = text.slice(endIdx + end.length).replace(/^\n+/, "");
  return text.slice(0, startIdx) + after;
}

module.exports = { upsertSection, stripSection };
