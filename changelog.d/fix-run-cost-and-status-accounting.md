- **A run's reported cost now includes every dispatch, not just the surviving
  gates.** `costUsdDetail` summed the gates on disk, and a review round-trip
  archives then prunes the first attempt's build/QA/review gates when the retry
  passes — so run E (2026-09-05, seven dispatches, $13.31 on the gates) ended
  with `$5.17 spent`, while `tokens_used` was right because tokens are summed
  from the append-only corpus. Cost now takes the same path: `initRunState`
  freezes the gates' cost once as a baseline (stages run by hand before
  `devteam run`) and `currentCostUsage()` adds every corpus row for the run's
  ids. The `--budget-usd` guard, heartbeats, and the final summary all read it.
  A resumed state that predates the field gets a zero baseline so its earlier
  dispatches, already in the corpus, are not counted twice.
- **Corpus rows carry derived cost.** `recordDispatch` took a host-reported
  `cost_usd` or the model's self-report and ignored `cost_usd_derived`, so every
  omp and codex dispatch landed in `.devteam/corpus/dispatches.jsonl` with
  `cost_usd: null` — the seven rows of run E summed to $0.00. Precedence is now
  observed > derived > model-asserted, matching `costEntryForGate`, and
  `cost_basis: "derived"` names the middle case. Besides making the run total
  possible, this is the cost coverage the evidence layer had been missing from
  those hosts.
- **`devteam status` reads the last status-bearing event, not the last line.**
  Run-end bookkeeping (`evals-resolution-linked`, pattern collection) is appended
  after `complete`, so a finished run reported `running`. Status now walks back
  to the last progress or terminal outcome.
