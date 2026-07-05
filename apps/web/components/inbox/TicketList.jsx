import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TicketListItem } from "@/components/inbox/TicketListItem";
import { ArrowDownUp, Filter, Inbox } from "lucide-react";
import { deriveReason, formatWaitAge, wakeInDays } from "@/lib/inbox/view-model";

const STATUS_FILTERS = [
  { value: "All", label: "All" },
  { value: "New", label: "New" },
  { value: "Open", label: "Open" },
  { value: "Pending", label: "Pending" },
  { value: "Waiting", label: "Waiting" },
  { value: "Solved", label: "Solved" },
];
const SORT_OPTIONS = [
  { value: "unread_first", label: "Unread first" },
  { value: "newest_activity", label: "Newest activity" },
  { value: "newest_updated", label: "Newest updated" },
  { value: "oldest_updated", label: "Oldest updated" },
];
const CONTEXT_MENU_WIDTH_PX = 160;
const CONTEXT_MENU_HEIGHT_PX = 84;
const CONTEXT_MENU_GUTTER_PX = 8;
const VIRTUAL_ROW_HEIGHT_PX = 84;
const VIRTUAL_OVERSCAN_ROWS = 6;
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
  resolvedView = "",
  isNeedsAttentionRoute = false,
  getAssigneeLabel,
  groups = null,
  showWakeCountdown = false,
  approveCloseGroupKey = null,
  onApproveClose,
  onKeepWaiting,
}) {
  const [contextMenu, setContextMenu] = useState(null);
  const [contextMenuRoot, setContextMenuRoot] = useState(null);
  // Task 8, Plan 2: when `groups` is supplied (Waiting tab), render is driven
  // by the group-partitioned, concatenated thread order rather than the raw
  // `threads` prop order — group headers are inserted at each group's first
  // row further down. Falls back to `threads` unchanged for every other view.
  const orderedThreads = useMemo(() => {
    if (!groups) return threads || [];
    return groups.flatMap((group) => group.threads || []);
  }, [groups, threads]);
  // Maps a thread id to the group header that should render immediately
  // above it (only the first thread of each group carries a header).
  const groupHeaderByThreadId = useMemo(() => {
    const map = new Map();
    if (!groups) return map;
    groups.forEach((group) => {
      const firstThread = (group.threads || [])[0];
      const firstId = firstThread ? String(firstThread.id || "") : "";
      if (firstId) map.set(firstId, group.label);
    });
    return map;
  }, [groups]);
  // Task 9, Plan 2: thread ids belonging to the "Approve close" group (keyed
  // by approveCloseGroupKey, e.g. "approve_close" from
  // groupNeedsAttentionThreads) — drives the Approve/Keep-waiting row actions
  // further down. Empty set (no rows match) for every other view/group.
  const approveCloseThreadIds = useMemo(() => {
    const set = new Set();
    if (!groups || !approveCloseGroupKey) return set;
    const match = groups.find((group) => group.key === approveCloseGroupKey);
    (match?.threads || []).forEach((thread) => {
      const id = String(thread?.id || "");
      if (id) set.add(id);
    });
    return set;
  }, [groups, approveCloseGroupKey]);
  const [renderedThreads, setRenderedThreads] = useState(
    (orderedThreads || []).map((thread) => ({ thread, isExiting: false }))
  );
  const exitTimersRef = useRef(new Map());
  const prevThreadIdsRef = useRef(null);
  const itemRefs = useRef({});
  const scrollContainerRef = useRef(null);
  const [virtualViewport, setVirtualViewport] = useState({
    scrollTop: 0,
    height: 0,
  });
  const [newThreadIds, setNewThreadIds] = useState(new Set());
  const newTimersRef = useRef(new Map());
  const statusOptions = hideSolvedFilter
    ? STATUS_FILTERS.filter((option) => option.value !== "Solved")
    : STATUS_FILTERS;
  const selectedStatuses = Array.isArray(filters.statuses)
    ? filters.statuses
    : filters.status && filters.status !== "All"
        ? [filters.status]
        : [];
  const activeFilterCount =
    selectedStatuses.length + (filters.unreadsOnly ? 1 : 0);
  const selectedSortLabel =
    SORT_OPTIONS.find((option) => option.value === (filters.sortBy || "newest_activity"))
      ?.label || "Newest activity";
  const handleStatusToggle = (status, checked) => {
    const next = checked
      ? [...new Set([...selectedStatuses, status])]
      : selectedStatuses.filter((value) => value !== status);
    onFiltersChange({ statuses: next, status: "All" });
  };

  const updateVirtualViewport = useCallback(() => {
    const node = scrollContainerRef.current;
    if (!node) return;
    setVirtualViewport((prev) => {
      const next = {
        scrollTop: node.scrollTop,
        height: node.clientHeight,
      };
      if (
        Math.abs(prev.scrollTop - next.scrollTop) < 24 &&
        Math.abs(prev.height - next.height) < 2
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const currentIds = new Set((orderedThreads || []).map((t) => String(t?.id || "")).filter(Boolean));
    if (prevThreadIdsRef.current !== null) {
      const addedIds = [...currentIds].filter((id) => !prevThreadIdsRef.current.has(id));
      if (addedIds.length > 0) {
        setNewThreadIds((prev) => {
          const next = new Set(prev);
          addedIds.forEach((id) => next.add(id));
          return next;
        });
        addedIds.forEach((id) => {
          if (newTimersRef.current.has(id)) return;
          const timer = setTimeout(() => {
            setNewThreadIds((prev) => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
            newTimersRef.current.delete(id);
          }, 800);
          newTimersRef.current.set(id, timer);
        });
      }
    }
    prevThreadIdsRef.current = currentIds;

    setRenderedThreads((prev) => {
      const nextById = new Map((orderedThreads || []).map((thread) => [String(thread?.id || ""), thread]));
      const merged = [];

      // Render threads in the sorted order from the parent (newest first).
      (orderedThreads || []).forEach((thread) => {
        const id = String(thread?.id || "");
        if (!id) return;
        merged.push({ thread, isExiting: false });
      });

      // Append threads that are leaving so their exit animation can finish.
      prev.forEach((item) => {
        const id = String(item?.thread?.id || "");
        if (!id || nextById.has(id)) return;
        merged.push({ thread: item.thread, isExiting: true });
      });

      return merged;
    });
  }, [orderedThreads]);

  useEffect(() => {
    renderedThreads.forEach((item) => {
      const id = String(item?.thread?.id || "");
      if (!id) return;
      if (item.isExiting) {
        if (exitTimersRef.current.has(id)) return;
        const timerId = setTimeout(() => {
          setRenderedThreads((prev) =>
            prev.filter((row) => String(row?.thread?.id || "") !== id)
          );
          exitTimersRef.current.delete(id);
        }, 520);
        exitTimersRef.current.set(id, timerId);
        return;
      }
      const existingTimer = exitTimersRef.current.get(id);
      if (existingTimer) {
        clearTimeout(existingTimer);
        exitTimersRef.current.delete(id);
      }
    });
  }, [renderedThreads]);

  useEffect(
    () => () => {
      exitTimersRef.current.forEach((timerId) => clearTimeout(timerId));
      exitTimersRef.current.clear();
      newTimersRef.current.forEach((timerId) => clearTimeout(timerId));
      newTimersRef.current.clear();
    },
    []
  );

  useEffect(() => {
    updateVirtualViewport();
  }, [renderedThreads.length, updateVirtualViewport]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return undefined;
    const node = scrollContainerRef.current;
    if (!node) return undefined;
    const observer = new ResizeObserver(updateVirtualViewport);
    observer.observe(node);
    return () => observer.disconnect();
  }, [updateVirtualViewport]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;
      e.preventDefault();

      const activeThreads = renderedThreads.filter((item) => !item.isExiting);
      if (!activeThreads.length) return;

      const currentIndex = activeThreads.findIndex(
        (item) => item.thread.id === selectedThreadId
      );
      let nextIndex;
      if (e.key === "ArrowDown") {
        nextIndex = currentIndex < activeThreads.length - 1 ? currentIndex + 1 : currentIndex;
      } else {
        nextIndex = currentIndex > 0 ? currentIndex - 1 : 0;
      }
      if (nextIndex === currentIndex && currentIndex !== -1) return;

      const nextThread = activeThreads[nextIndex === -1 ? 0 : nextIndex].thread;
      onSelectThread(nextThread.id);

      const el = itemRefs.current[nextThread.id];
      el?.scrollIntoView({ block: "nearest" });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [renderedThreads, selectedThreadId, onSelectThread]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const handleClose = () => setContextMenu(null);
    window.addEventListener("click", handleClose);
    window.addEventListener("scroll", handleClose, true);
    window.addEventListener("resize", handleClose);
    return () => {
      window.removeEventListener("click", handleClose);
      window.removeEventListener("scroll", handleClose, true);
      window.removeEventListener("resize", handleClose);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    setContextMenuRoot(document.body);
  }, []);

  const contextMenuStyle =
    contextMenu && typeof window !== "undefined"
      ? {
          left: Math.max(
            CONTEXT_MENU_GUTTER_PX,
            Math.min(
              contextMenu.x,
              window.innerWidth - CONTEXT_MENU_WIDTH_PX - CONTEXT_MENU_GUTTER_PX
            )
          ),
          top: Math.max(
            CONTEXT_MENU_GUTTER_PX,
            Math.min(
              contextMenu.y,
              window.innerHeight - CONTEXT_MENU_HEIGHT_PX - CONTEXT_MENU_GUTTER_PX
            )
          ),
        }
      : undefined;

  const virtualWindow = useMemo(() => {
    const total = renderedThreads.length;
    if (!total) {
      return {
        rows: [],
        before: 0,
        after: 0,
        startIndex: 0,
      };
    }
    const viewportHeight = virtualViewport.height || 720;
    const startIndex = Math.max(
      0,
      Math.floor(virtualViewport.scrollTop / VIRTUAL_ROW_HEIGHT_PX) -
        VIRTUAL_OVERSCAN_ROWS
    );
    const visibleCount =
      Math.ceil(viewportHeight / VIRTUAL_ROW_HEIGHT_PX) +
      VIRTUAL_OVERSCAN_ROWS * 2;
    const endIndex = Math.min(total, startIndex + visibleCount);
    return {
      rows: renderedThreads.slice(startIndex, endIndex),
      before: startIndex * VIRTUAL_ROW_HEIGHT_PX,
      after: Math.max(0, (total - endIndex) * VIRTUAL_ROW_HEIGHT_PX),
      startIndex,
    };
  }, [renderedThreads, virtualViewport.height, virtualViewport.scrollTop]);

  return (
    <aside className="animate-view-enter flex w-full flex-col border-r border-border bg-background lg:w-[clamp(18rem,20vw,24rem)] lg:min-w-[clamp(18rem,20vw,24rem)] lg:max-w-[clamp(18rem,20vw,24rem)] lg:flex-none">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Input
            value={filters.query}
            onChange={(event) => onFiltersChange({ query: event.target.value })}
            placeholder="Search..."
            className="h-8 min-w-0 flex-1 text-[13px]"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={`relative flex h-8 w-9 shrink-0 items-center justify-center rounded-md border text-muted-foreground ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${
                  activeFilterCount
                    ? "border-primary/35 bg-primary/10 text-primary"
                    : "border-input bg-background"
                }`}
                title="Filters"
              >
                <Filter className="h-4 w-4" />
                {activeFilterCount ? (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
                    {activeFilterCount}
                  </span>
                ) : null}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Status
              </DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={selectedStatuses.length === 0}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={() =>
                  onFiltersChange({ statuses: [], status: "All" })
                }
              >
                All
              </DropdownMenuCheckboxItem>
              {statusOptions
                .filter((option) => option.value !== "All")
                .map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option.value}
                    checked={selectedStatuses.includes(option.value)}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={(checked) =>
                      handleStatusToggle(option.value, checked)
                    }
                  >
                    {option.label}
                  </DropdownMenuCheckboxItem>
                ))}
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={filters.unreadsOnly}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={(checked) =>
                  onFiltersChange({ unreadsOnly: checked })
                }
              >
                Unread only
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-8 max-w-[128px] shrink-0 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-[13px] text-muted-foreground ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                title={`Sort: ${selectedSortLabel}`}
              >
                <ArrowDownUp className="h-4 w-4 shrink-0" />
                <span className="truncate">{selectedSortLabel.replace(" activity", "")}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {SORT_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  onClick={() => onFiltersChange({ sortBy: option.value })}
                >
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div
        ref={scrollContainerRef}
        className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={updateVirtualViewport}
      >
        {renderedThreads.length ? (
          <div className="divide-y divide-border">
            {virtualWindow.before ? (
              <div style={{ height: virtualWindow.before }} aria-hidden="true" />
            ) : null}
            {virtualWindow.rows.map(({ thread, isExiting }, index) => {
              const absoluteIndex = virtualWindow.startIndex + index;
              const uiState = ticketStateByThread[thread.id];
              const customer = customerByThread[thread.id] || "Unknown sender";
              const timestamp = getTimestamp(thread);
              const unreadCount = getUnreadCount(thread);
              // View-all (lookup) keeps today's status text; every other queue
              // view shows the "why is this here" reason instead.
              const isLookupView = resolvedView === "all";
              const reason = isLookupView ? null : deriveReason(thread);
              // When there's no stored reason (nothing new/no reply since the
              // agent last touched it), fall back to how long the customer has
              // been waiting rather than leaving the slot empty — same value
              // the queue is sorted by, so it's genuinely useful, not filler.
              const waitAge =
                !isLookupView && !reason ? formatWaitAge(thread, Date.now()) : null;
              const assigneeLabel = getAssigneeLabel
                ? getAssigneeLabel(uiState?.assignee ?? thread.assignee_id ?? null)
                : null;
              const groupHeaderLabel = groupHeaderByThreadId.get(String(thread.id));
              // Waiting tab only: wake countdown next to the meta line, per
              // Task 8 brief. `wakeInDays` handles null/invalid wake_at.
              const wakeDays = showWakeCountdown ? wakeInDays(thread, Date.now()) : null;
              // Task 9, Plan 2: rows in the "Approve close" group render two
              // small quiet text-buttons instead of relying on selection.
              const isApproveCloseRow = approveCloseThreadIds.has(String(thread.id));
              return (
                <div key={thread.id}>
                  {groupHeaderLabel ? (
                    <div className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      {groupHeaderLabel}
                    </div>
                  ) : null}
                  <div ref={(el) => { itemRefs.current[thread.id] = el; }}>
                    <TicketListItem
                      thread={thread}
                      isActive={thread.id === selectedThreadId}
                      status={uiState?.status || "New"}
                      customerLabel={customer}
                      timestamp={timestamp}
                      unreadCount={unreadCount}
                      assignee={uiState?.assignee}
                      assigneeLabel={assigneeLabel}
                      priority={uiState?.priority}
                      reason={reason}
                      waitAge={waitAge}
                      showLegacyStatus={isLookupView}
                      wakeDays={wakeDays}
                      isExiting={isExiting}
                      isNew={newThreadIds.has(String(thread.id))}
                      mountIndex={absoluteIndex}
                      showApproveCloseActions={isApproveCloseRow}
                      onApproveClose={
                        isApproveCloseRow && onApproveClose
                          ? () => onApproveClose(thread.id)
                          : undefined
                      }
                      onKeepWaiting={
                        isApproveCloseRow && onKeepWaiting
                          ? () => onKeepWaiting(thread.id)
                          : undefined
                      }
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
                  </div>
                </div>
              );
            })}
            {virtualWindow.after ? (
              <div style={{ height: virtualWindow.after }} aria-hidden="true" />
            ) : null}
          </div>
        ) : isNeedsAttentionRoute ? (
          // Task 10, Plan 2: quiet inbox-zero state for the needs-attention
          // queue (default view, "mine", or an inbox-scoped needs_attention
          // tab) when it has no threads — no confetti, Sona-quiet.
          <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 px-4 py-8 text-center">
            <Inbox className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-[13px] font-medium text-foreground">Inbox zero</p>
              <p className="text-[13px] text-muted-foreground">
                Nothing needs your attention right now.
              </p>
            </div>
          </div>
        ) : (
          <div className="px-4 py-8 text-[13px] text-muted-foreground">
            No tickets found yet.
          </div>
        )}
      </div>
      <div className="border-t border-border px-3 pb-2 pt-2">
        <button
          type="button"
          onClick={onCreateTicket}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md px-3 text-[13px] text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          <span className="text-base leading-none">+</span>
          New ticket
        </button>
      </div>
      {contextMenu && contextMenuRoot
        ? createPortal(
            <div
              className="fixed z-50 min-w-[160px] rounded-md border border-border bg-popover p-1 shadow-lg"
              style={contextMenuStyle}
            >
              <button
                type="button"
                onClick={() => {
                  onOpenInNewTab?.(contextMenu.threadId);
                  setContextMenu(null);
                }}
                className="flex w-full items-center rounded px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
              >
                Open in new tab
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteThread?.(contextMenu.threadId);
                  setContextMenu(null);
                }}
                className="flex w-full items-center rounded px-3 py-2 text-left text-sm text-red-500 hover:bg-red-500/10"
              >
                Delete
              </button>
            </div>,
            contextMenuRoot
          )
        : null}
    </aside>
  );
}
