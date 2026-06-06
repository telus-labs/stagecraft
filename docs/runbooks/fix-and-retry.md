# Runbook: Fix and Retry

`devteam next` reports `fix-and-retry`. A gate is FAIL. This runbook is the operational playbook — what to read, how to fix, how to re-run, and how to know it worked.

Most `fix-and-retry` cases come from one of four stages: **red-team** (Stage 4c), **QA-within-build** (Stage 4 QA workstream), **pre-review** (Stage 4a), or **peer-review** (Stage 5). Peer-review can fail in two distinct shapes — with reviewer objections (Case 4) or with no objections at all (Case 5, a quorum miss). After the red-team gate resolves, Case 1 also covers the **QA augmentation step** that adds regression tests for each red-team fix before peer-review begins. The general flow is the same across all cases; the per-stage specifics differ.

For escalations (`status: ESCALATE`, `decision_needed`), see [`escalation.md`](escalation.md) — different protocol.

---

## The general pattern

```bash
# 1. See what failed — and who needs to fix it
devteam next --json   # action: "fix-and-retry", reason: "...", blockers: [...]
cat pipeline/gates/<stage-id>.json | jq .affected_workstreams
# → ["backend"]          clear only the backend gate; skip frontend/platform
# → ["backend", "platform"]  clear both

# 2. Fix it — usually via a scoped build re-run
devteam stage build --patch --from <failing-stage> [--skip-completed] --headless

# 3. Merge if multi-role
devteam merge build

# 4. Re-run dependent stages so they see the patched code
devteam stage pre-review --headless
devteam stage <originating-failed-stage> --headless

# 5. Confirm advance
devteam next   # should say "▶️ run-stage <next-stage>"
```

Two things make this work cleanly:

- **`--patch --from <stage>`** reads the failing gate's blocker list and injects a `## ⚠️ PATCH MODE — targeted fix only` section at the top of every dispatched build prompt. Agents are constrained to those items.
- **`--skip-completed`** skips dispatching any workstream whose gate file still exists. Combined with `rm pipeline/gates/<workstream>.json` for the workstream(s) that own the bug, this means only the relevant dev re-runs.

The validator helps too: when red-team or stage-04.qa writes FAIL with blockers, it auto-injects a `## IMMEDIATE: ... — Fix Before X` section into `pipeline/context.md` so every later prompt sees the must-fix list. When the originating stage next writes PASS/WARN, the section is auto-stripped. You don't manage either lifecycle.

---

## Case 1: Red-team FAIL — `must_address_before_peer_review` non-empty

This is the most common `fix-and-retry`. Red-team walked the 10 attack surfaces, found a real defect, and listed it in `must_address_before_peer_review[]` of `pipeline/gates/stage-04c.json`. Each entry includes `id`, `severity`, `file`, `workstream`, `reproducer`, and `fix_suggestion` — everything the implementer needs.

**First: identify which workstreams to re-run.**

```bash
cat pipeline/gates/stage-04c.json | jq .affected_workstreams
# → ["backend"]
```

`affected_workstreams` is derived by cross-referencing each finding's `file`
against the build workstream gates' `files_written` arrays. It names exactly
the workstreams whose gates you need to clear. If you're working with a gate
written before this field was added, use the fallback:

```bash
# Fallback: cross-reference manually
for ws in backend frontend platform qa; do
  gate="pipeline/gates/stage-04.${ws}.json"
  [ -f "$gate" ] || continue
  ws_files=$(jq -r '.files_written[]' "$gate" 2>/dev/null | sort)
  flagged=$(jq -r '(.blockers // []) | .[].file' pipeline/gates/stage-04c.json \
            | cut -d: -f1 | sort)
  matches=$(comm -12 <(echo "$ws_files") <(echo "$flagged"))
  [ -n "$matches" ] && echo "[$ws] owns: $matches"
done
```

**Concrete example.** A run produced this gate:

```json
{
  "stage": "stage-04c", "status": "FAIL",
  "affected_workstreams": ["backend"],
  "must_address_before_peer_review": [{
    "id": "F-01", "severity": "critical",
    "file": "src/backend/app.py", "line": 146,
    "workstream": "backend",
    "reproducer": "POST /estimate {\"text\":\"hi\",\"model\":[]}  ->  500 text/html",
    "contracts_violated": ["design-spec §5", "brief AC-6/7/8"],
    "fix_suggestion": "Insert `if not isinstance(model, str)` check before the membership test."
  }],
  "noted_for_followup": [
    /* F-02 .. F-08 — non-blocking, recorded for tickets */
  ]
}
```

`affected_workstreams: ["backend"]` confirms only the backend dev needs to re-execute. Sequence:

```bash
# 1. (Optional) Watch the run in a second pane
devteam log --follow

# 2. Clear ONLY the backend workstream gate + the merged stage-04 gate.
#    --keep-context preserves the auto-injected red-team-blockers section
#    we want the agent to read.
rm pipeline/gates/stage-04.backend.json pipeline/gates/stage-04.json

# 3. Scoped build re-run.
#    --patch --from red-team    reads stage-04c.json's must_address_before_peer_review,
#                                inlines F-01 (with reproducer + fix_suggestion) into
#                                the dispatched build prompt.
#    --skip-completed            frontend/platform/qa gates still exist; those
#                                workstreams won't re-run.
#    --headless                  drives Claude Code (or whichever host) automatically.
devteam stage build --patch --from red-team --skip-completed --headless

# 4. Merge the rewritten backend gate with the surviving 3.
devteam merge build

# 5. Re-run pre-review. The orchestrator-stamped verification (lint + tests)
#    runs the actual commands; if F-01's fix breaks anything else, this
#    flips stage-04a to FAIL with the real exit codes.
devteam stage pre-review --headless

# 6. Re-run red-team to re-walk the 10 surfaces against the patched code.
#    On PASS, the validator auto-strips the red-team-blockers section from
#    context.md (no stale "IMMEDIATE: Fix" heading left behind).
devteam stage red-team --headless

# 7. Confirm advance.
devteam next
# → expect: ▶️ run-stage peer-review (stage-05)
```

### Slower but simpler: restart all of stage-04

If you don't want to think about which workstreams to clear:

```bash
devteam restart build --keep-context     # clear all build gates; preserve F-01 section
devteam stage build --patch --from red-team --headless    # all 4 workstreams re-run
devteam merge build
devteam stage pre-review --headless
devteam stage red-team --headless
devteam next
```

Costs 4× the build wall-clock (the 3 unaffected agents each render and exit quickly with PR summaries saying "no relevant items in scope"), but is conceptually simpler. Choose based on cost vs effort.

### After red-team PASS/WARN: run QA augmentation before peer-review

When the red-team gate turns WARN or PASS after one or more fix cycles, **do
not advance directly to Stage 5 peer-review**. A patch cycle with
`--skip-completed` leaves the QA gate unchanged — no regression tests were
written for the fixes. Peer reviewers then verify correctness by static
inspection alone, and the same bug class can resurface.

After `devteam stage red-team --headless` exits WARN or PASS:

```bash
# Clear only the QA workstream gate (backend/frontend/platform gates survive).
# --skip-completed ensures only QA re-runs.
# --from red-team injects the red-team context; QA's role brief (§On a Post-Red-Team
# Test Augmentation Task) guides it to write regression tests to src/tests/regression/
# rather than re-running the full Stage 6 suite.
rm pipeline/gates/stage-04.qa.json
rm pipeline/gates/stage-04.json     # merged gate must be rebuilt after QA finishes

devteam stage build --patch --from red-team --skip-completed --headless
devteam merge build

# Confirm all tests still pass (QA gate updated, tests_total incremented).
devteam next
# → expect: ▶️ run-stage peer-review (stage-05)
```

See `roles/qa.md §On a Post-Red-Team Test Augmentation Task` for exactly what
QA does in this mode and what the updated gate looks like.

### What about the `noted_for_followup` items?

The red-team gate's `noted_for_followup[]` is non-blocking by design. Don't try to fix those items in the patch cycle — bundling them in defeats the scoped re-run and they're explicitly deferred by the red-team agent. Each entry has a `track_for` field describing where it should land (ticket, ADR amendment, deploy README note, brief amendment). Handle these as separate work items.

---

## Case 2: QA-within-build FAIL

QA's workstream gate inside Stage 4 (`pipeline/gates/stage-04.qa.json`) is FAIL with a `blockers[]` list. QA found bugs in code that backend or platform owns. The validator auto-injects the QA blockers into `context.md` between `<!-- devteam:qa-build-blockers -->` markers.

```bash
# 1. Identify which workstreams own the failing tests.
cat pipeline/gates/stage-04.qa.json | jq .affected_workstreams
# → ["backend", "platform"]

# For gates written before affected_workstreams was added, derive it:
cat pipeline/gates/stage-04.qa.json | jq '[.failing_tests[].assigned_to] | unique | sort'

# 2. Clear the affected gates + QA (which must re-verify) + merged.
rm pipeline/gates/stage-04.backend.json    # owns backend failures
rm pipeline/gates/stage-04.platform.json   # owns platform failures
rm pipeline/gates/stage-04.qa.json         # QA must re-verify after fixes
rm pipeline/gates/stage-04.json            # merged gate must be rebuilt

# 3. Scoped re-run with --skip-completed (frontend's gate stays).
devteam stage build --patch --from stage-04.qa --skip-completed --headless
devteam merge build
devteam next
```

`--from stage-04.qa` accepts the per-workstream gate-id directly (no friendly name needed). Pre-review re-runs automatically as `devteam next` advances.

---

## Case 3: Pre-review (Stage 4a) FAIL — lint or test failure

Stage 4a is now **orchestrator-stamped** (the orchestrator runs the lint and test commands itself; the model's claim is verified against actual exit codes). If the gate is FAIL with `lint_passed: false` or `tests_passed: false`, the failure is real — the orchestrator observed it.

```bash
# 1. See the failing command(s)
cat pipeline/gates/stage-04a.json | jq '._orchestrator_stamped.runs'
# Shows: { lint: { command: "npm run lint", exit_code: 1, ... }, ... }

# 2. Reproduce locally to see what the agent missed
npm run lint   # or whatever command is in the stamped record

# 3. Fix via a scoped build re-run (--from stage-04a reads stage-04a.json's blockers[]).
rm pipeline/gates/stage-04.<owning-area>.json pipeline/gates/stage-04.json
devteam stage build --patch --from stage-04a --skip-completed --headless
devteam merge build
devteam stage pre-review --headless    # orchestrator re-runs the commands
devteam next
```

The orchestrator re-stamps stage-04a on the next run; you can't fake a PASS by hand-editing the gate (well, you can, but `devteam verify stage-04a` will re-stamp and flip you back to FAIL).

---

## Case 4: Peer-review (Stage 5) CHANGES_REQUESTED → FAIL

Stage 5 is different — the `approval-derivation` hook writes the gate based on `REVIEW: APPROVED` / `REVIEW: CHANGES REQUESTED` markers in `pipeline/code-review/by-<reviewer>.md`. A FAIL means the approval count didn't meet `required_approvals` because at least one reviewer wrote CHANGES_REQUESTED with `BLOCKER:` items.

```bash
# 1. Which workstreams need to fix something?
cat pipeline/gates/stage-05.json | jq .affected_workstreams
# → ["backend"]

# 2. Read the extracted BLOCKERs from the per-area gate (no grepping review files).
cat pipeline/gates/stage-05.backend.json | jq '.blockers[]'
# → { "reviewer": "dev-platform", "text": "Missing pagination on ListUsersCommand" }
# → { "reviewer": "dev-platform", "text": "iam_admin_users stub always emits PASS" }

# For gates written before blockers[] was added, fall back to the review file:
grep -A 2 "BLOCKER:" pipeline/code-review/by-*.md

# 3. Address each BLOCKER. Scoped build re-run using the merged peer-review gate
#    as the --from source (reads blockers[] from stage-05.json):
rm pipeline/gates/stage-04.<owning-area>.json pipeline/gates/stage-04.json
devteam stage build --patch --from peer-review --skip-completed --headless
devteam merge build

# 4. Re-run the build-chain stages.
devteam stage pre-review --headless
devteam stage red-team --headless     # if track includes it; see "QA augmentation" note in Case 1

# 5. Re-run peer-review. The reviewers see the patched diff and the
#    addressed BLOCKER comments; they update their REVIEW: marker.
devteam stage peer-review --headless

# 6. Merge the per-area gates before reading devteam next.
#    Skipping this step leaves the old merged gate on disk — devteam next will
#    report the old blockers even after reviewers have approved the fix.
devteam merge peer-review

# 7. Confirm advance.
devteam next   # expect: ▶️ run-stage qa (stage-06) or next track stage
```

> **Stale-gate trap.** If `devteam next` still shows the same blockers after you
> re-ran peer-review, the likely cause is that `devteam merge peer-review` (step 6)
> was skipped. The per-area gates are updated but the merged `stage-05.json` still
> holds the old findings. Run `devteam merge peer-review` and then `devteam next`
> again — the blockers should be gone.

If two rounds of reviews still disagree, that's an [escalation](escalation.md) — `REVIEW-ESCALATED:` lands in context.md and Principal rules.

---

## Case 5: Peer-review (Stage 5) FAIL with no objections — quorum miss

A subtler Stage 5 failure: the merged `stage-05.json` is FAIL, but no reviewer wrote `REVIEW: CHANGES REQUESTED` and no `BLOCKER:` line exists anywhere. The cause is a **missing area review** — one of the four areas didn't accumulate enough approvals to reach `required_approvals`, even though every review file that *was* written is APPROVED.

### Vocabulary you need first

At Stage 4 (build), `workstreams[]` are the four **implementers** — backend, frontend, platform, qa each produced code, each wrote a gate.

At Stage 5 (peer-review), `workstreams[]` in the merged `stage-05.json` are the four **areas of code being reviewed**, not reviewers. The `status` on each entry is the verdict on *that area's code*, derived from how many non-area reviewers approved it. A FAIL on `workstreams[3]` (`qa`) doesn't mean "the QA reviewer disapproved" — it means "the qa *area* (`src/tests/`) didn't receive its required approvals from non-qa reviewers." See [`concepts.md`](../concepts.md) §Workstream for the full vocabulary.

### How to diagnose

The merged gate is an aggregate; the actual FAIL lives in the per-area gate.

```bash
# 1. Which area is FAIL?
cat pipeline/gates/stage-05.json | jq '.workstreams'

# 2. Open the per-area gate for that area.
cat pipeline/gates/stage-05.<area>.json | jq '{status, approvals, required_approvals, changes_requested}'
# Expect to see:
#   status: "FAIL"
#   approvals: ["dev-backend"]   ← only one
#   required_approvals: 2
#   changes_requested: []        ← nobody objected
```

If `changes_requested` is empty and `approvals.length < required_approvals`, this is a **quorum miss with no objections**. The matrix (in `rules/stage-05.md`) excludes self-reviews — `dev-qa` reviewing the qa area doesn't count toward quorum for that area — so an area can sit at 1 approval if only one non-area reviewer wrote a `## Review of <area>` section.

```bash
# 3. Confirm by grepping the reviewer files
grep -l "^## Review of <area>" pipeline/code-review/by-*.md
# If only one non-area file matches, that's your quorum miss.
```

### Two operator paths

**Legitimate: add the missing area review.** Pick a reviewer who *can* review that area per the matrix (any non-area seat) and append a `## Review of <area>` section to their existing review file. Then run `devteam derive-approvals` to update the per-area gate, then `devteam merge peer-review` to rebuild the merged gate.

```bash
# 1. Append to an existing review file (e.g., dev-platform reviewing the qa area).
cat <<'EOF' >> pipeline/code-review/by-platform.md

## Review of <area>

<2-3 sentences of substantive review against AC-N and design-spec §X.
The audit trail should show a real read of the area, not a rubber stamp.>

REVIEW: APPROVED
EOF

# 2. Re-derive the per-area gate from the updated review file.
#    Without this, a shell/editor save doesn't trigger the approval-derivation
#    hook — see the host-lifecycle note below.
devteam derive-approvals pipeline/code-review/by-platform.md

# 3. Confirm the gate flipped to PASS.
cat pipeline/gates/stage-05.<area>.json | jq '{status, approvals}'
# Expect: status "PASS", approvals ["dev-backend", "dev-platform"]

# 4. Re-merge the per-area gates into the merged stage gate, then advance.
devteam merge peer-review
devteam next   # expect: ▶️ run-stage qa (stage-06) or next track-stage
```

#### Why step 2 is needed: the host-lifecycle constraint

The `approval-derivation` hook is registered as a Claude Code `PostToolUse` hook (`hosts/claude-code/adapter.js:230`). It fires when an **agent inside an active Claude Code session** uses the `Write` or `Edit` tool on a review file — that's how a peer-review subagent's `REVIEW: APPROVED` marker reaches the per-area gate during a normal stage run.

A shell `cat >>`, an editor save (vim, VS Code outside Claude Code, etc.), or any write that doesn't go through the Claude Code tool-call lifecycle bypasses the hook entirely. `devteam derive-approvals` is the explicit operator path that invokes the same hook (same code, same gate shape, same lock + atomic-write semantics) with a synthetic PostToolUse payload — it's what closes the gap when the review file was edited outside a host session.

It's also useful when:
- You hand-corrected a typo in a `## Review of <area>` heading and want the gate to reflect the fix.
- You bulk-edited several `by-*.md` files (`devteam derive-approvals` with no argument processes every one).
- The hook errored mid-run and you want to recover from a known-good review-file state.

**Override: hand-edit the merged gate to WARN.** Faster, but only defensible when the warnings carry no `BLOCKER:` content and the missing review wouldn't realistically have flipped any decision. Document the deferral in `pipeline/context.md` so the retrospective sees it.

```bash
# 1. Edit pipeline/gates/stage-05.json:
#    "status": "FAIL"  →  "status": "WARN"
#    Leave warnings[] and workstreams[] untouched — that's the audit record.

# 2. Document the deferral
cat <<'EOF' >> pipeline/context.md

## Deferred follow-ups

- **stage-05 <area> quorum** — Only 1 of 2 required approvals on <area>.
  Merged gate manually overridden to WARN because the open warnings are
  non-blocking SUGGESTIONs and no reviewer wrote CHANGES_REQUESTED.
  Filed as TICKET-XXX. Per docs/runbooks/escalation.md § 4b (defer path).
EOF

# 3. Advance
devteam validate   # gate is still valid; WARN advances
devteam next
```

**Critical caveat with the override path.** If you (or any process) later runs `devteam merge peer-review`, the merge re-derives FAIL from the still-FAILing per-area gate and your override is lost. The hook does NOT overwrite the merged gate (it only writes per-area gates), so as long as nobody re-merges, the WARN sticks. If you want the override to survive a re-merge, you must also hand-edit the per-area gate's status (and accept that the hook will overwrite it the next time anyone saves a review file).

### Worked example: qa area, 1-of-2 approvals, no objections

Real run, full track, multi-area diff. The merged gate looked like:

```json
{
  "stage": "stage-05",
  "status": "FAIL",
  "workstreams": [
    { "workstream": "backend",  "status": "PASS" },
    { "workstream": "frontend", "status": "PASS" },
    { "workstream": "platform", "status": "PASS" },
    { "workstream": "qa",       "status": "FAIL" }
  ]
}
```

The per-area gate showed the truth:

```json
{
  "stage": "stage-05", "workstream": "qa", "area": "qa",
  "status": "FAIL",
  "review_shape": "matrix", "required_approvals": 2,
  "approvals": ["dev-backend"],
  "changes_requested": [],
  "blockers": [],
  "warnings": ["…SUGGESTION:…", "…SUGGESTION:…"]
}
```

`dev-backend` wrote `## Review of qa` with `REVIEW: APPROVED`. Neither `dev-frontend` nor `dev-platform` wrote one. The QA reviewer's own file doesn't count (matrix excludes self-reviews). Pure quorum miss; nothing wrong with the code.

Fixed by appending a `## Review of qa` section to `by-platform.md` with a substantive review of `src/tests/` against AC-11 / AC-13 and `REVIEW: APPROVED`, then running `devteam derive-approvals pipeline/code-review/by-platform.md`. The gate flipped to PASS in milliseconds; `devteam merge peer-review` rebuilt the merged gate; `devteam next` advanced to stage-06.

The SUGGESTION items in `warnings[]` carried through to the merged gate as warnings, where the retrospective will see them. SUGGESTIONs are deferred follow-ups, not merge-blockers — that's the convention (see [`conventions.md`](../conventions.md)).

---

## Common gotchas

- **`--patch` without `--from`** defaults to `red-team`. Fine in the common case; explicit `--from <stage>` is clearer.
- **`--from` accepts both friendly name and gate id.** `--from red-team` and `--from stage-04c` are equivalent.
- **The non-target workstreams will re-render and exit fast.** When you run `devteam stage build --patch --from red-team --headless` (without `--skip-completed`), all four build workstreams re-dispatch. The three not implicated by the patch items write quick PASS gates with PR summaries saying "no relevant items in scope." Costs wall-clock but is correct.
- **Don't hand-edit gate status to PASS.** Orchestrator-stamped verification (stage-04a, stage-06) will re-stamp on next validate and flip you back. The right way to override an automated decision is the [escalation runbook](escalation.md) → Principal ruling.
- **Stage 5 is the exception — and only for quorum misses, not objections.** The merged `stage-05.json` is *not* orchestrator-stamped, so you can hand-edit it (Case 5, the override path). But the `approval-derivation` hook will overwrite per-area gates (`stage-05.<area>.json`) on any review-file save *from inside Claude Code*, and a subsequent `devteam merge peer-review` will re-derive the merged gate from those per-area gates. The override sticks only if neither happens. Adding the missing area review (and running `devteam derive-approvals`) is the durable fix.
- **Editor saves don't fire the approval-derivation hook.** The hook is registered as a Claude Code `PostToolUse Write|Edit` event — it fires when an agent uses the `Write` or `Edit` tool inside an active session, not when you save the file from vim, VS Code outside Claude Code, or `cat >>` from your shell. After any manual edit to `pipeline/code-review/by-*.md`, run `devteam derive-approvals [<file>]` to update the per-area gates. Without an argument it processes every review file under `pipeline/code-review/`.
- **`devteam log --follow`** in a second pane is the right way to watch a multi-step re-run. You'll see each gate land in chronological order.

---

## Case 6: PM sign-off (Stage 7) FAIL — `delta_items` non-empty

Stage 7 is different from all other FAIL cases: the PM has read the test report
and brief, and found that one or more acceptance criteria are not met or not
verified. `pm_signoff` is `false` and `delta_items[]` lists what's missing.

```bash
# 1. Read the delta items
cat pipeline/gates/stage-07.json | jq '.delta_items[]'
# e.g. "AC-8: credential failure exits 0 instead of 1 per the brief"
#      "AC-3: report.md missing the ## CC4.1 section"
```

Unlike red-team or QA failures, delta items are prose — there's no automatic
`affected_workstreams` derived from file paths. Read each item and match it
against the `files_written[]` arrays in the build workstream gates to identify
which agent owns the gap. The same fallback one-liner from Case 1 applies if
the responsible file is mentioned in the delta item text.

```bash
# 2. Determine owning workstreams from delta items (manual step)
#    Then clear their gates + the merged gate.
rm pipeline/gates/stage-04.backend.json   # if backend owns the gap
rm pipeline/gates/stage-04.json           # merged gate must be rebuilt

# 3. Patch build — constrained to delta items only.
#    --from stage-07 reads delta_items[] and injects them into the build prompt.
devteam stage build --patch --from stage-07 --skip-completed --headless
devteam merge build

# 4. Re-run the full post-build chain. PM will re-read the test report and
#    brief in the new stage-07 invocation; every intermediate gate must be fresh.
devteam stage pre-review --headless
devteam stage red-team --headless         # if track includes it
devteam stage peer-review --headless      # reviewers re-confirm delta items addressed
devteam stage qa --headless               # re-run tests; delta items often affect AC coverage
devteam stage sign-off --headless         # PM re-reviews

# 5. Confirm advance
devteam next
```

**When re-running QA is optional.** Skip step 4's QA re-run only if the delta
items are purely documentation gaps (a missing section in `report.md`, an
incomplete `## Verify` block) and the test suite itself doesn't change. If any
delta item touches observable behavior (exit codes, output format, a criterion
not exercised by a test), QA must re-run.

**`delta_items` don't have workstream attribution yet.** This is a known gap —
`delta_items[]` are prose strings, unlike red-team's structured findings.
A future improvement would give each item a `file` and `workstream` field,
enabling the same `jq .affected_workstreams` shortcut available in other cases.
Until then, read the items and identify the owning workstream manually.

---

## Case 7: Consistency drift — `devteam consistency analyze` exits non-zero

`devteam consistency analyze` walks the full artifact chain — brief → spec →
`pr-*.md §Verify` → red-team `must_address` → test-report → gate field reality
— and exits non-zero when any link in that chain disagrees. This can fire
during pre-review (Stage 4a), as a CI check, or when run manually.

```bash
# 1. See what drifted
devteam consistency analyze --json
# or, for human-readable output:
devteam consistency analyze
```

The output names the artifact pair that disagrees and the specific element that
drifted. The source-of-truth hierarchy for resolving conflicts:

```
pipeline/brief.md  (highest — the contract)
  ↓
pipeline/spec.feature  (generated from brief; defer to brief if they conflict)
  ↓
pipeline/pr-*.md  (describes what was built; must match spec)
  ↓
pipeline/test-report.md  (must match brief's ACs; brief wins on conflict)
  ↓
gate field reality  (must match test-report; test-report wins on conflict)
```

**Brief drifted from spec** — the PM amended an AC after the spec was
scaffolded. Fix: re-run `devteam spec generate` to rebuild the spec from the
updated brief, then check `devteam spec verify`. If the spec changes materially,
QA tests that mapped to the changed AC need re-verification.

**PR summary drifted from spec** — a workstream's `pr-*.md §Verify` claims to
satisfy an AC that the spec lists differently. Fix: identify the owning
workstream from the PR filename, clear that workstream's build gate, re-run
with `--patch --from stage-04a` to constrain the agent to only the drifted AC.

**Test-report drifted from brief** — an AC has no test row, or a test row
references an AC ID that doesn't exist in the brief. Fix: clear `stage-06.json`,
re-run QA (`devteam stage qa --headless`). If the brief's AC was removed or
renumbered, QA needs to update its test mapping.

**Gate reality drifted from test-report** — the orchestrator-stamped fields
disagree with what the agent claimed (e.g. `all_acceptance_criteria_met: true`
but an AC row is missing from `test-report.md`). Fix: run
`devteam verify stage-06` — the orchestrator re-stamps the gate from the actual
test output. If the stamp flips the status to FAIL, treat as a normal Case 2
(QA FAIL).

```bash
# After any artifact fix, re-run consistency check to confirm clean:
devteam consistency analyze
# → exit 0: drift resolved
# → exit non-zero: additional drift found — repeat per type above
```

---

## After resolution

`devteam next` advances past the failing stage. The auto-injected blocker section in `context.md` is gone (stripped by the validator on PASS/WARN). The audit trail in `pipeline/gates/` shows the failed gate, the patched re-run, and the eventual PASS — the full history is on disk for the retrospective and any future audit.

For the broader vocabulary (`BLOCKER:`, `## Verify`, `PRINCIPAL-RULING:`, etc.), see [`docs/conventions.md`](../conventions.md).

For escalation-shaped halts (`ESCALATE`, vetoes, decision_needed), see [`escalation.md`](escalation.md).

For deferred items that didn't block the pipeline but need tickets, see [`open-followups.md`](open-followups.md) — `jq .open_followups pipeline/gates/stage-09.json` is the starting point.

For Stage 8 (deploy) failures, see [`deploy-failure.md`](deploy-failure.md) — covers failure classification, adapter-specific diagnostics, and the rollback procedure.

For the chronological narrative across all this, `devteam log --follow`.
