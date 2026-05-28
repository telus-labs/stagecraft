# 05 — Documentation gaps

## Summary

Documentation is unusually strong — recently audited and uplifted in three coordinated tiers (presentation deck, README + concepts + user-guide restructure, adoption + FAQ + EXAMPLE depth, modular template docs, BACKLOG `/goal` entry, onboarding-gap fix). The doc footprint is **11,771 lines of markdown** across 11 root-level files + 19 files under `docs/`. Most categories audit clean. The remaining gaps are mostly small.

This audit's own outputs (in `docs/audit/`) are not yet committed and will add 11 more files; some decisions about whether to gitignore them are open.

## README quality

- **Quality:** complete.
- **Has:** problem-first hook, First-30-minutes checklist, two-path Quick Start (`--headless` vs interactive), CLI reference, audit reference (just added), architecture diagram, repo layout, design decisions, "why this exists."
- **Missing:** nothing material. The README is dense but not bloated.
- **Stale references:** none observed. The recent ARCHITECTURE.md fix (dangling `scripts/audit.js` ref) was the last known stale ref.

## Component docs

| Component | Has docs? | Coverage |
|---|---|---|
| Core orchestrator | yes — `ARCHITECTURE.md`, `core/adapters/host-adapter.md` | high |
| Host adapters | yes — `core/adapters/host-adapter.md` (contract), per-host capabilities.json | high |
| Roles | yes — every role has `roles/<role>.md` brief | high |
| Stages | yes — `docs/concepts.md`, `docs/tracks.md`, `docs/user-guide.md` cover them; `rules/gates.md` defines per-stage gate shape | high |
| Skills | yes — every skill has `skills/<name>/SKILL.md` | high |
| Memory subsystem | yes — `docs/memory.md` | high |
| Observability | yes — `docs/observability.md` (setup cookbooks for Jaeger / Honeycomb / Datadog) | high |
| Audit feature | yes — `docs/user-guide.md` section, FAQ Q&A, README mention, BACKLOG E8 entry | high |
| Templates | partial — `templates/README.md` is brief; per-artifact "how to fill it out" guides exist for brief / design-spec / runbook (recent tier 3 uplift), but **not for the other 9 templates** (build, clarification, pr-summary, pre-review, retrospective, review, test-report, adr, plus the new audit templates). |

#### Finding D1: 9 of 12 pipeline templates lack a "how to fill it out" doc

- **Where:** `templates/` has 12 templates; `docs/` has annotated guides for only `brief-template.md`, `design-spec-template.md`, `runbook-template.md`.
- **Missing guides:** `build-template.md`, `clarification-template.md`, `pr-summary-template.md`, `pre-review-template.md`, `retrospective-template.md`, `review-template.md`, `test-report-template.md`, `adr-template.md`, plus the new `templates/audit/*` (which arguably don't need guides because the audit skill is self-contained).
- **Risk:** medium — agents filling these templates have to infer structure from the template alone. Briefs / design specs / runbooks are the artifacts users care about most, so those got annotated first; the rest are mostly for agent consumption and the agent has the role brief for context.
- **Suggested action:** decide whether to keep this asymmetric (only "human-readable" artifacts get annotation docs) or finish the set. Closing the gap is ~9 doc files of moderate size (~500 lines total).
- **Confidence:** HIGH

## API documentation

Stagecraft has no public HTTP API surface. Its "API" is:

- The CLI (`bin/devteam` subcommands) — documented in `bin/devteam help` and `docs/user-guide.md`.
- The host adapter contract (`core/adapters/host-adapter.md`) — formal interface definition.
- The gate JSON schemas (`core/gates/schemas/`) — machine-readable contracts.

All three are well-documented.

## Inline documentation

Audit mostly clean. JSDoc-style comments are sparse — the style is to use plain comments above non-obvious blocks rather than full JSDoc. This is consistent with the project's stated preference for terse comments.

#### Finding D2: some hot files have lighter comment density than the complexity warrants

- **`core/orchestrator.js`** (493 LOC) — the `computeDispatchPlan` function (lines 37-58) does the fanout expansion that drives multi-host adversarial review. The function is correct but a one-line comment block explaining the fanout math (`roles × hosts` matrix → `(role, hostName, workstreamId, gateFile)` tuples) would help.
- **`core/hooks/approval-derivation.js`** (313 LOC) — the `hostFromPath()` function (added during fanout work) takes a review filename and returns either a known host or `null`. The implicit contract (what counts as a "known host") is in `KNOWN_HOSTS` but the calling convention isn't documented inline.
- **Severity:** low. Both are working code; the comment gaps are friction for a new contributor, not a correctness risk.
- **Suggested action:** add 2-3 lines of comment above each function as a follow-up. Not a P0.

## Stale docs

Spot-checked. The recent audit-driven cleanup caught most stale refs:

- ✅ `ARCHITECTURE.md` dangling `scripts/audit.js` — fixed in audit feature commit.
- ✅ `docs/GAP-ANALYSIS.md` — rewritten as historical retrospective during doc uplift.
- ✅ `docs/TESTING.md` — rewritten to reflect current state (was strategy doc with tier 1/2 as TODO).

One residual:

#### Finding D3: `docs/TESTING.md` claims "362 tests / 24 files" — actual is 378 / 25

- **Where:** `docs/TESTING.md` opening summary line.
- **Why:** the doc was last updated when the audit P1 commit landed (+15 tests for headless + release). The subsequent audit feature commit added 9 more tests + 1 file but didn't re-update TESTING.md's summary line.
- **Suggested action:** update the line to "378 tests across 25 files." Or change the wording to "growing" / "see `npm test` output" to avoid future drift.
- **Confidence:** HIGH

## Onboarding test

Walk through the README's First-30-minutes checklist mentally:

1. ✅ Install: `git clone … && npm install && npm link` — clear.
2. ✅ Initialize a target: `mkdir /tmp/scratch && cd /tmp/scratch && devteam init --host claude-code` — clear.
3. ✅ `devteam doctor` should be all green — verified in this audit.
4. ⚠️ Read EXAMPLE.md — the doc is now 22KB with a step-by-step walkthrough at the top (recent onboarding-gap fix). Good.
5. ⚠️ Run one full pipeline yourself — would the new user know they need a Claude Code session? The Quick Start now explains both paths; EXAMPLE shows both. **Should land.**
6. ✅ Inspect the audit trail with `ls pipeline/gates/`.

#### Finding D4: no end-to-end "I just typed `devteam stage`, what now?" video / GIF

- **Risk:** low. The onboarding-gap fix added a textual walk-through which is sufficient for most. But a 60-second screen recording showing the two-window dance for Path B would be a much higher-bandwidth onboarding artifact.
- **Suggested action:** record once, link from README + EXAMPLE. Not in scope for a doc audit, but worth flagging.
- **Confidence:** LOW (preference, not a gap)

## Project-Specific

*(No `docs/audit-extensions.md` is present.)*
