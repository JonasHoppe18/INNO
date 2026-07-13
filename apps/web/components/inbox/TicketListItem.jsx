import { memo, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMessageTime } from "@/components/inbox/inbox-utils";
import { assigneeInitials, formatWakeCountdown } from "@/lib/inbox/view-model";
import { THREAD_DRAG_MIME } from "@/lib/inbox/thread-drag-bridge";
import { formatTicketReference } from "@/lib/tickets/reference";

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
  const classificationLabel =
    classificationKey && classificationKey !== "support"
      ? CLASSIFICATION_LABELS[classificationKey] || null
      : null;
  const ticketRef = formatTicketReference(thread?.ticket_number);

  // One flat meta line instead of a variable-height stack — a ticket with a
  // classification label used to render a whole extra <div> below this one,
  // making rows with vs. without it visibly different heights in the list.
  // Built as an array (rather than a hand-chained "show a dot if the
  // previous thing rendered" conditional) so a dot only ever appears before
  // a real entry — no dangling/missing separators possible by construction.
  // ticketRef always renders here (not conditional like the rest), so this
  // line is never actually empty. inboxName is deliberately NOT included —
  // dropped per direct feedback that the card shouldn't show its inbox.
  const metaEntries = [
    <span key="ticket-ref" className="shrink-0 font-mono text-[10px] tabular-nums">
      {ticketRef}
    </span>,
    hasAiDraft ? (
      <span key="draft" className="text-purple-700 dark:text-purple-400">
        Draft ready
      </span>
    ) : null,
    // Unassigned is the common case pre-migration/for new threads — showing it
    // on every row was just noise; an assignee is only worth surfacing once
    // someone actually owns the ticket.
    assigneeDisplay ? (
      <span key="assignee" className="truncate">
        {assigneeDisplay}
      </span>
    ) : null,
    wakeCountdownText ? (
      <span key="wake" className="truncate">
        {wakeCountdownText}
      </span>
    ) : null,
    classificationLabel ? (
      <span key="classification" className="truncate">
        {classificationLabel}
      </span>
    ) : null,
  ].filter(Boolean);
  const metaChildren = metaEntries.flatMap((entry, index) =>
    index === 0
      ? [entry]
      : [
          <span key={`${entry.key}-dot`} aria-hidden="true">
            &middot;
          </span>,
          entry,
        ],
  );

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
        "relative flex w-full flex-col gap-0.5 px-4 py-2 text-left hover:bg-muted/50 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        isDraggable && "cursor-grab active:cursor-grabbing",
        isNew ? "animate-ticket-enter" : !isExiting && "animate-list-item-enter",
        // State hierarchy: unread calls for attention with type + a dot; the
        // active ticket is the current location, so it alone gets the calm
        // lavender surface and stronger brand rail.
        isUnread && "hover:bg-violet-50/60 dark:hover:bg-violet-500/[0.08]",
        isActive && "bg-violet-100/80 ring-1 ring-inset ring-violet-200/70 hover:bg-violet-100 dark:bg-violet-500/[0.18] dark:ring-violet-300/20 dark:hover:bg-violet-500/[0.22] before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-violet-600 dark:before:bg-violet-400",
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
      <div className="flex items-center gap-2">
        {isUnread ? (
          <span
            aria-label="Unread"
            className="size-2 shrink-0 rounded-full bg-violet-600 ring-2 ring-violet-100 dark:bg-violet-400 dark:ring-violet-500/20"
          />
        ) : null}
        <span className={cn("min-w-0 flex-1 truncate text-[13px] font-medium text-foreground", isUnread && "font-bold")}>
          {customerLabel}
        </span>
        <span className={cn("shrink-0 text-[12px] text-muted-foreground", isUnread && "font-semibold text-foreground/70")}>
          {formatMessageTime(timestamp)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] text-muted-foreground">
          <span className={cn("truncate", isUnread && "font-semibold text-foreground")}>
            {thread.subject || "Untitled ticket"}
          </span>
          {hasAiDraft ? <Sparkles className="h-3 w-3 text-amber-400" /> : null}
        </div>
        {reason ? (
          <span
            className={
              "shrink-0 whitespace-nowrap text-xs " +
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
        ) : waitAge ? (
          <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground/70">{waitAge}</span>
        ) : null}
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {metaChildren}
      </div>
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
    prev.waitAge === next.waitAge &&
    prev.showLegacyStatus === next.showLegacyStatus &&
    prev.wakeDays === next.wakeDays &&
    prev.isExiting === next.isExiting &&
    prev.isNew === next.isNew &&
    prev.mountIndex === next.mountIndex &&
    prev.showApproveCloseActions === next.showApproveCloseActions,
);
