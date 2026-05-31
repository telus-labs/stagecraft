# Walkthrough: SOC 2 evidence collector

A complete scenario for building `soc2-collect` — a CLI tool that automates SOC 2 Type II evidence collection — using the Stagecraft full pipeline. Use this as a showcase of what a structured AI dev pipeline produces that ad-hoc chat-based development doesn't.

---

## The scenario

You're a startup's engineering lead. Your first SOC 2 Type II audit is in 8 weeks. The auditor wants evidence for each of the 29 Common Criteria controls: access logs, encryption configs, change management records, incident timelines. Right now that means manually pulling screenshots from GitHub, AWS Console, and your ticketing system and dropping them into a shared folder. It takes a week and goes stale immediately.

`soc2-collect` automates that collection. Point it at your GitHub org, AWS account, and Terraform state, and it produces an audit-ready package: a structured `evidence.json` (one immutable record per piece of evidence, content-addressed) and a human-readable `report.md` (control-by-control status with gap reasons).

**Why this project showcases Stagecraft well:**

- 29 controls → 40+ acceptance criteria → 40+ Gherkin scenarios → 40+ tests. The spec-tracing chain (`devteam spec verify`) catches drift the moment you add or remove a control.
- Three integrations (GitHub, AWS, Terraform) → natural multi-workstream build.
- Security review fires on a tool that handles AWS credentials and raw audit logs — exactly when you want it to.
- Red-team catches the cases that would embarrass a compliance tool: collecting partial API pages and claiming PASS, credentials leaking into log output, silent failure on rate limits.
- The pipeline's own gate records — model version, prompt hash, timestamp — form a complete record of how the tool was designed and reviewed. For a SOC 2 tool, that's a feature.

---

## Prerequisites

```bash
# Stagecraft installed and on PATH
devteam --version

# Claude Code installed and authenticated
claude --version

# A GitHub token and AWS credentials available (for the actual tool to run later)
# Not needed to run the pipeline — only needed when soc2-collect itself runs
```

---

## Set up the project

```bash
mkdir soc2-collect && cd soc2-collect
git init
devteam init --host claude-code
devteam doctor          # should be all green before proceeding
```

Optionally, open the web UI in a second terminal and keep it open for the whole run:

```bash
devteam ui --open
```

---

## Run the pipeline

### Stage 1 — Requirements

```bash
devteam stage requirements --feature "Build a CLI tool called soc2-collect. \
It connects to a target company's GitHub org (via API token), AWS account \
(via CloudTrail + Config + IAM), and Terraform state files, and automatically \
collects evidence for the 29 SOC 2 Common Criteria controls (CC1 through CC9 series). \
It flags controls with insufficient evidence, maps each piece of evidence to the \
control it satisfies, and produces two outputs: evidence.json (machine-readable, \
one record per piece of evidence with source, collected_at, and evidence_hash) and \
report.md (human-readable summary by control, with PASS/PARTIAL/INSUFFICIENT status \
and a gap_reason for any control not at PASS). Primary user: a startup engineering \
or security lead preparing for their first SOC 2 Type II audit. \
Node.js CLI, no persistent database in v1 — stateless runs that can be re-run at any time." \
--track full
```

**What the PM produces:** `pipeline/brief.md` with numbered acceptance criteria. The 29 controls become 40-50 ACs because some controls need multiple evidence types. For example:

```
AC-1:  Given a GitHub org, when scanned for CC6.1 (logical access controls),
       evidence includes repo access policy, branch protection rules, required
       reviewer count, and last 90 days of member add/remove events.

AC-3:  Given insufficient GitHub permissions, when scanned, the tool reports
       INSUFFICIENT for affected controls with a specific gap_reason —
       it does not crash or silently omit controls.

AC-21: Given a Terraform state file, when scanned for CC6.7 (encryption in transit),
       evidence includes TLS listener configurations on any ALB or CloudFront
       distribution declared in state, confirmed ≥ TLS 1.2.
```

```bash
devteam next            # → run-stage design (stage-02)
```

---

### Stage 2 — Design

```bash
devteam stage design --headless
```

**What the Principal produces:** `pipeline/design-spec.md` with the architecture and at least one ADR.

The key ADR to watch for:

> *ADR-001: Evidence records are immutable and content-addressed. Each record carries `{control_id, source, collected_at, evidence_hash, raw}`. The hash is SHA-256 of the raw evidence payload. Re-running the tool on the same inputs should produce identical hashes if nothing in the environment changed — hash drift between runs signals an environment change.*

This decision becomes a binding constraint on every subsequent stage. QA will test hash stability. Peer review will check that no code path mutates a record after creation. If v2 of the tool tries to change the schema, the Principal's design stage queries the ADR store and finds ADR-001 before making the call.

```bash
devteam next            # → run-stage clarification (stage-03)
```

---

### Stage 3 — Clarification

```bash
devteam stage clarification --headless
```

Resolves open questions from design before build starts. Typical clarifications for this project: which CC controls are in scope for v1 vs deferred, what the minimum viable AWS IAM permissions are, how to handle orgs with thousands of repos (pagination strategy).

```bash
devteam next            # → run-stage executable-spec (stage-03b)
```

---

### Stage 3b — Executable spec

```bash
devteam stage executable-spec --headless
```

PM translates each `AC-N` from the brief into one Gherkin scenario in `pipeline/spec.feature`, tagged `@AC-N`.

```gherkin
@AC-1
Scenario: CC6.1 logical access evidence collected from GitHub
  Given a GitHub org with 3 repos
  And branch protection enabled on main in 2 of 3
  When soc2-collect runs with --integration github
  Then the CC6.1 evidence record includes branch_protection_coverage: 0.67
  And the record carries a stable evidence_hash
  And CC6.1 status is PARTIAL

@AC-3
Scenario: insufficient GitHub permissions produces gap reason not crash
  Given a GitHub token with read:org scope only
  When soc2-collect runs with --integration github
  Then exit code is 0
  And CC6.1 status is INSUFFICIENT
  And gap_reason contains "missing repo:read scope"
```

After this stage, run the drift check:

```bash
devteam spec verify
```

If it passes, every AC has a scenario. If you add a new control later, re-run this and the orphan AC shows up immediately.

```bash
devteam next            # → run-stage build (stage-04)
```

---

### Stage 4 — Build

```bash
devteam stage build --headless
```

Four workstreams run in parallel. Each writes its own gate:

| Workstream | Owns | Writes to |
|---|---|---|
| Backend | `src/integrations/`, `src/controls/`, `src/evidence/` | `pipeline/gates/stage-04.backend.json` |
| Frontend/CLI | `src/cli.js`, argument parsing, report generator | `pipeline/gates/stage-04.frontend.json` |
| Platform | `.env.example`, IAM policy template, config validation | `pipeline/gates/stage-04.platform.json` |
| QA | `test/fixtures/`, mock API responses, test harness | `pipeline/gates/stage-04.qa.json` |

```bash
devteam merge build     # aggregate four gates into stage-04.json
devteam next            # → run-stage pre-review (stage-04a)
```

---

### Stage 4a — Pre-review

```bash
devteam stage pre-review --headless
```

Platform runs lint, type-check, dep review, and the security heuristic. For `soc2-collect`, the security heuristic almost certainly sets `security_review_required: true` — the tool handles AWS credentials, GitHub tokens, and raw audit logs. This is expected and correct.

```bash
devteam next            # → run-stage security-review (stage-04b, conditional)
```

---

### Stage 4b — Security review (conditional)

Fires because pre-review flagged it.

```bash
devteam stage security-review --headless
```

What security review checks for this project in particular:

- Are credentials read from environment variables only, never from config files written to disk?
- Does any log statement include credential values or raw API tokens?
- Is the `evidence_hash` implementation collision-resistant? (SHA-256 is fine; MD5 is not.)
- Does the IAM policy template follow least privilege, or does it request `*:*`?
- Does the tool write raw audit data to disk in a way that could expose it to other processes?

A SOC 2 compliance tool that fails its own security review is an embarrassing gap. This stage catches it before peer review.

```bash
devteam next            # → run-stage red-team (stage-04c)
```

---

### Stage 4c — Red-team

```bash
devteam stage red-team --headless
```

The red-team role is routed to a different host than the build agents. For a compliance tool, the attack surfaces that matter most:

- **Partial API pages:** If the AWS CloudTrail API returns paginated results and the tool only reads page 1, it may see 3 of 47 load balancers and claim PASS on CC6.7. Does the collector handle pagination or report uncertainty?
- **Rate limiting mid-collection:** GitHub and AWS both rate-limit. If the tool hits a rate limit after collecting evidence for 15 of 29 controls, does it exit cleanly with the partial results labeled as partial, or does it silently omit the remaining 14?
- **Stale Terraform state:** The state file references a resource that no longer exists in AWS. Does the tool crash or report an evidence gap?
- **Overly broad IAM:** The user followed the docs and created an IAM role. Does the policy template actually follow least privilege, or did the build stage request more permissions than needed?
- **Evidence hash stability:** If the tool is run twice on the same account within the same day with no environment changes, do the hashes match? If not, the "hash drift signals environment change" story breaks.

Non-empty `must_address_before_peer_review` in the gate blocks the pipeline. The implementer addresses each item, re-runs build, red-team re-runs.

```bash
devteam next            # → run-stage migration-safety (stage-04d, conditional)
#                       # skipped in v1 — no database schema
devteam next            # → run-stage peer-review (stage-05)
```

---

### Stage 5 — Peer review

```bash
devteam stage peer-review --headless
```

With `review_fanout: [claude-code, codex, gemini-cli]` in `.devteam/config.yml`, each of the four review areas (backend, frontend, platform, QA) gets reviewed by three model families in parallel. 4 areas × 3 hosts = 12 parallel reviews.

Each reviewer is prompted adversarially: find the strongest objection to this change, not confirm it works.

For a compliance tool, the question is concrete: *does this code actually collect what it claims to collect for each control?* A cooperative reviewer (same model that wrote the integration code) shares the author's assumptions about what the GitHub API returns. An adversarial reviewer from a different model family will check the actual API docs and the actual response shape.

```bash
devteam next            # → run-stage qa (stage-06)
```

---

### Stage 6 — QA

```bash
devteam stage qa --headless
```

QA maps each `@AC-N` scenario to a test, 1:1. The gate requires `criterion_to_test_mapping_is_one_to_one: true`. The validator rejects a PASS gate without it.

```bash
devteam spec verify     # confirm brief ↔ spec ↔ tests still in sync
devteam next            # → run-stage accessibility-audit (stage-06b) — skipped (CLI only)
devteam next            # → run-stage observability-gate (stage-06c)
```

---

### Stage 6c — Observability gate

```bash
devteam stage observability-gate --headless
```

Brief §9 specified: the CLI should emit structured JSON logs when `--verbose` is set. Platform verifies that `pipeline/brief.md`'s observability signals (log lines for each integration start, each evidence record written, each gap flagged) are actually present in the shipped code.

```bash
devteam next            # → run-stage verification-beyond-tests (stage-06d)
```

---

### Stage 6d — Verification beyond tests

```bash
devteam stage verification-beyond-tests --headless
```

The verifier applies property-based testing to the evidence layer — the logic most likely to have subtle bugs:

```
Property: for any valid GitHub audit event shape,
  parseGithubEvent(event) either returns a valid EvidenceRecord
  or throws a typed ParseError — never undefined, never a partial record

Property: evidence_hash is deterministic —
  hash(record) === hash(record) for any record, always

Property: collect() is idempotent —
  running twice on the same API responses produces structurally
  identical output (same records, same hashes, same statuses)

Property: a PASS control always has at least one evidence record —
  no control reaches PASS status with an empty evidence array
```

A counterexample to any of these populates `blocking_findings[]` and fails the stage.

```bash
devteam next            # → run-stage sign-off (stage-07)
devteam stage sign-off --headless
devteam next            # → run-stage deploy (stage-08)
devteam stage deploy --headless
devteam next            # → run-stage retrospective (stage-09)
devteam stage retrospective --headless
# 🎉 pipeline-complete
```

Run `devteam summary` at any point to see the full pipeline state. After a completed run it looks like this:

```
Pipeline complete — soc2-collect v1.0.0-beta.1

All 9 stages finished with PASS or WARN:

┌───────────────────────┬────────┬────────────────────────────────────────────────────────────────────────────────┐
│         Stage         │ Status │                                  Key outcome                                   │
├───────────────────────┼────────┼────────────────────────────────────────────────────────────────────────────────┤
│ 01 requirements       │ PASS   │ 23 ACs, 33 CC controls confirmed                                               │
├───────────────────────┼────────┼────────────────────────────────────────────────────────────────────────────────┤
│ 02 design             │ PASS   │ Architecture, 5 ADRs, data-driven control mapping                              │
├───────────────────────┼────────┼────────────────────────────────────────────────────────────────────────────────┤
│ 03 clarification      │ PASS   │ All 10 OQs resolved, no scope changes                                          │
├───────────────────────┼────────┼────────────────────────────────────────────────────────────────────────────────┤
│ 03b executable-spec   │ PASS   │ 23 Gherkin scenarios 1:1 with ACs                                              │
├───────────────────────┼────────┼────────────────────────────────────────────────────────────────────────────────┤
│ 04 build              │ PASS   │ 6 collectors + engine + output; 170 tests                                      │
├───────────────────────┼────────┼────────────────────────────────────────────────────────────────────────────────┤
│ 04a–04c               │ PASS   │ 7 blocking findings fixed (OOM cap, secret redaction, log injection,           │
│ pre/sec/red-team      │        │ exit codes, Config observability)                                              │
├───────────────────────┼────────┼────────────────────────────────────────────────────────────────────────────────┤
│ 05 peer review        │ PASS   │ 2 blocking findings fixed (dry-run exit code, GitHub org member role)          │
├───────────────────────┼────────┼────────────────────────────────────────────────────────────────────────────────┤
│ 06 QA test execution  │ WARN   │ 184/184 tests pass; 16/23 ACs integration-only deferred                        │
├───────────────────────┼────────┼────────────────────────────────────────────────────────────────────────────────┤
│ 06b accessibility     │ PASS   │ Auto-skipped — pure CLI, no UI                                                 │
├───────────────────────┼────────┼────────────────────────────────────────────────────────────────────────────────┤
│ 06c observability     │ PASS   │ All design-spec §7 log events verified present                                 │
├───────────────────────┼────────┼────────────────────────────────────────────────────────────────────────────────┤
│ 06d verification      │ PASS   │ 14 fast-check property tests, 0 counterexamples                                │
├───────────────────────┼────────┼────────────────────────────────────────────────────────────────────────────────┤
│ 07 sign-off           │ PASS   │ PM signed off; runbook written                                                 │
├───────────────────────┼────────┼────────────────────────────────────────────────────────────────────────────────┤
│ 08 deploy             │ WARN   │ npm publish --dry-run successful; npm pkg fix resolves bin validation warning  │
├───────────────────────┼────────┼────────────────────────────────────────────────────────────────────────────────┤
│ 09 retrospective      │ PASS   │ 6 lessons promoted to pipeline/lessons-learned.md                              │
└───────────────────────┴────────┴────────────────────────────────────────────────────────────────────────────────┘

Source state: 184/184 tests passing. Build clean. Ready for npm publish --tag beta --access public once npm
credentials are available.
```

Two WARNs, zero FAILs: QA deferred 16 integration-only ACs (expected — no live AWS/GitHub in CI), and deploy ran as a dry-run. Both are documented in the gates and are not blockers for shipping.

---

## What the output looks like

After sign-off, `pipeline/gates/` has a gate file for every stage. `pipeline/brief.md`, `pipeline/design-spec.md`, `pipeline/spec.feature`, and `pipeline/code-review/` are all on disk. The pipeline is fully reconstructable from those files.

The tool itself produces:

```
evidence.json
  {
    "generated_at": "2026-05-30T14:22:11Z",
    "controls": {
      "CC6.1": {
        "status": "PASS",
        "evidence": [
          {
            "source": "github",
            "collected_at": "2026-05-30T14:21:55Z",
            "evidence_hash": "a3f8c2...",
            "summary": "Branch protection enabled on main across 12/12 repos"
          }
        ]
      },
      "CC6.7": {
        "status": "PARTIAL",
        "gap_reason": "TLS version unconfirmed on 2 ALBs (missing describe-listeners permission)",
        "evidence": [ ... ]
      }
    }
  }

report.md
  # SOC 2 Evidence Report — 2026-05-30

  | Control | Status | Summary |
  |---|---|---|
  | CC6.1 | ✅ PASS | Branch protection, access logs, member events — all present |
  | CC6.7 | ⚠️ PARTIAL | TLS confirmed on 5/7 load balancers; 2 need IAM permission |
  | CC7.2 | ❌ INSUFFICIENT | CloudTrail not enabled in us-west-2 |
  ...
```

---

## Timing reference

| Track | Stages | Approximate wall-clock |
|---|---|---|
| `full` | All 17 | 60-90 min |
| `quick` | 7 core stages | 20-30 min |

Run `quick` first to get a working prototype. Run `full` before any audit-facing use.

---

## Reproducing a specific run

Every gate optionally records `model_version`, `temperature`, `seed`, `system_prompt_hash`, and `tools_hash`. To replay any past stage and see what drifted:

```bash
devteam reproduce stage-04b    # security review — was the finding still valid with today's prompt?
devteam reproduce stage-06d    # verification — did the property counterexample reproduce?
```

For a SOC 2 tool specifically, this answers the auditor question: *how was this evidence collection tool itself validated, and by what process?* The answer is in `pipeline/gates/`.

---

## See also

- [`EXAMPLE.md`](../../EXAMPLE.md) — the canonical pipeline walkthrough (simpler feature, all 17 stages traced)
- [`docs/user-guide.md`](../user-guide.md) — daily reference: tracks, multi-host, headless mode
- [`docs/verification-beyond-tests.md`](../verification-beyond-tests.md) — property-based, mutation, and formal verification
- [`docs/red-team.md`](../red-team.md) — the 10 attack surfaces and gate fields
- [`docs/spec-authoring.md`](../spec-authoring.md) — writing AC-N criteria and using `devteam spec verify`
