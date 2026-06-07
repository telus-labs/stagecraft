// Pipeline UI — vanilla JS, no build step.
// Fetches state on load, subscribes to /api/events for live updates,
// renders the stage list, shows gate detail when a stage is clicked.

// ── Constants ────────────────────────────────────────────────────────────────

const STATUS_ICONS = {
  pass: "✅", warn: "⚠️ ", fail: "❌", escalate: "🚨",
  partial: "⏳", skipped: "⏸ ", pending: "○ ",
};

const STAGE_NAMES = {
  "stage-01": "Requirements",
  "stage-02": "Design",
  "stage-03": "Clarification",
  "stage-03b": "Executable Spec",
  "stage-04": "Build",
  "stage-04a": "Pre-Review",
  "stage-04b": "Security Review",
  "stage-04c": "Red Team",
  "stage-04d": "Migration Safety",
  "stage-05": "Peer Review",
  "stage-06": "QA Tests",
  "stage-06b": "Accessibility Audit",
  "stage-06c": "Observability",
  "stage-06d": "Verification Beyond Tests",
  "stage-07": "Sign-off",
  "stage-08": "Deploy",
  "stage-09": "Retrospective",
};

const ARTIFACT_PATHS = {
  "stage-01": "pipeline/brief.md",
  "stage-02": "pipeline/design-spec.md",
  "stage-03": "pipeline/clarification-log.md",
  "stage-03b": "pipeline/spec.feature",
  "stage-04": "pipeline/build-plan.md",
  "stage-04a": "pipeline/pre-review.md",
  "stage-04b": "pipeline/security-review.md",
  "stage-04c": "pipeline/red-team-report.md",
  "stage-04d": "pipeline/migration-safety.md",
  "stage-05": "pipeline/code-review/",
  "stage-06": "pipeline/test-report.md",
  "stage-06b": "pipeline/accessibility-report.md",
  "stage-06c": "pipeline/observability-report.md",
  "stage-06d": "pipeline/verification-report.md",
  "stage-07": "pipeline/runbook.md",
  "stage-08": "pipeline/deploy-log.md",
  "stage-09": "pipeline/retrospective.md",
};

const ACTION_ICONS = {
  "run-stage": "▶",
  "continue-stage": "⏳",
  "merge": "🔀",
  "fix-and-retry": "❌",
  "resolve-escalation": "🚨",
  "pipeline-complete": "🎉",
};

const ALL_SURFACES = [
  "input_boundaries", "state_boundaries", "sequence_boundaries", "integration_boundaries",
  "auth_edges", "resource_exhaustion", "failure_modes", "abuse_cases",
  "downstream_effects", "observability_gaps",
];

const SURFACE_LABELS = {
  input_boundaries: "Input",
  state_boundaries: "State",
  sequence_boundaries: "Sequence",
  integration_boundaries: "Integration",
  auth_edges: "Auth",
  resource_exhaustion: "Resources",
  failure_modes: "Failures",
  abuse_cases: "Abuse",
  downstream_effects: "Downstream",
  observability_gaps: "Observability",
};

// ── State ─────────────────────────────────────────────────────────────────────

let _state = null;
let _selectedStage = null;
let _nextAction = null;    // last result from /api/next; read by renderDetailFixSteps
let _filter = "all";       // "all" | "fail" | "action"
let _focusedIdx = -1;
let _pendingCollapsed = false;
let _connectionLostTimer = null;

// ── DOM helpers ────────────────────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

// ── Utilities ─────────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function timeAgo(iso) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

function isStale(iso) {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() > 2 * 3600000;
}

function fmtDuration(ms) {
  if (!ms) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

async function copyToClipboard(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    if (btn) { btn.textContent = "Copied!"; btn.classList.add("copied"); setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("copied"); }, 1500); }
  } catch { /* ignore */ }
}

function stageFriendlyName(stageId) {
  const parts = stageId.split(".");
  const base = STAGE_NAMES[parts[0]] || parts[0];
  return parts.length > 1 ? `${base} — ${parts[1]}` : base;
}

function statusClass(state) {
  return state ? "status-" + state : "";
}

function badge(text, cls) {
  return `<span class="badge badge-${cls}">${text}</span>`;
}

function chip(text, cls) {
  return `<span class="chip ${cls}">${text}</span>`;
}

function boolChip(val, trueLabel = "Yes", falseLabel = "No") {
  if (val === undefined || val === null) return "—";
  return `<span class="chip ${val ? "chip-bool-true" : "chip-bool-false"}">${val ? trueLabel : falseLabel}</span>`;
}

function checkRow(label, pass, note = "") {
  const icon = pass ? '<span class="check-icon check-pass">✓</span>' : '<span class="check-icon check-fail">✗</span>';
  const noteHtml = note ? ` <span style="color:var(--muted);font-size:0.8rem">${note}</span>` : "";
  return `<div class="checklist-row">${icon}<span>${label}${noteHtml}</span></div>`;
}

function severityBadgeHtml(sev) {
  if (!sev) return "";
  return badge(sev, sev.toLowerCase());
}

// ── Section builders ──────────────────────────────────────────────────────────

function addSection(parent, title) {
  const h = el("h3", null, title);
  parent.appendChild(h);
  return h;
}

function addFieldRow(parent, label, valueHtml) {
  const row = el("div", "field-row");
  const k = el("span", "k", label);
  const v = el("span");
  v.innerHTML = valueHtml;
  row.append(k, v);
  parent.appendChild(row);
}

// ── API ────────────────────────────────────────────────────────────────────────

async function fetchState() {
  const r = await fetch("/api/state");
  if (!r.ok) throw new Error(`/api/state ${r.status}`);
  return r.json();
}

async function fetchGate(stageId) {
  const r = await fetch(`/api/gate/${encodeURIComponent(stageId)}`);
  if (!r.ok) return null;
  return r.json();
}

async function fetchNext() {
  try {
    const r = await fetch("/api/next");
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

// ── Connection / status ────────────────────────────────────────────────────────

function setConnection(label, cls) {
  const e = $("[data-connection]");
  e.textContent = label;
  e.className = "connection " + cls;
}

function setStatus(msg) {
  $("[data-status]").textContent = msg;
}

// ── Header ─────────────────────────────────────────────────────────────────────

function renderHeader(state) {
  $("[data-track]").textContent = `track: ${state.track}`;
  $("[data-cwd]").textContent = state.cwd;
  setStatus(`updated ${new Date(state.timestamp).toLocaleTimeString()}`);
}

function renderHosts(state) {
  $("[data-hosts]").textContent = `hosts: ${state.hosts.join(", ")}`;
}

// ── Next-action banner ─────────────────────────────────────────────────────────

async function renderNextAction() {
  const action = await fetchNext();
  _nextAction = action;  // cache for renderDetailFixSteps
  const banner = $("[data-next]");
  if (!action) { banner.hidden = true; return; }

  banner.removeAttribute("hidden");
  const cls = "next-action action-" + action.action.replace(/-/g, "_");
  banner.className = cls;

  $("[data-next-icon]").textContent = ACTION_ICONS[action.action] || "•";

  let text = "";
  if (action.action === "run-stage" || action.action === "continue-stage") {
    text = `${action.name || action.stage}`;
    if (action.reason) text += ` — ${action.reason}`;
  } else if (action.action === "pipeline-complete") {
    text = "Pipeline complete! All stages passed.";
  } else {
    text = action.reason || action.name || action.action;
  }
  $("[data-next-text]").textContent = text;

  const cmd = action.command || "";
  $("[data-next-command]").textContent = cmd;

  const copyBtn = $("[data-next-copy]");
  copyBtn.hidden = !cmd || (action.fix_steps && action.fix_steps.length > 0);
  copyBtn.onclick = () => copyToClipboard(cmd, copyBtn);

  // Fix steps — rendered below the summary line
  let stepsEl = banner.querySelector(".fix-steps");
  if (action.fix_steps && action.fix_steps.length) {
    if (!stepsEl) {
      stepsEl = document.createElement("ol");
      stepsEl.className = "fix-steps";
      banner.appendChild(stepsEl);
    }
    stepsEl.innerHTML = action.fix_steps.map((step) => {
      const cmdsHtml = step.commands.length
        ? step.commands.map(c => {
            return `<span class="fix-step-cmd-row">
              <code class="fix-step-cmd">${escHtml(c)}</code>
              <button class="fix-step-copy" data-cmd="${escHtml(c)}" title="Copy">Copy</button>
            </span>`;
          }).join("")
        : "";
      return `<li class="fix-step">
        <span class="fix-step-desc">${escHtml(step.description)}</span>
        ${cmdsHtml}
      </li>`;
    }).join("");
    stepsEl.querySelectorAll(".fix-step-copy").forEach(btn => {
      btn.onclick = (e) => { e.stopPropagation(); copyToClipboard(btn.dataset.cmd, btn); };
    });
  } else if (stepsEl) {
    stepsEl.remove();
  }
}

// ── Progress bar ───────────────────────────────────────────────────────────────

function renderProgress(rows) {
  const total = rows.length;
  const done = rows.filter(r => ["pass", "warn", "skipped"].includes(r.state)).length;
  const failing = rows.filter(r => ["fail", "escalate"].includes(r.state)).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const el = $("[data-progress]");
  const failHtml = failing
    ? ` · <span class="status-fail">${failing} failing</span>`
    : "";
  el.innerHTML = `
    <div class="progress-text">${done} / ${total} stages done${failHtml}</div>
    <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
  `;
}

// ── Filter ─────────────────────────────────────────────────────────────────────

function setFilter(mode) {
  _filter = mode;
  document.querySelectorAll(".filter-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.filter === mode);
  });
  if (_state) renderPipeline(_state);
}

function rowMatchesFilter(row) {
  if (_filter === "all") return true;
  if (_filter === "fail" || _filter === "action") {
    return ["fail", "escalate"].includes(row.state);
  }
  return true;
}

// ── Collapse pending ───────────────────────────────────────────────────────────

function updateCollapseToggle(rows) {
  const btn = $("[data-collapse-pending]");
  const pendingCount = rows.filter(r => r.state === "pending").length;
  if (pendingCount > 3) {
    btn.hidden = false;
    btn.textContent = _pendingCollapsed
      ? `▸ Show ${pendingCount} pending stages`
      : `▾ Hide ${pendingCount} pending stages`;
  } else {
    btn.hidden = true;
  }
}

// ── Pipeline list ──────────────────────────────────────────────────────────────

function renderPipeline(state) {
  const ol = $("[data-stages]");
  ol.innerHTML = "";
  const visibleRows = state.rows.filter(r => {
    if (!rowMatchesFilter(r)) return false;
    if (_pendingCollapsed && r.state === "pending") return false;
    return true;
  });

  visibleRows.forEach((row, idx) => {
    const li = document.createElement("li");
    li.dataset.stage = row.stage;
    li.dataset.state = row.state;
    li.tabIndex = 0;
    if (_selectedStage === row.stage) li.classList.add("selected");
    if (row.workstreams && row.workstreams.length > 0) li.classList.add("has-workstreams");

    const icon = el("span", "icon " + statusClass(row.state));
    icon.textContent = STATUS_ICONS[row.state] || "•";

    const name = el("span", "name", row.name);

    const stageId = el("span", "stage-id " + statusClass(row.state));
    stageId.textContent = row.stage + (row.state === "skipped" ? " (skipped)" : "");

    li.append(icon, name, stageId);

    if (row.workstreams && row.workstreams.length > 0) {
      const ws = el("div", "workstreams");
      for (const w of row.workstreams) {
        const wRow = el("div", "ws clickable");
        const wIcon = el("span", statusClass(w.state));
        wIcon.textContent = STATUS_ICONS[w.state] || "•";
        const wRole = el("span", "role");
        wRole.textContent = w.role + (w.host ? ` (${w.host})` : "");
        wRow.append(wIcon, wRole);
        wRow.addEventListener("click", (e) => {
          e.stopPropagation();
          selectStage(`${row.stage}.${w.role}`);
        });
        ws.appendChild(wRow);
      }
      if (row.remaining && row.remaining.length > 0) {
        const r = el("div", "ws");
        r.textContent = `pending: ${row.remaining.join(", ")}`;
        ws.appendChild(r);
      }
      li.appendChild(ws);
    }

    li.addEventListener("click", () => {
      _focusedIdx = idx;
      selectStage(row.stage);
    });
    li.addEventListener("focus", () => { _focusedIdx = idx; });
    ol.appendChild(li);
  });

  updateCollapseToggle(state.rows);
}

// ── Stage selection ────────────────────────────────────────────────────────────

async function selectStage(stageId) {
  _selectedStage = stageId;
  document.querySelectorAll("ol.stages li").forEach((li) => {
    li.classList.toggle("selected", li.dataset.stage === stageId.split(".")[0]);
  });

  const detail = $("[data-detail]");
  detail.innerHTML = "";

  const titleEl = el("h2", "detail-title", stageFriendlyName(stageId));
  const idEl = el("span", "detail-stage-id", stageId);
  detail.append(titleEl, idEl);

  const gate = await fetchGate(stageId);
  if (!gate) {
    const p = el("p", "detail-empty", "No gate file yet for this stage.");
    detail.appendChild(p);
    return;
  }
  renderGate(detail, gate);
}

// ── Gate dispatcher ────────────────────────────────────────────────────────────

function renderGate(parent, gate) {
  renderBaseFields(parent, gate);
  renderArtifactLink(parent, gate);

  const base = (gate.stage || "").split(".")[0];
  switch (base) {
    case "stage-01": renderRequirements(parent, gate); break;
    case "stage-02": renderDesign(parent, gate); break;
    case "stage-03": renderClarification(parent, gate); break;
    case "stage-03b": renderSpec(parent, gate); break;
    case "stage-04": renderBuild(parent, gate); break;
    case "stage-04a": renderPreReview(parent, gate); break;
    case "stage-04b": renderSecurity(parent, gate); break;
    case "stage-04c": renderRedTeam(parent, gate); break;
    case "stage-04d": renderMigration(parent, gate); break;
    case "stage-05": renderPeerReview(parent, gate); break;
    case "stage-06": renderQA(parent, gate); break;
    case "stage-06b": renderAccessibility(parent, gate); break;
    case "stage-06c": renderObservability(parent, gate); break;
    case "stage-06d": renderVerification(parent, gate); break;
    case "stage-07": renderSignOff(parent, gate); break;
    case "stage-08": renderDeploy(parent, gate); break;
    case "stage-09": renderRetro(parent, gate); break;
    default: break;
  }

  renderDetailFixSteps(parent, gate);
  renderBlockers(parent, gate);
  renderWarnings(parent, gate);
  renderWorkstreams(parent, gate);
  renderRawJSON(parent, gate);
}

// ── Base fields (every gate) ───────────────────────────────────────────────────

function renderBaseFields(parent, gate) {
  const statusHtml = gate.status ? badge(gate.status, gate.status.toLowerCase()) : "—";
  addFieldRow(parent, "Status", statusHtml);

  if (gate.track) addFieldRow(parent, "Track", gate.track);
  if (gate.workstream) addFieldRow(parent, "Workstream", gate.workstream);
  if (gate.host) addFieldRow(parent, "Host", gate.host);

  if (gate.timestamp) {
    const ago = timeAgo(gate.timestamp);
    const cls = isStale(gate.timestamp) ? " ts-stale" : "";
    const dur = gate.duration_ms ? ` <span style="color:var(--muted);font-size:0.8rem">(took ${fmtDuration(gate.duration_ms)})</span>` : "";
    addFieldRow(parent, "Updated", `<span class="${cls}">${ago}</span>${dur}`);
  }
}

// ── Artifact link ──────────────────────────────────────────────────────────────

function renderArtifactLink(parent, gate) {
  const base = (gate.stage || "").split(".")[0];
  const path = ARTIFACT_PATHS[base];
  if (!path) return;

  const wrap = el("div", "artifact-link");
  const pathSpan = el("span", null, path);
  const copyBtn = el("button", "copy-btn", "Copy path");
  copyBtn.title = "Copy path to clipboard";
  copyBtn.onclick = (e) => { e.stopPropagation(); copyToClipboard(path, copyBtn); };
  wrap.append(el("span", "status-skipped", "📄"), pathSpan, copyBtn);
  parent.appendChild(wrap);
}

// ── Stage-specific renderers ───────────────────────────────────────────────────

function renderRequirements(parent, gate) {
  addSection(parent, "Requirements");
  const wrap = el("div");
  if (gate.acceptance_criteria_count !== undefined) {
    const row = el("div");
    row.innerHTML = `<span class="criteria-count">${gate.acceptance_criteria_count}</span> <span style="color:var(--muted)">acceptance criteria</span>`;
    wrap.appendChild(row);
  }
  if (gate.required_sections_complete !== undefined) {
    wrap.innerHTML += checkRow("All required sections present", gate.required_sections_complete);
  }
  if (Array.isArray(gate.out_of_scope_items) && gate.out_of_scope_items.length > 0) {
    addSection(parent, "Out of Scope");
    const ul = el("ul", "oos-list");
    gate.out_of_scope_items.forEach(s => { const li = el("li", null, s); ul.appendChild(li); });
    parent.appendChild(ul);
  }
  parent.appendChild(wrap);
}

function renderDesign(parent, gate) {
  addSection(parent, "Design Approval");
  const checks = el("div", "checklist");
  if (gate.arch_approved !== undefined) checks.innerHTML += checkRow("Architecture approved", gate.arch_approved);
  if (gate.pm_approved !== undefined) checks.innerHTML += checkRow("PM approved", gate.pm_approved);
  parent.appendChild(checks);

  if (gate.adr_count !== undefined) {
    addFieldRow(parent, "ADRs written", String(gate.adr_count));
  }
  if (Array.isArray(gate.adrs_consulted) && gate.adrs_consulted.length > 0) {
    addSection(parent, `ADRs Consulted (${gate.adrs_consulted.length})`);
    const ul = el("ul", "adr-list");
    gate.adrs_consulted.forEach(a => { const li = el("li", null, a.split("#").pop()); ul.appendChild(li); });
    parent.appendChild(ul);
  }
}

function renderClarification(parent, gate) {
  addSection(parent, "Clarification");
  if (gate.open_questions_count !== undefined) {
    addFieldRow(parent, "Open questions", gate.open_questions_count === 0
      ? badge("0 open", "pass")
      : badge(`${gate.open_questions_count} open`, "fail"));
  }
  if (gate.answered_questions_count !== undefined) addFieldRow(parent, "Answered", String(gate.answered_questions_count));
  if (gate.scope_changed !== undefined) addFieldRow(parent, "Scope changed", boolChip(gate.scope_changed, "Yes — brief updated", "No"));
}

function renderSpec(parent, gate) {
  addSection(parent, "Executable Spec (G2)");
  if (gate.criteria_count !== undefined) addFieldRow(parent, "Criteria (AC-N)", String(gate.criteria_count));
  if (gate.scenarios_count !== undefined) addFieldRow(parent, "Scenarios", String(gate.scenarios_count));
  if (gate.all_criteria_mapped !== undefined) {
    addFieldRow(parent, "All AC mapped", boolChip(gate.all_criteria_mapped, "Yes", "No — see orphans"));
  }
  if (gate.drift !== undefined) {
    addFieldRow(parent, "Drift detected", boolChip(!gate.drift, "No drift", "Yes — orphans exist"));
  }
}

function renderBuild(parent, gate) {
  if (Array.isArray(gate.pr_summaries_written) && gate.pr_summaries_written.length > 0) {
    addSection(parent, "PR Summaries Written");
    const ul = el("ul", "adr-list");
    gate.pr_summaries_written.forEach(p => { ul.appendChild(el("li", null, p)); });
    parent.appendChild(ul);
  }
  if (Array.isArray(gate.local_verification) && gate.local_verification.length > 0) {
    addSection(parent, "Local Verification");
    const ul = el("ul", "adr-list");
    gate.local_verification.forEach(v => { ul.appendChild(el("li", null, v)); });
    parent.appendChild(ul);
  }
}

function renderPreReview(parent, gate) {
  addSection(parent, "Hygiene Checks");
  const checks = el("div", "checklist");
  checks.innerHTML = [
    gate.lint_passed !== undefined ? checkRow("Lint", gate.lint_passed) : "",
    gate.type_check_passed !== undefined ? checkRow("Type check", gate.type_check_passed) : "",
    gate.tests_passed !== undefined ? checkRow("Unit tests", gate.tests_passed) : "",
    gate.dependency_review_passed !== undefined ? checkRow("Dependency audit (SCA)", gate.dependency_review_passed) : "",
  ].join("");
  parent.appendChild(checks);

  if (gate.sca_findings) {
    const { high = 0, critical = 0 } = gate.sca_findings;
    addFieldRow(parent, "SCA findings",
      `${badge(critical, "critical")} critical &nbsp; ${badge(high, "high")} high`);
  }

  if (gate.security_review_required !== undefined) {
    addFieldRow(parent, "Security review",
      gate.security_review_required
        ? '<span class="badge badge-warn">Required</span>'
        : '<span class="badge badge-pass">Not required</span>');
  }
  if (gate.migration_safety_required !== undefined) {
    addFieldRow(parent, "Migration review",
      gate.migration_safety_required
        ? '<span class="badge badge-warn">Required</span>'
        : '<span class="badge badge-pass">Not required</span>');
  }
}

function renderSecurity(parent, gate) {
  if (gate.veto) {
    const alert = el("div", "alert-banner alert-veto", "🚨 VETO — Pipeline halted");
    parent.appendChild(alert);
  }
  addSection(parent, "Security Review");
  if (gate.security_approved !== undefined) {
    addFieldRow(parent, "Approved", boolChip(gate.security_approved, "Yes", "No"));
  }
  if (Array.isArray(gate.triggering_conditions) && gate.triggering_conditions.length > 0) {
    addSection(parent, "Triggering Conditions");
    const wrap = el("div", "trigger-list");
    gate.triggering_conditions.forEach(t => { wrap.appendChild(el("span", "trigger-chip", t)); });
    parent.appendChild(wrap);
  }
}

function renderRedTeam(parent, gate) {
  // Severity breakdown
  if (gate.severity_breakdown) {
    addSection(parent, "Findings");
    const { critical = 0, high = 0, medium = 0, low = 0 } = gate.severity_breakdown;
    const row = el("div", "severity-row");
    [["critical", critical, "sev-critical"], ["high", high, "sev-high"],
     ["medium", medium, "sev-medium"], ["low", low, "sev-low"]].forEach(([label, count, cls]) => {
      const cell = el("div", `severity-count ${cls}`);
      cell.innerHTML = `<span class="count">${count}</span><span class="label">${label}</span>`;
      row.appendChild(cell);
    });
    if (gate.findings_count !== undefined) {
      const total = el("div", "severity-count");
      total.innerHTML = `<span class="count" style="color:var(--muted)">${gate.findings_count}</span><span class="label">total</span>`;
      row.appendChild(total);
    }
    parent.appendChild(row);
  }

  // Surfaces walked/skipped
  addSection(parent, "Attack Surfaces");
  const walked = new Set(gate.surfaces_walked || []);
  const skippedMap = {};
  (gate.surfaces_skipped || []).forEach(s => { skippedMap[s.surface] = s.reason; });

  const grid = el("div", "surfaces-grid");
  ALL_SURFACES.forEach(s => {
    const chip = el("span");
    const label = SURFACE_LABELS[s] || s;
    if (walked.has(s)) {
      chip.className = "surface-chip surface-walked";
      chip.textContent = label;
      chip.title = s;
    } else if (skippedMap[s]) {
      chip.className = "surface-chip surface-skipped";
      chip.textContent = label;
      chip.title = `Skipped: ${skippedMap[s]}`;
    } else {
      chip.className = "surface-chip surface-skipped";
      chip.textContent = label;
      chip.title = "Not walked";
      chip.style.opacity = "0.5";
    }
    grid.appendChild(chip);
  });
  parent.appendChild(grid);

  // Must-fix findings table
  const mustFix = gate.must_address_before_peer_review;
  if (Array.isArray(mustFix) && mustFix.length > 0) {
    addSection(parent, `Must Fix Before Peer Review (${mustFix.length})`);
    const table = el("table", "findings");
    table.innerHTML = `<thead><tr><th>ID</th><th>Severity</th><th>Likelihood</th><th>Surface</th><th>Summary</th></tr></thead>`;
    const tbody = el("tbody");
    mustFix.forEach(f => {
      const tr = el("tr");
      tr.innerHTML = `
        <td class="col-id">${f.id || "—"}</td>
        <td>${severityBadgeHtml(f.severity)}</td>
        <td>${f.likelihood ? chip(f.likelihood, `chip-${f.likelihood}`) : "—"}</td>
        <td class="col-surface">${f.surface || "—"}</td>
        <td>${f.summary || ""}</td>
      `;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    parent.appendChild(table);
  }

  // Noted for followup (collapsible)
  const noted = gate.noted_for_followup;
  if (Array.isArray(noted) && noted.length > 0) {
    const det = el("details");
    const sum = el("summary", null, `Noted for follow-up (${noted.length})`);
    sum.style.cssText = "cursor:pointer;font-size:0.8rem;color:var(--muted);padding:0.5rem 0;";
    det.appendChild(sum);
    const table = el("table", "findings");
    table.innerHTML = `<thead><tr><th>ID</th><th>Severity</th><th>Surface</th><th>Summary</th></tr></thead>`;
    const tbody = el("tbody");
    noted.forEach(f => {
      const tr = el("tr");
      tr.innerHTML = `
        <td class="col-id">${f.id || "—"}</td>
        <td>${severityBadgeHtml(f.severity)}</td>
        <td class="col-surface">${f.surface || "—"}</td>
        <td>${f.summary || f.text || ""}</td>
      `;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    det.appendChild(table);
    parent.appendChild(det);
  }
}

function renderMigration(parent, gate) {
  if (gate.veto) {
    parent.appendChild(el("div", "alert-banner alert-veto", "🚨 VETO — Migration safety halt"));
  }
  addSection(parent, "Migration Safety");
  const checks = el("div", "checklist");
  checks.innerHTML = [
    gate.breaking_change !== undefined ? checkRow("Breaking change", !gate.breaking_change, gate.breaking_change ? "Coordination required" : "") : "",
    gate.backfill_required !== undefined ? checkRow("Backfill required", !gate.backfill_required) : "",
    gate.rollback_tested !== undefined ? checkRow("Rollback tested", gate.rollback_tested) : "",
    gate.migration_approved !== undefined ? checkRow("Migration approved", gate.migration_approved) : "",
  ].join("");
  parent.appendChild(checks);

  if (gate.rollback_plan) {
    addSection(parent, "Rollback Plan");
    const p = el("p");
    p.style.cssText = "font-size:0.85rem;margin:0.25rem 0;";
    p.textContent = gate.rollback_plan.substring(0, 300) + (gate.rollback_plan.length > 300 ? "…" : "");
    parent.appendChild(p);
  }
}

function renderPeerReview(parent, gate) {
  addSection(parent, "Review Status");

  if (gate.escalated_to_principal) {
    parent.appendChild(el("div", "alert-banner alert-veto", "🚨 Escalated to Principal — two-round limit reached"));
  }

  const approvals = gate.approvals || [];
  const requested = gate.changes_requested || [];
  const required = gate.required_approvals || 1;

  const summary = el("div", "field-row");
  summary.innerHTML = `<span class="k">Approvals</span><span>${approvals.length} / ${required} required</span>`;
  parent.appendChild(summary);

  if (approvals.length > 0) {
    addSection(parent, "Approved");
    const row = el("div", "filter-strip");
    approvals.forEach(a => { row.appendChild(el("span", "chip chip-approved", `✓ ${a}`)); });
    parent.appendChild(row);
  }

  if (requested.length > 0) {
    addSection(parent, "Changes Requested");
    const row = el("div", "filter-strip");
    requested.forEach(a => { row.appendChild(el("span", "chip chip-changes", `✗ ${a}`)); });
    parent.appendChild(row);
  }

  if (gate.review_shape) {
    addFieldRow(parent, "Review shape", gate.review_shape);
  }
}

function renderQA(parent, gate) {
  const total = gate.tests_total;
  const passed = gate.tests_passed;
  const failed = gate.tests_failed;

  if (total !== undefined && passed !== undefined) {
    addSection(parent, "Test Results");
    const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
    const allPass = failed === 0;
    const wrap = el("div", "test-bar-wrap");
    wrap.innerHTML = `
      <div class="test-bar-label">
        <strong>${passed}</strong> / ${total} passing
        ${failed ? `<span class="status-fail">(${failed} failing)</span>` : '<span class="status-pass">✓ all passing</span>'}
      </div>
      <div class="test-bar">
        <div class="test-bar-fill ${allPass ? "all-pass" : "some-fail"}" style="width:${pct}%"></div>
      </div>
    `;
    parent.appendChild(wrap);
  }

  if (gate.all_acceptance_criteria_met !== undefined) {
    const ok = gate.all_acceptance_criteria_met;
    parent.appendChild(el("div", `alert-banner ${ok ? "alert-pass" : "alert-warn"}`,
      ok ? "✓ All acceptance criteria met" : "✗ Some acceptance criteria not met"));
  }

  if (gate.scenarios_total !== undefined && gate.scenarios_covered !== undefined) {
    addFieldRow(parent, "Scenarios",
      `${gate.scenarios_covered} / ${gate.scenarios_total} covered`);
  }

  const failing = gate.failing_tests;
  if (Array.isArray(failing) && failing.length > 0) {
    addSection(parent, `Failing Tests (${failing.length})`);
    const ul = el("ul");
    ul.style.cssText = "list-style:none;padding:0;margin:0;";
    failing.forEach(f => {
      const li = el("li");
      li.style.cssText = "font-size:0.82rem;padding:0.2rem 0;font-family:var(--mono);color:var(--fail);";
      const text = typeof f === "string" ? f : (f.file || f.test || JSON.stringify(f));
      const assigned = typeof f === "object" && f.assigned_to ? ` <span style="color:var(--muted)">(${f.assigned_to})</span>` : "";
      li.innerHTML = text + assigned;
      ul.appendChild(li);
    });
    parent.appendChild(ul);
  }
}

function renderAccessibility(parent, gate) {
  addSection(parent, "WCAG Audit");
  if (gate.wcag_level) addFieldRow(parent, "WCAG level", badge(gate.wcag_level, "info"));
  if (gate.audit_method) addFieldRow(parent, "Method", gate.audit_method);
  if (gate.audit_skipped_reason) {
    parent.appendChild(el("div", "alert-banner alert-warn", `Skipped: ${gate.audit_skipped_reason}`));
  }

  if (gate.violations) {
    const { critical = 0, serious = 0, moderate = 0, minor = 0 } = gate.violations;
    addSection(parent, "Violations");
    const row = el("div", "severity-row");
    [["critical", critical, "sev-critical"], ["serious", serious, "sev-high"],
     ["moderate", moderate, "sev-medium"], ["minor", minor, "sev-low"]].forEach(([label, count, cls]) => {
      const cell = el("div", `severity-count ${cls}`);
      cell.innerHTML = `<span class="count">${count}</span><span class="label">${label}</span>`;
      row.appendChild(cell);
    });
    parent.appendChild(row);
  }

  if (Array.isArray(gate.components_audited) && gate.components_audited.length > 0) {
    addSection(parent, "Components Audited");
    const ul = el("ul", "adr-list");
    gate.components_audited.forEach(c => { ul.appendChild(el("li", null, c)); });
    parent.appendChild(ul);
  }
}

function renderObservability(parent, gate) {
  ["metrics", "logs", "traces"].forEach(kind => {
    const section = gate[kind];
    if (!section) return;
    const { required = [], verified = [], gap = [] } = section;
    addSection(parent, `${kind.charAt(0).toUpperCase() + kind.slice(1)}`);
    const wrap = el("div", "obs-section");
    wrap.innerHTML = `<div class="obs-counts">${verified.length} / ${required.length} verified${gap.length ? ` · <span class="status-fail">${gap.length} gap(s)</span>` : " ✓"}</div>`;
    gap.forEach(g => {
      const item = el("div", "obs-gap-item");
      item.innerHTML = `✗ ${g.signal || g} ${g.assigned_to ? `<span class="assigned">→ ${g.assigned_to}</span>` : ""}`;
      wrap.appendChild(item);
    });
    parent.appendChild(wrap);
  });

  if (gate.verification_method) {
    addFieldRow(parent, "Verification", gate.verification_method);
  }
}

function renderVerification(parent, gate) {
  addSection(parent, "Verification Beyond Tests");
  if (Array.isArray(gate.methods_attempted) && gate.methods_attempted.length > 0) {
    addSection(parent, "Methods Attempted");
    const row = el("div", "trigger-list");
    gate.methods_attempted.forEach(m => { row.appendChild(el("span", "trigger-chip", m)); });
    parent.appendChild(row);
  }
  if (Array.isArray(gate.methods_skipped) && gate.methods_skipped.length > 0) {
    addSection(parent, "Methods Skipped");
    gate.methods_skipped.forEach(s => {
      const item = el("div", "checklist-row");
      item.innerHTML = `<span class="check-icon check-fail">–</span><span><strong>${s.method}</strong>: ${s.reason}</span>`;
      parent.appendChild(item);
    });
  }
  if (gate.mutation && gate.mutation.score !== undefined) {
    addSection(parent, "Mutation Score");
    const pct = Math.round(gate.mutation.score * 100);
    const wrap = el("div", "test-bar-wrap mutation-bar-wrap");
    wrap.innerHTML = `
      <div class="test-bar-label"><span class="mutation-score">${pct}%</span> killed${gate.mutation.threshold !== undefined ? ` (threshold: ${Math.round(gate.mutation.threshold * 100)}%)` : ""}</div>
      <div class="test-bar"><div class="test-bar-fill ${pct >= (gate.mutation.threshold || 0.8) * 100 ? "all-pass" : "some-fail"}" style="width:${pct}%"></div></div>
    `;
    parent.appendChild(wrap);
  }
  if (Array.isArray(gate.blocking_findings) && gate.blocking_findings.length > 0) {
    addSection(parent, `Blocking Findings (${gate.blocking_findings.length})`);
    gate.blocking_findings.forEach(f => {
      const card = el("div", "blocker-card");
      card.innerHTML = `<span>${badge(f.method, "fail")}</span><span>${f.summary}${f.file ? ` <span style="font-family:var(--mono);font-size:0.78rem;color:var(--muted)">${f.file}${f.line ? `:${f.line}` : ""}</span>` : ""}</span>`;
      parent.appendChild(card);
    });
  }
}

function renderSignOff(parent, gate) {
  const pmOk = gate.pm_signoff;
  parent.appendChild(el("div", `alert-banner ${pmOk ? "alert-pass" : "alert-warn"}`,
    pmOk ? "✓ PM sign-off confirmed" : "⏳ Awaiting PM sign-off"));

  if (gate.deploy_requested !== undefined) {
    addFieldRow(parent, "Deploy requested", boolChip(gate.deploy_requested, "Yes", "No"));
  }
  if (gate.auto_from_stage_06) {
    addFieldRow(parent, "Auto-fold", '<span class="badge badge-info">Yes — Stage 6 AC mapping verified</span>');
  }
  if (gate.runbook_referenced !== undefined) {
    addFieldRow(parent, "Runbook", boolChip(gate.runbook_referenced, "Present", "Missing"));
  }
}

function renderDeploy(parent, gate) {
  addSection(parent, "Deploy Results");
  const checks = el("div", "checklist");
  checks.innerHTML = [
    gate.deploy_completed !== undefined ? checkRow("Deploy completed", gate.deploy_completed) : "",
    gate.smoke_tests_passed !== undefined ? checkRow("Smoke tests passed", gate.smoke_tests_passed) : "",
    gate.runbook_referenced !== undefined ? checkRow("Runbook referenced", gate.runbook_referenced) : "",
  ].join("");
  parent.appendChild(checks);

  if (gate.rollback_executed) {
    parent.appendChild(el("div", "alert-banner alert-veto", "⚠️ Rollback was executed during deploy"));
  }
  if (gate.deploy_adapter) addFieldRow(parent, "Adapter", gate.deploy_adapter);
  if (gate.environment) addFieldRow(parent, "Environment", gate.environment);
}

function renderRetro(parent, gate) {
  if (gate.severity) {
    addSection(parent, "Run Severity");
    const cls = `retro-${gate.severity}`;
    const icons = { green: "🟢", yellow: "🟡", red: "🔴" };
    parent.appendChild(el("div", `retro-severity ${cls}`,
      `${icons[gate.severity] || ""} ${gate.severity.charAt(0).toUpperCase() + gate.severity.slice(1)}`));
  }
  if (Array.isArray(gate.lessons_promoted) && gate.lessons_promoted.length > 0) {
    addSection(parent, "Lessons Promoted");
    const ul = el("ul", "lessons-list");
    gate.lessons_promoted.forEach(l => { ul.appendChild(el("li", null, l)); });
    parent.appendChild(ul);
  }
  if (gate.patterns_harvested !== undefined) {
    addFieldRow(parent, "Patterns harvested", String(gate.patterns_harvested));
  }
  if (Array.isArray(gate.contributions_written) && gate.contributions_written.length > 0) {
    addFieldRow(parent, "Contributors", gate.contributions_written.join(", "));
  }
}

// ── Common sections (blockers, warnings, workstreams, raw JSON) ────────────────

function renderDetailFixSteps(parent, gate) {
  if (gate.status !== "FAIL") return;
  if (!_nextAction || _nextAction.action !== "fix-and-retry") return;
  if (_nextAction.stage !== (gate.stage || "").split(".")[0]) return;
  const steps = _nextAction.fix_steps;
  if (!steps || !steps.length) return;

  addSection(parent, "Fix steps");
  const ol = el("ol", "fix-steps detail-fix-steps");
  ol.innerHTML = steps.map((step) => {
    const cmdsHtml = step.commands.length
      ? step.commands.map(c => `<span class="fix-step-cmd-row">
          <code class="fix-step-cmd">${escHtml(c)}</code>
          <button class="fix-step-copy" data-cmd="${escHtml(c)}" title="Copy command">Copy</button>
        </span>`).join("")
      : "";
    return `<li class="fix-step">
      <span class="fix-step-desc">${escHtml(step.description)}</span>
      ${cmdsHtml}
    </li>`;
  }).join("");
  ol.querySelectorAll(".fix-step-copy").forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); copyToClipboard(btn.dataset.cmd, btn); };
  });
  parent.appendChild(ol);
}

function renderBlockers(parent, gate) {
  const blockers = gate.blockers;
  if (!Array.isArray(blockers) || blockers.length === 0) return;
  addSection(parent, `Blockers (${blockers.length})`);
  const list = el("div", "blockers-list");
  blockers.forEach(b => {
    const card = el("div", "blocker-card");
    const text = typeof b === "string" ? b : (b.text || b.summary || JSON.stringify(b));
    const sev = typeof b === "object" && b.severity ? severityBadgeHtml(b.severity) + " " : "";
    card.innerHTML = `${sev}${text}`;
    list.appendChild(card);
  });
  parent.appendChild(list);
}

function renderWarnings(parent, gate) {
  const warnings = gate.warnings;
  if (!Array.isArray(warnings) || warnings.length === 0) return;
  addSection(parent, `Warnings (${warnings.length})`);
  const list = el("div", "warnings-list");
  warnings.forEach(w => {
    const card = el("div", "warning-card");
    card.textContent = typeof w === "string" ? w : JSON.stringify(w);
    list.appendChild(card);
  });
  parent.appendChild(list);
}

function renderWorkstreams(parent, gate) {
  if (!Array.isArray(gate.workstreams) || gate.workstreams.length === 0) return;
  addSection(parent, "Workstreams");
  const rows = el("div", "workstream-rows");
  gate.workstreams.forEach(w => {
    const row = el("div", "ws-detail-row");
    const status = (w.status || w.state || "pending").toLowerCase();
    const icon = STATUS_ICONS[status] || "•";
    const wsId = `${gate.stage}.${w.workstream}`;
    row.innerHTML = `<span>${icon}</span><span class="ws-role">${w.workstream}</span><span class="ws-host ${statusClass(status)}">${w.host || "—"} · ${w.status || w.state || "pending"}</span>`;
    row.title = `Click to inspect ${wsId}`;
    row.onclick = () => selectStage(wsId);
    rows.appendChild(row);
  });
  parent.appendChild(rows);
}

function renderRawJSON(parent, gate) {
  const det = el("details", "raw-json");
  const sum = el("summary", null, "Raw gate JSON");
  const pre = el("pre");
  const jsonText = JSON.stringify(gate, null, 2);
  pre.textContent = jsonText;

  const copyBtn = el("button", "copy-btn copy-json-btn", "Copy");
  copyBtn.title = "Copy JSON to clipboard";
  copyBtn.onclick = (e) => { e.stopPropagation(); copyToClipboard(jsonText, copyBtn); };
  pre.style.position = "relative";

  det.append(sum, pre, copyBtn);
  parent.appendChild(det);
}

// ── Main state application ─────────────────────────────────────────────────────

function applyState(state) {
  _state = state;
  renderHeader(state);
  renderHosts(state);
  renderProgress(state.rows);
  renderPipeline(state);
  renderNextAction();
  if (_selectedStage) selectStage(_selectedStage);
}

// ── SSE subscription ───────────────────────────────────────────────────────────

function subscribe() {
  setConnection("connecting…", "");
  const es = new EventSource("/api/events");
  es.onopen = () => {
    clearTimeout(_connectionLostTimer);
    setConnection("live", "live");
  };
  es.addEventListener("state", (ev) => {
    try { applyState(JSON.parse(ev.data)); } catch (err) { console.error(err); }
  });
  es.addEventListener("heartbeat", () => {
    clearTimeout(_connectionLostTimer);
    setConnection("live", "live");
  });
  es.onerror = () => {
    setConnection("reconnecting…", "stale");
    clearTimeout(_connectionLostTimer);
    _connectionLostTimer = setTimeout(() => setConnection("server stopped", "stopped"), 30000);
  };
}

// ── Keyboard navigation ────────────────────────────────────────────────────────

document.addEventListener("keydown", (e) => {
  // Don't hijack input in form elements
  if (["INPUT", "TEXTAREA", "BUTTON"].includes(e.target.tagName)) return;

  const items = [...document.querySelectorAll("ol.stages li")];
  if (!items.length) return;

  if (e.key === "j" || e.key === "ArrowDown") {
    e.preventDefault();
    _focusedIdx = Math.min(_focusedIdx + 1, items.length - 1);
    items[_focusedIdx]?.focus();
  } else if (e.key === "k" || e.key === "ArrowUp") {
    e.preventDefault();
    _focusedIdx = Math.max(_focusedIdx - 1, 0);
    items[_focusedIdx]?.focus();
  } else if (e.key === "Enter" && _focusedIdx >= 0) {
    items[_focusedIdx]?.click();
  } else if (e.key === "Escape") {
    _selectedStage = null;
    _focusedIdx = -1;
    $("[data-detail]").innerHTML = '<div class="detail-empty">Select a stage to inspect its gate.</div>';
    document.querySelectorAll("ol.stages li").forEach(li => li.classList.remove("selected"));
  }
});

// ── Wire up static controls ────────────────────────────────────────────────────

document.querySelectorAll("[data-filter]").forEach(btn => {
  btn.addEventListener("click", () => setFilter(btn.dataset.filter));
});

const collapseBtn = $("[data-collapse-pending]");
if (collapseBtn) {
  collapseBtn.addEventListener("click", () => {
    _pendingCollapsed = !_pendingCollapsed;
    if (_state) {
      renderPipeline(_state);
      updateCollapseToggle(_state.rows);
    }
  });
}

// ── Init ───────────────────────────────────────────────────────────────────────

async function init() {
  try {
    const state = await fetchState();
    applyState(state);
    subscribe();
  } catch (err) {
    setConnection("error", "lost");
    setStatus(err.message);
  }
}

init();
