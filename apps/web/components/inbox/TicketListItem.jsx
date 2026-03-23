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

const CLASSIFICATION_LABELS = {
  support: "Support",
  notification: "Notification",
  partnership: "Partnership",
  job: "Job",
  invoice: "Invoice",
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
  onContextMenu,
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
  const classificationKey = String(thread?.classification_key || "").toLowerCase();
  const classificationLabel =
    classificationKey && classificationKey !== "support"
      ? CLASSIFICATION_LABELS[classificationKey] || null
      : null;

  return (
    <button
      type="button"
      onClick={(event) =>
        onSelect?.({
          newTab: Boolean(event.metaKey || event.ctrlKey),
        })
      }
      onContextMenu={(event) => onContextMenu?.(event)}
      className={cn(
        "relative mx-2 my-1 flex w-[calc(100%-1rem)] flex-col gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-left transition-colors hover:bg-gray-50",
        isActive && "z-10 border-slate-800 ring-1 ring-inset ring-slate-800",
        isUnread && "bg-slate-50"
      )}
      aria-pressed={isActive}
    >
      {isUnread ? (
        <span className="absolute left-0 top-0 h-full w-[2px] bg-indigo-500" />
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 truncate text-[13px] font-semibold text-slate-900">
          {isUnread ? <span className="h-2 w-2 rounded-full bg-indigo-500" /> : null}
          <span className="truncate">{customerLabel}</span>
        </div>
        <span className="shrink-0 text-[12px] text-gray-400">{formatMessageTime(timestamp)}</span>
      </div>
      {classificationLabel ? (
        <div className="text-[12px] font-medium uppercase tracking-wide text-slate-500">
          {classificationLabel}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] text-slate-700">
          <span className={cn("truncate", isUnread && "font-semibold text-slate-900")}>
              {thread.subject || "Untitled ticket"}
          </span>
          {hasAiDraft ? <Sparkles className="h-3.5 w-3.5 text-amber-500" /> : null}
        </div>
        <Badge
          variant="secondary"
          className={cn(
            "shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-bold",
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
