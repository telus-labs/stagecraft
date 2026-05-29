#!/usr/bin/env node
// dashboard.js — aggregate gate JSON across one or more projects and
// produce a pass-rate report. The local-files counterpart to the OTel
// path (D1): works for anyone who's run a pipeline, no APM backend
// required. Foundation for D4 (per-role per-model performance) and
// D5 (adaptive routing).
//
// Usage:
//   node scripts/dashboard.js                       # cwd/pipeline/gates
//   node scripts/dashboard.js --from path1,path2    # multi-project
//   node scripts/dashboard.js --json                # machine output
//   node scripts/dashboard.js --by stage|host|role  # default: stage
//   node scripts/dashboard.js --since 2026-01-01    # filter by timestamp
//
// Each --from path can be either a pipeline/gates/ directory or any
// directory containing one — we auto-detect.

const fs = require("node:fs");
const path = require("node:path");

function parseArgs(argv) {
  const args = {
    from: [process.cwd()],
    json: false,
    by: "stage",
    since: null,
    view: "rate", // "rate" (default) or "cost"
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--from") args.from = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (argv[i] === "--json") args.json = true;
    else if (argv[i] === "--by") args.by = argv[++i];
    else if (argv[i] === "--view") args.view = argv[++i];
    else if (argv[i] === "--since") args.since = argv[++i];
    else if (argv[i] === "-h" || argv[i] === "--help") { args.help = true; }
  }
  if (!["stage", "host", "role", "status"].includes(args.by)) {
    process.stderr.write(`Invalid --by ${args.by}. Choose: stage / host / role / status.\n`);
    process.exit(2);
  }
  if (!["rate", "cost"].includes(args.view)) {
    process.stderr.write(`Invalid --view ${args.view}. Choose: rate / cost.\n`);
    process.exit(2);
  }
  return args;
}

// ---------------------------------------------------------------------------
// Gate loading
// ---------------------------------------------------------------------------

function findGatesDir(root) {
  // Accept either a /pipeline/gates dir or any ancestor containing one.
  if (path.basename(root) === "gates" && fs.existsSync(path.join(root, "..", "..", "pipeline", "gates")) === false) {
    return root;
  }
  const direct = path.join(root, "pipeline", "gates");
  if (fs.existsSync(direct)) return direct;
  return null;
}

function loadGatesFrom(root) {
  const dir = findGatesDir(root);
  if (!dir) return { source: root, gates: [], warning: `no pipeline/gates/ under ${root}` };
  const gates = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const gate = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      gate._file = f;
      gate._source = root;
      gates.push(gate);
    } catch { /* skip malformed */ }
  }
  return { source: root, gates };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function emptyCounts() {
  return { PASS: 0, WARN: 0, FAIL: 0, ESCALATE: 0, total: 0 };
}

function bump(rec, status) {
  if (!rec[status]) rec[status] = 0;
  rec[status]++;
  rec.total++;
}

function passRate(rec) {
  if (rec.total === 0) return 0;
  // PASS + WARN both count as "advanced the pipeline" — that's the
  // operational pass rate. FAIL/ESCALATE are the failures we care
  // about reducing.
  return ((rec.PASS + rec.WARN) / rec.total) * 100;
}

function aggregate(gates, byKey) {
  // Expand merged stage gates into their constituent workstreams so
  // per-host / per-role attribution works for multi-role stages.
  const expanded = [];
  for (const g of gates) {
    if (Array.isArray(g.workstreams) && g.workstreams.length > 0) {
      // Merged stage gate — count each workstream individually.
      for (const w of g.workstreams) {
        expanded.push({ ...w, stage: g.stage, timestamp: g.timestamp, _file: g._file });
      }
    } else {
      expanded.push(g);
    }
  }

  const groups = new Map();
  for (const g of expanded) {
    let key;
    switch (byKey) {
      case "stage":  key = g.stage || "(no stage)"; break;
      case "host":   key = g.host || "(no host)"; break;
      case "role":   key = g.workstream || "(no role)"; break;
      case "status": key = g.status || "(no status)"; break;
    }
    if (!groups.has(key)) groups.set(key, emptyCounts());
    bump(groups.get(key), g.status);
  }
  return groups;
}

function overall(gates) {
  const rec = emptyCounts();
  for (const g of gates) {
    if (Array.isArray(g.workstreams) && g.workstreams.length > 0) {
      for (const w of g.workstreams) bump(rec, w.status);
    } else {
      bump(rec, g.status);
    }
  }
  return rec;
}

// Cost aggregation — sums tokens / dollars / duration per group key.
// Like aggregate(), expands merged stage gates into workstreams so per-
// host / per-role attribution is correct.
function emptyCostRec() {
  return {
    count: 0,
    tokens_in: 0,
    tokens_out: 0,
    cost_usd: 0,
    duration_ms: 0,
    has_cost: 0,      // how many of count had cost_usd
    has_tokens: 0,    // how many of count had tokens_in + tokens_out
    has_duration: 0,  // how many of count had duration_ms
  };
}

function bumpCost(rec, w) {
  rec.count += 1;
  if (typeof w.tokens_in === "number") { rec.tokens_in += w.tokens_in; rec.has_tokens += 1; }
  if (typeof w.tokens_out === "number") { rec.tokens_out += w.tokens_out; }
  if (typeof w.cost_usd === "number") { rec.cost_usd += w.cost_usd; rec.has_cost += 1; }
  if (typeof w.duration_ms === "number") { rec.duration_ms += w.duration_ms; rec.has_duration += 1; }
}

function aggregateCost(gates, byKey) {
  const expanded = [];
  for (const g of gates) {
    if (Array.isArray(g.workstreams) && g.workstreams.length > 0) {
      for (const w of g.workstreams) {
        expanded.push({ ...w, stage: g.stage, timestamp: g.timestamp, _file: g._file });
      }
    } else {
      expanded.push(g);
    }
  }
  const groups = new Map();
  for (const g of expanded) {
    let key;
    switch (byKey) {
      case "stage":  key = g.stage || "(no stage)"; break;
      case "host":   key = g.host || "(no host)"; break;
      case "role":   key = g.workstream || "(no role)"; break;
      case "status": key = g.status || "(no status)"; break;
    }
    if (!groups.has(key)) groups.set(key, emptyCostRec());
    bumpCost(groups.get(key), g);
  }
  return groups;
}

function overallCost(gates) {
  const rec = emptyCostRec();
  for (const g of gates) {
    if (Array.isArray(g.workstreams) && g.workstreams.length > 0) {
      for (const w of g.workstreams) bumpCost(rec, w);
    } else {
      bumpCost(rec, g);
    }
  }
  return rec;
}

function filterSince(gates, sinceIso) {
  if (!sinceIso) return gates;
  const since = new Date(sinceIso).getTime();
  if (Number.isNaN(since)) {
    process.stderr.write(`Invalid --since "${sinceIso}"; expected ISO-8601 (e.g. 2026-01-01).\n`);
    process.exit(2);
  }
  return gates.filter((g) => {
    if (!g.timestamp) return true; // keep gates with no timestamp
    return new Date(g.timestamp).getTime() >= since;
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function bar(rec, width = 30) {
  // Stacked unicode bar — PASS green / WARN yellow / FAIL red / ESCALATE
  // dark-red. Renders well in a terminal that supports unicode + colors,
  // gracefully degrades to plain blocks in plain output.
  if (rec.total === 0) return "(no data)";
  const p = Math.round((rec.PASS / rec.total) * width);
  const w = Math.round((rec.WARN / rec.total) * width);
  const f = Math.round((rec.FAIL / rec.total) * width);
  const e = width - p - w - f;
  return "▰".repeat(Math.max(0, p))
    + "▱".repeat(Math.max(0, w))
    + "▨".repeat(Math.max(0, f))
    + "▩".repeat(Math.max(0, e));
}

function renderMarkdown(args, allGates, overallRec, grouped) {
  const out = [];
  out.push(`# devteam dashboard\n`);
  out.push(`Generated: ${new Date().toISOString()}`);
  out.push(`Sources: ${args.from.map((s) => `\`${s}\``).join(", ")}`);
  if (args.since) out.push(`Since: ${args.since}`);
  out.push(`Grouping: ${args.by}`);
  out.push("");

  out.push(`## Overall`);
  out.push(`Total gates: ${overallRec.total}`);
  if (overallRec.total === 0) {
    out.push(`\n_No gates found. Pass \`--from <project-root>\` if the pipeline lives elsewhere._`);
    return out.join("\n") + "\n";
  }
  out.push(`Pass rate (PASS+WARN / total): **${passRate(overallRec).toFixed(1)}%**`);
  out.push(``);
  out.push(`| Status | Count | % |`);
  out.push(`|---|---:|---:|`);
  for (const s of ["PASS", "WARN", "FAIL", "ESCALATE"]) {
    const n = overallRec[s] || 0;
    const pct = overallRec.total > 0 ? ((n / overallRec.total) * 100).toFixed(1) : "0.0";
    out.push(`| ${s} | ${n} | ${pct}% |`);
  }
  out.push("");

  out.push(`## By ${args.by}`);
  out.push("");
  out.push(`| ${capitalize(args.by)} | Total | PASS | WARN | FAIL | ESC | Pass rate | Distribution |`);
  out.push(`|---|---:|---:|---:|---:|---:|---:|---|`);
  const entries = [...grouped.entries()].sort((a, b) => b[1].total - a[1].total);
  for (const [key, rec] of entries) {
    const rate = passRate(rec).toFixed(0) + "%";
    out.push(`| ${key} | ${rec.total} | ${rec.PASS || 0} | ${rec.WARN || 0} | ${rec.FAIL || 0} | ${rec.ESCALATE || 0} | ${rate} | \`${bar(rec, 24)}\` |`);
  }
  out.push("");
  out.push(`Legend: ▰ PASS, ▱ WARN, ▨ FAIL, ▩ ESCALATE`);
  return out.join("\n") + "\n";
}

function capitalize(s) { return s[0].toUpperCase() + s.slice(1); }

// Format a millisecond duration as the most informative human string.
function formatDuration(ms) {
  if (!ms || ms === 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

const { formatUsd } = require(path.join("..", "core", "pricing"));

function renderCostMarkdown(args, allGates, overallCostRec, groupedCost) {
  const out = [];
  out.push(`# devteam dashboard — cost view\n`);
  out.push(`Generated: ${new Date().toISOString()}`);
  out.push(`Sources: ${args.from.map((s) => `\`${s}\``).join(", ")}`);
  if (args.since) out.push(`Since: ${args.since}`);
  out.push(`Grouping: ${args.by}`);
  out.push("");

  out.push(`## Overall`);
  out.push(`Workstreams counted: ${overallCostRec.count}`);
  if (overallCostRec.count === 0) {
    out.push(`\n_No data._`);
    return out.join("\n") + "\n";
  }
  out.push(`With cost data: ${overallCostRec.has_cost} / ${overallCostRec.count}`);
  out.push(`Total cost: **${formatUsd(overallCostRec.cost_usd)}**`);
  out.push(`Total tokens: ${overallCostRec.tokens_in.toLocaleString()} in + ${overallCostRec.tokens_out.toLocaleString()} out`);
  out.push(`Total duration: ${formatDuration(overallCostRec.duration_ms)}`);
  out.push("");

  out.push(`## By ${args.by}`);
  out.push("");
  out.push(`| ${capitalize(args.by)} | # | Cost | Tokens in | Tokens out | Duration | Cost/run |`);
  out.push(`|---|---:|---:|---:|---:|---:|---:|`);
  const entries = [...groupedCost.entries()].sort((a, b) => b[1].cost_usd - a[1].cost_usd);
  for (const [key, rec] of entries) {
    const meanCost = rec.has_cost > 0 ? rec.cost_usd / rec.has_cost : null;
    out.push(`| ${key} | ${rec.count} | ${formatUsd(rec.cost_usd)} | ${rec.tokens_in.toLocaleString()} | ${rec.tokens_out.toLocaleString()} | ${formatDuration(rec.duration_ms)} | ${formatUsd(meanCost)} |`);
  }
  out.push("");
  out.push(`_Cost is computed by core/pricing.js from \`tokens_in\` + \`tokens_out\` + \`model\` on each gate. Gates without those fields contribute to the count but not to the cost total — see "With cost data" in the Overall section above._`);
  return out.join("\n") + "\n";
}

function renderCostJSON(args, allGates, overallCostRec, groupedCost) {
  return JSON.stringify({
    generated_at: new Date().toISOString(),
    sources: args.from,
    since: args.since,
    by: args.by,
    view: "cost",
    overall: overallCostRec,
    groups: [...groupedCost.entries()].map(([key, rec]) => ({ key, ...rec })),
  }, null, 2);
}

function renderJSON(args, allGates, overallRec, grouped) {
  return JSON.stringify({
    generated_at: new Date().toISOString(),
    sources: args.from,
    since: args.since,
    by: args.by,
    overall: { ...overallRec, pass_rate: passRate(overallRec) },
    groups: [...grouped.entries()].map(([key, rec]) => ({
      key, ...rec, pass_rate: passRate(rec),
    })),
  }, null, 2);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function usage() {
  console.log(`dashboard — pipeline rollup (pass-rate or cost)

Usage:
  node scripts/dashboard.js                       Read cwd/pipeline/gates/ (default --view rate).
  node scripts/dashboard.js --from p1,p2,...      One or more project roots.
  node scripts/dashboard.js --by stage|host|role|status  Group rows. Default: stage.
  node scripts/dashboard.js --view rate|cost      Default rate; cost requires tokens_in/out/model on gates.
  node scripts/dashboard.js --since YYYY-MM-DD    Filter by gate timestamp.
  node scripts/dashboard.js --json                Machine-readable output.

Cost view note:
  Cost data is opt-in per gate. The adapter or agent writes tokens_in,
  tokens_out, and model into the gate JSON; core/pricing.js converts
  to USD via its pricing table. Gates without those fields are counted
  but contribute zero to the cost total.
`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage(); return; }

  let all = [];
  const warnings = [];
  for (const src of args.from) {
    const loaded = loadGatesFrom(src);
    all.push(...loaded.gates);
    if (loaded.warning) warnings.push(loaded.warning);
  }
  all = filterSince(all, args.since);

  for (const w of warnings) process.stderr.write(`[dashboard] ⚠️  ${w}\n`);

  if (args.view === "cost") {
    const overallCostRec = overallCost(all);
    const groupedCost = aggregateCost(all, args.by);
    if (args.json) console.log(renderCostJSON(args, all, overallCostRec, groupedCost));
    else console.log(renderCostMarkdown(args, all, overallCostRec, groupedCost));
    return;
  }

  const overallRec = overall(all);
  const grouped = aggregate(all, args.by);

  if (args.json) {
    console.log(renderJSON(args, all, overallRec, grouped));
  } else {
    console.log(renderMarkdown(args, all, overallRec, grouped));
  }
}

if (require.main === module) main();

module.exports = {
  loadGatesFrom,
  aggregate,
  overall,
  passRate,
  filterSince,
  renderMarkdown,
  renderJSON,
  // D6 cost view exports
  aggregateCost,
  overallCost,
  emptyCostRec,
  bumpCost,
  renderCostMarkdown,
  renderCostJSON,
  formatDuration,
};
