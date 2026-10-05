# Application performance

## First pass — 5 October 2026

Branch: `codex/performance-1005a`, based on `9621dfc7`.

The dashboard shell now starts its Clerk user lookup and scoped onboarding check together. The connection check selects at most one ID per table instead of counting every shop and mailbox. Failed queries or missing scope do not establish that onboarding is required. The onboarding redirect runs outside the error handler; previously the handler also swallowed Next's redirect exception.

Dashboard activity still waits for its shop lookup. Support analytics and return tracking start without waiting for that shop. The inbox loader runs threads/tags, messages/attachments, and member/profile lookups in parallel after resolving authorized mailbox IDs. Dependent queries retain their ordering and existing filters. List-only inbox navigation still excludes message bodies and attachments.

A shared dashboard `loading.jsx` gives routes a skeleton while server data loads. Inbox retains its specific loading skeleton. These changes do not add a cross-request data cache or change mutations, approvals, automation, V2 generation, or database schema.

## Evidence

- Production build passed, including lint, type checking and 161 static pages. Existing MJML/vendor dynamic-import and edge-runtime warnings remain.
- Eight new regression tests pass. They cover scheduling, query limits, optional body reads, scoped filters, error handling, and independent workspace requests.
- With fixed simulated query delays, the fully enriched inbox loader completes in **200 ms instead of 450 ms**, with the same seven reads and result. This is a dependency-scheduling test, not a measurement of browser or database speed. The standard inbox route requests fewer datasets and does not receive this entire reduction.
- A read-only probe against dev Supabase compared count and existence queries for one workspace over six alternating runs. Both produced identical connection flags. Count timings: 201, 69, 169, 149, 218, 107 ms. Existence timings: 294, 152, 196, 251, 136, 198 ms. This sample does **not** demonstrate a query latency improvement; existence reads bound database work as the tables grow.
- Authenticated Playwright smoke testing used local Chrome, a 1470 × 900 viewport, a production build on localhost:3107, and dev services. Dashboard, Customers, Analytics and Integrations navigations passed. Observed click-to-visible-heading timings were 905, 856, 826 and 837 ms. These are single after-change observations, include automation overhead, and do not establish a before/after gain or completion of every data request.
- Full Vitest run: 741 passed, 8 skipped, 3 failed. The same three failures were reproduced with the changed existing source files restored to the base revision: two landing pricing expectations and a real knowledge evaluation missing environment variables. They are outside this change.

Raw local evidence and repeatable probes live in `/tmp/sona-performance-1005a/`. No customer emails or screenshots were uploaded. The production server's port and process working directory were verified against this worktree.

## Rules for future changes

Measure production builds: development compilation can dominate local navigation time. Record both visible feedback and completion of the data the user needs. Keep before/after runs comparable in viewport, route, dataset and network conditions.

Start independent reads together. Wait for authorization and workspace scope before querying tenant data. Fetch message bodies only when needed. Prefer bounded existence queries when a total is unused.

Any cache must include account and workspace identity, have a defined invalidation policy, and handle workspace switches and mutations. Do not trade freshness or tenant isolation for a lower timing number. This pass does not introduce such a cache.
