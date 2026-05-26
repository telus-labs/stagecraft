// Pipeline UI — vanilla JS, no build step.
// Fetches state on load, subscribes to /api/events for live updates,
// renders the stage list, shows gate detail when a stage is clicked.

const STATUS_ICONS = {
  pass: "✅", warn: "⚠️ ", fail: "❌", escalate: "🚨",
  partial: "⏳", skipped: "⏸ ", pending: "○ ",
};

let _state = null;
let _selectedStage = null;

const $ = (sel) => document.querySelector(sel);

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

function setConnection(label, cls) {
  const el = $("[data-connection]");
  el.textContent = label;
  el.className = "connection " + cls;
}

function setStatus(msg) {
  $("[data-status]").textContent = msg;
}

function renderHeader(state) {
  $("[data-track]").textContent = `track: ${state.track}`;
  $("[data-cwd]").textContent = state.cwd;
  setStatus(`updated ${new Date(state.timestamp).toLocaleTimeString()}`);
}

function renderHosts(state) {
  const el = $("[data-hosts]");
  el.textContent = `hosts: ${state.hosts.join(", ")}`;
}

function renderPipeline(state) {
  const ol = $("[data-stages]");
  ol.innerHTML = "";
  for (const row of state.rows) {
    const li = document.createElement("li");
    li.dataset.stage = row.stage;
    li.dataset.state = row.state;
    if (_selectedStage === row.stage) li.classList.add("selected");
    if (row.workstreams && row.workstreams.length > 0) li.classList.add("has-workstreams");

    const icon = document.createElement("span");
    icon.className = "icon " + statusClass(row.state);
    icon.textContent = STATUS_ICONS[row.state] || "•";

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = row.name;

    const stageId = document.createElement("span");
    stageId.className = "stage-id " + statusClass(row.state);
    stageId.textContent = row.stage + (row.state === "skipped" ? " (skipped)" : "");

    li.append(icon, name, stageId);

    if (row.workstreams && row.workstreams.length > 0) {
      const ws = document.createElement("div");
      ws.className = "workstreams";
      for (const w of row.workstreams) {
        const wRow = document.createElement("div");
        wRow.className = "ws";
        const wIcon = document.createElement("span");
        wIcon.className = statusClass(w.state);
        wIcon.textContent = STATUS_ICONS[w.state] || "•";
        const wRole = document.createElement("span");
        wRole.className = "role";
        wRole.textContent = w.role + (w.host ? ` (${w.host})` : "");
        wRow.append(wIcon, wRole);
        ws.appendChild(wRow);
      }
      if (row.remaining && row.remaining.length > 0) {
        const r = document.createElement("div");
        r.className = "ws";
        r.textContent = `pending: ${row.remaining.join(", ")}`;
        ws.appendChild(r);
      }
      li.appendChild(ws);
    }

    li.addEventListener("click", () => selectStage(row.stage));
    ol.appendChild(li);
  }
}

function statusClass(state) {
  return state ? "status-" + state : "";
}

async function selectStage(stageId) {
  _selectedStage = stageId;
  document.querySelectorAll("ol.stages li").forEach((li) => {
    li.classList.toggle("selected", li.dataset.stage === stageId);
  });
  const detail = $("[data-detail]");
  detail.innerHTML = "";
  const h = document.createElement("h2");
  h.textContent = stageId;
  detail.appendChild(h);
  const gate = await fetchGate(stageId);
  if (!gate) {
    const p = document.createElement("p");
    p.className = "detail-empty";
    p.textContent = "No gate file yet for this stage.";
    detail.appendChild(p);
    return;
  }
  renderGate(detail, gate);
}

function renderGate(parent, gate) {
  for (const [k, label] of [
    ["status", "Status"],
    ["track", "Track"],
    ["workstream", "Workstream"],
    ["host", "Host"],
    ["orchestrator", "Orchestrator"],
    ["timestamp", "Timestamp"],
  ]) {
    if (gate[k] === undefined || gate[k] === null) continue;
    const row = document.createElement("div");
    row.className = "field-row";
    const kEl = document.createElement("span"); kEl.className = "k"; kEl.textContent = label;
    const vEl = document.createElement("span");
    if (k === "status") vEl.className = statusClass(gate.status.toLowerCase());
    vEl.textContent = gate[k];
    row.append(kEl, vEl);
    parent.appendChild(row);
  }
  if (Array.isArray(gate.blockers) && gate.blockers.length > 0) {
    const h = document.createElement("h3"); h.textContent = "Blockers"; parent.appendChild(h);
    const ul = document.createElement("ul"); ul.className = "blockers";
    for (const b of gate.blockers) { const li = document.createElement("li"); li.textContent = b; ul.appendChild(li); }
    parent.appendChild(ul);
  }
  if (Array.isArray(gate.warnings) && gate.warnings.length > 0) {
    const h = document.createElement("h3"); h.textContent = "Warnings"; parent.appendChild(h);
    const ul = document.createElement("ul"); ul.className = "warnings";
    for (const w of gate.warnings) { const li = document.createElement("li"); li.textContent = w; ul.appendChild(li); }
    parent.appendChild(ul);
  }
  if (Array.isArray(gate.workstreams) && gate.workstreams.length > 0) {
    const h = document.createElement("h3"); h.textContent = "Workstreams"; parent.appendChild(h);
    const ul = document.createElement("ul");
    for (const w of gate.workstreams) {
      const li = document.createElement("li");
      const icon = STATUS_ICONS[(w.status || "pending").toLowerCase()] || "•";
      li.innerHTML = `${icon} <code>${w.workstream}</code> on <code>${w.host || "—"}</code>: <span class="${statusClass((w.status || "").toLowerCase())}">${w.status}</span>`;
      ul.appendChild(li);
    }
    parent.appendChild(ul);
  }
  const h = document.createElement("h3"); h.textContent = "Raw gate JSON"; parent.appendChild(h);
  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(gate, null, 2);
  parent.appendChild(pre);
}

function applyState(state) {
  _state = state;
  renderHeader(state);
  renderHosts(state);
  renderPipeline(state);
  if (_selectedStage) {
    // re-fetch the selected gate in case it changed
    selectStage(_selectedStage);
  }
}

function subscribe() {
  setConnection("connecting…", "");
  const es = new EventSource("/api/events");
  es.onopen = () => setConnection("live", "live");
  es.addEventListener("state", (ev) => {
    try { applyState(JSON.parse(ev.data)); } catch (err) { console.error(err); }
  });
  es.addEventListener("heartbeat", () => {
    // Just keep the connection label honest.
    setConnection("live", "live");
  });
  es.onerror = () => {
    setConnection("reconnecting…", "stale");
    // Browser auto-reconnects EventSource; we just update the label.
  };
}

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
