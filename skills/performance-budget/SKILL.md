---
name: performance-budget
description: "Measure Lighthouse performance scores, bundle size delta, and/or k6 load-test throughput at Stage 6e. Compares against project budgets (performance.budget.json or .devteam/config.yml defaults). Produces pipeline/performance-report.md and writes the stage-06e gate. Gate FAILs when any budget is exceeded. Skip with skipped_reason for changes with no performance-relevant surface."
---

# Performance budget

Use this skill at Stage 6e (after QA, on full / quick / hotfix tracks). Measures the three performance dimensions relevant to the change — Lighthouse Web Vitals, bundle size delta, and load-test throughput — and compares each against configured budgets.

## When to use each check

| Check | Use when |
|-------|----------|
| **Lighthouse** | Frontend change touched a page or route (new component, redesigned flow, added asset loading) |
| **Bundle size** | Change adds/removes JS or CSS that is bundled (new import, removed dependency, asset optimization) |
| **Load test** | Change modifies an HTTP endpoint, adds a new API route, or changes a query/computation that runs on every request |

**When to skip entirely**: If the change is purely backend with no HTTP surface change, doc-only, or infra config with no throughput impact, set `skipped_reason` and status PASS.

## Budget thresholds

Look for budgets in this order:

1. `performance.budget.json` at the project root (preferred — machine-readable, shareable)
2. `.devteam/config.yml` under `performance.budgets.*`
3. These defaults when no config exists:

| Metric | Default budget |
|--------|---------------|
| Lighthouse score | ≥ 0.80 (80/100) |
| LCP | ≤ 2500ms |
| INP | ≤ 200ms |
| CLS | ≤ 0.1 |
| Bundle total | — (warn only; no hard limit without explicit config) |
| Bundle delta | ≤ 50KB per PR |
| Load p95 | ≤ 200ms |
| Load error rate | ≤ 1% |

If `performance.budget.json` is absent, record that in the report and note which defaults were applied.

## Procedure

### 1. Scope the change

Read `pipeline/brief.md`, `pipeline/design-spec.md`, and `pipeline/test-report.md`. Identify:
- Which pages or routes were touched (for Lighthouse)
- Whether new assets / imports were added (for bundle)
- Which endpoints were modified (for load test)

Based on the scope, decide which of the three checks to run. Record what you chose (and why you skipped any check) in the report.

### 2. Read the budgets

```bash
# Check for project budget file
cat performance.budget.json 2>/dev/null || echo "No performance.budget.json found"

# Check config
cat .devteam/config.yml | grep -A 20 "performance:" || echo "No config section"
```

### 3. Lighthouse audit (if frontend changes)

Start the app locally or point at a staging URL from the brief.

**Using Lighthouse CLI:**
```bash
npx lighthouse <URL> \
  --output json \
  --output-path pipeline/lhci-result.json \
  --only-categories performance \
  --chrome-flags="--headless --no-sandbox"

# Extract the score
node -e "const r = require('./pipeline/lhci-result.json'); \
  console.log('score:', r.categories.performance.score); \
  console.log('LCP:', r.audits['largest-contentful-paint'].numericValue); \
  console.log('INP:', r.audits['interaction-to-next-paint']?.numericValue ?? 'N/A'); \
  console.log('CLS:', r.audits['cumulative-layout-shift'].numericValue); \
  console.log('FCP:', r.audits['first-contentful-paint'].numericValue); \
  console.log('TTFB:', r.audits['server-response-time'].numericValue)"
```

**Using Lighthouse CI (`@lhci/cli`):**
```bash
npx lhci autorun --config=lighthouserc.js
```

**Using `npm run lighthouse`** (check `package.json scripts` first — many projects already configure this):
```bash
cat package.json | jq '.scripts | to_entries[] | select(.key | contains("lighthouse", "perf", "lhci"))'
```

Record: `score`, `lcp_ms`, `inp_ms`, `cls`, `fcp_ms`, `ttfb_ms`, `url`, `tool`.

Compare against budget. Any metric exceeding budget → `budget_exceeded: true` → stage FAIL.

### 4. Bundle size (if bundled JS/CSS changed)

**Using `bundlesize`** (if configured in package.json):
```bash
npx bundlesize
```

**Using `size-limit`**:
```bash
npx size-limit
```

**Manual delta calculation** (always works, no extra tool):
```bash
# Build and measure
npm run build 2>/dev/null || yarn build 2>/dev/null

# Total size of all JS bundles
find dist/ build/ .next/static/chunks/ -name "*.js" -not -name "*.map" \
  -exec du -k {} + 2>/dev/null | awk '{sum += $1} END {print sum "KB total"}'

# Or use du on the entire output dir
du -sh dist/ build/ .next/ out/ 2>/dev/null | head -5
```

**Delta vs baseline:** If git diff shows the bundle changed:
```bash
# Get baseline size from main/master
git stash && npm run build && du -sk dist/ > /tmp/baseline_size.txt && git stash pop
npm run build && du -sk dist/ > /tmp/current_size.txt
echo "baseline: $(cat /tmp/baseline_size.txt)  current: $(cat /tmp/current_size.txt)"
```

Record: `total_size_kb`, `delta_kb`, `budget_kb`, `delta_budget_kb`, `budget_exceeded`.

### 5. Load test (if API / endpoint changed)

**Using k6:**
```bash
# Run the project's existing k6 script, or create a minimal one
cat k6/*.js k6.config.js 2>/dev/null | head -50  # check for existing scripts

# If no script exists, create a minimal one:
cat > /tmp/k6_perf.js <<'EOF'
import http from 'k6/http';
import { check, sleep } from 'k6';
export const options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<200'],
    http_req_failed: ['rate<0.01'],
  },
};
export default function () {
  const r = http.get('http://localhost:3000/api/health');
  check(r, { 'status 200': (r) => r.status === 200 });
  sleep(0.1);
}
EOF
k6 run /tmp/k6_perf.js --out json=/tmp/k6_result.json
```

**Using autocannon** (Node-native):
```bash
npx autocannon -c 10 -d 30 --json http://localhost:3000/api/health > /tmp/ac_result.json
node -e "const r = require('/tmp/ac_result.json'); \
  console.log('p95:', r.latency.p97_5 + 'ms'); \
  console.log('rps:', r.requests.average)"
```

Record: `tool`, `scenario`, `p95_ms`, `p99_ms`, `rps`, `error_rate`, `budget_p95_ms`, `budget_rps`, `budget_error_rate`, `budget_exceeded`.

### 6. Compute gate status

```
budget_exceeded = (lighthouse.score < budget_score)
               OR (lighthouse.lcp_ms > budget_lcp_ms)
               OR (bundle.budget_exceeded)
               OR (load_test.budget_exceeded)
```

- `budget_exceeded: true` → `status: "FAIL"` — list the failing metrics in `blockers[]`
- All budgets met, but some metrics are within 10% of limit → `status: "WARN"`, note in `warnings[]`
- All budgets met → `status: "PASS"`

### 7. Write the report and gate

Write `pipeline/performance-report.md` using the template at `templates/performance-report-template.md`. Then write `pipeline/gates/stage-06e.json`.

**Gate shape:**
```json
{
  "stage": "stage-06e",
  "status": "PASS",
  "orchestrator": "<from descriptor>",
  "track": "<from descriptor>",
  "timestamp": "<ISO-8601>",
  "blockers": [],
  "warnings": [],
  "checks_performed": ["lighthouse", "bundle"],
  "lighthouse": {
    "score": 0.91,
    "lcp_ms": 1850,
    "inp_ms": 95,
    "cls": 0.04,
    "fcp_ms": 720,
    "ttfb_ms": 180,
    "budget_score": 0.80,
    "url": "http://localhost:3000/dashboard",
    "tool": "lighthouse-cli"
  },
  "bundle": {
    "total_size_kb": 312,
    "delta_kb": 8,
    "budget_kb": null,
    "delta_budget_kb": 50,
    "budget_exceeded": false,
    "tool": "du"
  },
  "load_test": null,
  "budget_exceeded": false,
  "skipped_reason": null
}
```

**When skipping entirely:**
```json
{
  "status": "PASS",
  "checks_performed": [],
  "lighthouse": null,
  "bundle": null,
  "load_test": null,
  "budget_exceeded": false,
  "skipped_reason": "Backend-only change (new /internal/metrics endpoint). No customer-facing page was modified. No bundle change. Load envelope is unchanged."
}
```

## Common failure modes and fixes

| Failure | Cause | Fix |
|---------|-------|-----|
| Lighthouse score dropped | Large new image, render-blocking script, extra fonts | Optimize images (WebP, lazy-load), defer non-critical scripts, preconnect fonts |
| LCP regression | Slow hero image, unoptimized LCP element | Preload LCP image, use `fetchpriority="high"`, serve from CDN |
| Bundle delta > budget | New dependency or feature flag payload | Check if new import has a lighter alternative; tree-shake; code-split |
| p95 latency exceeded | New synchronous DB query on hot path | Profile with clinic.js / py-spy; cache, index, or async the query |
| Error rate exceeded | Unhandled edge case or timeout at load | Check server logs from the test run; fix or tune timeout |

## Notes

- **Run tests in a clean environment**: Local dev mode is not representative. Use a production build (`NODE_ENV=production`) on a machine not under other load.
- **Lighthouse needs a running server**: Start the app first. Many projects have a `preview` or `serve` npm script.
- **Load test against staging if local isn't possible**: Record the base URL used so results are reproducible.
- **No tool installed?** Record `attempted_but_blocked:<check>` in `checks_performed` and add a warning explaining the install path. Don't fabricate numbers.
