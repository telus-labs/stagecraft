- **Add read-only evidence readiness** (audit P3-1, Phase 16.2). `devteam evidence
  status` uses bounded, symlink-rejecting readers to aggregate local run logs, current
  gates, and gate archives for #142–#145. It separates local progress from
  cross-project conditions, reports degraded inputs, excludes free-form content, and
  explicitly marks durable-routing and accepted-resolution signals that current
  records cannot prove.
