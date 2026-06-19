- **Characterize the autonomous-driver transition contract** (audit P2-2, roadmap
  PR 3.2a). Adds a common `continue` / `halt` / `complete` transition result for
  summary and run-state patches plus ordered run-log/progress events, and routes
  representative terminal paths through its centralized applicator. New
  characterization tests pin persisted state and event traces for successful and
  transient dispatch, non-code fixes, rulings, and merge failure before handler
  extraction begins. *Honest scope note:* this slice introduces and proves the
  contract; dispatch/transient and fix/ruling/merge handler extraction remain the
  sequential follow-up PRs.
