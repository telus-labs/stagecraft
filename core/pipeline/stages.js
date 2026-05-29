// Stage definitions for the ai-dev-team pipeline.
//
// Each stage carries `roles: string[]` (1+). The orchestrator decomposes
// multi-role stages into one workstream dispatch per role; single-role
// stages produce a single dispatch (same code path).
//
// Numbering: 1=requirements, 2=design, 3=clarify, 4=build, 4a=pre-review,
// 4b=security review, 5=peer-review (per-area), 6=tests, 7=sign-off,
// 8=deploy, 9=retro.
//
// Paths are host-neutral. Host adapters rewrite `readFirst` at
// renderStagePrompt time (e.g. AGENTS.md → CLAUDE.md for Claude Code).
// `gate` is the stage-specific skeleton shown to the LLM in the stage
// prompt; base fields (stage, status, orchestrator, track, timestamp,
// blockers, warnings) are filled by the orchestrator at write time.

const STAGES = {
  requirements: {
    stage: "stage-01",
    roles: ["pm"],
    objective: "Turn the feature request into requirements, acceptance criteria, and scope boundaries.",
    readFirst: ["AGENTS.md", ".devteam/rules/pipeline.md", ".devteam/rules/gates.md", "pipeline/context.md"],
    allowedWrites: ["pipeline/brief.md", "pipeline/gates/stage-01.json", "pipeline/context.md"],
    artifact: "pipeline/brief.md",
    template: "brief-template.md",
    gate: {
      acceptance_criteria_count: 0,
      out_of_scope_items: [],
      required_sections_complete: false,
    },
  },
  design: {
    stage: "stage-02",
    roles: ["principal"],
    // G8 — architectural continuity. Principal queries org-shared
    // memory for prior ADRs before designing. The role brief
    // (roles/principal.md) walks the procedure; the gate records
    // which ADRs were consulted (adrs_consulted) and which were
    // explicitly superseded (adrs_superseded) so future audits can
    // verify the architecture didn't silently drift.
    objective: "Convert approved requirements into an implementable architecture and explicit decisions. Consult org-shared ADRs from prior projects before drafting; honor or explicitly supersede prior commitments.",
    readFirst: ["AGENTS.md", ".devteam/rules/pipeline.md", ".devteam/rules/gates.md", "pipeline/context.md", "pipeline/brief.md"],
    allowedWrites: ["pipeline/design-spec.md", "pipeline/adr/", "pipeline/gates/stage-02.json", "pipeline/context.md"],
    artifact: "pipeline/design-spec.md",
    template: "design-spec-template.md",
    gate: {
      arch_approved: false,
      pm_approved: false,
      adr_count: 0,
      adrs_consulted: [],
      adrs_superseded: [],
    },
  },
  clarification: {
    stage: "stage-03",
    roles: ["pm"],
    objective: "Resolve open questions from requirements and design before implementation starts.",
    readFirst: ["AGENTS.md", ".devteam/rules/pipeline.md", ".devteam/rules/gates.md", "pipeline/context.md", "pipeline/brief.md", "pipeline/design-spec.md"],
    allowedWrites: ["pipeline/clarification-log.md", "pipeline/gates/stage-03.json", "pipeline/context.md"],
    artifact: "pipeline/clarification-log.md",
    template: "clarification-template.md",
    gate: {
      open_questions_count: 0,
      answered_questions_count: 0,
      scope_changed: false,
    },
  },
  build: {
    stage: "stage-04",
    roles: ["backend", "frontend", "platform", "qa"],
    objective: "Implement the approved design in role-owned workstreams and record local verification.",
    readFirst: ["AGENTS.md", ".devteam/rules/pipeline.md", ".devteam/rules/gates.md", "pipeline/context.md", "pipeline/brief.md", "pipeline/design-spec.md"],
    allowedWrites: ["src/backend/", "src/frontend/", "src/infra/", "src/tests/", "pipeline/pr-*.md", "pipeline/build-plan.md", "pipeline/gates/stage-04.*.json", "pipeline/gates/stage-04.json"],
    roleWrites: {
      backend:  ["src/backend/", "src/tests/", "pipeline/pr-backend.md",  "pipeline/build-plan.md", "pipeline/gates/stage-04.backend.json",  "pipeline/context.md"],
      frontend: ["src/frontend/",               "pipeline/pr-frontend.md", "pipeline/build-plan.md", "pipeline/gates/stage-04.frontend.json", "pipeline/context.md"],
      platform: ["src/infra/",                  "pipeline/pr-platform.md", "pipeline/build-plan.md", "pipeline/gates/stage-04.platform.json", "pipeline/context.md"],
      qa:       ["src/tests/",                  "pipeline/pr-qa.md",                                  "pipeline/gates/stage-04.qa.json",       "pipeline/context.md"],
    },
    artifact: "pipeline/build-plan.md",
    template: "build-template.md",
    gate: {
      pr_summaries_written: [],
      local_verification: [],
    },
  },
  "pre-review": {
    stage: "stage-04a",
    roles: ["platform"],
    objective: "Run lint, tests, dependency/license review, and trigger checks for security review (stage-04b) + migration safety (stage-04d) before peer review.",
    readFirst: ["AGENTS.md", ".devteam/rules/pipeline.md", ".devteam/rules/gates.md", "pipeline/context.md", "pipeline/build-plan.md", "pipeline/pr-*.md"],
    allowedWrites: ["pipeline/pre-review.md", "pipeline/gates/stage-04a.json", "pipeline/context.md"],
    artifact: "pipeline/pre-review.md",
    template: "pre-review-template.md",
    gate: {
      lint_passed: false,
      tests_passed: false,
      dependency_review_passed: false,
      security_review_required: false,
      migration_safety_required: false,
    },
  },
  "security-review": {
    stage: "stage-04b",
    roles: ["security"],
    // Conditional stage. The orchestrator (in next()) reads
    // stage-04a's gate; runs this only when
    // security_review_required === true. Otherwise it's skipped
    // silently and the pipeline advances to peer-review.
    conditionalOn: { stage: "stage-04a", field: "security_review_required", equals: true },
    objective: "Security review of changes flagged by the Stage 4a security-trigger heuristic. Has veto power; a FAIL here halts the pipeline regardless of peer-review outcomes.",
    readFirst: ["AGENTS.md", ".devteam/rules/pipeline.md", ".devteam/rules/gates.md", "pipeline/context.md", "pipeline/pre-review.md", "pipeline/build-plan.md", "pipeline/pr-*.md"],
    allowedWrites: ["pipeline/security-review.md", "pipeline/gates/stage-04b.json", "pipeline/context.md"],
    artifact: "pipeline/security-review.md",
    template: "review-template.md",
    gate: {
      security_approved: false,
      veto: false,
      triggering_conditions: [],
    },
  },
  "red-team": {
    stage: "stage-04c",
    roles: ["red-team"],
    // Always runs on tracks where it's included (full + hotfix). Not
    // conditional like stage-04b — the goal is uniform adversarial
    // coverage on non-trivial changes. Lighter tracks (quick / nano /
    // config-only / dep-update) skip stage-04c by design.
    //
    // Diversity matters: route red-team to a different host than the
    // builders (`routing.roles.red-team` in .devteam/config.yml).
    objective: "Adversarial review of what was just built. Enumerate concrete attack scenarios, hostile inputs, race conditions, abuse cases, scale failures, downstream effects, and observability gaps the spec didn't cover. Produces must-fix items the implementer addresses before Stage 5 peer review begins.",
    readFirst: ["AGENTS.md", ".devteam/rules/pipeline.md", ".devteam/rules/gates.md", "pipeline/context.md", "pipeline/brief.md", "pipeline/design-spec.md", "pipeline/pr-*.md", "pipeline/pre-review.md", "pipeline/security-review.md"],
    allowedWrites: ["pipeline/red-team-report.md", "pipeline/gates/stage-04c.json", "pipeline/context.md"],
    artifact: "pipeline/red-team-report.md",
    template: "red-team-report-template.md",
    gate: {
      surfaces_walked: [],
      findings_count: 0,
      severity_breakdown: { critical: 0, high: 0, medium: 0, low: 0 },
      must_address_before_peer_review: [],
      noted_for_followup: [],
    },
  },
  "migration-safety": {
    stage: "stage-04d",
    roles: ["migrations"],
    // Conditional stage — fires when stage-04a's pre-review heuristic
    // sets migration_safety_required: true (data-layer changes in the
    // diff: schema files, migration directories, ALTER/CREATE/DROP TABLE
    // DDL, ORM migration files). When the heuristic doesn't fire, this
    // stage is skipped silently and the pipeline advances to peer-review.
    //
    // Has veto power like stage-04b security: a migration without a
    // tested rollback halts the pipeline regardless of any other
    // approval. Backfill plans + dual-write strategies + rollback paths
    // are not optional on changes that touch persistent state.
    conditionalOn: { stage: "stage-04a", field: "migration_safety_required", equals: true },
    objective: "Review the migration-safety story for data-layer changes: schema diff, backfill plan, dual-write strategy, rollback plan, and breaking-change blast radius. Has veto power on unsafe migrations.",
    readFirst: ["AGENTS.md", ".devteam/rules/pipeline.md", ".devteam/rules/gates.md", "pipeline/context.md", "pipeline/brief.md", "pipeline/design-spec.md", "pipeline/pre-review.md", "pipeline/pr-*.md"],
    allowedWrites: ["pipeline/migration-safety.md", "pipeline/gates/stage-04d.json", "pipeline/context.md"],
    artifact: "pipeline/migration-safety.md",
    template: "migration-safety-template.md",
    gate: {
      migration_files: [],
      schema_changes_summary: "",
      breaking_change: false,
      backfill_required: false,
      backfill_strategy: "",
      dual_write_required: false,
      dual_write_strategy: "",
      rollback_plan: "",
      rollback_tested: false,
      migration_approved: false,
      veto: false,
      triggering_conditions: [],
    },
  },
  "peer-review": {
    stage: "stage-05",
    // Workstreams are AREAS being reviewed, not the role doing the
    // reviewing. The dispatched subagent is `reviewer` for all of them
    // (see `subagent` override below). The approval-derivation
    // PostToolUse hook fills each area's workstream gate by parsing
    // per-area "## Review of X" sections in by-<reviewer>.md files.
    roles: ["backend", "frontend", "platform", "qa"],
    subagent: "reviewer",
    objective: "Review peer implementation per area; record findings in pipeline/code-review/by-<reviewer>.md; the approval-derivation hook fills the per-area workstream gates.",
    readFirst: ["AGENTS.md", ".devteam/rules/pipeline.md", ".devteam/rules/gates.md", "pipeline/context.md", "pipeline/pr-*.md"],
    allowedWrites: ["pipeline/code-review/by-<reviewer>.md", "pipeline/gates/stage-05.*.json", "pipeline/gates/stage-05.json"],
    artifact: "pipeline/code-review/by-<reviewer>.md",
    template: "review-template.md",
    gate: {
      review_shape: "matrix",
      required_approvals: 2,
      approvals: [],
      changes_requested: [],
      escalated_to_principal: false,
    },
  },
  qa: {
    stage: "stage-06",
    roles: ["qa"],
    objective: "Verify every acceptance criterion with a one-to-one test mapping and report results.",
    readFirst: ["AGENTS.md", ".devteam/rules/pipeline.md", ".devteam/rules/gates.md", "pipeline/context.md", "pipeline/brief.md", "pipeline/design-spec.md"],
    allowedWrites: ["src/tests/", "pipeline/test-report.md", "pipeline/gates/stage-06.json", "pipeline/context.md"],
    artifact: "pipeline/test-report.md",
    template: "test-report-template.md",
    gate: {
      all_acceptance_criteria_met: false,
      tests_total: 0,
      tests_passed: 0,
      tests_failed: 0,
      failing_tests: [],
      criterion_to_test_mapping_is_one_to_one: false,
    },
  },
  "accessibility-audit": {
    stage: "stage-06b",
    roles: ["qa"],
    objective: "Audit UI changes for WCAG accessibility violations using axe-core / pa11y / lighthouse. PASS requires zero critical + zero serious findings.",
    readFirst: ["AGENTS.md", ".devteam/rules/pipeline.md", ".devteam/rules/gates.md", "pipeline/context.md", "pipeline/brief.md", "pipeline/design-spec.md", "pipeline/test-report.md"],
    allowedWrites: ["pipeline/accessibility-report.md", "pipeline/gates/stage-06b.json", "pipeline/context.md"],
    artifact: "pipeline/accessibility-report.md",
    template: "test-report-template.md",
    gate: {
      audit_method: null,
      wcag_level: "AA",
      violations: { critical: 0, serious: 0, moderate: 0, minor: 0 },
      components_audited: [],
      audit_skipped_reason: null,
    },
  },
  "observability-gate": {
    stage: "stage-06c",
    roles: ["platform"],
    objective: "Verify that every metric / log / trace the design-spec promised is actually emitted by the shipped code. Closes the gap where designs claim instrumentation that never lands.",
    readFirst: ["AGENTS.md", ".devteam/rules/pipeline.md", ".devteam/rules/gates.md", "pipeline/context.md", "pipeline/brief.md", "pipeline/design-spec.md", "pipeline/test-report.md"],
    allowedWrites: ["pipeline/observability-report.md", "pipeline/gates/stage-06c.json", "pipeline/context.md"],
    artifact: "pipeline/observability-report.md",
    template: "test-report-template.md",
    gate: {
      metrics: { required: [], verified: [], gap: [] },
      logs: { required: [], verified: [], gap: [] },
      traces: { required: [], verified: [], gap: [] },
      verification_method: null,
    },
  },
  "sign-off": {
    stage: "stage-07",
    roles: ["pm", "platform"],
    objective: "PM sign-off on QA results; platform prepares deploy runbook.",
    readFirst: ["AGENTS.md", ".devteam/rules/pipeline.md", ".devteam/rules/gates.md", "pipeline/context.md", "pipeline/test-report.md"],
    allowedWrites: ["pipeline/runbook.md", "pipeline/gates/stage-07.*.json", "pipeline/gates/stage-07.json", "pipeline/context.md"],
    roleWrites: {
      pm:       ["pipeline/gates/stage-07.pm.json",       "pipeline/context.md"],
      platform: ["pipeline/runbook.md", "pipeline/gates/stage-07.platform.json", "pipeline/context.md"],
    },
    artifact: "pipeline/runbook.md",
    template: "runbook-template.md",
    gate: {
      pm_signoff: false,
      deploy_requested: false,
      runbook_referenced: false,
    },
  },
  deploy: {
    stage: "stage-08",
    roles: ["platform"],
    objective: "Execute the deploy runbook and record results.",
    readFirst: ["AGENTS.md", ".devteam/rules/pipeline.md", ".devteam/rules/gates.md", "pipeline/context.md", "pipeline/runbook.md"],
    allowedWrites: ["pipeline/deploy-log.md", "pipeline/gates/stage-08.json", "pipeline/context.md"],
    artifact: "pipeline/deploy-log.md",
    template: "pr-summary-template.md",
    gate: {
      deploy_completed: false,
      smoke_tests_passed: false,
      rollback_executed: false,
    },
  },
  retrospective: {
    stage: "stage-09",
    roles: ["principal"],
    objective: "Synthesize the run, capture durable lessons, and close the pipeline loop.",
    readFirst: ["AGENTS.md", ".devteam/rules/pipeline.md", ".devteam/rules/gates.md", "pipeline/context.md", "pipeline/lessons-learned.md"],
    allowedWrites: ["pipeline/retrospective.md", "pipeline/lessons-learned.md", "pipeline/gates/stage-09.json", "pipeline/context.md"],
    artifact: "pipeline/retrospective.md",
    template: "retrospective-template.md",
    gate: {
      severity: "green",
      lessons_promoted: [],
      patterns_harvested: 0,
      contributions_written: [],
    },
  },
};

const TRACKS = ["full", "quick", "nano", "config-only", "dep-update", "hotfix"];

const ORDERED_STAGE_NAMES = [
  "requirements",
  "design",
  "clarification",
  "build",
  "pre-review",
  "security-review",
  "red-team",
  "migration-safety",
  "peer-review",
  "qa",
  "accessibility-audit",
  "observability-gate",
  "sign-off",
  "deploy",
  "retrospective",
];

// Per-track stage lists. Lifted from the prior claude-team.js fork and
// extended over time. Accessibility audit (stage-06b) runs on full,
// quick, and hotfix. Observability gate (stage-06c) runs on full and
// hotfix only — the tracks where the brief actually requires
// observability sections per .devteam/rules/gates.md §Stage 01.
// Security-review (stage-04b) is in the lists but conditional on
// stage-04a's security_review_required flag at runtime.
// Red-team (stage-04c) runs unconditionally on full + hotfix — uniform
// adversarial coverage on non-trivial changes.
// Migration-safety (stage-04d) is conditional on stage-04a's
// migration_safety_required flag — fires when the diff touches the
// data layer (schema files, migrations dir, DDL fragments).
const STAGES_BY_TRACK = {
  full:          ORDERED_STAGE_NAMES,
  quick:         ["requirements", "build", "peer-review", "qa", "accessibility-audit", "sign-off", "deploy", "retrospective"],
  nano:          ["build", "qa"],
  "config-only": ["build", "pre-review", "security-review", "migration-safety", "qa", "sign-off", "deploy"],
  "dep-update":  ["build", "peer-review", "qa", "sign-off", "deploy"],
  hotfix:        ["build", "pre-review", "security-review", "red-team", "migration-safety", "peer-review", "qa", "accessibility-audit", "observability-gate", "sign-off", "deploy", "retrospective"],
};

function stageNames() {
  return Object.keys(STAGES);
}

function orderedStageNames() {
  return ORDERED_STAGE_NAMES.filter((n) => STAGES[n]);
}

function orderedStageNamesForTrack(track = "full") {
  const list = STAGES_BY_TRACK[track];
  if (!list) {
    throw new Error(`Unknown track "${track}". Valid: ${TRACKS.join(", ")}.`);
  }
  return list.filter((n) => STAGES[n]);
}

function isStageInTrack(stageName, track) {
  return orderedStageNamesForTrack(track).includes(stageName);
}

function getStage(name) {
  return STAGES[name] || null;
}

module.exports = {
  STAGES,
  TRACKS,
  ORDERED_STAGE_NAMES,
  STAGES_BY_TRACK,
  stageNames,
  orderedStageNames,
  orderedStageNamesForTrack,
  isStageInTrack,
  getStage,
};
