// Markdown-heading-based chunker for the memory store.
//
// A whole brief averaged into a single vector loses too much; chunking
// per heading gives section-level retrieval while keeping a pointer
// back to the parent document. Each chunk includes the heading path
// (e.g. "1. Problem", "9. Observability requirements") so retrieved
// results carry useful context.
//
// Defaults to splitting at level-2 (`##`) headings. The very first
// part of the document — anything before the first heading — becomes
// a "(preamble)" chunk if non-empty.

/**
 * Chunk markdown text by heading.
 *
 * @param {string} text     markdown content
 * @param {object} opts
 * @param {number} opts.level   heading level to split on (default 2)
 * @param {number} opts.minChars  chunks shorter than this are dropped (default 32)
 * @returns {Array<{heading: string, level: number, text: string}>}
 */
function chunkByHeading(text, opts = {}) {
  const level = opts.level || 2;
  const minChars = opts.minChars ?? 32;
  if (typeof text !== "string" || text.length === 0) return [];

  const headerRe = new RegExp(`^(#{1,${level}})\\s+(.+?)\\s*$`);
  const lines = text.split(/\r?\n/);
  const chunks = [];
  let current = { heading: "(preamble)", level: 0, lines: [] };

  for (const line of lines) {
    const m = line.match(headerRe);
    if (m && m[1].length === level) {
      // Flush current
      flush(current, chunks, minChars);
      current = { heading: m[2].trim(), level: m[1].length, lines: [] };
      continue;
    }
    // Lines that are higher-level headings (e.g. h1 when splitting on h2)
    // stay inside the current chunk as part of its content.
    current.lines.push(line);
  }
  flush(current, chunks, minChars);
  return chunks;
}

function flush(c, out, minChars) {
  const text = c.lines.join("\n").trim();
  if (text.length < minChars) return;
  out.push({ heading: c.heading, level: c.level, text });
}

/**
 * Pull the document title from a markdown body. Looks for the first
 * `# Title` line; falls back to a filename-derived guess if none.
 */
function extractTitle(text, fallback = "(untitled)") {
  if (typeof text !== "string") return fallback;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^#\s+(.+?)\s*$/);
    if (m) return m[1].trim();
  }
  return fallback;
}

module.exports = { chunkByHeading, extractTitle };
