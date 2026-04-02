import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { MessageBubble } from "@/components/inbox/MessageBubble";
import { Composer } from "@/components/inbox/Composer";
import { ThinkingCard } from "@/components/inbox/ThinkingCard";
import { ActionCard } from "@/components/inbox/ActionCard";
import { TrackingCard } from "@/components/inbox/TrackingCard";
import { getReplyTargetEmail, getSenderLabel, isOutboundMessage } from "@/components/inbox/inbox-utils";
import { useEffect, useMemo, useRef, useState } from "react";

const APPROVAL_ACTION_TYPES = new Set([
  "update_shipping_address",
  "cancel_order",
  "refund_order",
  "create_exchange_request",
  "process_exchange_return",
  "change_shipping_method",
  "hold_or_release_fulfillment",
  "edit_line_items",
  "update_customer_contact",
  "forward_email",
  "create_return_case",
  "send_return_instructions",
]);

const TRACKING_KEYWORD_PATTERN =
  /\b(track|tracking|trace|shipment|shipping|delivery|delivered|out for delivery|parcel|package|pakke|pakken|forsendelse|levering|leveret|spor|sporing|track and trace|track&trace)\b/i;

const TRACKING_STATUS_QUESTION_PATTERN =
  /\b(where is my order|order status|shipping status|delivery status|when will .*arriv|estimated delivery|not received|still haven'?t received|hvor er min ordre|hvor bliver .* af|hvornår .* lever|leveringstid|forventet levering|ikke modtaget)\b/i;

function getLatestInboundCustomerMessage(messages = [], mailboxEmails = []) {
  const rows = Array.isArray(messages) ? messages : [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const message = rows[index];
    if (!message || isOutboundMessage(message, mailboxEmails)) continue;
    return message;
  }
  return null;
}

function messageLooksLikeTrackingQuestion(message = null) {
  if (!message) return false;
  const haystack = [message?.clean_body_text, message?.body_text, message?.snippet]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("\n");
  if (!haystack) return false;
  const hasTrackingKeyword = TRACKING_KEYWORD_PATTERN.test(haystack);
  if (!hasTrackingKeyword) return false;
  if (TRACKING_STATUS_QUESTION_PATTERN.test(haystack)) return true;
  const hasQuestionSignal = /\?|\b(where|when|how long|hvor|hvornår|hvordan)\b/i.test(haystack);
  return hasQuestionSignal;
}

export function TicketDetail({
  thread,
  messages,
  attachments,
  customerLookup,
  threadOrderNumber = "",
  mentionUsers = [],
  currentUserName,
  ticketState,
  onTicketStateChange,
  onOpenInsights,
  showThinkingCard = false,
  draftValue,
  onDraftChange,
  signatureValue,
  onSignatureChange,
  onSignatureBlur,
  onDraftBlur,
  draftLoaded,
  canSend,
  onSend,
  pendingOrderUpdate,
  orderUpdateDecision,
  orderUpdateSubmitting,
  orderUpdateError,
  onOrderUpdateDecision,
  composerMode,
  onComposerModeChange,
  mailboxEmails,
  isSending = false,
  isWorkspaceTestMode = false,
  headerActions = null,
  rightHeaderActions = null,
  conversationScrollTop = 0,
  onConversationScroll = null,
  onGenerateDraft = null,
  isGeneratingDraft = false,
}) {
  const [composerCollapsed, setComposerCollapsed] = useState(false);
  const [processReturnRestock, setProcessReturnRestock] = useState(true);
  const conversationRef = useRef(null);
  const normalizedPendingStatus = String(pendingOrderUpdate?.status || "").toLowerCase();
  const pendingUpdateState = orderUpdateSubmitting
    ? "executing"
    : orderUpdateDecision === "accepted"
    ? isWorkspaceTestMode || normalizedPendingStatus === "approved_test_mode"
      ? "simulated"
      : "completed"
    : orderUpdateDecision === "denied"
    ? "declined"
    : normalizedPendingStatus === "approved_test_mode"
    ? "simulated"
    : normalizedPendingStatus === "applied" || normalizedPendingStatus === "approved"
    ? "completed"
    : normalizedPendingStatus === "failed"
    ? "failed"
    : orderUpdateError
    ? "failed"
    : "proposed";

  const pendingActionType = String(pendingOrderUpdate?.actionType || "");
  const pendingActionTitleByType = {
    update_shipping_address: "Update Address",
    cancel_order: "Cancel Order",
    refund_order: "Refund Order",
    create_exchange_request: "Create Exchange",
    process_exchange_return: "Process Return",
    change_shipping_method: "Change Shipping Method",
    hold_or_release_fulfillment: "Fulfillment Hold/Release",
    edit_line_items: "Edit Line Items",
    update_customer_contact: "Update Contact Details",
    forward_email: "Forward Email",
    create_return_case: "Create Return Case",
    send_return_instructions: "Send Return Instructions",
    add_note: "Add Internal Note",
    add_tag: "Add Internal Tag",
    add_internal_note_or_tag: "Add Internal Note/Tag",
    resend_confirmation_or_invoice: "Resend Confirmation/Invoice",
  };
  const pendingActionTitle =
    pendingActionTitleByType[pendingActionType] || "Review Action";
  const isProcessReturnAction = pendingActionType === "process_exchange_return";
  const isApprovalManagedActionType = APPROVAL_ACTION_TYPES.has(
    String(pendingActionType || "").trim().toLowerCase()
  );

  useEffect(() => {
    if (!isProcessReturnAction) return;
    const payloadRestock = pendingOrderUpdate?.payload?.restock;
    if (typeof payloadRestock === "boolean") {
      setProcessReturnRestock(payloadRestock);
      return;
    }
    setProcessReturnRestock(true);
  }, [isProcessReturnAction, pendingOrderUpdate?.id, pendingOrderUpdate?.payload?.restock]);

  const processReturnMeta = useMemo(() => {
    if (!isProcessReturnAction) return null;
    const reason = String(pendingOrderUpdate?.payload?.restock_reason || "").trim();
    const confidence = String(pendingOrderUpdate?.payload?.restock_confidence || "").trim();
    return { reason, confidence };
  }, [
    isProcessReturnAction,
    pendingOrderUpdate?.payload?.restock_reason,
    pendingOrderUpdate?.payload?.restock_confidence,
  ]);

  const isApprovalPending = Boolean(pendingOrderUpdate) && pendingUpdateState === "proposed";
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
  const detailSuggestsTestMode = (() => {
    const detailText = String(pendingOrderUpdate?.detail || "").toLowerCase();
    return detailText.includes("test mode") || detailText.includes("simulated");
  })();
  const payloadSuggestsTestMode =
    pendingOrderUpdate?.payload?.test_mode === true ||
    pendingOrderUpdate?.payload?.simulated === true;
  const isApprovedInTestMode =
    normalizedPendingStatus === "approved_test_mode" ||
    pendingOrderUpdate?.testMode === true ||
    payloadSuggestsTestMode ||
    detailSuggestsTestMode ||
    (Boolean(isWorkspaceTestMode) &&
      (pendingUpdateState === "completed" || pendingUpdateState === "simulated"));
  const shouldShowActionCard =
    Boolean(pendingOrderUpdate) &&
    (isApprovalManagedActionType || pendingUpdateState === "proposed");
  const selectedOrderSummary = useMemo(() => {
    const orders = Array.isArray(customerLookup?.orders) ? customerLookup.orders : [];
    if (!orders.length) return null;
    // Prefer the order that matches the thread's order number
    if (threadOrderNumber) {
      const normalized = String(threadOrderNumber).replace(/^#/, "").trim();
      const match = orders.find((o) =>
        String(o?.id || o?.order_number || "").replace(/^#/, "").trim() === normalized
      );
      if (match) return match;
    }
    return orders[0];
  }, [customerLookup?.orders, threadOrderNumber]);
  const latestInboundCustomerMessage = useMemo(
    () => getLatestInboundCustomerMessage(messages, mailboxEmails),
    [mailboxEmails, messages]
  );
  const latestInboundCustomerMessageId = String(latestInboundCustomerMessage?.id || "");
  const shouldShowTrackingCard = useMemo(() => {
    const hasTrackingData = Boolean(
      selectedOrderSummary?.tracking?.number || selectedOrderSummary?.tracking?.url
    );
    if (!hasTrackingData) return false;
    // Show for all tracking-categorised threads, or when the message looks like a tracking question
    const threadIsTracking = Array.isArray(thread?.tags) && thread.tags.includes("Tracking");
    return threadIsTracking || messageLooksLikeTrackingQuestion(latestInboundCustomerMessage);
  }, [
    thread?.tags,
    latestInboundCustomerMessage,
    selectedOrderSummary?.tracking?.number,
    selectedOrderSummary?.tracking?.url,
  ]);
  const selectedCustomerEmail = String(customerLookup?.customer?.email || "").trim();
  let actionCardInserted = false;
  const processReturnExtraContent =
    isProcessReturnAction && pendingUpdateState === "proposed" ? (
      <div className="rounded-lg border border-violet-100 bg-white p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Return options</div>
        <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-gray-300"
            checked={processReturnRestock}
            onChange={(event) => setProcessReturnRestock(Boolean(event.target.checked))}
          />
          Restock returned item
        </label>
        {processReturnMeta?.reason ? (
          <div className="mt-2 text-xs text-slate-500">
            AI: {processReturnMeta.reason}
            {processReturnMeta?.confidence ? ` (${processReturnMeta.confidence})` : ""}
          </div>
        ) : null}
      </div>
    ) : null;

  useEffect(() => {
    const node = conversationRef.current;
    if (!node) return;
    node.scrollTop = Number.isFinite(Number(conversationScrollTop)) ? Number(conversationScrollTop) : 0;
  }, [conversationScrollTop, thread?.id]);

  if (!thread) {
    return (
      <section className="flex min-h-0 flex-1 flex-col items-center justify-center text-sm text-muted-foreground">
        Select a ticket to view the conversation.
      </section>
    );
  }

  const firstMessage = messages[0] || {};
  const toEmail = getReplyTargetEmail(firstMessage);
  const senderLabel = getSenderLabel(firstMessage);
  const toLabel = toEmail ? `${senderLabel} <${toEmail}>` : senderLabel;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-sidebar lg:min-w-0">
      <header className="flex min-h-[58px] items-center justify-between border-b border-gray-100 bg-sidebar px-4 py-1.5">
        <div className="flex min-w-0 items-center gap-3">
          {headerActions ? <div className="flex shrink-0 items-center gap-2">{headerActions}</div> : null}
        </div>
        <div className="flex items-center gap-2">
          {rightHeaderActions}
        </div>
      </header>

      <div
        ref={conversationRef}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) => onConversationScroll?.(event.currentTarget.scrollTop)}
      >
        <div className="mx-auto w-full max-w-[900px] space-y-4 px-4 pb-4 pt-3">
          {orderUpdateError && !shouldShowActionCard ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {orderUpdateError}
            </div>
          ) : null}
          {messages.map((message) => {
            const direction = isOutboundMessage(message, mailboxEmails) ? "outbound" : "inbound";
            const persistedAttachments = attachments.filter(
              (attachment) => attachment.message_id === message.id
            );
            const messageAttachments =
              persistedAttachments.length || !Array.isArray(message?.attachments)
                ? persistedAttachments
                : message.attachments;
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
              <div key={message.id} className="space-y-3">
                {shouldInsertActionCardBeforeMessage ? (
                  <div className="ml-auto flex w-full max-w-[520px] justify-end">
                  <ActionCard
                  status={pendingUpdateState}
                  testMode={isApprovedInTestMode}
                  actionName={pendingActionTitle}
                  actionType={pendingOrderUpdate?.actionType || ""}
                  detail={pendingOrderUpdate?.detail || ""}
                  payload={pendingOrderUpdate?.payload || {}}
                  orderSummary={selectedOrderSummary}
                  fallbackOrderNumber={threadOrderNumber}
                  customerEmail={selectedCustomerEmail}
                  approvedAt={pendingOrderUpdate?.updatedAt || pendingOrderUpdate?.createdAt || ""}
                  approvedBy={pendingOrderUpdate?.approvedBy || ""}
                  error={orderUpdateError || ""}
                  loading={Boolean(orderUpdateSubmitting)}
                  extraContent={processReturnExtraContent}
                  onApprove={() =>
                        onOrderUpdateDecision?.(
                          "accepted",
                          isProcessReturnAction ? { restock: processReturnRestock } : undefined
                        )
                      }
                      onDecline={() => onOrderUpdateDecision?.("denied")}
                    />
                  </div>
                ) : null}
                {isDraft ? (
                  <div className="ml-auto w-full max-w-[520px]">
                    <ThinkingCard
                      data={thinkingData}
                      onClick={() => onOpenInsights?.(true)}
                    />
                  </div>
                ) : null}
                <MessageBubble
                  message={message}
                  direction={direction}
                  attachments={messageAttachments}
                  outboundSenderName={currentUserName}
                />
                {shouldShowTrackingCard &&
                  latestInboundCustomerMessageId &&
                  String(message?.id || "") === latestInboundCustomerMessageId ? (
                  <div className="ml-auto flex w-full max-w-[520px] justify-end">
                    <TrackingCard order={selectedOrderSummary} threadId={thread?.id || null} />
                  </div>
                ) : null}
              </div>
            );
          })}
          {shouldShowActionCard && !actionCardInserted ? (
            <div className="ml-auto flex w-full max-w-[520px] justify-end">
              <ActionCard
                status={pendingUpdateState}
                testMode={isApprovedInTestMode}
                actionName={pendingActionTitle}
                actionType={pendingOrderUpdate?.actionType || ""}
                detail={pendingOrderUpdate.detail || ""}
                payload={pendingOrderUpdate?.payload || {}}
                orderSummary={selectedOrderSummary}
                fallbackOrderNumber={threadOrderNumber}
                customerEmail={selectedCustomerEmail}
                approvedAt={pendingOrderUpdate?.updatedAt || pendingOrderUpdate?.createdAt || ""}
                approvedBy={pendingOrderUpdate?.approvedBy || ""}
                error={orderUpdateError || ""}
                loading={Boolean(orderUpdateSubmitting)}
                extraContent={processReturnExtraContent}
                onApprove={() =>
                  onOrderUpdateDecision?.(
                    "accepted",
                    isProcessReturnAction ? { restock: processReturnRestock } : undefined
                  )
                }
                onDecline={() => onOrderUpdateDecision?.("denied")}
              />
            </div>
          ) : null}
        </div>
      </div>

      {isActionPending ? (
        <div className="sticky bottom-0 flex-none bg-transparent px-3 py-1.5">
          <div className="mx-auto w-full max-w-[900px] rounded-3xl border border-violet-100 bg-violet-50/40 px-4 py-5 text-center">
            <div className="flex flex-col items-center justify-center">
              <Sparkles className="mb-2 h-5 w-5 animate-pulse text-violet-500" />
              <div className="text-sm font-medium text-violet-900">Sona is waiting for your decision</div>
              <p className="mt-1 max-w-xl text-xs text-violet-500">
                Review the action above to generate the reply draft.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="px-3 pb-1.5">
          <Composer
            key={`${thread?.id || "thread"}:${composerMode}`}
            value={draftValue}
            onChange={(nextValue) => onDraftChange?.(nextValue, thread?.id || null)}
            signatureValue={signatureValue}
            onSignatureChange={(nextValue) => onSignatureChange?.(nextValue, thread?.id || null)}
            onSignatureBlur={onSignatureBlur}
            collapsed={composerCollapsed}
            onToggleCollapse={() => setComposerCollapsed((prev) => !prev)}
            draftLoaded={draftLoaded}
            canSend={canSend}
            onSend={onSend}
            isSending={isSending}
            mode={composerMode}
            onModeChange={onComposerModeChange}
            toLabel={toLabel}
            mentionUsers={mentionUsers}
            onBlur={() => onDraftBlur?.(thread?.id || null)}
            isDraftLoading={showThinkingCard}
            onGenerateDraft={onGenerateDraft}
            isGeneratingDraft={isGeneratingDraft}
          />
        </div>
      )}
    </section>
  );
}
