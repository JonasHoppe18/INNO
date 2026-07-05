import { memo, useEffect, useRef } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMessageTime } from "@/components/inbox/inbox-utils";
import { assigneeInitials, formatWakeCountdown } from "@/lib/inbox/view-model";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

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
  const customerInitials = assigneeInitials(customerLabel) || "?";
  const wakeCountdownText = formatWakeCountdown(wakeDays);

  const classificationKey = String(thread?.classification_key || "").toLowerCase();
  const classificationLabel =
    classificationKey && classificationKey !== "support"
      ? CLASSIFICATION_LABELS[classificationKey] || null
      : null;
  const ticketRef = Number.isFinite(Number(thread?.ticket_number))
    ? `T-${String(Number(thread.ticket_number)).padStart(6, "0")}`
    : "No ticket ID";

  // One flat meta line instead of a variable-height stack — a ticket with a
  // classification label used to render a whole extra <div> below this one,
  // making rows with vs. without it visibly different heights in the list.
  // Built as an array (rather than a hand-chained "show a dot if the
  // previous thing rendered" conditional) so a dot only ever appears before
  // a real entry — no dangling/missing separators possible by construction.
  const metaEntries = [
    inboxName ? (
      <span key="inbox" className="truncate">
        {inboxName}
      </span>
    ) : null,
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
        "relative flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-muted/50 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        isNew ? "animate-ticket-enter" : !isExiting && "animate-list-item-enter",
        // A brand-tinted wash (not gray) so a selected row stays visually
        // distinct even while a different row is hovered at the same time —
        // a different hue reads as "selected" faster than a darker gray, and
        // a light tint feels lighter than a flat solid fill.
        isActive && "bg-primary/5",
        isExiting && "pointer-events-none"
      )}
      style={{
        animationDelay: !isNew && !isExiting && mountIndex > 0 ? `${Math.min(mountIndex, 8) * 28}ms` : undefined,
        transition:
          "opacity 200ms cubic-bezier(0.23,1,0.32,1), transform 200ms cubic-bezier(0.23,1,0.32,1), max-height 240ms cubic-bezier(0.23,1,0.32,1), padding 240ms cubic-bezier(0.23,1,0.32,1), background-color 150ms ease-out",
        opacity: isExiting ? 0 : 1,
        // Left unset (not forced to an identity value) so the active:scale-[0.99]
        // Tailwind class can still apply its own transform on press — an inline
        // transform always wins over a class, so forcing one here would silently
        // kill any transform utility on this element.
        transform: isExiting ? "translateX(12px) scale(0.98)" : undefined,
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
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] tabular-nums text-muted-foreground/70">
          {ticketRef}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-[12px] text-muted-foreground">{formatMessageTime(timestamp)}</span>
          {reason || showLegacyStatus || waitAge ? (
            <span aria-hidden="true" className="text-muted-foreground/70">
              &middot;
            </span>
          ) : null}
          {reason ? (
            <span
              className={
                "whitespace-nowrap text-xs " +
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
            <span className={cn("text-[12px]", STATUS_TEXT_STYLES[status] || "text-muted-foreground")}>
              {status === "Solved" ? "Resolved" : status}
            </span>
          ) : waitAge ? (
            <span className="whitespace-nowrap text-xs text-muted-foreground/70">{waitAge}</span>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Avatar className="h-6 w-6 shrink-0">
          <AvatarFallback className="bg-muted text-[10px] font-medium text-muted-foreground">
            {customerInitials}
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
          {customerLabel}
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
        <span className={cn("truncate", isUnread && "font-medium text-foreground")}>
          {thread.subject || "Untitled ticket"}
        </span>
        {hasAiDraft ? <Sparkles className="h-3 w-3 text-amber-400" /> : null}
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
    prev.inboxName === next.inboxName &&
    prev.wakeDays === next.wakeDays &&
    prev.isExiting === next.isExiting &&
    prev.isNew === next.isNew &&
    prev.mountIndex === next.mountIndex &&
    prev.showApproveCloseActions === next.showApproveCloseActions,
);
