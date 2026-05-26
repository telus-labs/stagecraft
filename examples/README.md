# examples/

Snapshot of one ai-dev-team pipeline run on a fictional feature ("Add SMS notification opt-in to user settings"). Use it as a reference for what each artifact looks like in practice — not a fixture to clone for a real project (run `devteam init` for that).

## Layout

```
examples/sms-opt-in/
├── .devteam/
│   ├── config.yml             ← split routing: backend on codex, rest on claude-code
│   └── rules/                 ← (rules dir would be here after `devteam init`; omitted to keep the example small)
├── pipeline/
│   ├── brief.md               ← Stage 1 artifact (PM)
│   ├── code-review/           ← Stage 5 review files (input to approval-derivation)
│   │   ├── by-backend.md
│   │   └── by-frontend.md
│   └── gates/
│       ├── stage-01.json
│       ├── stage-04.backend.json     ← per-workstream gates
│       ├── stage-04.frontend.json
│       ├── stage-04.platform.json
│       ├── stage-04.qa.json
│       ├── stage-04.json             ← merged stage gate
│       ├── stage-04a.json            ← pre-review triggers security
│       ├── stage-05.backend.json     ← derived by the approval-derivation hook
│       └── stage-05.frontend.json
└── README.md (this file)
```

## What to read first

1. `.devteam/config.yml` — see how multi-host routing is expressed.
2. `pipeline/brief.md` — what the PM produces at Stage 1.
3. `pipeline/gates/stage-04.json` — what the orchestrator's merge produces from per-workstream gates.
4. `pipeline/code-review/by-backend.md` — what reviewers write; the approval-derivation hook parses these into per-area gates at Stage 5.

## How this differs from a real init

- The `.devteam/rules/` directory is omitted to keep the example small. A real `devteam init` installs 10 rules docs there.
- The `.claude/` host install (agents, commands, skills, settings.local.json) is omitted — those are 20+ files, not informative as static examples. Run `devteam init --host claude-code --cwd /tmp/somewhere` to see them.
- Real artifacts (brief.md, design-spec.md, code) are written by the LLM during a real run. The ones here are hand-crafted demonstrations.

## Running the example

```bash
# Verify what the gate validator says about the gates here
cd examples/sms-opt-in
node /path/to/ai-dev-team/core/gates/validator.js

# What does `devteam next` say from this state?
devteam next --cwd .

# Pipeline state at a glance
devteam summary --cwd .
```

The example is set up with mid-pipeline state: stage-01 PASS, stage-04 PASS (all 4 workstreams merged), stage-04a PASS with `security_review_required: true` so stage-04b is the next step, and 2 of 4 stage-05 area gates derived.
