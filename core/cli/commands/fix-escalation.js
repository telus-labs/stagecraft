"use strict";

const path = require("node:path");
const { generateHelp } = require(path.join(__dirname, "..", "flags"));
const { getOrchestrator } = require(path.join(__dirname, "..", "get-orchestrator"));
const _escalation = require(path.join(__dirname, "..", "..", "escalation"));
const renderEscalationApplicatorPrompt = _escalation.renderEscalationApplicatorPrompt;
const loadPrincipalRulings = _escalation.loadPrincipalRulingLines;
const isHttpNativePrincipal = _escalation.isHttpNativePrincipal;

const name = "fix-escalation";

const flags = {
  cwd:      { type: "string",  description: "Target project directory" },
  headless: { type: "boolean", description: "Dispatch via host CLI non-interactively" },
  help:     { type: "boolean", description: "Show this help" },
};

// `devteam fix-escalation [--headless] [--cwd <dir>]`
// Reads PRINCIPAL-RULING entries from pipeline/context.md and dispatches
// an escalation-applicator agent to implement them — fixing gate shapes,
// running devteam stage commands, and merging — so `devteam next` advances.
async function run(positional, _flags) {
  if (_flags.help) { console.log(generateHelp("devteam fix-escalation [options]", flags)); process.exit(0); }
  const cwd = _flags.cwd || process.cwd();

  const rulings = loadPrincipalRulings(cwd);
  if (rulings.length === 0) {
    console.error("devteam fix-escalation: no PRINCIPAL-RULING entries found in pipeline/context.md.");
    console.error("Run `devteam ruling [--target-gate <path>] [--headless]` first to get a ruling.");
    process.exit(2);
  }

  // Find the escalating gate
  let escalatingGate = null;
  try {
    const { next } = getOrchestrator();
    const nr = next({ cwd });
    if (nr.action === "resolve-escalation" && nr.gate) escalatingGate = nr.gate;
  } catch { /* ignore */ }

  const prompt = renderEscalationApplicatorPrompt(cwd, rulings, escalatingGate);

  if (!_flags.headless && !isHttpNativePrincipal(cwd)) {
    // httpNative hosts have no interactive fallback; they always auto-dispatch.
    const onboarding = [
      "════════════════════════════════════════════════════════════════════",
      "  Escalation-applicator prompt",
      "  Paste into Claude Code (or add --headless to run automatically).",
      "════════════════════════════════════════════════════════════════════",
      "",
    ].join("\n");
    process.stderr.write(onboarding);
    console.log(prompt);
    return;
  }

  // Dispatch via the shared in-process helper in core.
  let exitCode;
  try {
    ({ exitCode } = await _escalation.dispatchToPrincipal(cwd, prompt, {
      label: "escalation-applicator",
      allowedWrites: ["pipeline/gates/*.json", "pipeline/code-review/by-*.md", "pipeline/runbook.md"],
    }));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  if (exitCode !== 0) {
    process.stderr.write(`[devteam] escalation-applicator exited ${exitCode}\n`);
    process.exit(exitCode);
  }
  process.stderr.write(`[devteam] escalation-applicator complete.\n`);
}

module.exports = { name, flags, run };
