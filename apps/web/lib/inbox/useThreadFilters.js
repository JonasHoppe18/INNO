"use client";

import { useDeferredValue, useMemo, useState } from "react";

// Verbatim extraction from InboxSplitView.jsx (Task 3, Plan 2). Behavior-preserving —
// see .superpowers/sdd/task-3-report.md for the mapping of what moved from where.
export const DEFAULT_FILTERS = {
  query: "",
  statuses: [],
  unreadsOnly: false,
  sortBy: "newest_activity",
};

export function useThreadFilters({ searchParams }) {
  const activeView = searchParams?.get("view") || "";
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

  return { activeView, filters, setFilters, effectiveFilters };
}
