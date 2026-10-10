# Product Radar

Status: spec, not built. Decided with Jonas 2026-10-10.

Product Radar shows a shop owner which products are generating customer
contact, what the problem is, and when that changes. The owner should learn
about a product defect from Sona before it shows up in reviews or returns.

## Where it lives

| Surface | Role |
| --- | --- |
| Analytics, new **Products** tab | Full view: every product, 12-week trend, issues, sample tickets |
| Dashboard, **Product alerts** card | Rendered only when a product has a spike or a rising trend. Links to the Products tab |
| Weekly owner email | Phase 2, after the alert rules have been trusted in production for a while |

The Products tab absorbs the two product cards that live in *Business impact*
today ("Products driving support", "Products with refunded value"), so product
data has one home. Overview keeps "Customer friction".

UI copy is English only. Do not name the commerce platform in the UI
(use "store" or "connected store").

## Data we have (prod, AceZone, 90 days to 2026-10-10)

Read-only counts:

- 1,219 threads, about 130 per week.
- `classification_key`: support 685, notification 424, partnership 108.
  Only `support` counts. The existing analytics filter
  (`SUPPORT_CLASSIFICATION_KEY` in `app/api/analytics/overview/route.js`)
  already does this. Reuse it.
- `detected_product_id` is set on 55% of support threads.
- `issue_summary` is set on 98% of threads. It is 1-2 English sentences
  written by `generateIssueMetadata`.
- Order matches are not stored on the thread.

Volume per product is low. One product (A-Spire Wireless) runs 14-28 threads
a week. The rest run 1-7. The rules below are built for that: absolute
minimums plus ratios, no z-scores.

Known weak spot: only V2 `postmark-inbound` calls `generateIssueMetadata`.
It matches a product only when the customer writes the product name, and
it only sees the first 50 products. Greenfield never sets a product. Slice 4
covers this. Until then the Products tab states the coverage
("Linked to a product: 55% of support tickets").

## Alert rules

All windows are rolling and anchored at "now". They do not follow the
period picker.

- **current** = support threads for the product in the last 7 days.
- **baseline** = weekly mean over the 8 full weeks before that.
- **Spike**: `current >= 5` and `current >= 3 × max(baseline, 1)`.
- **Rising**: mean of the last 4 weeks `>= 2 ×` the mean of the 8 weeks
  before them, and the last 4 weeks total `>= 12`. A product that is
  already a spike is not also reported as rising.

All thresholds are named constants in one module.

Check against the prod numbers above:

| Product | Last 4 weeks | Previous 8 weeks, mean | Result |
| --- | --- | --- | --- |
| A-Rise | 4, 5, 7, 5 (21) | 2.25 | Rising (2.3×) ✔ |
| A-Blaze | 6, 6, 4, 3 (19) | 3.4 | Nothing (1.4×) ✔ |
| A-Spire Wireless | 25, 28, 17, 16 | about 20 | Nothing ✔ |

A-Live had 14 threads in the week of 2026-07-13, against 1-3 in the weeks
after. That should be a spike, but its baseline lies before the 90-day
window, so the backtest must read 180 days.

## Slices

### Slice 1: Products tab and Dashboard card on existing data

No new tables and no new LLM calls.

- `apps/web/lib/server/product-radar.js`: pure functions. Input is thread
  rows (`id`, `created_at`, `classification_key`, `detected_product_id`,
  `issue_summary`) and the product map. Output is per-product weekly series,
  current, baseline and status (`spike`, `rising`, `steady`).
- `GET /api/analytics/products`: workspace-scoped through
  `resolveAuthScope` and `applyScope`, like the overview route. Reads 20 weeks
  of threads (12 shown, 8 more for the baseline).
- **Products tab**: a list of products sorted by status, then by volume.
  Each row shows name, tickets in the last 7 days, a 12-week sparkline,
  status, and the share of tickets with a refund. Clicking a row opens a
  detail view with the weekly chart, the latest `issue_summary` lines as a
  plain list ("What customers write"), and the tickets themselves, reusing the
  existing drilldown table.
- **Dashboard card**: up to 3 products with status `spike` or `rising`, e.g.
  "A-Rise: rising — 21 tickets in 4 weeks (usually 9)". No card when there
  are none. It reads the same lib function, not the API route.
- Follow `.agents/design.md` and the existing Analytics primitives.

Evidence: unit tests on the rule functions using the table above as
fixtures, then a backtest script that replays prod counts week by week for
the last 180 days and lists every alert it would have raised. The backtest
must flag A-Live in July and A-Rise in October, and the false positives get
reviewed by hand before the thresholds are locked.

### Slice 2: Issue clusters (the "why")

Group free-text `issue_summary` into short, stable labels per shop, such as
"Ear pads coming loose" or "Mic not detected".

- New tables, both carrying `workspace_id` and `shop_id`:
  `issue_labels (id, workspace_id, shop_id, label, created_at)` and
  `thread_issue_labels (thread_id pk, workspace_id, label_id, model, labeled_at)`.
- A scheduled job (daily, plus a one-time backfill) labels new support
  threads with a small model. The prompt receives the shop's existing labels
  so it reuses them, and may create a new one only when nothing fits.
- The alert rules also run per product + label, with a minimum of 4 for a
  spike. The card then reads "A-Rise: 9 tickets about ear pads coming loose
  this week (usually 1)".

This job reads tickets and writes analytics only. It touches neither the
draft pipeline nor V2.

### Slice 3: Weekly owner email

Monday morning: the top 3 signals, with links to the Products tab. Opt-in per
workspace. Built only after slices 1-2 have run in production without noisy
alerts.

### Slice 4: Better product linking

Fill `detected_product_id` from the matched order's line items when the
customer has exactly one product in the order, and run issue metadata for
greenfield and every other channel, not just V2. Track the coverage from the
55% baseline.

## Out of scope

- Inbox badge ("part of a spike: 14 similar").
- Dismissing or snoozing alerts.
- Cross-shop benchmarks.

## Open questions

1. Can alerts be computed on request (about 1,300 rows today), or do they
   need a stored daily snapshot once a shop gets larger? Slice 1 computes on
   request and measures the route's latency.
2. Should variants (e.g. "A-Spire" vs "A-Spire Wireless") roll up to a
   parent product? Slice 1 keeps them separate, as the data has them today.
