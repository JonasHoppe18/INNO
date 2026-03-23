import { useEffect, useState } from "react";
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
  const statusFilters = hideSolvedFilter
    ? STATUS_FILTERS.filter((option) => option !== "Solved")
    : STATUS_FILTERS;

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
      <div className="px-3 pb-3 pt-2.5">
        <div className="grid gap-2">
          <Input
            value={filters.query}
            onChange={(event) => onFiltersChange({ query: event.target.value })}
            placeholder="Search tickets"
            className="h-9 text-[13px]"
          />
          <div className="flex items-center justify-between gap-2">
            <Select
              value={filters.status}
              onValueChange={(value) => onFiltersChange({ status: value })}
            >
              <SelectTrigger className="h-9 w-[150px] text-[13px]">
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
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <span>Unreads</span>
              <Switch
                checked={filters.unreadsOnly}
                onCheckedChange={(checked) => onFiltersChange({ unreadsOnly: checked })}
              />
            </div>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pt-1 pb-24">
        {threads.length ? (
          <div>
            {threads.map((thread) => {
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
      <div className="sticky bottom-0 border-t border-gray-200 bg-sidebar px-3 pb-3 pt-2.5">
        <div className="mb-2 text-center text-[12px] text-gray-400">
          ({threads.length} total)
        </div>
        <button
          type="button"
          onClick={onCreateTicket}
          className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 bg-white px-3 text-[13px] font-medium text-gray-500 transition hover:border-gray-400 hover:text-gray-700"
        >
          <span className="text-sm font-semibold">+</span>
          Create New Ticket
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
