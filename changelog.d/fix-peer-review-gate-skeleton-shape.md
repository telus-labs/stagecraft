- **The peer-review gate skeleton in the prompt now matches the track.** The
  static stage-05 definition's `gate` says `review_shape: "matrix"` /
  `required_approvals: 2` (the full-track default) and that is what every
  reviewer saw in its "Gate to write" block — including `loop`, `nano`,
  `refactor`, and `review-pr` reviewers, whose rules say scoped / 1. A loop
  reviewer (run D, 2026-09-05) read `run-plan.json` three times to reconcile the
  two before writing the gate as scoped/1 anyway, and said so in a gate warning
  recommending exactly this fix. `buildDescriptor` now derives both fields from
  `requiredApprovalsFor(stage, track)`; gates without `review_shape`
  (adversarial mode, every other stage) are untouched.
- **`approval-derivation` writes `"scoped"`, not `"single"`.** The stage-05
  schema enum is `["scoped", "matrix"]` and `rules/stage-05.md` has always said
  scoped; the hook's `"single"` was a third name for the same shape that the
  (unenforced) schema would have rejected. Nothing in core branched on the
  value; two tests and one fixture pinned it and are updated.
