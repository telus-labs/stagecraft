"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { generateHelp } = require(path.join(__dirname, "..", "flags"));

const name = "reproduce";

const flags = {
  cwd:  { type: "string",  description: "Target project directory" },
  json: { type: "boolean", description: "JSON output" },
  help: { type: "boolean", description: "Show this help" },
};

// C4 — Reproducibility introspection. surface drift in system_prompt_hash.
function run(positional, _flags) {
  if (_flags.help) { console.log(generateHelp("devteam reproduce <stage-id> [options]", flags)); process.exit(0); }
  const cwd = _flags.cwd || process.cwd();
  const stageId = positional[0];
  if (!stageId) {
    console.error("Usage: devteam reproduce <stage-id> [--json]");
    console.error("");
    console.error("Examples:");
    console.error("  devteam reproduce stage-04");
    console.error("  devteam reproduce stage-04.backend");
    console.error("  devteam reproduce stage-02");
    console.error("");
    console.error("Reads pipeline/gates/<stage-id>.json and reports replay readiness:");
    console.error("which reproducibility fields were recorded, what's missing, and (if");
    console.error("the stage is still defined) whether the current rendered prompt's");
    console.error("hash matches what the gate captured.");
    process.exit(2);
  }
  const gateFile = path.join(cwd, "pipeline", "gates", `${stageId}.json`);
  if (!fs.existsSync(gateFile)) {
    console.error(`No gate at ${gateFile}`);
    process.exit(1);
  }
  let gate;
  try { gate = JSON.parse(fs.readFileSync(gateFile, "utf8")); }
  catch (err) { console.error(`Could not parse gate: ${err.message}`); process.exit(1); }

  const { reproducibilityFingerprint, replayReadiness, hashSystemPrompt } =
    require(path.join(__dirname, "..", "..", "reproducibility"));

  const fp = reproducibilityFingerprint(gate);
  const readiness = replayReadiness(gate);

  // Try to compute the CURRENT system_prompt_hash by re-rendering the
  // prompt for the same stage. Only works for top-level stage gates
  // (not per-workstream gates from multi-role stages — those need the
  // role name).
  let currentHash = null;
  let driftCheck = null;
  try {
    const { runStage } = require(path.join(__dirname, "..", "..", "orchestrator"));
    // Walk known stage names; pick the one whose stage field matches.
    const stages = require(path.join(__dirname, "..", "..", "pipeline", "stages"));
    let stageName = null;
    for (const [sName, def] of Object.entries(stages.STAGES)) {
      if (def.stage === (gate.stage || stageId)) { stageName = sName; break; }
    }
    if (stageName) {
      const result = runStage(stageName, { cwd, feature: "<reproducibility probe>" });
      // Pick the workstream whose role matches the gate's workstream
      // (or the first one for stage-level gates).
      const ws = gate.workstream
        ? result.workstreams.find((w) => w.role === gate.workstream) || result.workstreams[0]
        : result.workstreams[0];
      if (ws) {
        currentHash = hashSystemPrompt(ws.prompt);
        if (fp.system_prompt_hash && currentHash) {
          driftCheck = {
            gateHash: fp.system_prompt_hash,
            currentHash,
            match: fp.system_prompt_hash === currentHash,
          };
        }
      }
    }
  } catch (err) {
    // Re-render may fail (un-init'd target, missing config, etc.) —
    // that's not fatal for the reproduce command. Report what we
    // have without drift comparison.
    if (_flags.json) { /* swallow */ }
    else process.stderr.write(`[reproduce] could not re-render prompt for drift check: ${err.message}\n`);
  }

  if (_flags.json) {
    console.log(JSON.stringify({
      gate_file: gateFile,
      fingerprint: fp,
      readiness,
      drift: driftCheck,
    }, null, 2));
    return;
  }

  console.log(`Reproducibility report — ${gateFile}`);
  console.log("");
  console.log(`Recorded by orchestrator: ${fp.orchestrator || "(unknown)"}`);
  console.log(`Recorded at:              ${fp.timestamp || "(unknown)"}`);
  console.log(`Stage / workstream / host: ${fp.stage} / ${fp.workstream || "(stage-level)"} / ${fp.host || "(merged)"}`);
  console.log("");
  console.log(`Replay readiness: ${readiness.level.toUpperCase()} — ${readiness.reason}`);
  console.log("");
  console.log(`Recorded fields:`);
  const labels = {
    model:              "model",
    model_version:      "model_version",
    temperature:        "temperature",
    seed:               "seed",
    max_tokens:         "max_tokens",
    system_prompt_hash: "system_prompt_hash",
    tools_hash:         "tools_hash",
  };
  for (const [field, label] of Object.entries(labels)) {
    const v = fp[field];
    console.log(`  ${label.padEnd(20)} ${v === null ? "—" : v}`);
  }
  if (driftCheck) {
    console.log("");
    console.log(`Drift check (current rendered prompt vs gate hash):`);
    if (driftCheck.match) {
      console.log(`  ✅ system_prompt_hash matches — same prompt would render today.`);
    } else {
      console.log(`  ⚠️  DRIFT — the rendered prompt has changed since this gate was written.`);
      console.log(`     gate:    ${driftCheck.gateHash}`);
      console.log(`     current: ${driftCheck.currentHash}`);
      console.log(`     Likely causes: role brief, skill, or rules file edits.`);
    }
  } else if (fp.system_prompt_hash) {
    console.log("");
    console.log(`Drift check: skipped (couldn't re-render prompt — see stderr).`);
  }
}

module.exports = { name, flags, run };
