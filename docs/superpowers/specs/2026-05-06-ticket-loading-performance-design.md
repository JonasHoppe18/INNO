# Ticket Loading Performance — Design Spec

**Date:** 2026-05-06
**Problem:** Switching between tickets is slow because message data is fetched fresh from the API on every click, with `cache: "no-store"`.

## Root Cause

`useThreadMessages` in `hooks/useInboxData.js` fires a `fetch` to `/api/inbox/threads/{id}/messages` with `cache: "no-store"` every time a new thread is selected. The `messagesCacheRef` (a `Map` in `InboxSplitView`) only populates after the first fetch completes, so first visits always block on the network.

## Solution: Two targeted changes

### 1. Hover-prefetch in ticket list

**Where:** `TicketList.jsx` + `InboxSplitView.jsx`

- Add `onPrefetchThread` prop to `TicketList`
- Each ticket row gets `onMouseEnter` that calls `onPrefetchThread(threadId)`
- In `InboxSplitView`, implement `handlePrefetchThread(threadId)`:
  - Skip if `threadId` is already in `messagesCacheRef`
  - Skip if a prefetch for this `threadId` is already in-flight (track with a `prefetchingRef` Set)
  - Fetch `/api/inbox/threads/{id}/messages` and store result in `messagesCacheRef`
  - Debounce: only start fetch after 80ms to avoid firing on fast scrolls
- Pass `handlePrefetchThread` as `onPrefetchThread` to `TicketList`

**Effect:** By the time the user clicks, data is in cache and the thread opens instantly.

### 2. HTTP caching on the messages endpoint

**Where:** `apps/web/app/api/inbox/threads/[threadId]/messages/route.js`

- Add response header: `Cache-Control: private, max-age=30, stale-while-revalidate=60`
- `private` — browser-only caching, not CDN (data is user-specific)
- `max-age=30` — browser reuses cached response for 30 seconds
- `stale-while-revalidate=60` — after 30s, serve stale instantly while refreshing in background

**Effect:** Revisits to same ticket within 30s are instant. Beyond 30s, stale data is shown immediately while fresh data loads silently.

## What this does NOT change

- Loading states and skeleton UI — unchanged
- Realtime Supabase subscriptions — unchanged
- No changes to `useThreadMessages` logic itself
- No changes to `messagesByThread` or other state

## Files touched

| File | Change |
|------|--------|
| `apps/web/components/inbox/TicketList.jsx` | Add `onPrefetchThread` prop + `onMouseEnter` on rows |
| `apps/web/components/inbox/InboxSplitView.jsx` | Add `handlePrefetchThread` + pass to `TicketList` |
| `apps/web/app/api/inbox/threads/[threadId]/messages/route.js` | Add `Cache-Control` header to `NextResponse.json` |
