import { useEffect, useRef, useState } from "react";
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
import { ArrowDownUp, Filter } from "lucide-react";

const STATUS_FILTERS = [
  { value: "All", label: "All" },
  { value: "New", label: "New" },
  { value: "Open", label: "Open" },
  { value: "Pending", label: "Pending" },
  { value: "Waiting", label: "Waiting" },
  { value: "Solved", label: "Solved" },
];
const SORT_OPTIONS = [
  { value: "newest_activity", label: "Newest activity" },
  { value: "newest_updated", label: "Newest updated" },
  { value: "oldest_updated", label: "Oldest updated" },
];
const CONTEXT_MENU_WIDTH_PX = 160;
const CONTEXT_MENU_HEIGHT_PX = 84;
const CONTEXT_MENU_GUTTER_PX = 8;
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
}) {
  const [contextMenu, setContextMenu] = useState(null);
  const [contextMenuRoot, setContextMenuRoot] = useState(null);
  const [renderedThreads, setRenderedThreads] = useState(
    (threads || []).map((thread) => ({ thread, isExiting: false }))
  );
  const exitTimersRef = useRef(new Map());
  const prevThreadIdsRef = useRef(null);
  const itemRefs = useRef({});
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

  useEffect(() => {
    const currentIds = new Set((threads || []).map((t) => String(t?.id || "")).filter(Boolean));
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
      const nextById = new Map((threads || []).map((thread) => [String(thread?.id || ""), thread]));
      const merged = [];

      // Render threads in the sorted order from the parent (newest first).
      (threads || []).forEach((thread) => {
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
  }, [threads]);

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
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {renderedThreads.length ? (
          <div className="divide-y divide-border">
            {renderedThreads.map(({ thread, isExiting }, index) => {
              const uiState = ticketStateByThread[thread.id];
              const customer = customerByThread[thread.id] || "Unknown sender";
              const timestamp = getTimestamp(thread);
              const unreadCount = getUnreadCount(thread);
              return (
                <div key={thread.id} ref={(el) => { itemRefs.current[thread.id] = el; }}>
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
              );
            })}
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
