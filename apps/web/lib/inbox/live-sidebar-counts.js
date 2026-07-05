"use client";

// Tiny pub/sub bridge between InboxSplitView (which holds the full client-side
// thread list and can compute exact queue counts from it) and the app sidebar
// (a separate component tree in the dashboard layout). While the inbox is
// mounted it publishes live counts here; the sidebar prefers these over the
// DB-side /api/inbox/sidebar-counts values (which read 0 until Plan 1's
// migration is applied, and lag behind optimistic updates afterwards).
//
// Deliberately never cleared on unmount: navigating away from the inbox
// should keep showing the last known exact counts (still accurate — nothing
// changed them) rather than reverting to the API fallback, which reads 0
// pre-migration. Consumed via useSyncExternalStore.

let current = null;
const listeners = new Set();

export function publishLiveSidebarCounts(counts) {
  current = counts;
  listeners.forEach((listener) => listener());
}

export function subscribeLiveSidebarCounts(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLiveSidebarCountsSnapshot() {
  return current;
}

// Server snapshot for useSyncExternalStore (sidebar is client-only, but Next
// still evaluates the hook signature during SSR of the layout shell).
export function getLiveSidebarCountsServerSnapshot() {
  return null;
}
