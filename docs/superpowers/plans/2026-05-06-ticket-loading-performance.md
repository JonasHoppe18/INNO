# Ticket Loading Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the network-wait when switching between tickets by prefetching messages on hover and enabling HTTP caching on the messages endpoint.

**Architecture:** Two independent changes — (1) hover on a ticket row triggers a background fetch that stores messages in the existing `messagesCacheRef` in `InboxSplitView`, so by the time the user clicks the data is already in memory; (2) the `/api/inbox/threads/[threadId]/messages` route gets a `Cache-Control: private, max-age=30, stale-while-revalidate=60` header so the browser reuses cached responses for revisits.

**Tech Stack:** React (useCallback, useRef), Next.js API routes

---

### Task 1: Add Cache-Control header to messages route

**Files:**
- Modify: `apps/web/app/api/inbox/threads/[threadId]/messages/route.js:145`

The final `NextResponse.json` call on line 145 returns messages without caching headers. Add `Cache-Control` so the browser can reuse the response for 30 seconds and serve stale while revalidating for up to 60 more.

- [ ] **Step 1: Add Cache-Control header to the success response**

In `apps/web/app/api/inbox/threads/[threadId]/messages/route.js`, replace line 145:

```js
// Before
return NextResponse.json({ messages, attachments }, { status: 200 });
```

```js
// After
return NextResponse.json({ messages, attachments }, {
  status: 200,
  headers: {
    "Cache-Control": "private, max-age=30, stale-while-revalidate=60",
  },
});
```

- [ ] **Step 2: Verify manually**

Open browser DevTools → Network tab. Click a ticket, then click the same ticket again within 30 seconds. The second request should show `(disk cache)` or `304` status.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/inbox/threads/\[threadId\]/messages/route.js
git commit -m "perf: cache thread messages response for 30s in browser"
```

---

### Task 2: Add `onPrefetch` prop to TicketListItem

**Files:**
- Modify: `apps/web/components/inbox/TicketListItem.jsx`

`TicketListItem` currently accepts `onSelect` and `onContextMenu`. We add an `onPrefetch` prop and fire it from `onMouseEnter` after an 80ms debounce (to avoid triggering on fast scroll-past).

The debounce timer lives in a `useRef` so it doesn't cause re-renders.

- [ ] **Step 1: Add `onPrefetch` prop and `onMouseEnter`/`onMouseLeave` handlers**

In `apps/web/components/inbox/TicketListItem.jsx`, update the component props and add hover handlers. Find the destructuring at line 21 and the returned JSX root element:

```jsx
// Add onPrefetch to the destructured props (after onContextMenu):
export function TicketListItem({
  thread,
  isActive,
  status,
  customerLabel,
  timestamp,
  unreadCount,
  assignee,
  priority,
  isExiting = false,
  isNew = false,
  mountIndex = 0,
  onSelect,
  onContextMenu,
  onPrefetch,
}) {
```

Then add a ref and handlers inside the component body (after the existing const declarations, before the return):

```jsx
  const prefetchTimerRef = useRef(null);

  const handleMouseEnter = () => {
    if (!onPrefetch) return;
    prefetchTimerRef.current = setTimeout(() => {
      onPrefetch();
    }, 80);
  };

  const handleMouseLeave = () => {
    clearTimeout(prefetchTimerRef.current);
  };
```

- [ ] **Step 2: Add import for useRef**

`TicketListItem.jsx` currently has no React import (uses JSX transform). Add useRef import at the top:

```jsx
import { useRef } from "react";
```

- [ ] **Step 3: Wire handlers to the root element**

Find the root `<div>` or `<button>` returned by the component (the outermost clickable element). Add `onMouseEnter` and `onMouseLeave`:

```jsx
onMouseEnter={handleMouseEnter}
onMouseLeave={handleMouseLeave}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/inbox/TicketListItem.jsx
git commit -m "feat: add onPrefetch hover handler to TicketListItem"
```

---

### Task 3: Thread `onPrefetchThread` through TicketList

**Files:**
- Modify: `apps/web/components/inbox/TicketList.jsx`

`TicketList` receives `onPrefetchThread` and passes `() => onPrefetchThread(thread.id)` to each `TicketListItem` as `onPrefetch`.

- [ ] **Step 1: Add `onPrefetchThread` to TicketList props**

In `apps/web/components/inbox/TicketList.jsx`, add `onPrefetchThread` to the destructured props (line 18–32):

```jsx
export function TicketList({
  threads,
  selectedThreadId,
  ticketStateByThread,
  customerByThread,
  onSelectThread,
  filters,
  onFiltersChange,
  getTimestamp,
  getUnreadCount,
  onCreateTicket,
  onOpenInNewTab,
  onDeleteThread,
  hideSolvedFilter = false,
  onPrefetchThread,
}) {
```

- [ ] **Step 2: Pass `onPrefetch` to each TicketListItem**

In the `.map()` where `TicketListItem` is rendered (around line 238), add the `onPrefetch` prop:

```jsx
<TicketListItem
  thread={thread}
  isActive={thread.id === selectedThreadId}
  status={uiState?.status || "New"}
  customerLabel={customer}
  timestamp={timestamp}
  unreadCount={unreadCount}
  assignee={uiState?.assignee}
  priority={uiState?.priority}
  isExiting={isExiting}
  isNew={newThreadIds.has(String(thread.id))}
  mountIndex={index}
  onSelect={(options) => onSelectThread(thread.id, options)}
  onPrefetch={onPrefetchThread ? () => onPrefetchThread(thread.id) : undefined}
  onContextMenu={(event) => {
    event.preventDefault();
    setContextMenu({
      threadId: thread.id,
      x: event.clientX,
      y: event.clientY,
    });
  }}
/>
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/inbox/TicketList.jsx
git commit -m "feat: thread onPrefetchThread prop through TicketList"
```

---

### Task 4: Implement `handlePrefetchThread` in InboxSplitView

**Files:**
- Modify: `apps/web/components/inbox/InboxSplitView.jsx`

This is the core logic. `InboxSplitView` already has `messagesCacheRef` (a `Map`, line 1011). We add:
- A `prefetchingRef` Set to track in-flight prefetch requests (avoid duplicate fetches)
- A `handlePrefetchThread` useCallback that skips if already cached or already prefetching, then fetches and stores in `messagesCacheRef`
- Pass `handlePrefetchThread` as `onPrefetchThread` to `<TicketList>`

- [ ] **Step 1: Add prefetchingRef near messagesCacheRef**

Find line 1011 in `InboxSplitView.jsx`:
```jsx
const messagesCacheRef = useRef(new Map());
```

Add directly below it:
```jsx
const prefetchingRef = useRef(new Set());
```

- [ ] **Step 2: Add handlePrefetchThread**

Add this after the existing `useEffect` and `useCallback` blocks (a good place is near `handleSelectThreadInWorkspace` around line 3919, before the return statement):

```jsx
const handlePrefetchThread = useCallback((threadId) => {
  if (!threadId || isLocalThreadId(threadId)) return;
  if (messagesCacheRef.current.has(threadId)) return;
  if (prefetchingRef.current.has(threadId)) return;

  prefetchingRef.current.add(threadId);
  fetch(`/api/inbox/threads/${encodeURIComponent(threadId)}/messages`, {
    method: "GET",
    credentials: "include",
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((payload) => {
      const rows = Array.isArray(payload?.messages) ? payload.messages : [];
      if (rows.length) {
        messagesCacheRef.current.set(threadId, rows);
      }
    })
    .catch(() => {})
    .finally(() => {
      prefetchingRef.current.delete(threadId);
    });
}, [isLocalThreadId]);
```

- [ ] **Step 3: Pass handlePrefetchThread to TicketList**

Find the `<TicketList` JSX block (around line 4730). Add the prop:

```jsx
<TicketList
  key={activeView}
  threads={filteredThreads}
  selectedThreadId={selectedThreadId}
  ticketStateByThread={ticketStateByThread}
  customerByThread={customerByThread}
  onSelectThread={handleSelectThreadInWorkspace}
  onPrefetchThread={handlePrefetchThread}
  filters={filters}
  onFiltersChange={handleFiltersChange}
  getTimestamp={getThreadTimestamp}
  getUnreadCount={getThreadUnreadCount}
  onCreateTicket={handleCreateTicket}
  onOpenInNewTab={(threadId) =>
    handleSelectThreadInWorkspace(threadId, { newTab: true })
  }
  onDeleteThread={deleteThreadById}
  hideSolvedFilter={activeView === ""}
/>
```

- [ ] **Step 4: Verify manually**

1. Open the inbox in the browser
2. Open DevTools → Network tab, filter by `messages`
3. Hover over a ticket (without clicking) — after ~80ms a `messages` request should fire
4. Click the ticket — it should open instantly with no additional loading spinner
5. Hover over another ticket — another prefetch fires
6. Click a ticket you've already prefetched — opens instantly

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/inbox/InboxSplitView.jsx
git commit -m "perf: prefetch thread messages on hover to eliminate click-to-load delay"
```
