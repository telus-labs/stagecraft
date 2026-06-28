// Pipeline journal — chronological event timeline from on-disk state.
// Used by `devteam log` to render a human-readable narrative of what
// the pipeline has done so far, in both headless and user-driven modes.
//
// Events come from two sources, both keyed on file mtime:
//   1. Gate files (pipeline/gates/*.json) — the structured record of
//      each stage's outcome.
//   2. Artifact files (pipeline/brief.md, pipeline/pr-*.md,
//      pipeline/code-review/by-*.md, etc.) — what each role wrote.
//
// Together they answer: "what happened, in what order, with what
// outcome?" The UI dashboard renders the same data live; this module
// renders it for the terminal.

const fs = require("node:fs");
const path = require("node:path");

// Artifact files we surface in the timeline. Each entry pairs a path
// pattern with the role that owns it — used for attribution in the
// rendered line ("pr-backend.md (dev-backend)"). Order doesn't matter;
// the first matching pattern wins.
const ARTIFACT_PATTERNS = [
  { re: /^pipeline\/brief\.md$/,                    owner: "pm",        kind: "brief" },
  { re: /^pipeline\/design-spec\.md$/,              owner: "principal", kind: "design" },
  { re: /^pipeline\/adr\/.+\.md$/,                  owner: "principal", kind: "adr" },
  { re: /^pipeline\/clarification-log\.md$/,        owner: "pm",        kind: "clarification" },
  { re: /^pipeline\/spec\.feature$/,                owner: "pm",        kind: "spec" },
  { re: /^pipeline\/build-plan\.md$/,               owner: "principal", kind: "build-plan" },
  { re: /^pipeline\/pr-backend\.md$/,               owner: "backend",   kind: "pr" },
  { re: /^pipeline\/pr-frontend\.md$/,              owner: "frontend",  kind: "pr" },
  { re: /^pipeline\/pr-platform\.md$/,              owner: "platform",  kind: "pr" },
  { re: /^pipeline\/pr-qa\.md$/,                    owner: "qa",        kind: "pr" },
  { re: /^pipeline\/pre-review\.md$/,               owner: "platform",  kind: "pre-review" },
  { re: /^pipeline\/code-review\/by-[a-z0-9-]+\.md$/, owner: null,     kind: "review" }, // owner derived from filename
  { re: /^pipeline\/red-team-report\.md$/,          owner: "red-team",  kind: "red-team" },
  { re: /^pipeline\/migration-safety\.md$/,         owner: "migrations", kind: "migration-safety" },
  { re: /^pipeline\/test-report\.md$/,              owner: "qa",        kind: "test-report" },
  { re: /^pipeline\/accessibility-report\.md$/,     owner: "qa",        kind: "accessibility" },
  { re: /^pipeline\/observability-report\.md$/,     owner: "platform",  kind: "observability" },
  { re: /^pipeline\/verification-report\.md$/,      owner: "verifier",  kind: "verification" },
  { re: /^pipeline\/runbook\.md$/,                  owner: "platform",  kind: "runbook" },
  { re: /^pipeline\/deploy-log\.md$/,               owner: "platform",  kind: "deploy" },
  { re: /^pipeline\/retrospective\.md$/,            owner: "principal", kind: "retrospective" },
  { re: /^pipeline\/lessons-learned\.md$/,          owner: "principal", kind: "lessons" },
];

// Skip these — they're orchestrator-managed and would flood the timeline.
const SKIP_PATHS = new Set([
  "pipeline/context.md",      // mutated by every agent + the validator
  "pipeline/changed-files.txt", // ephemeral input to the security heuristic
]);

const STATUS_ICONS = {
  PASS:     "✓",
  WARN:     "⚠",
  FAIL:     "✗",
  ESCALATE: "🚨",
};

/**
 * Read every gate and artifact file under `pipeline/` (relative to cwd)
 * and return a chronologically-sorted list of events. Each event has:
 *
 *   {
 *     kind: "gate" | "artifact",
 *     path: <absolute>,
 *     mtime: <Date>,
 *     gate?: <parsed gate JSON>,      // when kind === "gate"
 *     owner?: <role>, artifactKind?: <kind>,  // when kind === "artifact"
 *   }
 *
 * changeId: when set (B9 bounded mode), reads from
 * pipeline/changes/<changeId>/ instead of pipeline/.
 */
function buildEvents(cwd, changeId) {
  const events = [];
  const { pipelineRoot } = require("../paths");
  const pipelineDir = pipelineRoot(cwd, changeId || null);
  if (!fs.existsSync(pipelineDir)) return events;

  // Epoch: mtime of pipeline/brief.md anchors the current pipeline run.
  // Artifacts older than the brief belong to a prior run and are suppressed.
  // devteam restart clears gate files but not artifacts; the brief is always
  // (re)written at the start of a new feature, so it is the right anchor.
  // When no brief exists yet (fresh project) epochMs stays 0 — no filtering.
  let epochMs = 0;
  try {
    epochMs = fs.statSync(path.join(pipelineDir, "brief.md")).mtimeMs;
  } catch { /* no brief yet */ }

  // Gate events.
  const gatesDir = path.join(pipelineDir, "gates");
  if (fs.existsSync(gatesDir)) {
    for (const entry of fs.readdirSync(gatesDir)) {
      if (!entry.endsWith(".json")) continue;
      const full = path.join(gatesDir, entry);
      let gate;
      try {
        gate = JSON.parse(fs.readFileSync(full, "utf8"));
      } catch {
        continue; // malformed gates are surfaced by the validator, not here
      }
      events.push({
        kind: "gate",
        path: full,
        mtime: fs.statSync(full).mtime,
        gate,
      });
    }
  }

  // Artifact events. Walk pipeline/ but skip pipeline/gates/ (already
  // covered) and pipeline/logs/ (would be self-referential noise).
  // Pass pipelineDir as relBase so ARTIFACT_PATTERNS (which all start with
  // "pipeline/") match correctly in both in-place and bounded mode.
  walkArtifacts(pipelineDir, pipelineDir, events, epochMs);

  return events.sort((a, b) => a.mtime - b.mtime);
}

// relBase: root of the run's pipeline tree. Artifact relative paths are
// computed as "pipeline/" + path.relative(relBase, file) so ARTIFACT_PATTERNS
// match in both in-place (relBase = cwd/pipeline) and bounded
// (relBase = cwd/pipeline/changes/<id>) mode.
function walkArtifacts(dir, relBase, out, epochMs = 0) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "gates" || e.name === "logs") continue;
      walkArtifacts(full, relBase, out, epochMs);
      continue;
    }
    // Normalise to "pipeline/<relative-from-pipelineRoot>" so ARTIFACT_PATTERNS
    // work identically in in-place and bounded mode.
    const rel = "pipeline/" + path.relative(relBase, full).replace(/\\/g, "/");
    if (SKIP_PATHS.has(rel)) continue;
    const match = ARTIFACT_PATTERNS.find((p) => p.re.test(rel));
    if (!match) continue;
    const stat = fs.statSync(full);
    // Suppress artifacts from prior pipeline runs (written before the current brief).
    if (epochMs > 0 && stat.mtimeMs < epochMs) continue;
    let owner = match.owner;
    if (owner === null && match.kind === "review") {
      const m = e.name.match(/^by-([a-z0-9-]+)\.md$/);
      if (m) owner = m[1];
    }
    out.push({
      kind: "artifact",
      path: full,
      mtime: stat.mtime,
      owner,
      artifactKind: match.kind,
    });
  }
}

/**
 * Render a gate event as a one-line summary with key fields per stage.
 * Returns { icon, label, status, extras } — caller formats.
 */
function summarizeGate(gate) {
  const stagePart = gate.stage ?? "unknown";
  const id = gate.workstream
    ? `${stagePart}.${gate.workstream}`
    : stagePart;
  const status = gate.status || "?";
  const icon = STATUS_ICONS[status] || "•";
  const extras = stageExtras(gate);
  return { icon, label: id, status, extras };
}

function stageExtras(gate) {
  const stage = gate.stage;
  const parts = [];

  if (stage === "stage-01") {
    if (gate.acceptance_criteria_count != null) parts.push(`${gate.acceptance_criteria_count} AC`);
    if (gate.open_questions_count != null) parts.push(`${gate.open_questions_count} Q`);
  } else if (stage === "stage-02") {
    if (Array.isArray(gate.adrs_consulted)) parts.push(`${gate.adrs_consulted.length} ADRs consulted`);
    if (Array.isArray(gate.adrs_superseded) && gate.adrs_superseded.length > 0) {
      parts.push(`${gate.adrs_superseded.length} ADRs superseded`);
    }
  } else if (stage === "stage-03b") {
    if (gate.criteria_count != null) parts.push(`${gate.criteria_count} AC`);
    if (gate.scenarios_count != null) parts.push(`${gate.scenarios_count} scenarios`);
    if (Array.isArray(gate.drift) && gate.drift.length > 0) parts.push(`drift: ${gate.drift.length}`);
  } else if (stage === "stage-04") {
    if (Array.isArray(gate.workstreams)) {
      const passed = gate.workstreams.filter((w) => w.status === "PASS").length;
      parts.push(`${passed}/${gate.workstreams.length} workstreams`);
    }
  } else if (stage === "stage-04a") {
    if (gate.lint_passed != null) parts.push(`lint ${gate.lint_passed ? "✓" : "✗"}`);
    if (gate.tests_passed != null) parts.push(`tests ${gate.tests_passed ? "✓" : "✗"}`);
    if (gate.dependency_review_passed != null) parts.push(`deps ${gate.dependency_review_passed ? "✓" : "✗"}`);
  } else if (stage === "stage-04c") {
    if (gate.findings_count != null) parts.push(`${gate.findings_count} findings`);
    if (Array.isArray(gate.must_address_before_peer_review) && gate.must_address_before_peer_review.length > 0) {
      parts.push(`${gate.must_address_before_peer_review.length} must-fix`);
    }
  } else if (stage === "stage-04d") {
    if (gate.veto) parts.push("VETO");
  } else if (stage === "stage-05") {
    if (Array.isArray(gate.workstreams)) {
      parts.push(`${gate.workstreams.length} reviewers`);
    } else if (Array.isArray(gate.approvals)) {
      parts.push(`${gate.approvals.length}/${gate.required_approvals ?? 2} approvals`);
    }
  } else if (stage === "stage-06") {
    if (gate.tests_total != null) parts.push(`${gate.tests_passed ?? 0}/${gate.tests_total} tests`);
    if (gate.all_acceptance_criteria_met != null) parts.push(`AC ${gate.all_acceptance_criteria_met ? "✓" : "✗"}`);
  } else if (stage === "stage-06b") {
    if (gate.violations && typeof gate.violations === "object") {
      const v = gate.violations;
      const total = (v.critical || 0) + (v.serious || 0) + (v.moderate || 0) + (v.minor || 0);
      parts.push(`${total} WCAG findings`);
    }
  } else if (stage === "stage-06e") {
    if (typeof gate.budget_exceeded === "boolean") parts.push(gate.budget_exceeded ? "budget exceeded" : "budgets met");
    if (Array.isArray(gate.checks_performed) && gate.checks_performed.length > 0) {
      parts.push(gate.checks_performed.join("+"));
    }
    if (gate.lighthouse && gate.lighthouse.score != null) {
      parts.push(`LH ${Math.round(gate.lighthouse.score * 100)}`);
    }
  } else if (stage === "stage-07") {
    if (gate.auto_from_stage_06) parts.push("auto-fold");
    if (gate.pm_signoff) parts.push("PM signoff");
  } else if (stage === "stage-08") {
    if (gate.deploy_adapter) parts.push(gate.deploy_adapter);
    if (gate.smoke_test_passed != null) parts.push(`smoke ${gate.smoke_test_passed ? "✓" : "✗"}`);
  }

  if (Array.isArray(gate.blockers) && gate.blockers.length > 0) {
    parts.push(`${gate.blockers.length} blocker${gate.blockers.length === 1 ? "" : "s"}`);
  }
  if (Array.isArray(gate.warnings) && gate.warnings.length > 0) {
    parts.push(`${gate.warnings.length} warning${gate.warnings.length === 1 ? "" : "s"}`);
  }

  return parts.join(", ");
}

/**
 * Render an artifact event. Returns { rel, lines, owner, kind }.
 */
function summarizeArtifact(event, cwd) {
  const rel = path.relative(cwd, event.path).replace(/\\/g, "/");
  let lines = 0;
  try {
    const content = fs.readFileSync(event.path, "utf8");
    lines = content.split("\n").length;
  } catch { /* unreadable — show 0 */ }
  return { rel, lines, owner: event.owner, kind: event.artifactKind };
}

module.exports = {
  buildEvents,
  summarizeGate,
  summarizeArtifact,
  ARTIFACT_PATTERNS,
  STATUS_ICONS,
};
