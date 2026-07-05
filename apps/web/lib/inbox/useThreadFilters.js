"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { resolveViewRoute } from "./view-model.js";

// Verbatim extraction from InboxSplitView.jsx (Task 3, Plan 2). Behavior-preserving —
// see .superpowers/sdd/task-3-report.md for the mapping of what moved from where.
// sortBy starts unset (not "newest_activity") so the default needs_attention
// queue can tell "user hasn't touched the sort dropdown yet" (null - keep
// the queue's own oldest-customer-wait-first ordering) apart from "user
// explicitly picked Newest first" (the string "newest_activity" - same
// value, but only set once the dropdown is actually used). Every other view
// already defaults to newest-activity ordering whenever sortBy isn't one of
// the other explicit values, so this is behavior-preserving for them.
export const DEFAULT_FILTERS = {
  query: "",
  statuses: [],
  unreadsOnly: false,
  sortBy: null,
};

// Task 6, Plan 2: lifecycle view routing. `activeView` keeps its pre-existing
// raw semantics (the literal `?view=` param, "" meaning the default
// needs-attention view) so every pre-Task-6 consumer of `activeView` in
// InboxSplitView.jsx keeps working unchanged. `resolvedView`/`tab` are the
// NEW normalized values (legacy aliases mapped, tab defaulted) that Step 3's
// StatusTabs wiring and the visible-thread-set computation should read
// instead. Both are derived from the same `resolveViewRoute` pure mapping in
// view-model.js, which is unit-tested directly.
export function useThreadFilters({ searchParams }) {
  const activeView = searchParams?.get("view") || "";
  const rawTab = searchParams?.get("tab") || "";
  const { view: resolvedView, tab } = useMemo(
    () => resolveViewRoute(activeView, rawTab),
    [activeView, rawTab],
  );
  const [filters, setFilters] = useState(DEFAULT_FILTERS);

  const deferredFilterQuery = useDeferredValue(filters.query);
  const effectiveFilters = useMemo(
    () => ({
      query: deferredFilterQuery,
      statuses: filters.statuses,
      status: filters.status,
      unreadsOnly: filters.unreadsOnly,
      sortBy: filters.sortBy,
    }),
    [
      deferredFilterQuery,
      filters.sortBy,
      filters.status,
      filters.statuses,
      filters.unreadsOnly,
    ],
  );

  return { activeView, resolvedView, tab, filters, setFilters, effectiveFilters };
}
