// Which sections of a role brief belong to which stage.
//
// A role brief (roles/*.md) is written once per role and covers every task
// that role can be handed: pm.md has "On a Brief Request", "On a Sign-off
// Request", "On a Retrospective Task", and four more. Since 37.2 the whole
// brief is inlined into every dispatch prompt, so a stage-01 requirements
// dispatch carried the sign-off and retrospective instructions too — and
// re-sent them on every one of its ~20 model turns. The docs review measured
// role briefs at roughly 40% of dispatch bytes; most of that is sections for
// other stages.
//
// This module is the stage→section map that lets the inlined copy keep only
// the sections for the stage being dispatched. The brief on disk stays
// complete (claude-code subagents read it directly; humans read it too).
//
// Conventions the map relies on:
//   - Task sections are top-level "## On …" headings ("On a Build Task",
//     "On an Executable-Spec Request", "On Chairing a Design Review").
//     Everything else at "## " level — Read First, Writes, Handoff, Standing
//     Rules, Gate Writing Rules, Escalation Triggers, ADR Format, … — is
//     common to every task and is always kept.
//   - "## " lines inside fenced code blocks are examples (the "## Review of
//     backend" review-file format, the ADR skeleton) and never split a
//     section. splitTopLevelSections() is fence-aware for that reason.
//   - A task section may belong to more than one stage ("On a Test Fix Task"
//     is read by a build re-dispatch after QA fails, and by QA itself).
//
// tests/brief-trimming.test.js has a drift guard: every "## On …" heading in
// roles/*.md must match exactly one entry here, so a new task section cannot
// be silently kept for every stage (or dropped from its own).

const BRIEF_TASK_SECTIONS = [
  { match: /^On a Brief Request\b/i,                  stages: ["stage-01"] },
  { match: /^On an Executable-Spec Request\b/i,       stages: ["stage-03b"] },
  { match: /^On a Clarification Request\b/i,          stages: ["stage-03"] },
  { match: /^On a Design Scope-Fit Review\b/i,        stages: ["stage-02"] },
  { match: /^On a Design Draft Request\b/i,           stages: ["stage-02"] },
  { match: /^On Chairing a Design Review\b/i,         stages: ["stage-02"] },
  { match: /^On a Build Task\b/i,                     stages: ["stage-04"] },
  { match: /^On a Test Fix Task\b/i,                  stages: ["stage-04", "stage-06"] },
  { match: /^On a Code Review Task\b/i,               stages: ["stage-05"] },
  { match: /^On a Code Review Escalation\b/i,         stages: ["stage-05"] },
  { match: /^On a Security Review Task\b/i,           stages: ["stage-04b"] },
  { match: /^On a Sign-off Request\b/i,               stages: ["stage-07"] },
  { match: /^On a Post-Deploy Summary Request\b/i,    stages: ["stage-08"] },
  { match: /^On a Retrospective (Task|Contribution Task|Synthesis Task)\b/i, stages: ["stage-09"] },
];

const TASK_HEADING = /^On\b/i;

// Split markdown into [{ heading, lines }] at top-level "## " headings,
// ignoring headings inside ``` fences. The first element (heading null) is
// whatever precedes the first heading — the "# Role" title and intro.
function splitTopLevelSections(markdown) {
  const sections = [{ heading: null, lines: [] }];
  let fenced = false;
  for (const line of String(markdown || "").split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (!fenced && /^## /.test(line)) {
      sections.push({ heading: line.slice(3).trim(), lines: [line] });
      continue;
    }
    sections[sections.length - 1].lines.push(line);
  }
  return sections;
}

function isTaskHeading(heading) {
  return typeof heading === "string" && TASK_HEADING.test(heading);
}

function entryFor(heading) {
  return BRIEF_TASK_SECTIONS.find((e) => e.match.test(heading)) || null;
}

// Keep common sections and the task sections for `stageId`; drop task
// sections that belong to other stages. Returns the trimmed markdown and the
// omitted headings (empty when nothing was dropped, in which case `text` is
// the input unchanged). A task heading the map does not know is kept — the
// drift guard test is what makes that a build failure, not a silent prompt
// change.
function trimBriefForStage(markdown, stageId) {
  if (typeof markdown !== "string" || !stageId) return { text: markdown, omitted: [] };
  const sections = splitTopLevelSections(markdown);
  const kept = [];
  const omitted = [];
  for (const section of sections) {
    if (section.heading === null || !isTaskHeading(section.heading)) { kept.push(section); continue; }
    const entry = entryFor(section.heading);
    if (!entry || entry.stages.includes(stageId)) { kept.push(section); continue; }
    omitted.push(section.heading);
  }
  if (omitted.length === 0) return { text: markdown, omitted };
  const text = kept.map((s) => s.lines.join("\n")).join("\n").replace(/\n{3,}/g, "\n\n");
  return { text, omitted };
}

module.exports = { BRIEF_TASK_SECTIONS, splitTopLevelSections, isTaskHeading, trimBriefForStage };
