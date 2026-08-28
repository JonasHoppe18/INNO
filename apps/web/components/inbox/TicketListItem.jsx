import { memo, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMessageTime } from "@/components/inbox/inbox-utils";
import { assigneeInitials, formatWakeCountdown } from "@/lib/inbox/view-model";
import { THREAD_DRAG_MIME } from "@/lib/inbox/thread-drag-bridge";
import { formatTicketReference } from "@/lib/tickets/reference";

const STATUS_DOT_STYLES = {
  New: "bg-emerald-500",
  Open: "bg-blue-500",
  Pending: "bg-orange-500",
  Waiting: "bg-violet-500",
  Solved: "bg-muted-foreground/60",
};

const CLASSIFICATION_LABELS = {
  support: "Support",
  notification: "Notification",
  partnership: "Partnership",
  job: "Job",
  invoice: "Invoice",
};
const PREFETCH_HOVER_DELAY_MS = 700;

function getTicketTypeLabel(thread, classificationKey) {
  const firstTag = (Array.isArray(thread?.tags) ? thread.tags : [])
    .map((tag) => (typeof tag === "string" ? tag : tag?.name || tag?.label))
    .map((tag) => String(tag || "").trim())
    .find((tag) => tag && !tag.toLowerCase().startsWith("inbox:"));
  if (firstTag) return firstTag;
  return classificationKey && classificationKey !== "support"
    ? CLASSIFICATION_LABELS[classificationKey] || null
    : null;
}

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
  waitAge = null,
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

  const classificationKey = String(thread?.classification_key || "").toLowerCase();
  const classificationLabel = getTicketTypeLabel(thread, classificationKey);
  const ticketRef = formatTicketReference(thread?.ticket_number);
  const hasTicketRef = ticketRef !== "No ticket ID";
  const ticketNumberLabel = hasTicketRef
    ? `#${ticketRef.replace(/^T-/, "")}`
    : null;
  const statusLabel = status === "Solved" ? "Resolved" : status;

  // Keep the compact two-line mail rhythm: sender/time first, subject and
  // quiet context second. Type and ticket ID remain visible without competing
  // with the sender for horizontal space.
  const metadataTitle = [
    ticketRef,
    hasAiDraft ? "Draft ready" : null,
    assigneeDisplay,
    wakeCountdownText,
    classificationLabel,
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
        "relative flex min-h-[68px] w-full flex-col justify-center gap-0.5 px-3 py-2 text-left transition-[background-color,transform] duration-150 ease-out hover:bg-muted/45 active:scale-[0.99] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400/70",
        isDraggable && "cursor-grab active:cursor-grabbing",
        isNew ? "animate-ticket-enter" : !isExiting && "animate-list-item-enter",
        // State hierarchy: unread calls for attention with type + a dot; the
        // active ticket is the current location, so it alone gets the calm
        // lavender surface and stronger brand rail.
        isUnread && "hover:bg-violet-50/55 dark:hover:bg-violet-500/[0.08]",
        isActive && "bg-violet-50/85 hover:bg-violet-100/90 dark:bg-violet-500/[0.14] dark:hover:bg-violet-500/[0.19] before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-violet-600 dark:before:bg-violet-400",
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
          <span
            aria-label="Unread"
            className="size-2 shrink-0 rounded-full bg-violet-600 ring-2 ring-violet-100 dark:bg-violet-400 dark:ring-violet-500/20"
          />
        ) : null}
        <span className={cn("min-w-0 flex-1 truncate text-[12px] font-medium text-foreground", isUnread && "font-bold")}>
          {customerLabel}
        </span>
        <span className={cn("shrink-0 text-[11px] text-muted-foreground", isUnread && "font-semibold text-foreground/70")}>
          {formatMessageTime(timestamp)}
        </span>
      </div>
      <div
        className="flex min-w-0 items-center gap-2"
        title={metadataTitle || undefined}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-muted-foreground">
          <span className={cn("min-w-0 truncate", isUnread && "font-semibold text-foreground")}>
            {thread.subject || "Untitled ticket"}
          </span>
          {hasAiDraft ? (
            <span title="Draft ready" aria-label="Draft ready" className="shrink-0">
              <Sparkles className="h-3 w-3 text-amber-400" />
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground/75">
          {classificationLabel ? (
            <span className="max-w-[72px] truncate rounded-full bg-violet-50/80 px-1.5 py-0.5 text-[10px] font-medium leading-none text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">
              {classificationLabel}
            </span>
          ) : null}
          {ticketNumberLabel ? (
            <span className="shrink-0 font-mono text-[10px] font-medium leading-none tabular-nums text-muted-foreground/70">
              {ticketNumberLabel}
            </span>
          ) : null}
          {reason && reason.key !== "new" ? (
            <span
              className={
                "max-w-[96px] truncate whitespace-nowrap text-[11px] " +
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
            <span
              title={statusLabel}
              aria-label={`Status: ${statusLabel}`}
              className={cn(
                "h-1.5 w-1.5 shrink-0 rounded-full ring-2 ring-background",
                STATUS_DOT_STYLES[status] || "bg-muted-foreground/50",
              )}
            >
              <span className="sr-only">{statusLabel}</span>
            </span>
          ) : waitAge ? (
            <span className="max-w-[90px] truncate whitespace-nowrap text-[11px] text-muted-foreground/70">{waitAge}</span>
          ) : null}
          {!hasTicketRef ? (
            <span className="sr-only">No ticket ID</span>
          ) : null}
        </div>
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
    prev.waitAge === next.waitAge &&
    prev.showLegacyStatus === next.showLegacyStatus &&
    prev.wakeDays === next.wakeDays &&
    prev.isExiting === next.isExiting &&
    prev.isNew === next.isNew &&
    prev.mountIndex === next.mountIndex &&
    prev.showApproveCloseActions === next.showApproveCloseActions,
);
