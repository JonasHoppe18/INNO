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

const STATUS_FILTERS = ["All", "New", "Open", "Waiting", "Solved"];
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
}) {
  return (
    <aside className="flex w-full flex-col border-b bg-white lg:w-[20vw] lg:min-w-[20vw] lg:max-w-[20vw] lg:flex-none lg:border-b-0 lg:border-r lg:border-gray-200">
      <div className="border-b p-3">
        <div className="grid gap-2">
          <Input
            value={filters.query}
            onChange={(event) => onFiltersChange({ query: event.target.value })}
            placeholder="Search tickets"
            className="h-9 text-sm"
          />
          <div className="flex items-center justify-between gap-2">
            <Select
              value={filters.status}
              onValueChange={(value) => onFiltersChange({ status: value })}
            >
              <SelectTrigger className="h-9 w-[150px] text-sm">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>Unreads</span>
              <Switch
                checked={filters.unreadsOnly}
                onCheckedChange={(checked) => onFiltersChange({ unreadsOnly: checked })}
              />
            </div>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-24">
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
                  onSelect={() => onSelectThread(thread.id)}
                />
              );
            })}
          </div>
        ) : (
          <div className="px-4 py-8 text-xs text-muted-foreground">
            No tickets found yet.
          </div>
        )}
      </div>
      <div className="sticky bottom-0 border-t border-gray-200 bg-gray-50 px-3 pb-4 pt-3">
        <div className="mb-2 text-center text-[11px] text-gray-400">
          ({threads.length} total)
        </div>
        <button
          type="button"
          onClick={onCreateTicket}
          className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 bg-white px-3 text-xs font-medium text-gray-500 transition hover:border-gray-400 hover:text-gray-700"
        >
          <span className="text-sm font-semibold">+</span>
          Create New Ticket
        </button>
      </div>
    </aside>
  );
}
