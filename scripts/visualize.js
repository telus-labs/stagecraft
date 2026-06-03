#!/usr/bin/env node
// visualize.js — render the stage graph as Mermaid.
//
// Usage:
//   node scripts/visualize.js              # full pipeline (track=full)
//   node scripts/visualize.js --track nano # just one track
//   node scripts/visualize.js --tracks     # all tracks as separate diagrams
//
// Output goes to stdout; pipe into a file or paste into a Mermaid live editor.

const path = require("node:path");
const REPO_ROOT = path.resolve(__dirname, "..");
const {
  TRACKS,
  STAGES_BY_TRACK,
  orderedStageNamesForTrack,
  getStage,
} = require(path.join(REPO_ROOT, "core", "pipeline", "stages"));

function parseArgs(argv) {
  const args = { track: "full", allTracks: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--track") args.track = argv[++i];
    else if (argv[i] === "--tracks") args.allTracks = true;
  }
  return args;
}

function nodeId(stageName) {
  return stageName.replace(/-/g, "_");
}

function nodeLabel(name) {
  const def = getStage(name);
  if (!def) return name;
  const rolesNote = def.roles.length > 1
    ? `${def.roles.length} roles`
    : def.roles[0];
  const subagent = def.subagent ? `, via ${def.subagent}` : "";
  return `${def.stage}<br/>${name}<br/><i>${rolesNote}${subagent}</i>`;
}

function renderTrack(track) {
  const stages = orderedStageNamesForTrack(track);
  const lines = [];
  lines.push(`flowchart TD`);
  lines.push(`  %% Track: ${track}`);
  lines.push("");

  // Nodes
  for (const name of stages) {
    const def = getStage(name);
    const id = nodeId(name);
    const label = nodeLabel(name);
    if (def.roles.length > 1) {
      lines.push(`  ${id}["${label}"]:::multi`);
    } else if (def.conditionalOn) {
      lines.push(`  ${id}["${label}"]:::conditional`);
    } else {
      lines.push(`  ${id}["${label}"]:::single`);
    }
  }
  lines.push("");

  // Edges
  for (let i = 0; i < stages.length - 1; i++) {
    const from = nodeId(stages[i]);
    const to = nodeId(stages[i + 1]);
    const toDef = getStage(stages[i + 1]);
    if (toDef.conditionalOn) {
      const c = toDef.conditionalOn;
      lines.push(`  ${from} -->|"${c.field}: ${c.equals}"| ${to}`);
      // Also draw the skip path to the stage after
      if (i + 2 < stages.length) {
        const skip = nodeId(stages[i + 2]);
        lines.push(`  ${from} -.->|"otherwise (skip)"| ${skip}`);
      }
    } else {
      lines.push(`  ${from} --> ${to}`);
    }
  }
  lines.push("");

  // Style classes
  lines.push(`  classDef single fill:#dde,stroke:#557,stroke-width:1px`);
  lines.push(`  classDef multi fill:#bdf,stroke:#358,stroke-width:2px`);
  lines.push(`  classDef conditional fill:#fea,stroke:#a72,stroke-width:1px,stroke-dasharray:5 5`);
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.allTracks) {
    for (const t of TRACKS) {
      console.log(`## Track: ${t}\n`);
      console.log("```mermaid");
      console.log(renderTrack(t));
      console.log("```\n");
    }
    return;
  }

  if (!STAGES_BY_TRACK[args.track]) {
    console.error(`Unknown track: ${args.track}. Valid: ${TRACKS.join(", ")}`);
    process.exit(1);
  }

  console.log("```mermaid");
  console.log(renderTrack(args.track));
  console.log("```");
}

if (require.main === module) main();

module.exports = { renderTrack };
