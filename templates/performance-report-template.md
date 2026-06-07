# Performance Budget Report — Stage 6e

**Feature:** <!-- brief.md §Feature name -->  
**Date:** <!-- ISO-8601 -->  
**QA:** <!-- host name, e.g. claude-code / codex / gemini-cli -->  
**Change scope:** <!-- which pages / endpoints / bundles were affected -->

---

## 1. Budget source

<!-- Where do the thresholds come from? -->
- [ ] `performance.budget.json` (project-configured)
- [ ] `.devteam/config.yml` under `performance.budgets`
- [ ] Stagecraft defaults (no project budget file found)

If using defaults, list them here:

| Metric | Default threshold |
|--------|------------------|
| Lighthouse score | ≥ 0.80 |
| LCP | ≤ 2500ms |
| INP | ≤ 200ms |
| CLS | ≤ 0.10 |
| Bundle delta | ≤ 50KB |
| Load p95 | ≤ 200ms |
| Load error rate | ≤ 1% |

---

## 2. Checks performed

<!-- Delete sections for checks you DID NOT run; explain why in §6 Skipped -->

### 2a. Lighthouse (Web Vitals)

**URL audited:** <!-- e.g. http://localhost:3000/dashboard -->  
**Tool:** <!-- lighthouse-cli / @lhci/cli / lighthouse npm script -->  
**Build mode:** <!-- production / development — must be production -->

| Metric | Result | Budget | Status |
|--------|--------|--------|--------|
| Overall score | <!-- e.g. 0.91 → 91/100 --> | ≥ <!-- budget --> | ✅/⚠️/❌ |
| LCP | <!-- ms --> | ≤ <!-- ms --> | ✅/⚠️/❌ |
| INP | <!-- ms --> | ≤ <!-- ms --> | ✅/⚠️/❌ |
| CLS | <!-- unitless --> | ≤ <!-- threshold --> | ✅/⚠️/❌ |
| FCP | <!-- ms --> | ≤ <!-- ms --> | ✅/⚠️/❌ |
| TTFB | <!-- ms --> | ≤ <!-- ms --> | ✅/⚠️/❌ |

**Command used:**
```bash
# paste exact command
```

**Key findings / context:**  
<!-- What drove any regressions? Any new image, script, or font? -->

---

### 2b. Bundle size

**Tool:** <!-- bundlesize / size-limit / du / esbuild --analyze -->  
**Output directory:** <!-- dist/ / build/ / .next/static/ -->

| Metric | Result | Budget | Status |
|--------|--------|--------|--------|
| Total bundle size | <!-- KB --> | ≤ <!-- KB or "unconstrained" --> | ✅/⚠️/❌ |
| Size delta vs. baseline | <!-- +/- KB --> | ≤ <!-- KB --> | ✅/⚠️/❌ |

**Command used:**
```bash
# paste exact command
```

**Top contributors to delta (if delta > 10KB):**
<!-- e.g. "added lodash/cloneDeep: +8KB; removed moment: -4KB; net +4KB" -->

---

### 2c. Load test

**Tool:** <!-- k6 / autocannon / wrk / artillery / locust -->  
**Scenario:** <!-- e.g. "steady 10 VUs for 30s against GET /api/users" -->  
**Base URL:** <!-- where the test hit (local, staging, etc.) -->

| Metric | Result | Budget | Status |
|--------|--------|--------|--------|
| p95 latency | <!-- ms --> | ≤ <!-- ms --> | ✅/⚠️/❌ |
| p99 latency | <!-- ms --> | — | — |
| Throughput (RPS) | <!-- req/s --> | ≥ <!-- req/s or "unconstrained" --> | ✅/⚠️/❌ |
| Error rate | <!-- e.g. 0.3% --> | ≤ <!-- e.g. 1% --> | ✅/⚠️/❌ |

**Command used:**
```bash
# paste exact command
```

**Observations:**  
<!-- Any hotspots, timeouts, or unexpected errors from the server logs? -->

---

## 3. Overall result

| Check | Budget met? |
|-------|-------------|
| Lighthouse | ✅ PASS / ⚠️ WARN / ❌ FAIL |
| Bundle | ✅ PASS / ⚠️ WARN / ❌ FAIL |
| Load test | ✅ PASS / ⚠️ WARN / ❌ FAIL |
| **Overall** | **✅ PASS / ⚠️ WARN / ❌ FAIL** |

**Budget exceeded?** Yes / No  
<!-- If yes, list each failing metric: "LCP 3200ms > 2500ms budget; p95 250ms > 200ms budget" -->

---

## 4. Blockers (budget exceeded)

<!-- Delete this section if budget_exceeded: false -->

| Metric | Actual | Budget | Fix recommendation |
|--------|--------|--------|-------------------|
| <!-- e.g. LCP --> | <!-- ms --> | ≤ <!-- ms --> | <!-- lazy-load hero image, preconnect fonts, etc. --> |

---

## 5. Warnings (near-budget)

<!-- Metrics within 10% of limit. Not blocking but worth monitoring. -->
<!-- Delete if none. -->

| Metric | Actual | Budget | Note |
|--------|--------|--------|------|
| | | | |

---

## 6. Skipped checks

<!-- Explain why any check was not run. "No time" is not acceptable — skip only when the change genuinely has no surface for that check. -->

| Check | Reason |
|-------|--------|
| <!-- check name --> | <!-- e.g. "Backend-only change; no pages were modified" --> |

---

## 7. Environment notes

- **Local app command:** <!-- e.g. `npm run preview` / `docker-compose up` -->
- **Node version:** <!-- node -v output -->
- **Build command:** <!-- npm run build -->
- **Platform:** <!-- e.g. macOS M2, Linux x86-64 — Lighthouse scores are hardware-sensitive -->
