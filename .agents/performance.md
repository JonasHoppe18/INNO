# Application performance

## Implementation, 5 October 2026

PR #87 uses branch `codex/performance-1005a`, based on `9621dfc7`. Shared navigation changes apply throughout the authenticated app. Additional read optimizations target Inbox, Customers, Analytics, Knowledge, Integrations and Settings.

The dashboard shell starts its Clerk user lookup and scoped onboarding check together. Connection checks select at most one ID per table. Errors and missing scope do not establish that onboarding is required. Dashboard activity waits only for its shop lookup; analytics and return tracking start independently. A shared route skeleton and explicit full icon-rail prefetch make page transitions respond while data loads.

Read-only browser snapshots live for 15 seconds, with at most 20 entries and a one-million-character limit per result. Every key includes Clerk account, session and active organization. Identity changes and shell unmount clear memory. Pending duplicate reads share one promise; failures are not retained, and invalidated requests cannot restore old data. Customers lists/order counts, Analytics, Knowledge categories/saved replies, integration status and inbox previews use this cache. Explicit retries, saved-reply edits and integration refreshes bypass or invalidate it. Editable Settings forms, conversation detail, drafts and approval/action state remain fresh.

All integration cards share one status request. Inbox queue filters and Settings tabs use native History navigation for local query changes; normal links, new-tab clicks and server-dependent inbox parameters retain router navigation. Inbox hover prefetch starts after 150 ms instead of 700 ms, with the existing concurrency limit. Preview scope resolves the active organization and verifies membership rather than choosing the newest membership.

The server reuses a stateless service-role transport with session persistence and auto-refresh disabled. Each handler still authenticates and applies tenant scope. Only simultaneously running scope lookups share results; settled authorization is not cached. Analytics enrichment, Knowledge reads and independent thread-detail reads run in parallel. Settings bootstrap calls its nine existing protected handlers in parallel using `NextRequest`, preserving individual status codes and defaults. Settings uses the canonical server scope before considering compatibility fallbacks and does not cache form values.

No schema, V2 generation, automation execution or production deployment changed.

## Browser navigation

Base `9621dfc7` and candidate `295d12de` ran as independently installed local production builds against dev services. The Settings-specific `NextRequest` correction was rechecked at `5255cba9`. Chrome used a 1470 × 900 viewport with no throttling. Live network/service timings vary; these small samples are local evidence, not production guarantees.

The navigation probe uses real sidebar clicks and a fresh page per scenario. It allows one second for ordinary prefetch, alternates version order, and reports medians of five runs after one discarded warm-up. Feedback is a target heading or route skeleton appearing in the DOM, not pixel paint or LCP. Main data is response-body completion for Customers/Analytics; Dashboard page time is its server-rendered heading. Background requests are excluded from this table.

| Scenario | Feedback before/after, ms | Main data/page before/after, ms |
| --- | ---: | ---: |
| Dashboard first load | 663 / 273 | 663 / 325 |
| Dashboard navigation | 401 / 21 | 401 / 21 |
| Customers navigation | 53 / 21 | 353 / 318 |
| Analytics navigation | 49 / 20 | 639 / 412 |

## Route coverage and data reads

The route probe covers all 27 static authenticated route paths, three Knowledge category destinations, five guide redirects and one product-detail template. Two Greenfield routes are disabled in production builds and are excluded from latency claims. Marketing, auth and webhook routes are outside this app-navigation benchmark. Redirect paths are retained in the results, with the actual destination recorded.

Each version logs in separately as the same dev account/workspace. Each target gets a fresh browser page, starts from Integrations, and is then revisited twice within the snapshot lifetime. Integrations itself starts from Dashboard. The probe uses Next's debug router only in the test harness; application code uses Link/native History. It blocks app API and dev Supabase writes after login.

The following metric is time from navigation until the last observed initial API/Supabase GET body completes. It includes background reads such as test-mode and Customer order counts. It excludes RSC, scripts, Clerk requests and client rendering; it is not complete page-load or main-content time. On static routes, the sole GET can be a background banner rather than data blocking the screen. The first visit has one sample; revisit values are medians of two. Route-probe version order was not alternated and server warm-up was not identical, so first-visit rows are observations, not controlled cold-server comparisons. GET counts show first visit and both revisits. Artificial quiet-window waits are excluded from the reported metric.

| Route | First visit before/after, ms | Revisit before/after, ms | GETs first/revisit before → after |
| --- | ---: | ---: | --- |
| `/analytics` | 698 / 433 | 528 / 265 | 2/2,2 → 2/1,1 |
| `/automation` | 796 / 966 | 514 / 523 | 7/7,7 → 7/7,7 |
| `/customers` | 1317 / 1381 | 1136 / 251 | 3/3,3 → 3/1,1 |
| `/dashboard` | 1167 / 339 | 386 / 342 | 2/2,2 → 2/2,2 |
| `/documents` | 241 / 288 | 228 / 260 | 1/1,1 → 1/1,1 |
| `/eval` | 362 / 1014 | 416 / 343 | 3/3,3 → 3/3,3 |
| `/feedback` | 489 / 670 | 348 / 445 | 2/2,2 → 2/2,2 |
| `/guides` | 232 / 255 | 225 / 273 | 1/1,1 → 1/1,1 |
| `/guides/connect-gls` | 321 / 291 | 284 / 383 | 1/1,1 → 1/1,1 |
| `/guides/connect-mail` | 342 / 307 | 295 / 307 | 1/1,1 → 1/1,1 |
| `/guides/connect-shopify` | 303 / 329 | 292 / 505 | 1/1,1 → 1/1,1 |
| `/guides/connect-webshipper` | 298 / 302 | 314 / 284 | 1/1,1 → 1/1,1 |
| `/guides/connect-zendesk` | 327 / 317 | 290 / 289 | 1/1,1 → 1/1,1 |
| `/inbox` | 1186 / 762 | 809 / 435 | 12/12,12 → 16/6,6 |
| `/inbox/tickets` | 421 / 223 | 272 / 326 | 1/1,1 → 1/1,1 |
| `/integrations` | 733 / 530 | 551 / 349 | 7/7,7 → 3/2,2 |
| `/integrations/zendesk` | 441 / 537 | 508 / 400 | 3/3,3 → 3/3,3 |
| `/knowledge` | 724 / 321 | 505 / 250 | 3/3,3 → 3/1,1 |
| `/knowledge-hub` | 412 / 389 | 389 / 310 | 4/4,4 → 4/2,2 |
| `/knowledge/all` | 331 / 621 | 303 / 311 | 2/2,2 → 2/2,2 |
| `/knowledge/general` | 708 / 1439 | 626 / 636 | 4/4,4 → 4/4,4 |
| `/knowledge/internal-rules` | 311 / 607 | 293 / 300 | 2/2,2 → 2/2,2 |
| `/knowledge/new` | Disabled | Disabled | Excluded |
| `/knowledge/product-questions/:productId` | 439 / 760 | 427 / 382 | 2/2,2 → 2/2,2 |
| `/knowledge/product-questions/general` | 353 / 631 | 318 / 316 | 2/2,2 → 2/2,2 |
| `/knowledge/returns` | 846 / 950 | 620 / 651 | 4/4,4 → 4/4,4 |
| `/knowledge/shipping` | 340 / 613 | 310 / 294 | 3/3,3 → 3/3,3 |
| `/knowledge/simulate` | 255 / 255 | 381 / 245 | 1/1,1 → 1/1,1 |
| `/mailboxes` | 640 / 632 | 248 / 247 | 4/4,4 → 4/4,4 |
| `/mailboxes/other` | 241 / 253 | 233 / 274 | 1/1,1 → 1/1,1 |
| `/persona` | 1044 / 892 | 970 / 613 | 13/13,13 → 3/3,3 |
| `/playground` | Disabled | Disabled | Excluded |
| `/settings` | 986 / 1005 | 936 / 538 | 12/12,12 → 2/2,2 |
| `/settings/csat/email` | 521 / 690 | 226 / 268 | 2/2,2 → 2/2,2 |
| `/settings/csat/thank-you` | 285 / 582 | 226 / 252 | 2/2,2 → 2/2,2 |
| `/tags` | 322 / 542 | 295 / 387 | 2/2,2 → 2/2,2 |

Several fresh-read pages show little improvement or regressions. The table retains those results. Customers' first visit also has no demonstrated improvement in this route-wide sample; its large revisit reduction comes from avoiding repeated list and order-count reads. Cached revisits should not be presented as uncached server improvements.

## Inbox and Settings assertions

The separate inbox probe uses fresh pages for cold clicks and hover prefetch, and waits for the detail response body. Every detail returned HTTP 200; every returned message belonged to the selected thread. Queue back/forward navigation worked on both versions. Thirty automatic write attempts per version, including mark-read activity, were blocked by the harness; no mail, approval or external action was executed.

| Inbox interaction | Before | After |
| --- | ---: | ---: |
| Click to thread-detail body, median of 3 | 831 ms | 520 ms |
| Hover to prefetched detail body, median of 3 | 1468 ms | 664 ms |
| Queue filter server-render requests | 1 | 0 |

The Settings browser probe checks all nine bootstrap resource statuses, verifies a workspace was resolved, changes a form value without saving, dismisses the discard prompt and asserts that the edit remains. It then visits Members, Email and General, tests back/forward, and checks that tab changes make no RSC requests. All nine resources returned HTTP 200, the unsaved edit was preserved, back/forward passed, and tab changes made zero RSC requests and zero writes.

## Validation and evidence

Production build passed with lint/type checks and 162 pages. Existing MJML/vendor and edge-runtime warnings remain. Full Vitest run: 777 passed, 8 skipped, 3 failed. The three failures were reproduced on the base source earlier: two landing pricing expectations and a real Knowledge evaluation without required environment variables. The 31 tests added in the expanded pass and eight earlier scheduling tests pass, including scope isolation, cache expiry/force/invalidation, authorization coalescing, parallel reads and protected Settings aggregation.

A fixed-delay scheduling test keeps the same seven enriched inbox reads and result while reducing 450 ms to 200 ms. It is not a browser/database measurement. An earlier dev database count-versus-existence probe did not demonstrate a latency improvement; bounded existence checks reduce work as tables grow.

Sanitized samples are committed in [performance-results.json](performance-results.json). Local logs remain in `/tmp/sona-performance-1005a/`. No customer emails, message bodies, identifiers or screenshots were uploaded. Production remains untouched. KnowledgeCategoriesClient overlaps PR #80; the owner explicitly approved the performance edit.

## Conversation follow-up

The follow-up compares PR revision `3b343089` with `ca9e36ea`, rather than repeating the original-main comparison. Conversation bodies now arrive through an authorized `view=messages` read while fresh draft, signature, action and attachment details continue loading. Their readiness is tracked separately, and Send stays disabled until the complete detail read finishes. Existing draft/action fallbacks retain their original readiness checks.

Hover and selection share the same pending full-detail promise keyed by account/session/organization and URL. Settled details are not retained by that helper. The server shares simultaneously running authorized thread/message reads between the early and complete response; no settled authorization or detail cache was added. Late partial responses cannot overwrite an applied full response.

| Visible conversation metric | Before this follow-up | Final follow-up |
| --- | ---: | ---: |
| Cold selection, median of 3 | 540 ms | 409 ms |
| Revisited conversation, median of 3 | Not measured | 36 ms |
| Complete fresh detail body, median of 3 | 543 ms | 513 ms |

Before visible samples were 654, 540, 495 ms. Final visible samples were 695, 396, 409 ms; revisit samples were 35, 36, 42 ms. Earlier after probes had visible medians of 429, 365 and 359 ms. All samples are retained. These were sequential local production-browser runs against dev, without network throttling; service timing varies and the first final sample was slower. The main improvement is showing messages before the complete ticket payload, not making every complete read equally fast. Visible timing records a message bubble entering the DOM and is not a paint/LCP metric.

The browser verifies matching selected-thread data, one full request for hover followed by click, and disabled Send while the complete response is deliberately delayed by 1.2 seconds. That artificial delay applies only to the behavioral assertion, not the cold/revisit timing samples. Back/forward and zero-RSC queue navigation still pass. App writes were blocked. Four additional regression tests cover the early authorized response, sharing pending database reads, client pending-read boundaries and retry/cleanup behavior. Full suite has the same three baseline failures.

A cold selection can make two HTTP requests. Concurrent server reads share work, but requests arriving after a query settles can repeat it. Fresh metadata still has network latency; this change does not claim sub-100-ms cold data loading. Local validation used the final production build. No inbox screenshots or customer data were uploaded.

Repeat with `PERF_AFTER_URL=http://localhost:3107 PERF_OUTPUT_FILE=/tmp/sona-visible.json node scripts/performance/conversation-visible.cjs`. The script tests the current app and does not launch a comparison revision automatically. A matching old build or recorded baseline is required for a before/after comparison.

## Global follow-up

This pass compares `833ced00` with `ac119cdf`. The common authorization helper is imported by 134 API route modules. For active organizations, profile lookup and a joined workspace-membership read now run together. The join filters both Clerk user ID and the requested Clerk organization with `workspaces!inner(clerk_org_id)`. This removes one sequential database round trip and one query. Personal-session ambiguity checks remain unchanged. Missing membership, unknown organization and join errors fail closed; settled authorization is never cached.

The relationship already exists in `supabase/schema/workspaces_org_foundation.sql` and was verified read-only against dev. No migration was needed. Six alternating direct query runs returned the identical workspace. Separate lookup timings were 224, 129, 126, 399, 239, 350 ms; joined timings were 99, 84, 102, 191, 76, 72 ms. Medians were 232 and 92 ms. This measures database authorization reads for one active organization, not total page latency. A separate probe confirmed that an unknown organization returns no membership. The join syntax follows [Supabase's documented inner-join filtering](https://supabase.com/docs/guides/database/joins-and-nesting).

Client inbox scope uses the same joined membership check. Customers, Knowledge shop-policy and action-config now use the stateless service transport, allowing overlapping scope reads to share running work. Automation starts independent user/workspace lookups together; modes and save behavior are unchanged. Editable forms still read fresh data.

The same 36 route destinations were revisited before and after this pass. Metrics below retain the existing route-probe definition: navigation to last initial API/Supabase GET body completion, including background reads, excluding RSC/scripts/Clerk/rendering. First visit is one sample; revisit is the median of two within the existing cache lifetime. Version order was sequential and server warm-up differed. Network variation remains; the table includes regressions. These are incremental results against the already optimized PR, not the original main branch. Two disabled routes are excluded from latency claims.

| Route | First before/after, ms | Revisit before/after, ms |
| --- | ---: | ---: |
| `/analytics` | 458 / 422 | 265 / 369 |
| `/automation` | 1096 / 1106 | 503 / 384 |
| `/customers` | 1301 / 1112 | 245 / 178 |
| `/dashboard` | 320 / 255 | 524 / 254 |
| `/documents` | 268 / 187 | 243 / 309 |
| `/eval` | 673 / 595 | 319 / 244 |
| `/feedback` | 641 / 570 | 324 / 246 |
| `/guides` | 245 / 166 | 263 / 173 |
| `/guides/connect-gls` | 308 / 239 | 283 / 229 |
| `/guides/connect-mail` | 314 / 243 | 296 / 245 |
| `/guides/connect-shopify` | 302 / 252 | 294 / 216 |
| `/guides/connect-webshipper` | 291 / 251 | 295 / 228 |
| `/guides/connect-zendesk` | 348 / 226 | 274 / 223 |
| `/inbox` | 815 / 690 | 386 / 385 |
| `/inbox/tickets` | 232 / 151 | 255 / 220 |
| `/integrations` | 496 / 395 | 305 / 307 |
| `/integrations/zendesk` | 442 / 421 | 384 / 329 |
| `/knowledge` | 312 / 232 | 229 / 166 |
| `/knowledge-hub` | 352 / 248 | 459 / 237 |
| `/knowledge/all` | 620 / 548 | 316 / 228 |
| `/knowledge/general` | 1000 / 861 | 661 / 534 |
| `/knowledge/internal-rules` | 636 / 571 | 299 / 247 |
| `/knowledge/new` | Disabled | Excluded |
| `/knowledge/product-questions/:productId` | 1127 / 636 | 360 / 324 |
| `/knowledge/product-questions/general` | 640 / 562 | 302 / 225 |
| `/knowledge/returns` | 949 / 829 | 692 / 471 |
| `/knowledge/shipping` | 615 / 572 | 314 / 238 |
| `/knowledge/simulate` | 293 / 189 | 226 / 157 |
| `/mailboxes` | 666 / 611 | 250 / 202 |
| `/mailboxes/other` | 225 / 186 | 216 / 179 |
| `/persona` | 834 / 732 | 1185 / 531 |
| `/playground` | Disabled | Excluded |
| `/settings` | 751 / 694 | 406 / 340 |
| `/settings/csat/email` | 675 / 665 | 245 / 177 |
| `/settings/csat/thank-you` | 560 / 484 | 323 / 178 |
| `/tags` | 552 / 506 | 239 / 164 |

All recorded GETs completed without HTTP errors or pending reads. Some routes show little improvement or regressions, including Analytics revisits; no uniform speedup is claimed. The changes reduce work in the shared request path without extending form or authorization cache lifetimes. Existing cached-list improvements are still present in both comparison revisions.

Final production build passes with lint/type checks and 162 pages. Full suite: 777 passed, 8 skipped, the same 3 baseline failures. Scope tests cover exact user/org filters, revoked membership, missing organizations, relation errors and personal ambiguity. Settings returned HTTP 200 for all nine resources, preserved rejected-discard edits, and passed history/zero-RSC checks. Inbox again passed selected-thread, shared hover/click, delayed-detail Send gating and history assertions. Its final cold-visible samples were 339, 301, 301 ms; cached samples were 38, 41, 35 ms. Those Inbox results are additional validation, not the main claim of this pass.

Repeat the direct dev scope probe with `node scripts/performance/scope-join.cjs`. It reads local dev credentials, uses only database reads, and prints timings/booleans without identities or bodies. Run timing probes sequentially. Raw results are retained in `performance-results.json`. Production, schema and V2 functions remain untouched.

## Repeat the probes

Run the base production build on localhost:3108 and the PR build on localhost:3107. Both must point to dev services with their own dashboard URL. From the PR root:

```sh
npm install --prefix /tmp/sona-performance-browser --no-audit --no-fund playwright
PERF_VERSION=before PERF_OUTPUT_FILE=/tmp/sona-before.json node scripts/performance/all-pages.cjs
PERF_VERSION=after PERF_OUTPUT_FILE=/tmp/sona-after.json node scripts/performance/all-pages.cjs
node scripts/performance/compare-navigation.cjs
node scripts/performance/inbox.cjs
node scripts/performance/settings.cjs
```

Run timing probes sequentially. Extra coverage uses `PERF_EXTRA_ROUTES=1` and an optional existing `PERF_PRODUCT_ROUTE`; product identifiers are masked in output. `PERF_ROUTES` selects comma-separated paths for a rerun. Browser/location overrides are `PERF_BEFORE_URL`, `PERF_AFTER_URL`, `PERF_PLAYWRIGHT_PATH`, and `PERF_CHROME_PATH`. Scripts read local dev credentials without printing them. The first four scripts report measurements; Settings reports behavioral assertions.

## Rules for future changes

Measure production builds and distinguish visible feedback, main data, background requests and cached revisits. Record routes, samples, request counts, freshness and network conditions. Start independent reads together only after authorization and tenant scope. Fetch message bodies only when needed.

Cache keys must include account, session and organization. Bound memory and lifetime, invalidate after edits, reject stale in-flight results, and keep drafts, approvals and editable forms fresh. Never cache settled authorization to improve timing. Preserve the existing protected handler when composing a read endpoint, including its request type and error behavior.
