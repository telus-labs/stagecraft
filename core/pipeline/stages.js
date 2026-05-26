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
    objective: "Convert approved requirements into an implementable architecture and explicit decisions.",
    readFirst: ["AGENTS.md", ".devteam/rules/pipeline.md", ".devteam/rules/gates.md", "pipeline/context.md", "pipeline/brief.md"],
    allowedWrites: ["pipeline/design-spec.md", "pipeline/adr/", "pipeline/gates/stage-02.json", "pipeline/context.md"],
    artifact: "pipeline/design-spec.md",
    template: "design-spec-template.md",
    gate: {
      arch_approved: false,
      pm_approved: false,
      adr_count: 0,
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
    objective: "Run lint, tests, dependency/license review, and security-trigger checks before peer review.",
    readFirst: ["AGENTS.md", ".devteam/rules/pipeline.md", ".devteam/rules/gates.md", "pipeline/context.md", "pipeline/build-plan.md", "pipeline/pr-*.md"],
    allowedWrites: ["pipeline/pre-review.md", "pipeline/security-review.md", "pipeline/gates/stage-04a.json", "pipeline/context.md"],
    artifact: "pipeline/pre-review.md",
    template: "pre-review-template.md",
    gate: {
      lint_passed: false,
      tests_passed: false,
      dependency_review_passed: false,
      security_review_required: false,
    },
  },
  "peer-review": {
    stage: "stage-05",
    roles: ["reviewer"],
    objective: "Review peer implementation notes, record findings, and derive deterministic approval gates. Dispatched per area; one workstream per reviewed area.",
    readFirst: ["AGENTS.md", ".devteam/rules/pipeline.md", ".devteam/rules/gates.md", "pipeline/context.md", "pipeline/pr-*.md"],
    allowedWrites: ["pipeline/code-review/by-<area>.md", "pipeline/gates/stage-05.*.json", "pipeline/gates/stage-05.json"],
    artifact: "pipeline/code-review/by-backend.md",
    template: "review-template.md",
    gate: {
      area: null,
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
  "peer-review",
  "qa",
  "sign-off",
  "deploy",
  "retrospective",
];

// Per-track stage lists. Lifted verbatim from the prior claude-team.js
// fork — these reflect a year+ of operational tuning over which stages
// are skippable for which kind of change.
const STAGES_BY_TRACK = {
  full:          ORDERED_STAGE_NAMES,
  quick:         ["requirements", "build", "peer-review", "qa", "sign-off", "deploy", "retrospective"],
  nano:          ["build", "qa"],
  "config-only": ["build", "pre-review", "qa", "sign-off", "deploy"],
  "dep-update":  ["build", "peer-review", "qa", "sign-off", "deploy"],
  hotfix:        ["build", "pre-review", "peer-review", "qa", "sign-off", "deploy", "retrospective"],
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
