import { Button } from "@/components/ui/button";
import { Sparkles, Trash2 } from "lucide-react";
import { MessageBubble } from "@/components/inbox/MessageBubble";
import { Composer } from "@/components/inbox/Composer";
import { ThinkingCard } from "@/components/inbox/ThinkingCard";
import { ActionCard } from "@/components/inbox/ActionCard";
import { formatMessageTime, getSenderLabel, isOutboundMessage } from "@/components/inbox/inbox-utils";

export function TicketDetail({
  thread,
  messages,
  attachments,
  currentUserName,
  ticketState,
  onTicketStateChange,
  onOpenInsights,
  showThinkingCard = false,
  draftValue,
  onDraftChange,
  onDraftBlur,
  draftLoaded,
  canSend,
  onSend,
  onDeleteThread,
  deletingThread,
  pendingOrderUpdate,
  orderUpdateDecision,
  orderUpdateSubmitting,
  orderUpdateError,
  onOrderUpdateDecision,
  composerMode,
  onComposerModeChange,
  mailboxEmails,
  isSending = false,
}) {
  if (!thread) {
    return (
      <section className="flex min-h-0 flex-1 flex-col items-center justify-center text-sm text-muted-foreground">
        Select a ticket to view the conversation.
      </section>
    );
  }

  const lastUpdated = formatMessageTime(thread.last_message_at);
  const firstMessage = messages[0] || {};
  const toEmail = firstMessage?.from_email || "";
  const senderLabel = getSenderLabel(firstMessage) || "";
  const toLabel = toEmail ? `${senderLabel || "Unknown"} <${toEmail}>` : "";
  const headerTitle = thread.subject || "Untitled ticket";
  const pendingUpdateState = orderUpdateSubmitting
    ? "applying"
    : orderUpdateError
    ? "failed"
    : orderUpdateDecision === "accepted"
    ? "accepted"
    : orderUpdateDecision === "denied"
    ? "denied"
    : "pending";

  const pendingActionType = String(pendingOrderUpdate?.actionType || "");
  const pendingActionTitleByType = {
    update_shipping_address: "Update Address",
    cancel_order: "Cancel Order",
    refund_order: "Refund Order",
    change_shipping_method: "Change Shipping Method",
    hold_or_release_fulfillment: "Fulfillment Hold/Release",
    edit_line_items: "Edit Line Items",
    update_customer_contact: "Update Contact Details",
    add_note: "Add Internal Note",
    add_tag: "Add Internal Tag",
    add_internal_note_or_tag: "Add Internal Note/Tag",
    resend_confirmation_or_invoice: "Resend Confirmation/Invoice",
  };
  const pendingActionTitle =
    pendingActionTitleByType[pendingActionType] || "Review Action";

  const isApprovalPending = Boolean(pendingOrderUpdate) && !Boolean(orderUpdateDecision);
  const shouldForceUnlocked =
    orderUpdateDecision === "denied" || orderUpdateDecision === "accepted";
  const isActionPending = (() => {
    if (shouldForceUnlocked) return false;
    if (!pendingOrderUpdate) return false;
    if (!Array.isArray(messages) || messages.length === 0) return isApprovalPending;
    const lowered = [...messages]
      .reverse()
      .find((message) => {
        const type = String(
          message?.type || message?.message_type || message?.kind || ""
        ).toLowerCase();
        const status = String(message?.status || message?.action_status || "").toLowerCase();
        const isAiAction = type === "ai_action" || type.includes("ai_action");
        const isPendingStatus =
          status === "pending" ||
          status === "waiting" ||
          status === "awaiting_approval" ||
          status === "requires_approval";
        return isAiAction && isPendingStatus;
      });
    return Boolean(lowered) || isApprovalPending;
  })();
  const actionCardStatus =
    pendingUpdateState === "accepted"
      ? "approved"
      : pendingUpdateState === "denied"
      ? "declined"
      : "pending";
  const shouldShowActionCard = Boolean(pendingOrderUpdate);
  let actionCardInserted = false;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white lg:min-w-0">
      <header className="flex h-14 items-center justify-between border-b border-gray-100 bg-white px-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900">{headerTitle}</div>
          <div className="text-[11px] text-muted-foreground">
            {getSenderLabel(firstMessage)} • {firstMessage?.from_email} • Last update {lastUpdated}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onDeleteThread}
            disabled={deletingThread}
            aria-label="Delete ticket"
            className="text-gray-400 hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="w-full space-y-3 px-4 pb-3 pt-3">
          {messages.map((message) => {
            const direction = isOutboundMessage(message, mailboxEmails) ? "outbound" : "inbound";
            const messageAttachments = attachments.filter(
              (attachment) => attachment.message_id === message.id
            );
            const isDraft = Boolean(message.from_me && message.is_draft);
            const shouldInsertActionCardBeforeMessage =
              shouldShowActionCard &&
              !actionCardInserted &&
              (direction === "outbound" || isDraft);
            if (shouldInsertActionCardBeforeMessage) {
              actionCardInserted = true;
            }
            const primaryLog =
              Array.isArray(message.ai_logs) && message.ai_logs.length
                ? message.ai_logs[0]
                : null;
            const thinkingData = isDraft
              ? primaryLog
                ? {
                    type: primaryLog.step_name,
                    detail: primaryLog.step_detail,
                  }
                : message?.ai_context || message?.context || {
                    summary: "Analyzed request using Store Policies.",
                  }
              : null;
            return (
              <div key={message.id} className="space-y-2">
                {shouldInsertActionCardBeforeMessage ? (
                  <ActionCard
                    status={actionCardStatus}
                    actionName={pendingActionTitle}
                    detail={pendingOrderUpdate?.detail || ""}
                    error={orderUpdateError || ""}
                    loading={Boolean(orderUpdateSubmitting)}
                    onApprove={() => onOrderUpdateDecision?.("accepted")}
                    onDecline={() => onOrderUpdateDecision?.("denied")}
                  />
                ) : null}
                {isDraft ? (
                  <ThinkingCard
                    data={thinkingData}
                    onClick={() => onOpenInsights?.(true)}
                  />
                ) : null}
                <MessageBubble
                  message={message}
                  direction={direction}
                  attachments={messageAttachments}
                  outboundSenderName={currentUserName}
                />
              </div>
            );
          })}
          {shouldShowActionCard && !actionCardInserted ? (
            <ActionCard
              status={actionCardStatus}
              actionName={pendingActionTitle}
              detail={pendingOrderUpdate.detail || ""}
              error={orderUpdateError || ""}
              loading={Boolean(orderUpdateSubmitting)}
              onApprove={() => onOrderUpdateDecision?.("accepted")}
              onDecline={() => onOrderUpdateDecision?.("denied")}
            />
          ) : null}
          {showThinkingCard ? (
            <ThinkingCard loading onClick={() => onOpenInsights?.(true)} />
          ) : null}
        </div>
      </div>

      {isActionPending ? (
        <div className="sticky bottom-0 flex-none border-t border-violet-100 bg-violet-50/30 p-8 text-center">
          <div className="flex flex-col items-center justify-center">
            <Sparkles className="mb-2 h-6 w-6 animate-pulse text-violet-500" />
            <div className="text-sm font-medium text-violet-900">Sona is waiting for your decision</div>
            <p className="mt-1 max-w-xl text-xs text-violet-500">
              Review the action above to generate the reply draft.
            </p>
          </div>
        </div>
      ) : (
        <Composer
          value={draftValue}
          onChange={onDraftChange}
          draftLoaded={draftLoaded}
          canSend={canSend}
          onSend={onSend}
          isSending={isSending}
          mode={composerMode}
          onModeChange={onComposerModeChange}
          toLabel={toLabel}
          onBlur={onDraftBlur}
        />
      )}
    </section>
  );
}
