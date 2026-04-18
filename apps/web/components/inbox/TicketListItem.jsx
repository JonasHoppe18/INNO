import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMessageTime } from "@/components/inbox/inbox-utils";

const STATUS_TEXT_STYLES = {
  New: "text-green-600",
  Open: "text-blue-600",
  Pending: "text-orange-500",
  Waiting: "text-violet-500",
  Solved: "text-gray-400",
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
  isExiting = false,
  onSelect,
  onContextMenu,
}) {
  const isUnread = (unreadCount ?? 0) > 0;
  const hasAiDraft = Boolean(
    thread?.ai_draft_text ||
      thread?.draft_ready ||
      thread?.has_ai_draft
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
        isExiting
          ? null
          : onSelect?.({
              newTab: Boolean(event.metaKey || event.ctrlKey),
            })
      }
      onContextMenu={(event) => onContextMenu?.(event)}
      className={cn(
        "animate-in fade-in slide-in-from-left-1 relative flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors duration-200 hover:bg-gray-50",
        isActive && "bg-gray-50",
        isExiting && "pointer-events-none"
      )}
      style={{
        transition:
          "opacity 420ms ease, transform 420ms ease, max-height 420ms ease, padding 420ms ease",
        opacity: isExiting ? 0 : 1,
        transform: isExiting ? "translateX(20px) scale(0.98)" : "translateX(0) scale(1)",
        maxHeight: isExiting ? "0px" : "220px",
        paddingTop: isExiting ? "0px" : undefined,
        paddingBottom: isExiting ? "0px" : undefined,
        overflow: "hidden",
      }}
      aria-pressed={isActive}
    >
      <span
        className={cn(
          "absolute left-0 top-0 h-full w-[3px] rounded-r transition-all",
          isActive ? "bg-slate-800" : isUnread ? "bg-indigo-400" : "bg-transparent"
        )}
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 truncate text-[13px] font-semibold text-slate-900">
          <span className="truncate">{customerLabel}</span>
        </div>
        <span className="shrink-0 text-[12px] text-gray-400">{formatMessageTime(timestamp)}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] text-slate-500">
          <span className={cn("truncate", isUnread && "font-medium text-slate-700")}>
            {thread.subject || "Untitled ticket"}
          </span>
          {hasAiDraft ? <Sparkles className="h-3 w-3 text-amber-400" /> : null}
        </div>
        <span className={cn("shrink-0 text-[12px]", STATUS_TEXT_STYLES[status] || "text-gray-400")}>
          {status === "Solved" ? "Resolved" : status}
        </span>
      </div>
      {classificationLabel ? (
        <div className="text-[11px] text-slate-400">
          {classificationLabel}
        </div>
      ) : null}
    </button>
  );
}
