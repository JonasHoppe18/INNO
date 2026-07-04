"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const TAB_STATE_STORAGE_PREFIX = "inbox-open-tabs";
const MAX_PREFETCH_IN_FLIGHT = 2;

// Verbatim extraction from InboxSplitView.jsx (Task 4, Plan 2). Behavior-preserving —
// see .superpowers/sdd/task-4-report.md for the mapping of what moved from where.
//
// Owns "which thread is open" (selectedThreadId + ref), "which tabs are open"
// (openThreadIds + localStorage persistence/restoration), and the hover-prefetch
// machinery (messagesCacheRef/draftCacheRef/prefetchingRef + handlePrefetchThread).
export function useThreadSelection({
  threads,
  sortedThreads,
  searchParams,
  isLocalThreadId,
  currentSupabaseUserId,
  userId,
  startInboxTransition,
  markThreadReadInstantly,
  setLocalNewThread,
}) {
  const derivedThreads = threads;
  const filteredThreads = sortedThreads;

  const [selectedThreadId, setSelectedThreadId] = useState(null);
  const [openThreadIds, setOpenThreadIds] = useState([]);
  const [tabStateReady, setTabStateReady] = useState(false);
  const tabStateHydratedRef = useRef(false);
  const selectedThreadIdRef = useRef(null);
  const lastAppliedRequestedThreadIdRef = useRef("");
  const messagesCacheRef = useRef(new Map());
  const prefetchingRef = useRef(new Set());
  const draftCacheRef = useRef(new Map());

  const requestedThreadId = String(searchParams?.get("thread") || "").trim();

  const tabStateStorageKey = useMemo(() => {
    const viewerId = String(currentSupabaseUserId || userId || "anonymous").trim();
    return `${TAB_STATE_STORAGE_PREFIX}:${viewerId}`;
  }, [currentSupabaseUserId, userId]);

  useEffect(() => {
    selectedThreadIdRef.current = selectedThreadId;
  }, [selectedThreadId]);

  useEffect(() => {
    if (tabStateHydratedRef.current) return;
    if (typeof window === "undefined") return;
    if (!derivedThreads.length) return;

    const raw = window.localStorage.getItem(tabStateStorageKey);
    tabStateHydratedRef.current = true;
    if (!raw) {
      setTabStateReady(true);
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      const validIds = new Set(
        derivedThreads
          .map((thread) => String(thread?.id || "").trim())
          .filter((threadId) => threadId && !isLocalThreadId(threadId)),
      );
      const savedOpenIds = Array.isArray(parsed?.openThreadIds)
        ? parsed.openThreadIds
            .map((threadId) => String(threadId || "").trim())
            .filter((threadId) => validIds.has(threadId))
        : [];
      const savedSelectedId = String(parsed?.selectedThreadId || "").trim();

      if (savedOpenIds.length) {
        const restoredSelectedId =
          savedSelectedId && savedOpenIds.includes(savedSelectedId)
            ? savedSelectedId
            : savedOpenIds[0];
        setOpenThreadIds(restoredSelectedId ? [restoredSelectedId] : []);
        setSelectedThreadId(restoredSelectedId || null);
      }
    } catch {
      // noop
    } finally {
      setTabStateReady(true);
    }
  }, [derivedThreads, isLocalThreadId, tabStateStorageKey]);

  useEffect(() => {
    setOpenThreadIds((prev) => {
      if (!prev.length) return prev;
      const validIds = new Set(
        derivedThreads
          .map((thread) => String(thread?.id || "").trim())
          .filter(Boolean),
      );
      const next = prev.filter((threadId) =>
        validIds.has(String(threadId || "").trim()),
      );
      return next.length === prev.length ? prev : next;
    });
  }, [derivedThreads]);

  useEffect(() => {
    if (!requestedThreadId) {
      lastAppliedRequestedThreadIdRef.current = "";
      return;
    }
    if (lastAppliedRequestedThreadIdRef.current === requestedThreadId) return;
    const validIds = new Set(
      derivedThreads
        .map((thread) => String(thread?.id || "").trim())
        .filter(Boolean),
    );
    if (!validIds.has(requestedThreadId)) return;
    lastAppliedRequestedThreadIdRef.current = requestedThreadId;
    setOpenThreadIds((prev) =>
      prev.includes(requestedThreadId) ? prev : [requestedThreadId, ...prev],
    );
    setSelectedThreadId(requestedThreadId);
  }, [derivedThreads, requestedThreadId]);

  // Keep ?thread= in the URL in sync with the selected thread so page refresh restores it
  useEffect(() => {
    if (typeof window === "undefined") return;
    const current = new URLSearchParams(window.location.search);
    const currentThreadParam = current.get("thread") || "";
    const nextThreadId = selectedThreadId || "";
    if (currentThreadParam === nextThreadId) return;
    const next = new URLSearchParams(current);
    if (nextThreadId) {
      next.set("thread", nextThreadId);
    } else {
      next.delete("thread");
    }
    const queryString = next.toString();
    const newUrl = queryString
      ? `${window.location.pathname}?${queryString}`
      : window.location.pathname;
    window.history.replaceState(window.history.state, "", newUrl);
  }, [selectedThreadId]);

  useEffect(() => {
    if (!tabStateReady) return;
    if (openThreadIds.length) {
      if (selectedThreadId && openThreadIds.includes(selectedThreadId)) return;
      const visibleOpenThreadIds = openThreadIds.filter((threadId) =>
        filteredThreads.some((thread) => thread.id === threadId),
      );
      if (visibleOpenThreadIds.length) {
        setSelectedThreadId(visibleOpenThreadIds[0] || null);
        return;
      }
      setSelectedThreadId(openThreadIds[0] || null);
      return;
    }
    if (!filteredThreads.length) {
      setSelectedThreadId(null);
      return;
    }
    const fallbackThreadId = filteredThreads[0]?.id || null;
    setOpenThreadIds([fallbackThreadId]);
    setSelectedThreadId(fallbackThreadId);
  }, [
    filteredThreads,
    openThreadIds,
    selectedThreadId,
    tabStateReady,
  ]);

  // Keep filter/view changes from making the conversation pane feel empty when
  // the user still has the current ticket open in the workspace tabs.
  useEffect(() => {
    if (!tabStateReady) return;
    if (!selectedThreadId) return;
    if (openThreadIds.includes(selectedThreadId)) return;
    if (!filteredThreads.length) {
      return;
    }
    const isInDerived = derivedThreads.some((t) => t.id === selectedThreadId);
    if (!isInDerived) return;
    const isVisible = filteredThreads.some((t) => t.id === selectedThreadId);
    if (isVisible) return;
    const nextThread = filteredThreads[0];
    setOpenThreadIds((prev) => {
      const without = prev.filter((id) => id !== selectedThreadId);
      return without.includes(nextThread.id)
        ? without
        : [nextThread.id, ...without];
    });
    setSelectedThreadId(nextThread.id);
  }, [
    derivedThreads,
    filteredThreads,
    openThreadIds,
    selectedThreadId,
    tabStateReady,
  ]);

  useEffect(() => {
    if (!tabStateReady) return;
    if (typeof window === "undefined") return;

    const normalizedSelectedId = String(selectedThreadId || "").trim();
    const persistedOpenIds =
      normalizedSelectedId && !isLocalThreadId(normalizedSelectedId)
        ? [normalizedSelectedId]
        : [];
    const persistedSelectedId = String(selectedThreadId || "").trim();
    const payload = {
      openThreadIds: persistedOpenIds,
      selectedThreadId:
        persistedSelectedId && persistedOpenIds.includes(persistedSelectedId)
          ? persistedSelectedId
          : persistedOpenIds[0] || null,
    };
    window.localStorage.setItem(tabStateStorageKey, JSON.stringify(payload));
  }, [
    isLocalThreadId,
    openThreadIds,
    selectedThreadId,
    tabStateReady,
    tabStateStorageKey,
  ]);

  const openThreadInWorkspace = useCallback(
    (threadId, options = {}) => {
      const nextThreadId = String(threadId || "").trim();
      if (!nextThreadId) return;
      const shouldOpenInNewTab = Boolean(options?.newTab);
      markThreadReadInstantly(nextThreadId);

      startInboxTransition(() => {
        setOpenThreadIds((prev) => {
          if (prev.includes(nextThreadId)) return prev;
          if (!prev.length) return [nextThreadId];

          const currentIndex = prev.indexOf(selectedThreadId);
          if (shouldOpenInNewTab) {
            const next = [...prev];
            const insertAt = currentIndex === -1 ? next.length : currentIndex + 1;
            next.splice(insertAt, 0, nextThreadId);
            return next;
          }

          const next = [...prev];
          next[currentIndex === -1 || !selectedThreadId ? 0 : currentIndex] =
            nextThreadId;
          return Array.from(new Set(next));
        });

        setSelectedThreadId(nextThreadId);
      });
    },
    [markThreadReadInstantly, selectedThreadId, startInboxTransition],
  );

  const closeThreadTab = useCallback(
    (threadId) => {
      const closingThreadId = String(threadId || "").trim();
      if (!closingThreadId) return;
      if (isLocalThreadId(closingThreadId)) {
        setLocalNewThread((prev) =>
          prev?.id === closingThreadId ? null : prev,
        );
      }
      setOpenThreadIds((prev) => {
        const currentIndex = prev.indexOf(closingThreadId);
        if (currentIndex === -1) return prev;
        const next = prev.filter((id) => id !== closingThreadId);
        if (selectedThreadId === closingThreadId) {
          const replacement =
            next[currentIndex] || next[currentIndex - 1] || null;
          setSelectedThreadId(replacement);
        }
        return next;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setLocalNewThread is the stable useState setter passed in from InboxSplitView (declared there with useState); identity never changes, so omitting it matches the pre-extraction behavior when this logic lived directly in the component.
    [isLocalThreadId, selectedThreadId],
  );

  // Prefetch on hover. CACHE-RACE SAFETY INVARIANT:
  //
  // The prefetched `draftCacheRef` entry could in theory go stale if the user
  // edits a draft for thread X while prefetch is in-flight. It doesn't cause
  // a bug because:
  //
  // 1. The `loadDraft` effect's early-return guard (InboxSplitView.jsx, ~line 3119)
  //    only reads `draftCacheRef` when `draftValueByThread[threadId]` is NOT set.
  //    User edits always populate `draftValueByThread`, so any edited thread
  //    short-circuits before the cache is touched.
  // 2. Prefetch never runs for the currently-selected thread (line below).
  //
  // If you ever loosen the early-return guard, you MUST also add an explicit
  // `cacheInvalidatedAt` timestamp to prevent stale-cache resurrections.
  // — 2026-05-26
  const handlePrefetchThread = useCallback((threadId) => {
    if (!threadId || isLocalThreadId(threadId)) return;
    if (String(threadId) === String(selectedThreadIdRef.current || "")) return;

    // Prefetch the same detail payload used by the selected thread view.
    if (!messagesCacheRef.current.has(threadId) && !prefetchingRef.current.has(threadId)) {
      if (prefetchingRef.current.size >= MAX_PREFETCH_IN_FLIGHT) return;
      prefetchingRef.current.add(threadId);
      fetch(`/api/inbox/threads/${encodeURIComponent(threadId)}/detail`, {
        method: "GET",
        credentials: "include",
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((payload) => {
          const rows = Array.isArray(payload?.messages) ? payload.messages : [];
          if (rows.length) {
            messagesCacheRef.current.set(threadId, rows);
          }
          if (payload?.draft && typeof payload.draft === "object") {
            draftCacheRef.current.set(threadId, payload.draft);
          }
        })
        .catch(() => {})
        .finally(() => {
          prefetchingRef.current.delete(threadId);
        });
    }

    // Draft loading is intentionally left to actual selection. Hovering through
    // the list used to start draft requests for many tickets the user never opened.
  }, [isLocalThreadId]);

  // Inert until Task 10 (send-to-next). Selects and returns the next thread
  // after the currently selected one in sortedThreads order.
  const selectNext = useCallback(() => {
    const order = Array.isArray(sortedThreads) ? sortedThreads : [];
    const idx = order.findIndex((t) => t?.id === selectedThreadId);
    const next = idx >= 0 ? order[idx + 1] : order[0];
    if (next?.id) setSelectedThreadId(next.id);
    return next?.id ?? null;
  }, [sortedThreads, selectedThreadId]);

  return {
    selectedThreadId,
    setSelectedThreadId,
    selectedThreadIdRef,
    openThreadIds,
    setOpenThreadIds,
    tabStateReady,
    requestedThreadId,
    tabStateStorageKey,
    messagesCacheRef,
    draftCacheRef,
    prefetchingRef,
    openThreadInWorkspace,
    closeThreadTab,
    handlePrefetchThread,
    selectNext,
  };
}
