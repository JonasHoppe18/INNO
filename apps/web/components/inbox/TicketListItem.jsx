import { memo, useEffect, useRef } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMessageTime } from "@/components/inbox/inbox-utils";
import { assigneeInitials, formatWakeCountdown } from "@/lib/inbox/view-model";

const STATUS_TEXT_STYLES = {
  New: "text-green-600 dark:text-green-400",
  Open: "text-blue-600 dark:text-blue-400",
  Pending: "text-orange-500 dark:text-orange-400",
  Waiting: "text-violet-500 dark:text-violet-400",
  Solved: "text-muted-foreground",
};

const CLASSIFICATION_LABELS = {
  support: "Support",
  notification: "Notification",
  partnership: "Partnership",
  job: "Job",
  invoice: "Invoice",
};
const PREFETCH_HOVER_DELAY_MS = 700;

function TicketListItemComponent({
  thread,
  isActive,
  status,
  customerLabel,
  timestamp,
  unreadCount,
  assignee,
  assigneeLabel = null,
  priority,
  reason = null,
  showLegacyStatus = false,
  inboxName = null,
  wakeDays = null,
  isExiting = false,
  isNew = false,
  mountIndex = 0,
  showApproveCloseActions = false,
  onApproveClose,
  onKeepWaiting,
  onSelect,
  onContextMenu,
  onPrefetch,
}) {
  const isUnread = (unreadCount ?? 0) > 0;
  const hasAiDraft = Boolean(
    thread?.ai_draft_text ||
      thread?.draft_ready ||
      thread?.has_ai_draft
  );
  const assigneeDisplay = assigneeLabel ? assigneeInitials(assigneeLabel) : null;
  const wakeCountdownText = formatWakeCountdown(wakeDays);

  const classificationKey = String(thread?.classification_key || "").toLowerCase();
  const classificationLabel =
    classificationKey && classificationKey !== "support"
      ? CLASSIFICATION_LABELS[classificationKey] || null
      : null;
  const ticketRef = Number.isFinite(Number(thread?.ticket_number))
    ? `T-${String(Number(thread.ticket_number)).padStart(6, "0")}`
    : "No ticket ID";
  const hasTicketNumber = ticketRef !== "No ticket ID";

  const prefetchTimerRef = useRef(null);

  const handleMouseEnter = () => {
    if (!onPrefetch) return;
    prefetchTimerRef.current = setTimeout(() => {
      onPrefetch();
    }, PREFETCH_HOVER_DELAY_MS);
  };

  const handleMouseLeave = () => {
    clearTimeout(prefetchTimerRef.current);
  };

  useEffect(
    () => () => {
      clearTimeout(prefetchTimerRef.current);
    },
    [],
  );

  return (
    // Task 9, Plan 2: the outer element used to be a bare <button> — approve
    // close and keep-waiting are now rendered as a sibling row (see below)
    // rather than nested inside it (nested <button>s are invalid HTML/a11y),
    // so the row is now wrapped in a plain <div> when those actions can show.
    // Every other view still gets exactly the same single <button>, unchanged.
    <div className="relative">
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
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(
        "relative flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors duration-150 hover:bg-muted/50",
        isNew ? "animate-ticket-enter" : !isExiting && "animate-list-item-enter",
        isActive && "bg-muted/50",
        isExiting && "pointer-events-none"
      )}
      style={{
        animationDelay: !isNew && !isExiting && mountIndex > 0 ? `${Math.min(mountIndex, 8) * 28}ms` : undefined,
        transition:
          "opacity 200ms cubic-bezier(0.23,1,0.32,1), transform 200ms cubic-bezier(0.23,1,0.32,1), max-height 240ms cubic-bezier(0.23,1,0.32,1), padding 240ms cubic-bezier(0.23,1,0.32,1)",
        opacity: isExiting ? 0 : 1,
        transform: isExiting ? "translateX(12px) scale(0.98)" : "translateX(0) scale(1)",
        maxHeight: isExiting ? "0px" : "220px",
        paddingTop: isExiting ? "0px" : undefined,
        paddingBottom: isExiting ? "0px" : undefined,
        overflow: "hidden",
      }}
      aria-pressed={isActive}
    >
      <span
        className={cn(
          "absolute left-0 top-0 h-full w-[3px] rounded-r transition-[background-color,opacity] duration-150",
          isActive ? "bg-primary" : isUnread ? "bg-indigo-400" : "bg-transparent"
        )}
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 truncate text-[13px] font-semibold text-foreground">
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
              hasTicketNumber
                ? "bg-muted font-medium text-muted-foreground"
                : "text-muted-foreground"
            )}
          >
            {ticketRef}
          </span>
          <span className="truncate">{customerLabel}</span>
        </div>
        <span className="shrink-0 text-[12px] text-muted-foreground">{formatMessageTime(timestamp)}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] text-muted-foreground">
          <span className={cn("truncate", isUnread && "font-medium text-foreground")}>
            {thread.subject || "Untitled ticket"}
          </span>
          {hasAiDraft ? <Sparkles className="h-3 w-3 text-amber-400" /> : null}
        </div>
        {reason ? (
          <span
            className={
              "shrink-0 text-xs whitespace-nowrap " +
              (reason.key === "customer_replied"
                ? "text-amber-700 dark:text-amber-500"
                : reason.key === "approve_close"
                  ? "text-purple-700 dark:text-purple-400"
                  : "text-green-700 dark:text-green-500")
            }
          >
            {reason.label}
          </span>
        ) : showLegacyStatus ? (
          <span className={cn("shrink-0 text-[12px]", STATUS_TEXT_STYLES[status] || "text-muted-foreground")}>
            {status === "Solved" ? "Resolved" : status}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {inboxName ? <span className="truncate">{inboxName}</span> : null}
        {inboxName ? <span aria-hidden="true">&middot;</span> : null}
        {hasAiDraft ? (
          <>
            <span className="text-purple-700 dark:text-purple-400">Draft ready</span>
            <span aria-hidden="true">&middot;</span>
          </>
        ) : null}
        <span className={cn(!assigneeDisplay && "text-muted-foreground/70")}>
          {assigneeDisplay || "Unassigned"}
        </span>
        {wakeCountdownText ? (
          <>
            <span aria-hidden="true">&middot;</span>
            <span className="truncate">{wakeCountdownText}</span>
          </>
        ) : null}
      </div>
      {classificationLabel ? (
        <div className="text-[11px] text-muted-foreground">
          {classificationLabel}
        </div>
      ) : null}
    </button>
    {showApproveCloseActions ? (
      <div className="flex items-center gap-3 border-t border-border/60 px-4 py-1.5">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onApproveClose?.();
          }}
          className="text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onKeepWaiting?.();
          }}
          className="text-[12px] text-muted-foreground transition-colors hover:text-foreground"
        >
          Keep waiting
        </button>
      </div>
    ) : null}
    </div>
  );
}

export const TicketListItem = memo(
  TicketListItemComponent,
  (prev, next) =>
    prev.thread === next.thread &&
    prev.isActive === next.isActive &&
    prev.status === next.status &&
    prev.customerLabel === next.customerLabel &&
    prev.timestamp === next.timestamp &&
    prev.unreadCount === next.unreadCount &&
    prev.assignee === next.assignee &&
    prev.assigneeLabel === next.assigneeLabel &&
    prev.priority === next.priority &&
    prev.reason === next.reason &&
    prev.showLegacyStatus === next.showLegacyStatus &&
    prev.inboxName === next.inboxName &&
    prev.wakeDays === next.wakeDays &&
    prev.isExiting === next.isExiting &&
    prev.isNew === next.isNew &&
    prev.mountIndex === next.mountIndex &&
    prev.showApproveCloseActions === next.showApproveCloseActions,
);
