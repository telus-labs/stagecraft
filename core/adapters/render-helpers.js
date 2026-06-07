// Shared rendering helpers used by every host adapter's
// renderStagePrompt. Audit Tier-3: the gate-skeleton + cost telemetry
// + C4 reproducibility lines were copy-pasted across three adapters
// (claude-code, codex, gemini-cli) — ~30 lines of structurally
// identical text per adapter, ~90 lines of duplication total. This
// module is the single source.
//
// The contract: each adapter assembles its own header / objective /
// readFirst / allowedWrites lines (those vary per host because of
// enforcement-level wording), then calls appendGateFooter() to
// append the parts that are genuinely shared.

// Caption for the "Allowed writes" section. The wording reflects
// how the host *actually* enforces the list at runtime — tool-call-
// time (hooks block writes) vs prompt-only (advisory; gate validator
// catches violations post-hoc) vs post-hoc-audit (similar). Each
// adapter declares its level in capabilities.enforces.allowed_writes;
// this helper just renders the right caption.
function allowedWritesCaption(enforcementLevel, hostDisplayName) {
  switch (enforcementLevel) {
    case "tool-call-time":
      return `## Allowed writes (enforced by ${hostDisplayName} hooks at tool-call time)`;
    case "post-hoc-audit":
      return `## Allowed writes (enforced post-hoc by the orchestrator write-audit: unauthorized writes flip the gate to FAIL)`;
    case "prompt-only":
    default:
      return `## Allowed writes (advisory — ${hostDisplayName} enforces this in prompt only; gate validator catches violations post-hoc)`;
  }
}

// Append the gate footer to a partially-assembled prompt. This is the
// last thing every adapter pushes before returning lines.join("\n").
// It writes:
//   - "## Gate to write" heading + path + JSON skeleton
//   - The orchestrator/host attribution line
//   - The cost-telemetry hint
//   - The C4 reproducibility hint with the system_prompt_hash of
//     everything in `lines` up to (but not including) the C4 line.
//
// `lines` is mutated in place. The function returns nothing.
function appendGateFooter(lines, descriptor, ctx, hostName) {
  const { prefixPipelineRelative } = require("../paths");
  const gatePath = prefixPipelineRelative(`pipeline/gates/${descriptor.workstreamId}.json`, descriptor.changeId || null);
  lines.push(`## Gate to write`);
  lines.push(`Write to \`${gatePath}\`. You provide:`);
  lines.push("```json");
  lines.push(JSON.stringify({
    stage: descriptor.stage,
    workstream: descriptor.role,
    status: "PASS|WARN|FAIL|ESCALATE",
    track: ctx.track,
    timestamp: "<ISO-8601>",
    blockers: [],
    warnings: [],
    ...descriptor.expectedGate,
  }, null, 2));
  lines.push("```");
  lines.push(`The orchestrator adds \`"orchestrator": "${ctx.orchestrator}"\` and \`"host": "${hostName}"\` at validation time.`);
  lines.push("");
  lines.push(`Optional cost telemetry: include \`model\`, \`tokens_in\`, \`tokens_out\`, \`duration_ms\` in the gate if measurable. \`scripts/dashboard.js --view cost\` computes USD via \`core/pricing.js\`.`);

  // C4 — hash spans everything we've pushed so far (excluding the C4
  // line itself), so the hash is stable as long as the adapter's
  // header + the shared footer text don't drift.
  const { hashSystemPrompt } = require("../reproducibility");
  const systemPromptHash = hashSystemPrompt(lines.join("\n"));
  lines.push("");
  lines.push(`Optional reproducibility (C4): include \`model_version\`, \`temperature\`, \`seed\`, \`max_tokens\`, \`tools_hash\` in the gate when known. Also stamp \`"system_prompt_hash": "${systemPromptHash}"\` verbatim — that's the hash of this prompt. \`devteam reproduce <stage>\` uses these for audit.`);
}

module.exports = { allowedWritesCaption, appendGateFooter };
