import { memo, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMessageTime } from "@/components/inbox/inbox-utils";
import { assigneeInitials, formatWakeCountdown } from "@/lib/inbox/view-model";
import { THREAD_DRAG_MIME } from "@/lib/inbox/thread-drag-bridge";
import { formatTicketReference } from "@/lib/tickets/reference";

const STATUS_DOT_STYLES = {
  New: "bg-success-foreground",
  Open: "bg-info-foreground",
  Pending: "bg-warning-foreground",
  Waiting: "bg-muted-foreground",
  Solved: "bg-muted-foreground/60",
};

const PREFETCH_HOVER_DELAY_MS = 700;

function TicketListItemComponent({
  thread,
  isActive,
  status,
  customerLabel,
  previewText = "",
  timestamp,
  unreadCount,
  assignee,
  assigneeLabel = null,
  priority,
  reason = null,
  showLegacyStatus = false,
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

  const ticketRef = formatTicketReference(thread?.ticket_number);
  const hasTicketRef = ticketRef !== "No ticket ID";
  const ticketNumberLabel = hasTicketRef
    ? `#${ticketRef.replace(/^T-/, "")}`
    : null;
  const statusLabel = status === "Solved" ? "Resolved" : status;

  // Give sender and subject their own lines; keep ID, reason and time together
  // below them so metadata does not shorten the subject.
  const metadataTitle = [
    ticketRef,
    hasAiDraft ? "Draft ready" : null,
    assigneeDisplay,
    wakeCountdownText,
  ]
    .filter(Boolean)
    .join(" · ");

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

  // Drag-to-move: the row can be dragged onto a sidebar inbox (see
  // nav-queue.jsx drop targets). Native HTML5 DnD carries just the threadId
  // via dataTransfer. Not draggable for local/unsaved new-ticket rows (no
  // server id to move) or while the row is animating out.
  const [isDragging, setIsDragging] = useState(false);
  const threadId = String(thread?.id || "").trim();
  const isDraggable = Boolean(threadId) && !thread?.is_local && !isExiting;

  const handleDragStart = (event) => {
    if (!isDraggable) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData(THREAD_DRAG_MIME, threadId);
    // Plain-text fallback keeps some browsers from rejecting the drag.
    event.dataTransfer.setData("text/plain", threadId);
    event.dataTransfer.effectAllowed = "move";
    setIsDragging(true);
  };

  const handleDragEnd = () => setIsDragging(false);

  return (
    // Task 9, Plan 2: the outer element used to be a bare <button> — approve
    // close and keep-waiting are now rendered as a sibling row (see below)
    // rather than nested inside it (nested <button>s are invalid HTML/a11y),
    // so the row is now wrapped in a plain <div> when those actions can show.
    // Every other view still gets exactly the same single <button>, unchanged.
    <div className="relative">
    <button
      type="button"
      draggable={isDraggable}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
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
        "relative flex h-[76px] min-h-[76px] w-full flex-col gap-1 rounded-none px-4 pb-2 pt-3 text-left transition-[background-color,transform] duration-150 ease-out hover:bg-muted/45 active:scale-[0.99] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        isDraggable && "cursor-grab active:cursor-grabbing",
        isNew ? "animate-ticket-enter" : !isExiting && "animate-list-item-enter",
        // State hierarchy: unread calls for attention with type + a dot; the
        // active ticket is the current location, so it alone gets the calm
        // accent surface.
        isActive && "bg-accent hover:bg-accent",
        isExiting && "pointer-events-none"
      )}
      style={{
        animationDelay: !isNew && !isExiting && mountIndex > 0 ? `${Math.min(mountIndex, 8) * 28}ms` : undefined,
        // Exit: the row glides LEFT (toward the sidebar inboxes it's moving
        // to) and fades, THEN the vertical gap closes — the max-height/padding
        // collapse is delayed 130ms so the horizontal glide reads first and
        // the list settling doesn't stomp on it. Outlook-style "flew to the
        // folder, then the list closed up". Fully completes well inside the
        // 520ms removal timer in TicketList.jsx.
        transition:
          "opacity 260ms cubic-bezier(0.23,1,0.32,1), transform 300ms cubic-bezier(0.23,1,0.32,1), max-height 260ms cubic-bezier(0.23,1,0.32,1) 130ms, padding 260ms cubic-bezier(0.23,1,0.32,1) 130ms, background-color 150ms ease-out",
        opacity: isExiting ? 0 : isDragging ? 0.4 : 1,
        // Left unset (not forced to an identity value) so the active:scale-[0.99]
        // Tailwind class can still apply its own transform on press — an inline
        // transform always wins over a class, so forcing one here would silently
        // kill any transform utility on this element.
        transform: isExiting ? "translateX(-64px) scale(0.96)" : undefined,
        maxHeight: isExiting ? "0px" : "220px",
        paddingTop: isExiting ? "0px" : undefined,
        paddingBottom: isExiting ? "0px" : undefined,
        overflow: "hidden",
      }}
      aria-pressed={isActive}
      aria-current={isActive ? "page" : undefined}
    >
      <div className="flex min-w-0 items-center gap-2">
        {isUnread ? (
          <span aria-label="Unread" className="size-2 shrink-0 rounded-full bg-primary ring-2 ring-accent" />
        ) : null}
        <span title={thread.subject || "Untitled ticket"} className={cn("min-w-0 flex-1 truncate text-xs font-medium text-foreground", isUnread && "font-semibold")}>
          {thread.subject || "Untitled ticket"}
        </span>
        {hasAiDraft ? (
          <span title="Draft ready" aria-label="Draft ready" className="shrink-0">
            <Sparkles className="h-3 w-3 text-primary" />
          </span>
        ) : null}
        <span className="shrink-0 text-xs font-normal tabular-nums text-muted-foreground">{formatMessageTime(timestamp)}</span>
      </div>
      <div className="flex min-w-0 items-center text-xs font-normal text-muted-foreground">
        <span title={customerLabel} className="min-w-0 flex-1 truncate">
          {customerLabel}
        </span>
      </div>
      <div className="mt-auto flex min-w-0 items-center gap-1.5 text-xs font-normal text-muted-foreground" title={metadataTitle || undefined}>
        <p className="min-w-0 flex-1 truncate" title={previewText || undefined} aria-hidden={!previewText}>
          {previewText || "\u00a0"}
        </p>
        {reason && reason.key !== "new" ? (
          <span
            title={reason.label}
            aria-label={reason.label}
            className={cn(
              "min-w-0 max-w-[45%] truncate whitespace-nowrap",
              reason.key === "customer_replied"
                ? "text-warning-foreground"
                : reason.key === "approve_close"
                  ? "text-accent-foreground"
                  : "text-success-foreground"
            )}
          >
            {reason.key === "customer_replied" ? "Replied" : reason.label}
          </span>
        ) : showLegacyStatus ? (
          <span
            title={statusLabel}
            aria-label={`Status: ${statusLabel}`}
            className={cn("size-1.5 shrink-0 rounded-full ring-2 ring-background", STATUS_DOT_STYLES[status] || "bg-muted-foreground")}
          >
            <span className="sr-only">{statusLabel}</span>
          </span>
        ) : null}
        {ticketNumberLabel ? <span className="ml-auto shrink-0 tabular-nums">{ticketNumberLabel}</span> : null}
        {!hasTicketRef ? <span className="sr-only">No ticket ID</span> : null}
      </div>
    </button>
    {showApproveCloseActions ? (
      <div className="flex items-center gap-3 border-t border-border/60 px-3.5 py-1">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onApproveClose?.();
          }}
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onKeepWaiting?.();
          }}
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
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
    prev.previewText === next.previewText &&
    prev.timestamp === next.timestamp &&
    prev.unreadCount === next.unreadCount &&
    prev.assignee === next.assignee &&
    prev.assigneeLabel === next.assigneeLabel &&
    prev.priority === next.priority &&
    prev.reason === next.reason &&
    prev.waitAge === next.waitAge &&
    prev.showLegacyStatus === next.showLegacyStatus &&
    prev.wakeDays === next.wakeDays &&
    prev.isExiting === next.isExiting &&
    prev.isNew === next.isNew &&
    prev.mountIndex === next.mountIndex &&
    prev.showApproveCloseActions === next.showApproveCloseActions,
);
