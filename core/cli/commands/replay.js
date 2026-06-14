"use strict";

const path = require("node:path");
const { generateHelp } = require(path.join(__dirname, "..", "flags"));
const {
  snapshotGate,
  restoreFromBackup,
  deleteBackup,
  findLeftoverBackups,
  archiveReplayGate,
  clearOriginalGate,
} = require(path.join(__dirname, "..", "..", "gates", "replay-backup"));

const name = "replay";

const flags = {
  cwd:       { type: "string",  description: "Target project directory" },
  json:      { type: "boolean", description: "JSON output" },
  "dry-run": { type: "boolean", description: "Print plan without invoking host" },
  help:      { type: "boolean", description: "Show this help" },
};

// E6 — Replay a past pipeline run. Reads a recorded gate, runs the
// stage headlessly with the CURRENT config, writes the new gate to a
// non-clobbering path, and diffs the two.
function run(positional, _flags) {
  if (_flags.help) { console.log(generateHelp("devteam replay <stage-id> [options]", flags)); process.exit(0); }
  const cwd = _flags.cwd || process.cwd();
  const { loadConfig, checkBoundedFence } = require(path.join(__dirname, "..", "..", "config"));
  checkBoundedFence(loadConfig(cwd), "replay");
  const stageId = positional[0];
  if (!stageId) {
    console.error("Usage: devteam replay <stage-id> [--dry-run] [--json]");
    console.error("");
    console.error("Re-runs a recorded gate's stage with current config and");
    console.error("diffs the result. --dry-run prints the replay plan + drift");
    console.error("check without invoking the host CLI.");
    process.exit(2);
  }

  const gatesDir = path.join(cwd, "pipeline", "gates");

  // On startup, warn if a previous replay left an unfinished backup (crash
  // between dispatch and restore). Offer to restore before proceeding.
  const leftovers = findLeftoverBackups(gatesDir);
  if (leftovers.length > 0) {
    process.stderr.write(
      `[replay] WARNING: found ${leftovers.length} leftover backup(s) from a previous crashed replay:\n`,
    );
    for (const b of leftovers) {
      process.stderr.write(`  ${b.name}  (backup: ${b.backupPath})\n`);
    }
    process.stderr.write(
      "[replay] A crash between dispatch and restore left the original gate replaced on disk.\n" +
      "[replay] To restore: copy each backup file over its original path, then delete the backup.\n" +
      "[replay] Run `devteam replay --restore-backup` (or manually) before replaying again.\n",
    );
    process.exit(1);
  }

  const fs = require("node:fs");
  const originalPath = path.join(gatesDir, `${stageId}.json`);
  if (!fs.existsSync(originalPath)) {
    console.error(`No gate at ${originalPath}`);
    process.exit(1);
  }
  let originalGate;
  try { originalGate = JSON.parse(fs.readFileSync(originalPath, "utf8")); }
  catch (err) { console.error(`Could not parse original gate: ${err.message}`); process.exit(1); }

  const { reproducibilityFingerprint, replayReadiness, hashSystemPrompt } =
    require(path.join(__dirname, "..", "..", "reproducibility"));

  const readiness = replayReadiness(originalGate);
  const originalFp = reproducibilityFingerprint(originalGate);

  // Find the stage definition for the recorded gate's `stage` field.
  const stages = require(path.join(__dirname, "..", "..", "pipeline", "stages"));
  let stageName = null;
  for (const [sName, def] of Object.entries(stages.STAGES)) {
    if (def.stage === (originalGate.stage || stageId.replace(/\..+$/, ""))) { stageName = sName; break; }
  }
  if (!stageName) {
    console.error(`No stage definition matches gate's stage field "${originalGate.stage}". The pipeline definition may have changed since this gate was written.`);
    process.exit(1);
  }

  // Re-render the prompt for drift check (and as the replay input).
  let renderedPrompts;
  try {
    const { runStage } = require(path.join(__dirname, "..", "..", "orchestrator"));
    renderedPrompts = runStage(stageName, { cwd, feature: originalGate.feature || "<replay>" });
  } catch (err) {
    console.error(`Could not re-render prompt for replay: ${err.message}`);
    process.exit(1);
  }

  // Match the workstream — for stage-level gates we use the first
  // workstream, for per-workstream gates we match by role.
  const ws = originalGate.workstream
    ? renderedPrompts.workstreams.find((w) => w.role === originalGate.workstream) || renderedPrompts.workstreams[0]
    : renderedPrompts.workstreams[0];
  const currentPromptHash = hashSystemPrompt(ws.prompt);
  const hashDrift = originalFp.system_prompt_hash && currentPromptHash
    ? originalFp.system_prompt_hash !== currentPromptHash
    : null;

  // Print the plan (always shown, even on --dry-run).
  if (!_flags.json) {
    console.log(`Replay plan — ${originalPath}`);
    console.log("");
    console.log(`  Original gate:`);
    console.log(`    Recorded at:        ${originalFp.timestamp || "(unknown)"}`);
    console.log(`    Orchestrator:       ${originalFp.orchestrator || "(unknown)"}`);
    console.log(`    Host:               ${originalFp.host || "(stage-level, merged)"}`);
    console.log(`    Model:              ${originalFp.model || "(unrecorded)"}`);
    console.log(`    Temperature:        ${originalFp.temperature ?? "(unrecorded)"}`);
    console.log(`    Seed:               ${originalFp.seed ?? "(unrecorded)"}`);
    console.log(`    Replay readiness:   ${readiness.level.toUpperCase()}`);
    console.log("");
    console.log(`  Replay configuration (CURRENT, not pinned):`);
    console.log(`    Host:               ${ws.host}`);
    console.log(`    Stage:              ${ws.descriptor.stage} / ${ws.role}`);
    console.log(`    Workstream id:      ${ws.descriptor.workstreamId}`);
    console.log("");
    if (hashDrift === null) {
      console.log(`  Prompt hash drift:  unknown (original gate didn't record system_prompt_hash)`);
    } else if (hashDrift) {
      console.log(`  Prompt hash drift:  ⚠️  DRIFT`);
      console.log(`    original: ${originalFp.system_prompt_hash}`);
      console.log(`    current:  ${currentPromptHash}`);
      console.log(`    The replay will use the CURRENT prompt — outputs may differ for prompt-level reasons, not just model nondeterminism.`);
    } else {
      console.log(`  Prompt hash drift:  ✅ match — current prompt is identical to the recorded one`);
    }
    console.log("");
  }

  if (_flags.dryRun) {
    if (_flags.json) {
      console.log(JSON.stringify({
        plan: "dry-run",
        original_gate: originalPath,
        stage: stageName,
        workstream: ws.role,
        host: ws.host,
        original_fingerprint: originalFp,
        current_prompt_hash: currentPromptHash,
        hash_drift: hashDrift,
        readiness,
      }, null, 2));
    } else {
      console.log(`(dry-run — no host invocation. Drop --dry-run to actually replay.)`);
    }
    return;
  }

  // Real replay. Snapshot the original gate to disk before dispatch so a
  // crash between headless-run and restore cannot silently leave the
  // original replaced. (3.7.4 race fix)
  const originalGateName = `${ws.descriptor.workstreamId}.json`;
  const originalGatePath = path.join(gatesDir, originalGateName);
  const originalGateRaw = fs.existsSync(originalGatePath)
    ? fs.readFileSync(originalGatePath, "utf8")
    : null;
  // Capture mtime before snapshot so we can detect whether dispatch
  // actually wrote a new gate vs. the original being left untouched.
  const originalMtimeMs = originalGateRaw !== null
    ? fs.statSync(originalGatePath).mtimeMs
    : 0;

  if (originalGateRaw !== null) {
    snapshotGate(gatesDir, originalGateName, originalGateRaw);
  }

  process.stderr.write(`[replay] invoking ${ws.host} headlessly…\n`);
  const { runStageHeadless } = require(path.join(__dirname, "..", "..", "orchestrator"));
  runStageHeadless(stageName, { cwd, feature: originalGate.feature || "<replay>" })
    .then((result) => {
      const wsResult = result.results.find((r) => r.role === ws.role) || result.results[0];
      const gateWasWritten = wsResult && wsResult.gatePath
        && fs.existsSync(wsResult.gatePath)
        && fs.statSync(wsResult.gatePath).mtimeMs > originalMtimeMs;
      if (!gateWasWritten) {
        // Restore from backup before exiting so we don't leave the
        // canonical path missing or corrupted.
        if (originalGateRaw !== null) {
          restoreFromBackup(gatesDir, originalGateName, originalGatePath);
        }
        process.stderr.write(`[replay] host did not write a new workstream gate (file at ${originalGatePath} is unchanged from before)\n`);
        if (!_flags.json) console.log(`Replay produced no new gate.`);
        process.exit(1);
      }

      // Read what was written, then archive it to replay/.
      const newGateRaw = fs.readFileSync(wsResult.gatePath, "utf8");
      const replayPath = archiveReplayGate(gatesDir, stageId, newGateRaw);

      // Restore the original from the disk backup, then remove the backup.
      if (originalGateRaw !== null) {
        restoreFromBackup(gatesDir, originalGateName, originalGatePath);
      } else {
        // No original existed; remove the file the headless run wrote so
        // the canonical path is left in its pre-replay state (absent).
        deleteBackup(gatesDir, originalGateName);
        clearOriginalGate(originalGatePath);
      }

      // Diff the gates.
      let newGate;
      try { newGate = JSON.parse(newGateRaw); }
      catch (err) {
        process.stderr.write(`[replay] host wrote malformed JSON to ${wsResult.gatePath}: ${err.message}\n`);
        process.exit(1);
      }
      const newFp = reproducibilityFingerprint(newGate);
      const diff = require(path.join(__dirname, "..", "..", "reproducibility"))
        .compareFingerprints(originalFp, newFp);

      const costFields = ["cost_usd", "tokens_in", "tokens_out", "duration_ms"];

      if (_flags.json) {
        console.log(JSON.stringify({
          original_gate: originalPath,
          replay_gate: replayPath,
          reproducibility_diff: diff,
          status: { original: originalGate.status, replay: newGate.status },
          cost: {
            original: { cost_usd: originalGate.cost_usd, tokens_in: originalGate.tokens_in, tokens_out: originalGate.tokens_out, duration_ms: originalGate.duration_ms },
            replay:   { cost_usd: newGate.cost_usd,      tokens_in: newGate.tokens_in,      tokens_out: newGate.tokens_out,      duration_ms: newGate.duration_ms },
          },
          blockers: { original: originalGate.blockers || [], replay: newGate.blockers || [] },
          warnings: { original: originalGate.warnings || [], replay: newGate.warnings || [] },
        }, null, 2));
      } else {
        console.log(`Replay complete → ${path.relative(cwd, replayPath)}`);
        console.log("");
        console.log(`  Status:`);
        console.log(`    original → ${originalGate.status}`);
        console.log(`    replay   → ${newGate.status}`);
        console.log("");
        if (diff.length > 0) {
          console.log(`  Reproducibility-field drift (${diff.length}):`);
          for (const d of diff) {
            console.log(`    ${d.field.padEnd(20)} ${d.kind.padEnd(8)} ${d.before ?? "—"} → ${d.after ?? "—"}`);
          }
        } else {
          console.log(`  Reproducibility fields: identical`);
        }
        if (typeof newGate.cost_usd === "number" || typeof originalGate.cost_usd === "number") {
          console.log("");
          console.log(`  Cost / duration:`);
          for (const f of costFields) {
            const o = originalGate[f], n = newGate[f];
            if (o === undefined && n === undefined) continue;
            console.log(`    ${f.padEnd(15)} ${o ?? "—"} → ${n ?? "—"}`);
          }
        }
      }
    })
    .catch((err) => {
      console.error(`[replay] ${err.message}`);
      process.exit(1);
    });
}

module.exports = { name, flags, run };
