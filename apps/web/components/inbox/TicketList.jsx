import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TicketListItem } from "@/components/inbox/TicketListItem";

const STATUS_FILTERS = ["All", "New", "Open", "Pending", "Waiting", "Solved"];
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
  const [renderedThreads, setRenderedThreads] = useState(
    (threads || []).map((thread) => ({ thread, isExiting: false }))
  );
  const exitTimersRef = useRef(new Map());
  const prevThreadIdsRef = useRef(null);
  const [newThreadIds, setNewThreadIds] = useState(new Set());
  const newTimersRef = useRef(new Map());
  const statusFilters = hideSolvedFilter
    ? STATUS_FILTERS.filter((option) => option !== "Solved")
    : STATUS_FILTERS;

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

  return (
    <aside className="flex w-full flex-col border-r border-gray-200 bg-white lg:w-[clamp(18rem,20vw,24rem)] lg:min-w-[clamp(18rem,20vw,24rem)] lg:max-w-[clamp(18rem,20vw,24rem)] lg:flex-none">
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
        <Input
          value={filters.query}
          onChange={(event) => onFiltersChange({ query: event.target.value })}
          placeholder="Search..."
          className="h-8 flex-1 text-[13px]"
        />
        <Select
          value={filters.status}
          onValueChange={(value) => onFiltersChange({ status: value })}
        >
          <SelectTrigger className="h-8 w-[90px] shrink-0 text-[13px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {statusFilters.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Switch
          checked={filters.unreadsOnly}
          onCheckedChange={(checked) => onFiltersChange({ unreadsOnly: checked })}
          title="Unread only"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {renderedThreads.length ? (
          <div className="divide-y divide-gray-100">
            {renderedThreads.map(({ thread, isExiting }) => {
              const uiState = ticketStateByThread[thread.id];
              const customer = customerByThread[thread.id] || "Unknown sender";
              const timestamp = getTimestamp(thread);
              const unreadCount = getUnreadCount(thread);
              return (
                <TicketListItem
                  key={thread.id}
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
              );
            })}
          </div>
        ) : (
          <div className="px-4 py-8 text-[13px] text-muted-foreground">
            No tickets found yet.
          </div>
        )}
      </div>
      <div className="border-t border-gray-100 px-3 pb-2 pt-2">
        <button
          type="button"
          onClick={onCreateTicket}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md px-3 text-[13px] text-gray-400 transition hover:bg-gray-50 hover:text-gray-600"
        >
          <span className="text-base leading-none">+</span>
          New ticket
        </button>
      </div>
      {contextMenu ? (
        <div
          className="fixed z-50 min-w-[160px] rounded-md border border-gray-200 bg-white p-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            type="button"
            onClick={() => {
              onOpenInNewTab?.(contextMenu.threadId);
              setContextMenu(null);
            }}
            className="flex w-full items-center rounded px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
          >
            Open in new tab
          </button>
          <button
            type="button"
            onClick={() => {
              onDeleteThread?.(contextMenu.threadId);
              setContextMenu(null);
            }}
            className="flex w-full items-center rounded px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      ) : null}
    </aside>
  );
}
