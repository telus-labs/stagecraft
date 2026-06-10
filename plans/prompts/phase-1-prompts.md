# Phase 1 Prompts — Trust Consolidation

Run in this order: **1.4 → 1.1 → 1.2 → 1.3 → 1.5 → 1.6 → 1.7** (1.4 first because clean flag
parsing unblocks CLI-level testing of the rest). Paste the PREAMBLE from
[README.md](README.md), then one prompt below.

---

## Prompt 1.4 — Fix verified flag-parsing bugs

```
TASK: Fix the flag-parsing bugs specified in plans/phase-1-trust-consolidation.md, item 1.4.
Read that section in full first. Branch: fix/flag-parsing-bugs

Summary of the verified bugs you are fixing:
- parseFlags (bin/devteam:253-305) treats --apply as value-taking (for `advise --apply
  AC-11=A`), but cmdAssess uses it as a boolean. Result: `devteam assess --apply --json`
  swallows --json as the value; `devteam assess --apply` as last arg sets flags.apply =
  undefined and silently does not apply.
- --skip-write, --skip-preflight, --skip-advise are checked at bin/devteam:518, 340, 726
  but are missing from parseFlags, so they exit 2 "Unknown flag" and the guards are dead code.

Implement exactly the three changes in the plan item (add the three boolean flags; make
--apply peek-ahead boolean-or-value; audit all other flags\[ / flags. usages in bin/devteam
for further orphans and fix the same way, listing them in your report).

Do NOT restructure parseFlags or split bin/devteam — that is Phase 3.

Required tests (tests/cli.test.js, via the existing runCLI helper):
- `assess --apply --json` emits JSON AND applies the config change.
- `assess --apply` as the final argument applies.
- `advise --apply AC-11=A` behavior unchanged.
- `preflight --skip-write` no longer exits 2.

Done means: all four new tests pass; npm test and npx eslint . green; CHANGELOG entry added.
```

---

## Prompt 1.1 — Enforce the stoplist on the autonomous path

```
TASK: Implement plans/phase-1-trust-consolidation.md, item 1.1. Read that section in full
first. Branch: fix/run-stoplist

Context: the safety stoplist (core/guards/stoplist.js) blocks lighter tracks on
auth/PII/payments/migration-shaped changes, but it is only called from the interactive path
(bin/devteam:329, track-applicability constant at bin/devteam:33-35). The autonomous driver
(core/driver.js, `devteam run`) never calls it. This is the highest-severity gap in the
repo: the strongest guard is skipped on exactly the unattended path.

Implement the four numbered changes in the plan item:
1. Move the track-applicability constant into core/guards/stoplist.js as an export
   (STOPLIST_TRACKS); import it in bin/devteam.
2. Driver calls checkStoplist at run start (after track resolution, before first loop
   iteration) when the track is in STOPLIST_TRACKS.
3. On match: halt BEFORE dispatch with halt_action "stoplist", render explainMatches()
   output, write the halt event to run-log.jsonl, exit non-zero — mirror how existing
   typed halts (e.g. judgment-gate) are plumbed; read those code paths first and follow them.
4. Re-check once more immediately before dispatching stage-04 (build), because the brief
   may be written by the run itself after start. Exactly two check points — start + pre-build.

Preserve full/hotfix bypass and its explanatory comment.

Required tests (tests/run.test.js style, injected deps — study how that file fakes
next/runStageHeadless before writing yours): the three scenarios listed in the plan item
(quick-track halt, full-track no-halt, mid-run brief triggers pre-build halt).

Also update: docs/runbooks/autonomous-run.md halt-action table (add stoplist row, matching
the table's existing format). No other doc changes.

Done means: three new tests pass; npm test / npx eslint . green; manual smoke per the plan's
Verify block reproduced and pasted into your report; CHANGELOG entry added.
```

---

## Prompt 1.2 — Make next() pure: extract the sign-off auto-fold write

```
TASK: Implement plans/phase-1-trust-consolidation.md, item 1.2. Read that section in full
first, then read core/orchestrator.js tryAutoFoldSignOff (line 538) and its call site
(line 1122), the purity comment (line 483), and core/driver.js's header comments.
Branch: fix/next-purity-auto-fold

The contract violation you are fixing: next() is documented "Pure read; never mutates
state" but tryAutoFoldSignOff writes pipeline/gates/stage-07.json as a side effect.

The decided design (do not redesign): keep the auto-fold feature; move the WRITE to callers.
1. tryAutoFoldSignOff becomes pure: returns the folded gate object or null. No fs writes.
2. _nextImpl returns a new action "fold-sign-off" carrying the gate content in the payload.
   Follow the existing versioned action-schema pattern around bin/devteam:718; read how
   other actions are shaped and version-bumped before adding yours.
3. cmdNext: on fold-sign-off, write the gate, print what happened, re-run next(), show the
   subsequent action (one command still gets the user to the real next step).
4. Driver: on fold-sign-off, write the gate, append an
   {"event":"auto-fold-sign-off","derived_from":"brief AC mapping"} record to
   run-log.jsonl, continue the loop. Do NOT require --allow-stage for the fold (it is
   orchestrator-derived, not model-asserted) — but it must now appear in the audit log.
5. Update the purity comments at orchestrator.js:483 and the driver header to state the
   new contract precisely.

Compatibility: tests/auto-fold.test.js and possibly tests/pipeline-e2e.test.js encode the
old write-on-read behavior. Updating those tests is EXPECTED for this item — list every
test you touch and why in your report. All other tests must pass unchanged.

Required new tests:
- next() leaves pipeline/gates/ byte-identical (snapshot the dir before/after the call).
- fold-sign-off payload validates as a stage-07 gate.
- Driver writes the gate + log event and the run proceeds to completion.
- cmdNext end-to-end (runCLI) still reaches pipeline-complete on a clean nano run.

Done means: grep shows no fs write reachable from _nextImpl; tests above pass; npm test /
eslint green; CHANGELOG entry added.
```

---

## Prompt 1.3 — Gate validator: fail closed where it matters

```
TASK: Implement plans/phase-1-trust-consolidation.md, item 1.3. Read that section, then
core/gates/validator.js runMain() (the error handling around lines 610-630) and the
escalation sweep (~lines 411-421 — [verify-first] confirm the mtime ordering exists there
before changing it). Branch: fix/validator-fail-closed

What you are fixing: the unknown-internal-error path prints "treating as PASS" and exits 0
(validator.js:625-627). The validator underpins the tamper-evident gate chain and CI
blocking, so fail-open means a validator bug green-lights everything.

Implement the three numbered changes in the plan item:
1. --strict mode (also honored via CI=true env): unknown-error path exits 1. Hook-mode
   default keeps warn-and-pass (the rationale — don't kill interactive sessions — is
   legitimate there) BUT now also appends the error to pipeline/validator-errors.log so
   failures stop vanishing.
2. The shipped CI template (templates/ci/github-actions/stagecraft-pr-checks.yml) and the
   `devteam ci install` flow pass --strict.
3. Escalation sweep ordering: replace mtime with the gate's own timestamp field, falling
   back to stage order from core/pipeline/stages.js. Comment why mtime was wrong.

Required tests (extend tests/gate-validator.test.js, which already drives exit codes via
spawnSync):
- Reach the unknown-error path (e.g. a directory where a gate file is expected, or
  whatever reliably triggers it — read the code to find the cleanest injection): hook mode
  → exit 0 + validator-errors.log written; --strict → exit 1.
- fs.utimesSync manipulation no longer changes the sweep verdict.

Done means: tests pass; npm test / npx eslint . / npm run consistency green; CHANGELOG
entry added with an Honest scope note that hook mode remains fail-open by design.
```

---

## Prompt 1.5 — codex/gemini adapters: render PATCH MODE

```
TASK: Implement plans/phase-1-trust-consolidation.md, item 1.5. Read that section, then
compare renderStagePrompt across all four hosts/*/adapter.js files. Branch:
fix/patch-mode-all-hosts

Verified gap: claude-code (adapter.js:346-363) and generic (adapter.js:36-53) render the
ctx.patchItems "PATCH MODE — targeted fix only" block; codex and gemini-cli never read
ctx.patchItems, so a --patch fix routed to them loses its scoping constraint.

Implement:
1. Extract the PATCH MODE rendering into core/adapters/render-helpers.js as
   renderPatchBlock(ctx), claude-code wording canonical. Match render-helpers.js's
   existing export style.
2. All four adapters call it. Output for claude-code and generic must remain byte-identical
   to before (the adapter-contract tests normalize-and-compare prompts — keep them green).
3. Do NOT merge the codex/gemini adapters into a shared base (Phase 3); add one comment
   noting the duplication with a pointer to plans/phase-3-structural-debt.md.
4. [verify-first] hosts/gemini-cli/capabilities.json lacks the goalLoop key that codex and
   claude-code declare. Investigate goalCondition consumers in core/pipeline/stages.js and
   the goal-loop tests; if it is an omission, add "goalLoop": true; if genuinely
   unsupported, add an explicit "goalLoop": false with a comment. Report which you chose
   and the evidence.

Required tests (tests/adapter-contract.test.js): for every host exposing renderStagePrompt,
a descriptor WITH patchItems renders the normalized PATCH MODE block; WITHOUT patchItems
it does not.

Done means: tests pass for all four hosts; npm test / eslint green; CHANGELOG entry added.
```

---

## Prompt 1.6 — Finish bounded-isolation (B9) wiring

```
TASK: Implement plans/phase-1-trust-consolidation.md, item 1.6. Read that section, then
core/paths.js in full (44 lines), and find every `path.join(cwd, "pipeline"` in
core/orchestrator.js and core/driver.js. Branch: fix/bounded-isolation-read-side

The defect: dispatch honors changeId via core/paths.js (gates go to
pipeline/changes/<id>/gates/), but the READ side — next() (orchestrator.js:494), summary()
(orchestrator.js:1270), brief/test-report/runbook paths (orchestrator.js:552-553, 579),
and the driver's lock/run-state/run-log/gates/context paths (driver.js:54-57, 165) —
hardcodes pipeline/. In bounded mode the pipeline appears permanently "not started".

Implement per the plan item:
1. Thread changeId through next(), summary(), and the driver path helpers using
   core/paths.js (gatesDir(cwd, changeId), prefixPipelineRelative). First read how
   runStage/runStageHeadless currently OBTAIN changeId (config or flag) and reuse exactly
   that mechanism — do not invent a new flag.
2. If any command surface genuinely cannot support bounded mode after this change, make
   loadConfig reject isolation:bounded with an error naming that command. Silent breakage
   is the only unacceptable outcome.

Required tests (extend tests/bounded-workspace.test.js): the end-to-end in the plan item —
bounded config, gates seeded under pipeline/changes/<id>/gates/, next() advances,
summary() reports, a short injected-deps driver run reads/writes only under the change root.

Final check required in your report: output of
  grep -n 'path.join(cwd, "pipeline"' core/**/*.js
— every remaining hit must carry a comment justifying changeId-exemption, or be fixed.

Done means: e2e test passes; npm test / eslint green; CHANGELOG entry added.
```

---

## Prompt 1.7 — Small hardening basket (three fixes, one branch)

```
TASK: Implement plans/phase-1-trust-consolidation.md, item 1.7 — three independent fixes,
one branch, one commit per fix. Branch: fix/phase1-hardening

Fix 1 (verified) — summary() crash: orchestrator.js:1316 calls gate.status.toLowerCase()
guarded only by `gate ?`; line 1319 same for w.status. A valid-JSON gate without status
throws and takes down `devteam summary` and the UI /api/state. Use the
(gate.status || "unknown").toLowerCase() pattern in both spots, render "unknown"
distinctly. Test: gate file containing {} → summary succeeds and shows unknown.

Fix 2 (verified) — secret-scan bypass scope: core/hooks/secret-scan.js:123 disables the
ENTIRE scan if `devteam-allow-secret:` appears anywhere in content the scanned LLM itself
writes. Change to per-line scoping: the magic comment suppresses findings only on its own
line and the immediately following line. Every suppression appends {file, line, reason} to
pipeline/secret-allowlist.log. Update the stderr help text at secret-scan.js:215 and the
header comment at line 18. Update tests/secret-scan.test.js: a file with the comment on
line 1 and a secret on line 30 must now FAIL the scan; comment adjacent to the secret
passes and logs.

Fix 3 [verify-first] — budget cap blind spot: the driver's budget check (around
driver.js:107-119) reportedly sums only MERGED stage gates pre-dispatch, so a multi-role
stage's per-workstream costs are invisible until merge. CONFIRM by reading the
cost-summing code. If confirmed: include per-workstream gate costs
(pipeline/gates/stage-NN.<role>.json cost fields) in the sum. Test: workstream gates whose
summed cost exceeds --budget-usd, no merged gate yet → next dispatch refused. If NOT
confirmed, stop fix 3 and report what the code actually does.

Done means: each fix has its regression test (failing before, passing after); npm test /
eslint green; one CHANGELOG entry covering the basket.
```
