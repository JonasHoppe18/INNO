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
  before them, and the last 4 weeks total `>= 12`, and the same was true one
  week earlier. A product that is already a spike is not also reported as
  rising.

All thresholds are named constants in `RADAR_RULES`. The series needs 13
weeks of history: 12 are shown, and the extra week confirms a trend.

### Backtest (prod, AceZone, support threads only, to 2026-10-10)

`apps/web/scripts/product-radar-backtest.mjs` replays the rules once per
week over weekly counts per product. The counts come from a read-only query
and stay outside the repo. Data starts about 24 weeks back, which gives 12
anchors × 10 products.

- A-Rise: rising from 2026-10-03. The last 4 weeks are 4, 5, 6, 4 (19
  tickets) against a prior mean of 1.9 a week. A real, sustained climb.
- A-Spire: rising on 2026-08-15 only, before the two-week confirmation was
  added. The series shows a quiet spell (0, 0, 2, 1) followed by normal
  weeks, so it was a false positive. The confirmation removes it.
- A-Spire Wireless swings between 10 and 25 a week and raises nothing.
- No spikes in the period.

The July A-Live peak (14 threads in the week of 2026-07-13) seen in the
first counts disappears once only support threads are counted. Those were
notifications and partnership mails, so today's unfiltered product counts
can mislead.

## Slices

### Slice 1: Products tab and Dashboard card on existing data

No new tables and no new LLM calls.

- `apps/web/lib/server/product-radar.js`: pure functions. Input is thread
  rows (`id`, `created_at`, `classification_key`, `detected_product_id`,
  `issue_summary`) and the product map. Output is per-product weekly series,
  current, baseline and status (`spike`, `rising`, `steady`).
- `GET /api/analytics/products`: workspace-scoped through
  `resolveAuthScope` and `applyScope`, like the overview route. Reads 13 weeks
  of threads (see Alert rules).
- **Products tab**: a list of products sorted by status, then by volume.
  Each row shows name, tickets in the last 7 days, a 12-week sparkline,
  status, and the share of tickets with a refund. Clicking a row opens a
  detail view with the weekly chart, the latest `issue_summary` lines as a
  plain list ("What customers write"), and the tickets themselves, reusing the
  existing drilldown table.
- **Dashboard card**: up to 3 products with status `spike` or `rising`, e.g.
  "A-Rise: rising — 19 tickets in 4 weeks (usually 8)". No card when there
  are none. It reads the same lib function, not the API route.
- Follow `.agents/design.md` and the existing Analytics primitives.

Evidence: unit tests on the rule functions with the backtest series as
fixtures (`lib/server/__tests__/product-radar.test.js`), the backtest above,
and the Products tab and card checked on dev.

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
