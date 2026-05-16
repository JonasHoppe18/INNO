# Analytics Excel Export — Design Spec

**Date:** 2026-05-16
**Status:** Approved

## Problem

The "Export CSV" button on the Analytics page exists in the UI but is disabled with a placeholder comment. Users need to export all analytics data to Excel for offline analysis and reporting.

## Approach

Client-side Excel generation using SheetJS (`xlsx` community edition). Data is already loaded in the browser's `data` state after fetching from `/api/analytics/overview`, so no server changes are required. SheetJS is imported dynamically on first click to avoid impacting initial bundle size.

## File Output

Filename: `sona-analytics-[period-label].xlsx`

Example: `sona-analytics-last-30-days.xlsx`

## Sheet Structure

### Sheet 1: Overview
Key-value rows for the selected period:

| Key | Value |
|---|---|
| Period | e.g. "Last 30 days" |
| Time saved | e.g. "12.1 hrs" |
| Drafts sent as-is | count |
| Drafts sent as-is (%) | pct of sent drafts |
| Avg edit effort | pct |
| Automation rate | pct |
| Support requests | count |
| Unsolved tickets | count |
| Solved tickets | count |
| Median first reply | formatted duration |

### Sheet 2: Tickets over time
Time series ready for charting in Excel:

| Date | Tickets |
|---|---|
| 2026-04-16 | 12 |
| ... | ... |

### Sheet 3: Topics
Three blocks in one sheet separated by a blank row:

**Block 1 — Request types:** Label, Count, % of tickets
**Block 2 — Products:** Label, Count, % of tickets
**Block 3 — Issue descriptions:** Label, Count, % of tickets

### Sheet 4: Support KPIs
Two sub-tables:

**First reply time brackets:** Bracket label, Count, %
**Resolution time brackets:** Bracket label, Count, %

Plus two summary rows at the bottom: Median first reply (formatted), Median resolution time (formatted).

### Sheet 5: Ticket list
Full ticket rows — all columns the UI shows:

| Ticket # | Subject | Customer | Status | Request type | Product | Created | Updated | First reply (min) | Sona usage |

Note: "First reply" is exported as raw minutes (numeric) for easy sorting/filtering in Excel.

## Implementation

### New files
- `apps/web/utils/export-analytics.js` — exports one function `exportAnalyticsToExcel(data, periodLabel)` that builds the workbook and triggers the browser download

### Changed files
- `apps/web/package.json` — add `xlsx` dependency
- `apps/web/app/(dashboard)/analytics/page.jsx`:
  - Add `onExport` prop to `AnalyticsHeader`
  - Enable the export button (remove `disabled`, update label to "Export Excel", update icon title)
  - Wire `handleExport` in `AnalyticsPage` that calls `exportAnalyticsToExcel(data, periodLabel)`

### Dynamic import pattern
```js
async function exportAnalyticsToExcel(data, periodLabel) {
  const XLSX = await import("xlsx");
  // build workbook ...
  XLSX.writeFile(workbook, `sona-analytics-${slug}.xlsx`);
}
```

## Constraints

- SheetJS is MIT licensed for community use — no license concerns
- Export button is disabled when `data` is null (loading or error state)
- Period label for filename is derived from the active period/range state in `AnalyticsPage`
- No server changes required
- Ticket list exports all rows currently in `data.drilldowns.defaultTickets` (up to 25 newest tickets per the existing API limit)

## Out of scope

- Server-side export endpoint
- ZIP of multiple CSV files
- Scheduled/email export
