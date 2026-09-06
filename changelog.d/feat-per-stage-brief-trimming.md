- **The inlined role brief is trimmed to the dispatched stage.** A role brief
  covers every task its role can be given — `pm.md` carries brief,
  executable-spec, clarification, scope-fit, sign-off, post-deploy, and
  retrospective sections; `principal.md` design and retrospective; the
  developer briefs build, code review, test fix, and retrospective — and since
  37.2 the whole file was inlined into every dispatch and re-sent on every
  model turn. `core/pipeline/brief-sections.js` is the stage→section map the
  September review said did not exist: top-level `## On …` headings are task
  sections, each mapped to one or more stage ids; everything else (Read First,
  Writes, Standing Rules, Gate Writing Rules, …) is common and always kept.
  `renderRoleBriefBlock` drops the other stages' sections from the inlined copy
  and appends one line naming them and the full brief's path. Fence-aware, so
  the `## Review of …` and ADR-format examples inside code blocks stay with
  their sections. The brief on disk is untouched. `prompts.trim_role_brief:
  false` inlines the whole brief as before.
  Measured on the loop track, whole prompt: requirements 26,994 → 22,991 bytes,
  build 25,729 → 22,009, peer review 24,727 → 24,310, QA unchanged (its brief
  has no task sections) — roughly 15% on the stages that carry multi-task
  briefs, on every turn.
  *Contract change:* layers 1–2 of the prompt were byte-identical across every
  dispatch of the same role in a run; with trimming on they are identical
  across dispatches of the same role *and stage* (and across every turn within
  a dispatch, where prefix caching matters most). `docs/user-guide.md` says so.
  A drift guard in `tests/brief-trimming.test.js` fails the build if a `## On …`
  heading appears in `roles/*.md` that the map does not cover exactly once.
