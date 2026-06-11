# 05 — Documentation gaps

## Summary

Documentation is **broad, deep, and actively maintained** — but has several specific gaps from the rapid feature cycle. Total doc surface is ~4,580 lines across 14 major files (README, ARCHITECTURE, AGENTS, CONTRIBUTING, user-guide, concepts, faq, methodology, FEATURES, conventions, 2 runbooks, 2 walkthroughs), plus 21 rule docs, 14 role briefs, 13 skill docs, and per-stage schemas with embedded descriptions. By doc-to-code ratio (~50%), this is unusually documentation-heavy — appropriate for a tool whose value depends on operator understanding.

The recent cycle (99 commits since 2026-05-28) added: `docs/conventions.md`, `docs/methodology.md`, `docs/FEATURES.md`, two runbooks (`escalation.md`, `fix-and-retry.md`), one walkthrough (`soc2-evidence-collector.md`), plus substantial updates to README, user-guide, FAQ. The "audit-modes" framing addition from PR #27 is the freshest content; it landed yesterday.

## Findings

### D-1 — `devteam derive-approvals` missing from README CLI reference (HIGH, HIGH confidence)

PR #26 shipped `devteam derive-approvals [<file>]` as a new CLI subcommand with 9 tests, runbook references in `docs/runbooks/fix-and-retry.md`, and an FAQ entry. **It was not added to the README CLI reference table** (`## CLI reference` section). All other recently-shipped subcommands (`ruling`, `restart`, `log`, `verify`, `replay`, `reproduce`) have one row each in that table; `derive-approvals` has zero.

```
$ grep -c "derive-approvals" README.md
0
```

**Impact**: discoverability — operators reading the README CLI reference won't know the command exists. They'd only find it via the runbook (if they hit a stage-05 quorum miss and read fix-and-retry.md Case 5) or the FAQ. The command is a small but real escape hatch for operators editing review files outside Claude Code; missing it from the reference table is a real gap.

**Recommended fix**: add a row to the README CLI reference table. ~3 lines.

### D-2 — Broken cross-reference to `docs/audit/10-roadmap.md` in user-guide (HIGH, HIGH confidence)

PR #28 moved the prior audit to `docs/audit-archive/2026-05-28-v0.4.0-initial-dogfood/` but did not update inbound links. Specifically:

- **`docs/user-guide.md` line 779**: `[\`docs/audit/10-roadmap.md\`](audit/10-roadmap.md) — sequenced batches with effort estimates. The self-audit identified 0 P0 items, 5 P1 quick wins, …` — link target is `docs/audit/10-roadmap.md`, which no longer exists at that path. Should be `audit-archive/2026-05-28-v0.4.0-initial-dogfood/10-roadmap.md`.
- **README.md line 226** and **user-guide line 736** also mention `docs/audit/10-roadmap.md` but as descriptive references to the canonical roadmap path (where the *current* audit's roadmap lands). These are correct in principle but currently point at a non-existent file (the path is reserved for the in-progress audit). Once Phase 3 of this audit lands the file, they resolve. So these two are "transient broken" rather than "broken pattern" — acceptable.

**Impact**: the user-guide:779 link 404s when clicked today.

**Recommended fix**: update user-guide:779 to point at the archive path. ~1 line. Roll into the PR that closes this audit — it's the same audit cycle's output, so the fix is self-contained.

### D-3 — `devteam ruling` documented in runbooks + README, not in user-guide or FAQ (MEDIUM, HIGH confidence)

`devteam ruling` is a new subcommand for ad-hoc Principal dispatch. Documentation distribution:

| Doc | References to `ruling` |
|---|---|
| README CLI reference | ✅ 1 (table row) |
| `docs/runbooks/escalation.md` | ✅ Several (operational use case) |
| `docs/user-guide.md` | ❌ 0 |
| `docs/faq.md` | ❌ 0 |
| `CHANGELOG.md` | ✅ (Unreleased) |

The user-guide is positioned as "daily-use reference" (README doc map line 43). A subcommand that an operator might reach for during an escalation has no entry in the daily-use reference — they have to find it via the README table (which mostly lists *what* it does, not *how* to use it) or via the escalation runbook (which assumes they already know to use it).

**Impact**: medium. Operators encountering an escalation in real work would find their way via the escalation runbook (which has a dedicated section on `ruling`). But the user-guide's "what commands exist and when to use which" framing has a gap.

**Recommended fix**: add a `### Ad-hoc Principal rulings` subsection to the user-guide under (probably) "When things go wrong" or right after "Daily loop". ~15 lines covering: when you'd want a ruling (a reviewer wrote `ESCALATE-to-Principal:` without a stage-09 dispatch; an architectural call comes up mid-pipeline), the basic invocation, where the ruling lands (`pipeline/context.md` under `## Principal Rulings`), and a pointer to the escalation runbook for the full flow.

### D-4 — Two role files registered but missing on disk (LOW, HIGH confidence) — **RETRACTED 2026-06-03**

**RETRACTED**: depends on C-1, which was a false reading. `hosts/claude-code/adapter.js` does not register `architect` or `data-engineer`; the names appear in the codebase only as word-uses for "architecture" the concept, not as agent identifiers. See `03-compliance.md` § C-1 RETRACTION for the full citation. No documentation gap exists; the original text below is preserved for audit-trail integrity.

---

**Original finding text (now retracted):**

Cross-reference with finding C-1 in `03-compliance.md`. `hosts/claude-code/adapter.js` registers `architect` and `data-engineer` in its `AGENT_DEFS`; neither has a `roles/<name>.md` file. From a documentation standpoint, this means the role definition for those two agents is implicit in the adapter's inline description (the `description` field on each AGENT_DEFS entry, used by Claude Code's subagent metadata). That's not the project's documented convention — role briefs are the single source of truth.

**Impact**: anyone reading `roles/` to learn about available roles will see 12 briefs, not 14. The inline descriptions in `hosts/claude-code/adapter.js` aren't discoverable as a "role catalogue."

**Recommended fix**: either author the two missing briefs or remove the registrations. See finding C-1.

### D-5 — Per-stage rules cover only stages 4–8 (LOW, HIGH confidence)

Cross-reference with finding C-2. `rules/stage-NN.md` exists for stages 4, 4a, 4b, 5, 6, 6b, 7, 8. Not for 1, 2, 3, 3b, 4c, 4d, 6c, 6d, 9.

**Impact**: minor — those stages have less procedural depth and their rules live in role briefs and `rules/pipeline.md`. But the asymmetry will confuse anyone reading `rules/` and wondering why some stages have dedicated files and others don't.

**Recommended fix**: add a one-line note to `rules/pipeline-build.md` (the now-30-line index) explaining the split intentionally covers stages 4-8 only and where the others live. Cheap.

### D-6 — `BACKLOG.md` partly stale: items struck through inline rather than removed (LOW, MEDIUM confidence)

`docs/BACKLOG.md` uses the convention `~~item~~ ✅ landed` for shipped items rather than removing them. Spot-checking the first 50 lines: A1 (Gemini CLI), B1 (Accessibility audit), B4 (Observability gate), B5 (Migration safety) all show this pattern. That's intentional historical preservation, but at 99 commits since the 2026-05-28 audit, the list has grown noisy. Many items now shipped are still listed.

**Impact**: a reader scanning BACKLOG.md for "what's next" has to skip past completed items. Not blocking, but increases cognitive load.

**Recommended fix**: optional. Either keep the convention (preserves history) or migrate shipped items to a `### Shipped` section at the top with a date column. The latter would make "what's left" scannable. ~30 minutes of doc editing.

### D-7 — No documentation of `core/log/journal.js` event semantics (LOW, MEDIUM confidence)

`devteam log` was introduced in PR #23 with a `--follow` mode for tailing the pipeline directory. It builds a chronological event timeline (`buildEvents`, `summarizeGate`, `summarizeArtifact`). The CLI is documented in README and user-guide (4 refs); the **event-shape semantics** (what fields each event carries, what the JSON output of `--follow --json` looks like) are not documented anywhere explicit.

**Impact**: low — anyone building tooling on top of `devteam log --json` would need to read `core/log/journal.js` directly. That's actually OK for a stable internal format, but if external integrations land (CI dashboards, audit-trail compliance tools), the JSON shape would benefit from a documented contract.

**Recommended fix**: optional, low priority. ~15 lines in `docs/observability.md` or a new `docs/log-schema.md`. Defer until external integration emerges.

### D-8 — `docs/methodology.md` is 94 lines; was added recently and is the shortest of the major docs (POSITIVE finding, no action)

The recent addition of `docs/methodology.md` (PR sequence in late May) compactly captures the methodology Stagecraft enforces — ATDD loop, phase-gate progression, adversarial red-team layer, multi-role peer review, four coding principles. At 94 lines, it punches above its weight: it explains *why* the pipeline is shaped this way, which was missing before. This is the kind of doc that prevents the "we follow this process — why?" question that often blocks adoption.

No action; flagging because doc additions often correlate with team-formation moments (when answers need to be in writing because the team is no longer 1 person). Worth preserving and elaborating as use cases pile up.

## Cross-document consistency

Inbound link integrity check on the README's `## Documentation map` section: all 20 internal links resolve to existing files (only `docs/audit/10-roadmap.md` references are transient-broken, see D-2).

`docs/concepts.md` (the vocabulary doc) is consistent with code: every primitive named in concepts.md has a corresponding code location (verified by spot-check of stage/role/workstream/host/gate/track).

`docs/FEATURES.md` (329 lines) is a comprehensive list of shipped features and looks current — every recently-merged PR's feature appears (auto-fold, orchestrator-stamped verification, derive-approvals, ruling, restart, log, etc.).

`docs/conventions.md` (222 lines, new in this cycle) catalogues the inter-agent marker vocabulary cleanly. No drift between conventions.md and the validator's auto-injection logic (both reference the same marker tags: `## Brief Changes`, `## Verify`, `## Out of Scope — Noticed`, `## Principal Rulings`, `## Deferred follow-ups`).

## What's working well

- **Doc velocity tracks code velocity.** 99 commits in 6 days, with doc-related files in the top 5 churn list (CHANGELOG, user-guide, README, BACKLOG, FAQ). Documentation is not treated as a post-hoc afterthought.
- **Hierarchical structure.** README → doc map → user-guide / FAQ / runbooks / walkthroughs. Discoverable from any entry point.
- **Recent rationalization** (PR #27 audit-section cleanup) demonstrates active stewardship: when duplication was identified, it was fixed; when bugs surfaced in the README (the `devteam stage audit` command that doesn't exist), they were corrected.
- **Walkthroughs.** Two end-to-end traces — `stage-04-split-host.md` (multi-workstream contract stress test) and `soc2-evidence-collector.md` (full 18-stage trace). The latter is the recommended onboarding artifact and at 460 lines, it's a substantial commitment to showing-not-telling.
- **Doc-as-test discipline** for the consistency check (`scripts/consistency.js` enforces 221 cross-artifact invariants between code, docs, and configs). This catches drift between role briefs and code; between stage definitions and rules; between CHANGELOG entries and shipped features.
