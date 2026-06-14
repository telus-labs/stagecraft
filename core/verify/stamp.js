// Orchestrator-stamped gate fields. Closes the gap between agent
// self-report ("tests_passed: true") and orchestrator verification
// (the orchestrator actually runs the test command and observes exit
// code 0). For stage-04a (pre-review), stage-06 (qa), and stage-03b
// (executable-spec), the orchestrator runs the relevant commands and
// overwrites the gate's verification fields with what it observed.
//
// When the orchestrator's verification disagrees with what the model
// wrote, the orchestrator wins: status flips to FAIL, blockers gain
// a structured entry naming what failed, and `_orchestrator_stamped`
// records the audit trail (commands run, exit codes, timestamps).
//
// Audit finding (2026-06-02 audit, CRITICAL): every Stage 04a gate
// field is currently model-self-reported. The validator only
// enforces shape, not truth. This module is the fix.
//
// 6.2: stage-03b stamping moves spec generate/verify out of the pm
// agent (no Bash budget) into the orchestrator — model-said vs
// observed recorded on every spec-related gate field.

const fs = require("node:fs");
const path = require("node:path");
const { loadConfig } = require("../config");
const { runCommand, resolveCommands } = require("./runner");
const { loadGateSafe } = require("../gates/load-gate");
const { verify: specVerify, generateScaffold } = require("../spec/verify");

const STAMPER_VERSION = "1";

// Stage-04a (Pre-Review): orchestrator stamps lint_passed and tests_passed
// based on actually running the configured commands.
async function stampStage04a(cwd, gatePath) {
  const config = loadConfig(cwd);
  const commands = resolveCommands(cwd, config);
  const { gate, error } = loadGateSafe(gatePath);
  if (error) return { ok: false, error };

  const stamp = {
    stamper_version: STAMPER_VERSION,
    at: new Date().toISOString(),
    fields: [],
    runs: {},
  };
  const blockers = Array.isArray(gate.blockers) ? gate.blockers.slice() : [];

  // lint_passed
  if (commands.lint) {
    const result = await runCommand(commands.lint, { cwd });
    const passed = result.exitCode === 0 && !result.timedOut && !result.spawnError;
    if (gate.lint_passed !== passed) {
      stamp.fields.push({ field: "lint_passed", model_said: gate.lint_passed, orchestrator: passed });
    } else {
      stamp.fields.push({ field: "lint_passed", orchestrator: passed });
    }
    gate.lint_passed = passed;
    stamp.runs.lint = {
      command: result.command,
      exit_code: result.exitCode,
      duration_ms: result.durationMs,
      timed_out: result.timedOut || undefined,
      spawn_error: result.spawnError || undefined,
    };
    if (!passed) {
      blockers.push(`lint failed (exit ${result.exitCode}${result.timedOut ? ", timed out" : ""}): ${result.command}`);
    }
  } else {
    stamp.runs.lint = { skipped: "no lint command configured or discovered" };
  }

  // tests_passed (lightweight check at 4a; 06 is the authoritative test stage)
  if (commands.test) {
    const result = await runCommand(commands.test, { cwd });
    const passed = result.exitCode === 0 && !result.timedOut && !result.spawnError;
    if (gate.tests_passed !== passed) {
      stamp.fields.push({ field: "tests_passed", model_said: gate.tests_passed, orchestrator: passed });
    } else {
      stamp.fields.push({ field: "tests_passed", orchestrator: passed });
    }
    gate.tests_passed = passed;
    stamp.runs.test = {
      command: result.command,
      exit_code: result.exitCode,
      duration_ms: result.durationMs,
      timed_out: result.timedOut || undefined,
      spawn_error: result.spawnError || undefined,
    };
    if (!passed) {
      blockers.push(`tests failed (exit ${result.exitCode}${result.timedOut ? ", timed out" : ""}): ${result.command}`);
    }
  } else {
    stamp.runs.test = { skipped: "no test command configured or discovered" };
  }

  return finalizeStamp(gate, gatePath, blockers, stamp);
}

// Stage-06 (QA): run test command; cross-check AC→test mapping in
// pipeline/test-report.md against brief.md AC-N list.
async function stampStage06(cwd, gatePath) {
  const config = loadConfig(cwd);
  const commands = resolveCommands(cwd, config);
  const { gate, error } = loadGateSafe(gatePath);
  if (error) return { ok: false, error };

  const stamp = {
    stamper_version: STAMPER_VERSION,
    at: new Date().toISOString(),
    fields: [],
    runs: {},
  };
  const blockers = Array.isArray(gate.blockers) ? gate.blockers.slice() : [];

  // Test command exit code
  if (commands.test) {
    const result = await runCommand(commands.test, { cwd });
    const passed = result.exitCode === 0 && !result.timedOut && !result.spawnError;
    stamp.runs.test = {
      command: result.command,
      exit_code: result.exitCode,
      duration_ms: result.durationMs,
      timed_out: result.timedOut || undefined,
      spawn_error: result.spawnError || undefined,
    };
    if (!passed) {
      // Force a counter when tests genuinely fail. The model's tests_failed
      // and failing_tests stay as written (those are runner-specific to
      // count), but we record that at least one failure occurred per the
      // exit code. The blocker below halts sign-off.
      stamp.fields.push({ field: "test_command_exit_0", orchestrator: false });
      blockers.push(`test command failed (exit ${result.exitCode}${result.timedOut ? ", timed out" : ""}): ${result.command}`);
    } else {
      stamp.fields.push({ field: "test_command_exit_0", orchestrator: true });
    }
  } else {
    stamp.runs.test = { skipped: "no test command configured or discovered" };
  }

  // AC→test cross-check: derive `all_acceptance_criteria_met` from the
  // brief and test-report.md rather than trusting the model's claim.
  const acCheck = checkAcceptanceCriteria(cwd);
  if (acCheck.applicable) {
    stamp.runs.ac_mapping = acCheck.details;
    const orchestratorSaysAllMet = acCheck.unmappedAcs.length === 0;
    if (gate.all_acceptance_criteria_met !== orchestratorSaysAllMet) {
      stamp.fields.push({
        field: "all_acceptance_criteria_met",
        model_said: gate.all_acceptance_criteria_met,
        orchestrator: orchestratorSaysAllMet,
      });
    } else {
      stamp.fields.push({ field: "all_acceptance_criteria_met", orchestrator: orchestratorSaysAllMet });
    }
    gate.all_acceptance_criteria_met = orchestratorSaysAllMet;
    if (!orchestratorSaysAllMet) {
      blockers.push(
        `acceptance criteria unmapped to tests (${acCheck.unmappedAcs.length}): ${acCheck.unmappedAcs.join(", ")}`,
      );
    }
  } else {
    stamp.runs.ac_mapping = { skipped: acCheck.reason };
  }

  return finalizeStamp(gate, gatePath, blockers, stamp);
}

// Parse pipeline/brief.md for AC-N entries and pipeline/test-report.md for
// the AC mapping table. Returns which AC-Ns appear in the brief but have
// no test mapped. Conservative: when the test report or brief is missing
// we skip rather than fail (the model didn't run; can't blame the gate).
function checkAcceptanceCriteria(cwd) {
  // B9 exemption: stamp.js is called from mergeWorkstreamGates which already
  // knows the gatesDir; brief.md/test-report.md use the global pipeline/ path
  // here. Bounded support for stamps would require passing changeId; deferred.
  const briefPath = path.join(cwd, "pipeline", "brief.md");
  const reportPath = path.join(cwd, "pipeline", "test-report.md");
  if (!fs.existsSync(briefPath)) {
    return { applicable: false, reason: "pipeline/brief.md not found (track without requirements stage?)" };
  }
  if (!fs.existsSync(reportPath)) {
    return { applicable: false, reason: "pipeline/test-report.md not found — model didn't produce it" };
  }
  const briefAcs = extractAcsFromBrief(fs.readFileSync(briefPath, "utf8"));
  const reportAcs = extractAcsFromReport(fs.readFileSync(reportPath, "utf8"));

  const reportSet = new Set(reportAcs);
  const unmapped = briefAcs.filter((ac) => !reportSet.has(ac));

  return {
    applicable: true,
    details: {
      brief_ac_count: briefAcs.length,
      report_ac_count: reportAcs.length,
      unmapped_acs: unmapped,
      brief_acs: briefAcs,
    },
    unmappedAcs: unmapped,
  };
}

// Extract AC identifiers from brief.md. Tolerant of formats:
//   - "AC-1: description"
//   - "**AC-1** — description"
//   - "- AC-1: ..."
function extractAcsFromBrief(text) {
  const re = /(?:^|\s|\*|`)AC-(\d+)\b/g;
  const seen = new Set();
  let m;
  while ((m = re.exec(text)) !== null) {
    seen.add(`AC-${m[1]}`);
  }
  return Array.from(seen).sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
}

// Extract AC identifiers from a test-report.md mapping table. Any cell
// containing "AC-N" counts as a mention.
function extractAcsFromReport(text) {
  const re = /AC-(\d+)\b/g;
  const seen = new Set();
  let m;
  while ((m = re.exec(text)) !== null) {
    seen.add(`AC-${m[1]}`);
  }
  return Array.from(seen);
}

// Stage-03b (Executable Spec): orchestrator stamps the spec-related gate
// fields by running verify() from core/spec/verify. This moves spec
// generation/verification out of the pm agent (budget: Read, Write, Glob —
// no Bash) into the orchestrator. If spec.feature is absent but brief.md
// is present, generates a scaffold first so the gate records observed state.
//
// Rejected alternative: granting pm Bash capability. Verification belongs
// to the orchestrator — the trust model requires the orchestrator to check
// the agent's work, not for the agent to self-certify (6.2 rationale).
async function stampStage03b(cwd, gatePath) {
  const { gate, error } = loadGateSafe(gatePath);
  if (error) return { ok: false, error };

  const pipelineDir = path.join(cwd, "pipeline");
  const briefPath = path.join(pipelineDir, "brief.md");
  const specPath  = path.join(pipelineDir, "spec.feature");

  const stamp = {
    stamper_version: STAMPER_VERSION,
    at: new Date().toISOString(),
    fields: [],
    runs: {},
  };
  const blockers = Array.isArray(gate.blockers) ? gate.blockers.slice() : [];

  if (!fs.existsSync(briefPath)) {
    stamp.runs.spec_generate = { skipped: "pipeline/brief.md not found — track without requirements stage?" };
    stamp.runs.spec_verify   = { skipped: "pipeline/brief.md not found" };
    return finalizeStamp(gate, gatePath, blockers, stamp);
  }

  const briefText = fs.readFileSync(briefPath, "utf8");

  // Generate scaffold if spec.feature is absent (corresponds to devteam spec generate).
  if (!fs.existsSync(specPath)) {
    try {
      const scaffold = generateScaffold(briefText);
      fs.mkdirSync(path.dirname(specPath), { recursive: true });
      fs.writeFileSync(specPath, scaffold, "utf8");
      stamp.runs.spec_generate = { generated: true, path: path.relative(cwd, specPath) };
    } catch (err) {
      stamp.runs.spec_generate = { error: err.message };
    }
  } else {
    stamp.runs.spec_generate = { skipped: "spec.feature already exists" };
  }

  // Run verify (corresponds to devteam spec verify).
  const report = specVerify(cwd, { pipelineDir });
  stamp.runs.spec_verify = {
    drift: report.drift,
    criteria_count: report.criteria.length,
    scenarios_count: report.scenarios.length,
    orphan_criteria_count: report.orphan_criteria.length,
    orphan_scenarios_count: report.orphan_scenarios.length,
    duplicate_criteria_count: report.duplicate_criteria.length,
  };

  // Build criteria_to_scenario_mapping from the report's scenario objects.
  const scenariosByAc = new Map();
  for (const sc of report.scenarios) {
    for (const id of sc.ac_ids || []) {
      if (!scenariosByAc.has(id)) scenariosByAc.set(id, []);
      scenariosByAc.get(id).push(sc.name);
    }
  }
  const orchMapping = report.criteria.map((id) => ({
    criterion_id: id,
    scenarios: scenariosByAc.get(id) || [],
  }));

  const orchCriteriaCount   = report.criteria.length;
  const orchScenariosCount  = report.scenarios.length;
  const orchAllMapped       = report.orphan_criteria.length === 0 &&
                              report.duplicate_criteria.length === 0;
  const orchOrphanScenarios = report.orphan_scenarios.map((o) => o.name);
  const orchOrphanCriteria  = report.orphan_criteria.map((o) => o.id);
  const orchDrift           = report.drift;

  function stampField(field, orchVal) {
    const modelVal = gate[field];
    const entry = { field, orchestrator: orchVal };
    if (JSON.stringify(modelVal) !== JSON.stringify(orchVal)) {
      entry.model_said = modelVal;
    }
    stamp.fields.push(entry);
    gate[field] = orchVal;
  }

  stampField("criteria_count",            orchCriteriaCount);
  stampField("scenarios_count",           orchScenariosCount);
  stampField("criteria_to_scenario_mapping", orchMapping);
  stampField("all_criteria_mapped",       orchAllMapped);
  stampField("orphan_scenarios",          orchOrphanScenarios);
  stampField("orphan_criteria",           orchOrphanCriteria);
  stampField("drift",                     orchDrift);

  if (!orchAllMapped || orchDrift) {
    const orphCritStr = orchOrphanCriteria.join(", ") || "none";
    const orphScenCount = report.orphan_scenarios.length;
    blockers.push(
      `spec drift: orphan_criteria=[${orphCritStr}], orphan_scenarios=${orphScenCount}`
    );
  }

  return finalizeStamp(gate, gatePath, blockers, stamp);
}

function finalizeStamp(gate, gatePath, blockers, stamp) {
  // If the orchestrator detected failures, force gate status to FAIL.
  // The model may have written PASS optimistically; orchestrator's truth
  // wins. Existing FAIL or ESCALATE is preserved (orchestrator never
  // upgrades a FAIL to PASS).
  const originalStatus = gate.status;
  const orchestratorFailed = blockers.length > (Array.isArray(gate.blockers) ? gate.blockers.length : 0);
  if (orchestratorFailed) {
    if (gate.status === "PASS" || gate.status === "WARN") {
      gate.status = "FAIL";
      stamp.status_overridden = { from: originalStatus, to: "FAIL", reason: "orchestrator verification failed" };
    }
  }

  gate.blockers = blockers;
  gate._orchestrator_stamped = stamp;
  gate.timestamp = new Date().toISOString();

  fs.writeFileSync(gatePath, JSON.stringify(gate, null, 2) + "\n", "utf8");
  return { ok: true, gate, stamp };
}

// Public dispatch — pick the right stamper for a stage id.
async function stamp(cwd, stageId) {
  if (!STAMPABLE_STAGES.has(stageId)) {
    return { ok: false, error: `no orchestrator stamping defined for ${stageId}` };
  }
  // B9 exemption: stamp() reads gates from in-place pipeline/gates/; callers
  // that need bounded paths should pass an explicit gatePath (future enhancement).
  const gatesDir = path.join(cwd, "pipeline", "gates");
  const gatePath = path.join(gatesDir, `${stageId}.json`);
  if (!fs.existsSync(gatePath)) {
    return { ok: false, error: `gate not found: ${gatePath}` };
  }
  switch (stageId) {
    case "stage-03b": return stampStage03b(cwd, gatePath);
    case "stage-04a": return stampStage04a(cwd, gatePath);
    case "stage-06":  return stampStage06(cwd, gatePath);
    default:          return { ok: false, error: `no orchestrator stamping defined for ${stageId}` };
  }
}

// Stages this module knows how to verify. Callers can use this to
// decide whether to invoke stamp() at all.
const STAMPABLE_STAGES = new Set(["stage-03b", "stage-04a", "stage-06"]);

module.exports = {
  stamp,
  stampStage03b,
  stampStage04a,
  stampStage06,
  STAMPABLE_STAGES,
  STAMPER_VERSION,
  extractAcsFromBrief, // exposed for tests
  extractAcsFromReport,
};
