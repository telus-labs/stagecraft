- **Omnigent runtime adapter** (closes #291). Adds a first-party `omnigent` host adapter that
  installs Stagecraft role prompts, skills, rules, templates, and a default
  Omnigent agent YAML under `.omnigent/stagecraft/`, then invokes Omnigent's
  one-shot `omnigent run ... --no-session -p <prompt>` path for headless
  workstreams. The design and Phase 24 plan document the intended evolution:
  configurable harness/model launch profiles (#292), prompt-file transport
  (#293), Omnigent-policy bridging (#294), session evidence (#295), and a later
  director-mode experiment (#296). *Honest scope note:* this first slice treats Omnigent as a
  conservative host runtime with Stagecraft post-hoc write auditing; it does
  not yet claim Omnigent-native tool-call-time enforcement, sub-agent
  consolidation, or remote-session evidence.
