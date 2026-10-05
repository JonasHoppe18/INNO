# Application performance

## First pass — 5 October 2026

Branch: `codex/performance-1005a`, based on `9621dfc7`.

The dashboard shell now starts its Clerk user lookup and scoped onboarding check together. The connection check selects at most one ID per table instead of counting every shop and mailbox. Failed queries or missing scope do not establish that onboarding is required. The onboarding redirect runs outside the error handler; previously the handler also swallowed Next's redirect exception.

Dashboard activity still waits for its shop lookup. Support analytics and return tracking start without waiting for that shop. The inbox loader runs threads/tags, messages/attachments, and member/profile lookups in parallel after resolving authorized mailbox IDs. Dependent queries retain their ordering and existing filters. List-only inbox navigation still excludes message bodies and attachments.

A shared dashboard `loading.jsx` gives routes a skeleton while server data loads. Inbox retains its specific loading skeleton. Icon-rail links explicitly prefetch full routes, so the new loading boundary does not limit them to partial prefetch. These changes do not add a cross-request data cache or change mutations, approvals, automation, V2 generation, or database schema.

## Evidence

- Production build passed, including lint, type checking and 161 static pages. Existing MJML/vendor dynamic-import and edge-runtime warnings remain.
- Eight new regression tests pass. They cover scheduling, query limits, optional body reads, scoped filters, error handling, and independent workspace requests.
- With fixed simulated query delays, the fully enriched inbox loader completes in **200 ms instead of 450 ms**, with the same seven reads and result. This is a dependency-scheduling test, not a measurement of browser or database speed. The standard inbox route requests fewer datasets and does not receive this entire reduction.
- A read-only probe against dev Supabase compared count and existence queries for one workspace over six alternating runs. Both produced identical connection flags. Count timings: 201, 69, 169, 149, 218, 107 ms. Existence timings: 294, 152, 196, 251, 136, 198 ms. This sample does **not** demonstrate a query latency improvement; existence reads bound database work as the tables grow.
- Full Vitest run: 741 passed, 8 skipped, 3 failed. The same three failures were reproduced with the changed existing source files restored to the base revision: two landing pricing expectations and a real knowledge evaluation missing environment variables. They are outside this change.

Raw local evidence and repeatable probes live in `/tmp/sona-performance-1005a/`. No customer emails or screenshots were uploaded. The production server's port and process working directory were verified against this worktree.

## Browser before/after — 5 October 2026

Measured application code: base `9621dfc7` versus `b4c209c0`. Both ran as local production builds against dev services. Same authenticated Clerk session and 1470 × 900 Chrome viewport; no throttling. Each scenario used a new page, six runs per version, with the first run excluded as warm-up. Version order alternated. The table reports medians of five measured runs.

For navigation, each page first opened Integrations and allowed one second for ordinary sidebar prefetch. Timings start at the browser click event, excluding Playwright's click preparation. Initial-load timing starts at navigation's browser time origin.

“Feedback” means a new target heading or route skeleton appeared in the DOM. This is not a pixel-paint/LCP measurement. Customers/Analytics “data” means the main API response body finished downloading; all measured responses were HTTP 200. Dashboard “page” means its server-rendered heading appeared after the page's data loader completed. These data/page metrics do not include every background request or guarantee all client rendering finished.

| Scenario | Feedback before | Feedback after | Data/page before | Data/page after | Change in data/page time |
| --- | ---: | ---: | ---: | ---: | --- |
| Dashboard — first load | 666 ms | 374 ms | 666 ms | 437 ms | 34% faster |
| Dashboard — navigation | 396 ms | 22 ms | 396 ms | 21 ms | 95% faster |
| Customers — navigation | 54 ms | 25 ms | 464 ms | 364 ms | 22% faster |
| Analytics — navigation | 54 ms | 26 ms | 565 ms | 603 ms | 7% slower |

Analytics data was **7% slower** in this sample. The PR does not demonstrate faster Analytics fetching. Live service/network timings varied; five samples do not establish statistical significance. The Dashboard navigation improvement includes route prefetch/cache reuse and is not an uncached server-only speedup.

The first comparison found that the new loading boundary delayed target content on Customers/Analytics by limiting default icon-rail prefetch. Explicit full prefetch fixed that behavior; the table above measures the corrected implementation.

### Repeat the browser probe

Run two independently installed production builds on localhost:3108 (base) and localhost:3107 (PR), each configured for dev services and its own dashboard URL. From the PR repository root:

```sh
npm install --prefix /tmp/sona-performance-browser --no-audit --no-fund playwright
PERF_OUTPUT_FILE=/tmp/sona-navigation-measurements.json node scripts/performance/compare-navigation.cjs
```

The script reads local dev login credentials without printing them. Optional overrides: `PERF_BEFORE_URL`, `PERF_AFTER_URL`, `PERF_PLAYWRIGHT_PATH`, and `PERF_CHROME_PATH`. The defaults use macOS Google Chrome. Output contains timing numbers and status codes, not response bodies or customer identifiers.

### Measured samples

| Scenario | Metric | Before samples (ms) | After samples (ms) |
| --- | --- | --- | --- |
| Dashboard — first load | feedbackMs | 614, 666, 681, 569, 668 | 386, 413, 282, 374, 245 |
| Dashboard — first load | dataMs | 614, 666, 681, 569, 668 | 897, 511, 356, 437, 313 |
| Dashboard — navigation | feedbackMs | 441, 387, 592, 385, 396 | 20, 69, 32, 22, 20 |
| Dashboard — navigation | dataMs | 441, 387, 592, 385, 396 | 20, 370, 32, 21, 20 |
| Customers — navigation | feedbackMs | 54, 54, 52, 54, 48 | 22, 35, 25, 25, 28 |
| Customers — navigation | dataMs | 554, 517, 341, 464, 336 | 567, 730, 364, 292, 315 |
| Analytics — navigation | feedbackMs | 46, 117, 56, 45, 54 | 15, 127, 22, 27, 26 |
| Analytics — navigation | dataMs | 890, 698, 565, 532, 540 | 529, 1190, 629, 603, 526 |

## Rules for future changes

Measure production builds: development compilation can dominate local navigation time. Record both visible feedback and completion of the data the user needs. Keep before/after runs comparable in viewport, route, dataset and network conditions.

Start independent reads together. Wait for authorization and workspace scope before querying tenant data. Fetch message bodies only when needed. Prefer bounded existence queries when a total is unused.

Any cache must include account and workspace identity, have a defined invalidation policy, and handle workspace switches and mutations. Do not trade freshness or tenant isolation for a lower timing number. This pass does not introduce such a cache.
