import { CheckCircle2, Clock, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatMessageTime } from "@/components/inbox/inbox-utils";

const STATUS_STYLES = {
  New: "bg-green-50 text-green-700 border-green-200",
  Open: "bg-blue-50 text-blue-700 border-blue-200",
  Waiting: "bg-amber-50 text-amber-700 border-amber-200",
  Solved: "bg-red-50 text-red-700 border-red-200",
};

export function TicketListItem({
  thread,
  isActive,
  status,
  customerLabel,
  timestamp,
  unreadCount,
  assignee,
  priority,
  onSelect,
}) {
  const isUnread = (unreadCount ?? 0) > 0;
  const hasAiDraft = Boolean(
    thread?.ai_draft_text ||
      thread?.draft_ready ||
      thread?.has_ai_draft
  );

  const statusIcon =
    status === "Solved" ? (
      <CheckCircle2 className="h-3.5 w-3.5" />
    ) : (
      <Clock className="h-3.5 w-3.5" />
    );

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "relative mx-2 my-1.5 flex w-[calc(100%-1rem)] flex-col gap-2 rounded-lg border border-gray-200 bg-white px-3.5 py-3.5 text-left transition-colors hover:bg-gray-50",
        isActive && "z-10 border-slate-800 ring-1 ring-inset ring-slate-800",
        isUnread && "bg-slate-50"
      )}
      aria-pressed={isActive}
    >
      {isUnread ? (
        <span className="absolute left-0 top-0 h-full w-[2px] bg-indigo-500" />
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 truncate text-xs font-semibold text-slate-900">
          {isUnread ? <span className="h-2 w-2 rounded-full bg-indigo-500" /> : null}
          {customerLabel}
        </div>
        <span className="text-[11px] text-gray-400">{formatMessageTime(timestamp)}</span>
      </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-slate-700">
            <span className={cn("truncate", isUnread && "font-semibold text-slate-900")}>
              {thread.subject || "Untitled ticket"}
            </span>
          {hasAiDraft ? <Sparkles className="h-3.5 w-3.5 text-amber-500" /> : null}
        </div>
        <Badge
          variant="secondary"
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold",
            STATUS_STYLES[status]
          )}
        >
          {statusIcon}
          {status === "Solved" ? "Resolved" : status}
        </Badge>
      </div>
    </button>
  );
}
