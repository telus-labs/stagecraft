"use strict";

// render-html.js — take a ReportData object and return a self-contained
// HTML string. No external dependencies, no CDN, works offline.

function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fileLink(absPath, label) {
  return `<a href="file://${esc(absPath)}">${esc(label)}</a>`;
}

function badge(status) {
  const map = {
    PASS:     ["pass",     "PASS"],
    WARN:     ["warn",     "WARN"],
    FAIL:     ["fail",     "FAIL"],
    ESCALATE: ["escalate", "ESCALATE"],
  };
  const [cls, text] = map[status] || ["neutral", esc(status || "—")];
  return `<span class="badge ${cls}">${text}</span>`;
}

function finalStatusBadge(status) {
  const map = {
    completed: ["pass",    "COMPLETED"],
    failed:    ["fail",    "FAILED"],
    abandoned: ["neutral", "ABANDONED"],
    "no-run":  ["neutral", "NO RUN DATA"],
  };
  const [cls, text] = map[status] || ["neutral", esc(status)];
  return `<span class="badge ${cls}">${text}</span>`;
}

function formatDate(isoStr) {
  if (!isoStr) return "—";
  try {
    return new Date(isoStr).toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return isoStr; }
}

function formatDuration(ms) {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), rem = s % 60;
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}

function formatCost(usd) {
  if (usd == null) return null;
  return `$${Number(usd).toFixed(3)}`;
}

const CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    color: #111827;
    background: #f9fafb;
    margin: 0;
    padding: 0;
  }
  .page { max-width: 960px; margin: 0 auto; padding: 2rem 1.5rem 4rem; }
  h1 { font-size: 1.5rem; font-weight: 700; margin: 0 0 0.25rem; }
  h2 {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #6b7280;
    margin: 0 0 0.75rem;
    padding-bottom: 0.4rem;
    border-bottom: 1px solid #e5e7eb;
  }
  .section { margin-bottom: 2.5rem; }
  .header { margin-bottom: 2rem; }
  .header-meta {
    color: #6b7280;
    font-size: 0.85rem;
    margin: 0.35rem 0 0.75rem;
    display: flex;
    gap: 1.5rem;
    flex-wrap: wrap;
    align-items: center;
  }
  .badge {
    display: inline-block;
    font-size: 0.72rem;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 999px;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
  .pass     { background: #d1fae5; color: #065f46; }
  .warn     { background: #fef3c7; color: #78350f; }
  .fail     { background: #fee2e2; color: #7f1d1d; }
  .escalate { background: #ede9fe; color: #4c1d95; }
  .neutral  { background: #f3f4f6; color: #6b7280; }
  .role-badge {
    display: inline-block;
    font-size: 0.72rem;
    background: #dbeafe;
    color: #1e40af;
    padding: 1px 7px;
    border-radius: 999px;
    margin-right: 4px;
  }
  .stat-row {
    display: flex;
    gap: 1.25rem;
    flex-wrap: wrap;
    font-size: 0.85rem;
    color: #374151;
    margin-bottom: 0.75rem;
  }
  .stat-row .stat { display: flex; align-items: center; gap: 0.25rem; }
  .stat-row .stat span { color: #6b7280; }
  .problem { color: #374151; font-size: 0.9rem; margin-bottom: 0.75rem; max-width: 72ch; }
  ul.oos { margin: 0.25rem 0 0 1rem; padding: 0; list-style: disc; color: #6b7280; font-size: 0.85rem; }
  ul.oos li { margin-bottom: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  thead th {
    text-align: left;
    padding: 6px 10px;
    background: #f3f4f6;
    border-bottom: 2px solid #e5e7eb;
    font-weight: 600;
    color: #374151;
  }
  tbody tr:nth-child(even) { background: #f9fafb; }
  tbody tr:hover { background: #f0f9ff; }
  tbody td { padding: 6px 10px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  .stage-name { font-weight: 500; }
  .stage-id { color: #9ca3af; font-size: 0.75rem; margin-left: 4px; }
  details { margin-top: 4px; }
  details summary {
    cursor: pointer;
    font-size: 0.78rem;
    color: #6b7280;
    user-select: none;
    list-style: none;
  }
  details summary::before { content: "▶ "; font-size: 0.65rem; }
  details[open] summary::before { content: "▼ "; font-size: 0.65rem; }
  .ws-table { width: 100%; margin-top: 6px; font-size: 0.8rem; }
  .ws-table td { padding: 3px 6px; border-bottom: 1px solid #f3f4f6; }
  .blockers-list { margin: 6px 0 0 1rem; padding: 0; list-style: disc; color: #7f1d1d; }
  .warnings-list { margin: 6px 0 0 1rem; padding: 0; list-style: disc; color: #78350f; }
  .blocker-log pre {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 1rem;
    font-size: 0.8rem;
    white-space: pre-wrap;
    word-break: break-word;
    color: #374151;
    max-height: 400px;
    overflow-y: auto;
    margin: 0.5rem 0 0;
  }
  .artifacts-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 0.5rem;
  }
  .artifact-item {
    background: #fff;
    border: 1px solid #e5e7eb;
    border-radius: 6px;
    padding: 0.5rem 0.75rem;
    font-size: 0.82rem;
  }
  .artifact-item.missing { opacity: 0.4; }
  .artifact-item a { color: #2563eb; text-decoration: none; }
  .artifact-item a:hover { text-decoration: underline; }
  .adrs-list { display: flex; flex-direction: column; gap: 0.35rem; }
  .adrs-list a { color: #2563eb; font-size: 0.85rem; text-decoration: none; }
  .adrs-list a:hover { text-decoration: underline; }
  .design-links { display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 0.5rem; }
  .design-links a { color: #2563eb; font-size: 0.85rem; text-decoration: none; }
  .design-links a:hover { text-decoration: underline; }
  footer {
    margin-top: 3rem;
    padding-top: 1rem;
    border-top: 1px solid #e5e7eb;
    color: #9ca3af;
    font-size: 0.75rem;
  }
  .no-data { color: #9ca3af; font-style: italic; font-size: 0.85rem; }
  .drift-warn { color: #78350f; font-weight: 600; }
`;

function renderStageTable(stages) {
  if (!stages || stages.length === 0) {
    return '<p class="no-data">No stage gate files found.</p>';
  }

  const rows = stages.map(s => {
    const statusCell = s.status ? badge(s.status) : '<span class="neutral badge">—</span>';
    const when = s.timestamp ? formatDate(s.timestamp) : "—";
    const dur = s.durationMs != null ? formatDuration(s.durationMs)
      : (s.workstreams.length > 0 && s.workstreams[0].durationMs != null)
        ? formatDuration(s.workstreams.reduce((sum, w) => sum + (w.durationMs || 0), 0))
        : "—";

    let details = "";

    // Workstreams breakdown (if multi-role)
    if (s.workstreams.length > 0) {
      const wsRows = s.workstreams.map(w => `
        <tr>
          <td>${esc(w.role)}</td>
          <td>${w.status ? badge(w.status) : "—"}</td>
          <td>${w.host ? esc(w.host) : "—"}</td>
          <td>${w.durationMs != null ? formatDuration(w.durationMs) : "—"}</td>
        </tr>`).join("");
      details += `
        <details>
          <summary>${s.workstreams.length} workstream${s.workstreams.length !== 1 ? "s" : ""}</summary>
          <table class="ws-table">
            <thead><tr><th>Role</th><th>Status</th><th>Host</th><th>Duration</th></tr></thead>
            <tbody>${wsRows}</tbody>
          </table>
        </details>`;
    }

    // Collect blockers from stage + workstreams
    const allBlockers = [
      ...(s.blockers || []),
      ...s.workstreams.flatMap(w => w.blockers || []),
    ];
    const allWarnings = [
      ...(s.warnings || []),
      ...s.workstreams.flatMap(w => w.warnings || []),
    ];

    if (allBlockers.length > 0) {
      const items = allBlockers.map(b => `<li>${esc(b)}</li>`).join("");
      details += `
        <details>
          <summary>${allBlockers.length} blocker${allBlockers.length !== 1 ? "s" : ""}</summary>
          <ul class="blockers-list">${items}</ul>
        </details>`;
    }

    if (allWarnings.length > 0) {
      const items = allWarnings.map(w => `<li>${esc(w)}</li>`).join("");
      details += `
        <details>
          <summary>${allWarnings.length} warning${allWarnings.length !== 1 ? "s" : ""}</summary>
          <ul class="warnings-list">${items}</ul>
        </details>`;
    }

    return `
      <tr>
        <td class="stage-name">${esc(s.name)}<span class="stage-id">${esc(s.stage)}</span></td>
        <td>${statusCell}</td>
        <td>${esc(when)}</td>
        <td>${esc(dur)}</td>
        <td>${details}</td>
      </tr>`;
  });

  return `
    <table>
      <thead>
        <tr>
          <th>Stage</th>
          <th>Status</th>
          <th>Completed</th>
          <th>Duration</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>${rows.join("")}</tbody>
    </table>`;
}

function renderHtml(data) {
  const { meta, brief, adrs, stages, blockerLog, artifacts } = data;

  const metaItems = [
    meta.track ? `Track: <strong>${esc(meta.track)}</strong>` : null,
    meta.startedAt ? `Started: <strong>${esc(formatDate(meta.startedAt))}</strong>` : null,
    `Iterations: <strong>${esc(String(meta.iterations))}</strong>`,
    meta.costUsd != null ? `Cost: <strong>${esc(formatCost(meta.costUsd))}</strong>` : null,
    meta.orchestratorVersion ? `<span style="color:#d1d5db">${esc(meta.orchestratorVersion)}</span>` : null,
  ].filter(Boolean).join(" &nbsp;·&nbsp; ");

  // Brief section
  const problemHtml = brief.problemStatement
    ? `<p class="problem">${esc(brief.problemStatement)}</p>`
    : "";

  const statParts = [];
  if (brief.acCount != null) statParts.push(`<div class="stat"><span>ACs:</span> <strong>${esc(String(brief.acCount))}</strong></div>`);
  if (brief.specScenarios != null) statParts.push(`<div class="stat"><span>Scenarios:</span> <strong>${esc(String(brief.specScenarios))}</strong></div>`);
  if (brief.acCount != null || brief.specScenarios != null) {
    const driftStr = brief.specDrift
      ? '<span class="drift-warn">drift detected</span>'
      : '<span style="color:#065f46">no drift</span>';
    statParts.push(`<div class="stat"><span>Spec drift:</span> ${driftStr}</div>`);
  }
  const statRowHtml = statParts.length > 0
    ? `<div class="stat-row">${statParts.join("")}</div>`
    : "";

  const rolesHtml = brief.activeRoles && brief.activeRoles.length > 0
    ? `<div style="margin-top:0.5rem"><span style="color:#6b7280;font-size:0.82rem">Active roles: </span>${brief.activeRoles.map(r => `<span class="role-badge">${esc(r)}</span>`).join("")}</div>`
    : "";

  const oosHtml = brief.outOfScope && brief.outOfScope.length > 0
    ? `<ul class="oos">${brief.outOfScope.map(i => `<li>${esc(i)}</li>`).join("")}</ul>`
    : "";

  // Design section
  const designLinks = artifacts
    .filter(a => ["design", "build-plan"].includes(a.kind) && a.exists)
    .map(a => fileLink(a.absPath, a.label));

  const adrHtml = adrs.length > 0
    ? `<div class="adrs-list">${adrs.map(a => `<div>${fileLink(a.absPath, a.title)}</div>`).join("")}</div>`
    : '<p class="no-data">No ADRs written.</p>';

  const designLinksHtml = designLinks.length > 0
    ? `<div class="design-links">${designLinks.join("")}</div>`
    : "";

  const designSection = (adrs.length > 0 || designLinks.length > 0)
    ? `
      <div class="section">
        <h2>Design</h2>
        ${adrHtml}
        ${designLinksHtml}
      </div>`
    : "";

  // Blockers section
  const blockersSection = blockerLog
    ? `
      <div class="section blocker-log">
        <h2>Blockers &amp; Escalations</h2>
        <details open>
          <summary>Re-dispatch blockers (from context.md)</summary>
          <pre>${esc(blockerLog)}</pre>
        </details>
      </div>`
    : "";

  // Halt reason
  const haltHtml = meta.haltReason
    ? `<div style="margin-top:0.5rem;font-size:0.85rem;color:#7f1d1d">Halt: ${esc(meta.haltReason)}</div>`
    : "";

  // Artifacts grid
  const artifactsHtml = artifacts.map(a => {
    const linkHtml = a.exists
      ? fileLink(a.absPath, a.label)
      : `<span style="color:#9ca3af">${esc(a.label)}</span>`;
    return `<div class="artifact-item${a.exists ? "" : " missing"}">${linkHtml}</div>`;
  }).join("");

  const now = new Date().toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Stagecraft Report — ${esc(meta.feature)}</title>
  <style>${CSS}</style>
</head>
<body>
  <div class="page">

    <!-- Header -->
    <div class="section header">
      <h1>${esc(meta.feature)}</h1>
      <div class="header-meta">${metaItems}</div>
      <div>${finalStatusBadge(meta.finalStatus)}${haltHtml}</div>
    </div>

    <!-- Brief -->
    <div class="section">
      <h2>Brief</h2>
      ${problemHtml}
      ${statRowHtml}
      ${rolesHtml}
      ${oosHtml ? `<div style="margin-top:0.75rem"><span style="color:#6b7280;font-size:0.82rem">Out of scope:</span>${oosHtml}</div>` : ""}
    </div>

    <!-- Design -->
    ${designSection}

    <!-- Stage timeline -->
    <div class="section">
      <h2>Stage Timeline</h2>
      ${renderStageTable(stages)}
    </div>

    <!-- Blockers -->
    ${blockersSection}

    <!-- Artifacts -->
    <div class="section">
      <h2>Pipeline Artifacts</h2>
      <div class="artifacts-grid">${artifactsHtml}</div>
    </div>

    <footer>
      Generated ${esc(now)}${meta.orchestratorVersion ? ` &nbsp;·&nbsp; ${esc(meta.orchestratorVersion)}` : ""}
    </footer>

  </div>
</body>
</html>`;
}

module.exports = { renderHtml };
