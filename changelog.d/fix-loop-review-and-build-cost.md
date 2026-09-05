- **Peer review reads the change, not the pipeline.** Three `loop` runs of a
  34-line hello-world put peer review at 37, 41, and 52 tool calls (5m43s,
  8m20s, 14m26s) — the last needing a 20-minute `--timeout-ms` after two
  10-minute timeouts. The transcripts showed why: the reviewer followed a
  full-track reading order (design-spec, all ADRs, the other reviewer), globbed
  for each missing artifact, read `run-plan.json`, `run-state.json`, and its own
  previous transcripts, and re-ran lint, tests, and `npm audit` that QA and the
  orchestrator had just verified. `rules/stage-05.md` gains a § Reviewer
  efficiency: read the brief, the area's `pr-*.md`, and the manifest's changed
  files; read full-track artifacts only if present; cite the stage-06 gate's
  `_orchestrator_stamped.runs` instead of re-running; never open orchestrator
  state. `roles/backend.md`, `frontend.md`, and `reviewer.md` reading orders
  now say the same.
- **A build no longer installs a linter to satisfy stage-04.** The rule read
  "if no lint or test script is defined yet, create one"; a build on a project
  with no linter fetched ESLint over the network, added two devDependencies and
  a config, and fixed what it found — 54 tool calls, $5.10, for a change that
  needed none of it. `rules/stage-04.md` now distinguishes the two cases: wire
  an existing test runner into a `test` script if one is missing (that is a
  missing artifact), but when there is no `lint` script record `lint: not
  configured` and let the orchestrator's existing warning stand. Tooling
  decisions belong to the operator or a platform workstream.
- **Changed-file manifest excludes dependency and build trees.** With
  `node_modules/` untracked, `git status --untracked-files=all` produced a
  40-entry manifest with 1,150 omitted, all `node_modules`, and no usable
  changed-file list. `core/context-manifest.js` now skips paths with a
  `node_modules`, `dist`, `build`, `coverage`, `.venv`, `target`, and similar
  segment regardless of the project's `.gitignore`.
- **Timed-out dispatches count toward the run's spend.** The two 10-minute
  review attempts consumed ~3M input tokens that the extractor captured but the
  driver dropped, because `dispatch-observation` read model and cost off a gate
  that never existed; the halt line said `$6.79 spent` for a run that cost
  roughly twice that. When a dispatch produces no gate but the host reported
  usage, the observation now carries `model`, `tokens_in`/`tokens_out`, and a
  derived `cost_usd` (`cost_basis: derived-ungated`), the run summary carries
  `ungated_usage`, and `devteam run` prints it beside the total.
- **Repeated timeouts say so.** Two consecutive timeouts halted with "input is
  structurally unworkable", which sent the operator to the brief when the fix
  was a longer `--timeout-ms`. The halt class is unchanged (`structural-input`,
  for everything that keys off it); the reason now says the host hit the
  per-dispatch timeout N times while still working, points at `pipeline/logs/`,
  and names the two remedies.
- **Peer-review write targets name the reviewer.** `by-<reviewer>.md` was a
  literal placeholder the model substituted itself — one run wrote
  `by-backend.md`, the next `by-reviewer.md` with `approvals: ["reviewer"]`.
  `buildDescriptor` now substitutes the workstream role into `allowedWrites` and
  `artifact`, so the prompt names `pipeline/code-review/by-backend.md` outright
  and the placeholder note disappears for that stage.
