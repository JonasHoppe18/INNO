import { memo, useEffect, useRef, useState } from "react";
import { Mail, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMessageTime } from "@/components/inbox/inbox-utils";
import {
  assigneeInitials,
  CANONICAL_STATUS_OPTIONS,
  canonicalStatusOption,
  formatWakeCountdown,
} from "@/lib/inbox/view-model";
import { THREAD_DRAG_MIME } from "@/lib/inbox/thread-drag-bridge";
import { formatTicketReference } from "@/lib/tickets/reference";

const STATUS_DOT_STYLES = {
  New: "bg-success-foreground",
  Open: "bg-info-foreground",
  Pending: "bg-warning-foreground",
  Waiting: "bg-muted-foreground",
  Solved: "bg-muted-foreground/60",
};

// List layout shows the same lifecycle status as the ticket header control.
const LIFECYCLE_DOT_STYLES = {
  needs_attention: "bg-warning-foreground",
  waiting_customer: "bg-info-foreground",
  waiting_third_party: "bg-info-foreground",
  resolved: "bg-success-foreground",
  blocked: "bg-destructive",
};

const PREFETCH_HOVER_DELAY_MS = 150;

// Shared by the list-layout header (TicketList) and each row so columns line
// up: customer · subject · status (lg+) · owner, # (xl+) · updated.
export const LIST_ROW_GRID_CLASS =
  "grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_4.5rem] items-center gap-x-5 pl-4 pr-5 lg:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_10rem_5rem] xl:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_10rem_8rem_4rem_5rem]";

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
  waitAge = null,
  showLegacyStatus = false,
  wakeDays = null,
  isExiting = false,
  isNew = false,
  mountIndex = 0,
  variant = "card",
  showDivider = false,
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

  const reasonClassName = reason
    ? reason.key === "customer_replied"
      ? "text-warning-foreground"
      : reason.key === "approve_close"
        ? "text-accent-foreground"
        : "text-success-foreground"
    : "";

  if (variant === "row") {
    // Full-width list layout: one column-aligned row per ticket (grid shared
    // with the header in TicketList). Same data and handlers as the card;
    // approve/keep-waiting sit after the row button as siblings (nested
    // buttons are invalid).
    // Real names get two initials; a bare email address gets one letter, and
    // no-reply senders get a neutral mail glyph instead of noise like "NC".
    const senderLabel = String(customerLabel || "").trim();
    const senderIsEmail = senderLabel.includes("@");
    const senderIsNoReply = /^(no-?reply|do-?not-?reply|mailer-daemon)/i.test(senderLabel);
    const senderInitials = senderIsEmail
      ? (senderLabel.match(/[a-z0-9]/i)?.[0] || "?").toUpperCase()
      : assigneeInitials(senderLabel) || "?";
    const lifecycleStatus = canonicalStatusOption({
      status: status || thread?.status,
      waiting_reason: thread?.waiting_reason,
    });
    const lifecycleLabel =
      CANONICAL_STATUS_OPTIONS.find((option) => option.value === lifecycleStatus)?.label ||
      (lifecycleStatus === "blocked" ? "Blocked" : "Needs attention");
    // Second line only when it adds something: why the ticket is back in the
    // queue, or how long it has been waiting. "New" is already the unread bar.
    const statusDetail =
      reason && reason.key !== "new"
        ? { text: reason.label, className: reasonClassName }
        : wakeCountdownText
          ? { text: wakeCountdownText, className: "text-muted-foreground" }
          : waitAge && lifecycleStatus !== "resolved"
            ? { text: `Waiting ${waitAge}`, className: "text-muted-foreground" }
            : null;
    return (
      <div
        className={cn(
          "group relative flex h-14 items-center transition-[background-color,opacity] duration-150 ease-out hover:bg-muted/50",
          showDivider && "border-t border-border/50",
          isActive && "bg-accent hover:bg-accent",
          isNew && "animate-ticket-enter",
          isExiting && "pointer-events-none opacity-0",
          isDragging && "opacity-40",
        )}
      >
        {isUnread ? (
          <span aria-hidden="true" className="absolute inset-y-2.5 left-0 w-0.5 rounded-r-full bg-primary" />
        ) : null}
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
            LIST_ROW_GRID_CLASS,
            "h-full min-w-0 flex-1 text-left text-[13px] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            isDraggable && "cursor-grab active:cursor-grabbing",
          )}
          aria-current={isActive ? "page" : undefined}
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden="true"
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                isUnread ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
              )}
            >
              {senderIsNoReply ? <Mail className="size-3.5" /> : senderInitials}
            </span>
            <span
              title={customerLabel}
              className={cn(
                "min-w-0 truncate",
                isUnread ? "font-semibold text-foreground" : "text-foreground/85",
              )}
            >
              {customerLabel}
            </span>
            {isUnread ? <span className="sr-only">Unread</span> : null}
          </span>

          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                title={thread.subject || "Untitled ticket"}
                className={cn(
                  "min-w-0 truncate text-foreground",
                  isUnread ? "font-semibold" : "font-medium",
                )}
              >
                {thread.subject || "Untitled ticket"}
              </span>
              {hasAiDraft ? (
                <span title="Draft ready" aria-label="Draft ready" className="shrink-0">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                </span>
              ) : null}
            </span>
            <span
              title={previewText || undefined}
              className="min-w-0 truncate text-xs text-muted-foreground"
            >
              {previewText || "\u00a0"}
            </span>
          </span>

          <span className="hidden min-w-0 flex-col justify-center gap-0.5 lg:flex">
            <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-foreground">
              <span
                aria-hidden="true"
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  LIFECYCLE_DOT_STYLES[lifecycleStatus] || "bg-muted-foreground",
                )}
              />
              <span title={lifecycleLabel} className="truncate">
                {lifecycleLabel}
              </span>
            </span>
            {statusDetail ? (
              <span className={cn("min-w-0 truncate pl-3 text-[11px]", statusDetail.className)}>
                {statusDetail.text}
              </span>
            ) : null}
          </span>

          <span className="hidden min-w-0 items-center gap-2 xl:flex">
            {assigneeDisplay ? (
              <>
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[9px] font-semibold text-muted-foreground">
                  {assigneeDisplay}
                </span>
                <span title={assigneeLabel} className="min-w-0 truncate text-xs text-foreground/85">
                  {assigneeLabel}
                </span>
              </>
            ) : (
              <span className="text-xs text-muted-foreground/60">Unassigned</span>
            )}
          </span>

          <span className="hidden text-xs tabular-nums text-muted-foreground xl:inline">
            {ticketNumberLabel || "—"}
          </span>

          <span
            className={cn(
              "text-right text-xs tabular-nums",
              isUnread ? "font-semibold text-foreground" : "text-muted-foreground",
            )}
          >
            {formatMessageTime(timestamp)}
          </span>
        </button>
        {showApproveCloseActions ? (
          <div className="flex shrink-0 items-center gap-3 pr-5">
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
        "relative flex h-[76px] min-h-[76px] w-full flex-col gap-1 rounded-md border border-border/60 bg-card px-4 pb-2 pt-3 text-left transition-[background-color,transform] duration-150 ease-out hover:bg-muted active:scale-[0.99] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        isDraggable && "cursor-grab active:cursor-grabbing",
        isNew ? "animate-ticket-enter" : !isExiting && "animate-list-item-enter",
        // State hierarchy: unread calls for attention with type + a dot; the
        // active ticket is the current location, so it alone gets the calm
        // accent surface.
        isActive && "border-primary/20 bg-accent hover:bg-accent",
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
    prev.variant === next.variant &&
    prev.showDivider === next.showDivider &&
    prev.showApproveCloseActions === next.showApproveCloseActions,
);
