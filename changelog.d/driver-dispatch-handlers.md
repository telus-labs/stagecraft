- **Extract autonomous-driver dispatch decisions** (audit P2-2, roadmap PR 3.2b).
  Moves consequence, `--until`, and budget guards; host-result normalization;
  transient/structural classification; targeted-fix convergence; and repair scope
  decisions into pure handlers returning the common transition result. `run()`
  retains host invocation, stall probes, persistence, retry delay, stub cleanup,
  and loop ownership. Existing characterization traces remain unchanged. *Honest
  scope note:* fix, ruling, and merge handlers remain the sequential PR 3.2c.
