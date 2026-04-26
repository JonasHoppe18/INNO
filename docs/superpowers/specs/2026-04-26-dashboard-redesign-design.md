# Dashboard Redesign

**Date:** 2026-04-26  
**Approach:** Full redesign of `apps/web/app/(dashboard)/dashboard/page.jsx` in one go

---

## Goal

Redesign the dashboard to give support staff a richer, more actionable overview — similar to the reference design shown. More "live" feel with attention-based prioritization and an AI activity feed.

---

## Layout

```
[ Greeting                                        ]
[ Needs your attention ]  [ 4 stat cards (2x2)   ]
[ Recent AI activity   ]  [ Returns in transit    ]
[ AI Self Learning                                ]
```

No AI status panel in the header — greeting only.

---

## Sections

### 1. Greeting
Unchanged — uses existing `DashboardGreeting` component.

---

### 2. Needs Your Attention (left, large card)

Dynamic card that only renders rows where count > 0. If all counts are 0, shows an "All clear" empty state instead.

**Rows (shown only if count > 0):**

| Row | Source | Link |
|-----|--------|------|
| Pending approvals | `thread_actions` where `status = pending` | `/inbox` |
| Customers waiting over 12h | `mail_threads` without reply, older than 12h | `/inbox` |
| Returns missing tracking | `thread_actions` where `action_type = initiate_return` and `payload.tracking_url` is null | `/inbox` |

Each row: icon, title, subtitle, count badge (right), chevron.  
Bottom: "Review tickets" button → `/inbox`.

**New data fetch required:** `loadMissingTrackingCount(serviceClient, shopId)` — counts `initiate_return` actions with `status = applied` and no `payload->tracking_url`.

---

### 3. Stat Cards (right, 2×2 grid)

Four cards, no sparklines in this version:

| Card | Value | Badge |
|------|-------|-------|
| Awaiting Reply | `awaitingCount` | "Action needed" / "All clear" |
| Pending Approvals | `pendingCount` | "Need review" / "All clear" |
| AI Drafts Sent | `sentDraftCount` | "{n} sent" |
| Time Saved | `timeSavedLabel` | "Estimated" |

Data already fetched in existing page — no changes needed.

---

### 4. Recent AI Activity (left, bottom)

Timeline feed of the 10 most recent events, merged and sorted by `created_at` descending.

**Sources:**
- `drafts` with `status = sent` → label: "Draft sent", badge: "Sent"
- `thread_actions` with `status = applied` → label: "Action executed", badge: "Approved"  
- `thread_actions` with `status = pending` → label: "Awaiting approval", badge: "Pending"

**Each row shows:**
- Timestamp (HH:MM format)
- Description (e.g. "Refund draft generated")
- Order / customer email if available in payload
- Status badge

**New data fetch required:** `loadRecentActivity(serviceClient, scope, shopId)` — fetches last 10 drafts + last 10 thread_actions, merges, sorts, slices to 10.

---

### 5. Returns in Transit (right, bottom)

Simplified — no inspection phase (not in data model yet).

**Summary counts at top:**
- In transit: count of `initiate_return` actions with `status = applied`

**List below:** order number, customer email, time ago.

Data already fetched via `loadReturnsInTransit` — reuse as-is, just update the card layout.

---

### 6. AI Self Learning

Unchanged — uses existing `LearningCard` component. Spans full width at the bottom.

---

## Data Changes Summary

| Change | Details |
|--------|---------|
| New fetch | `loadMissingTrackingCount` — counts returns missing tracking URL |
| New fetch | `loadRecentActivity` — merges drafts + thread_actions into activity feed |
| Existing | All other fetches unchanged |

---

## Components

All logic stays in `dashboard/page.jsx` as a server component. No new files needed unless the activity feed becomes complex enough to extract — defer that decision.

---

## Out of scope

- Sparkline charts on stat cards
- AI status panel
- Inspection phase in returns
- Date picker / time range filter
