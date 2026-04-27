import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Package, Sparkles, TriangleAlert, X } from "lucide-react";
import { MessageBubble } from "@/components/inbox/MessageBubble";
import { Composer } from "@/components/inbox/Composer";
import { ThinkingCard } from "@/components/inbox/ThinkingCard";
import { ActionCard } from "@/components/inbox/ActionCard";
import { TrackingCard } from "@/components/inbox/TrackingCard";
import { ThreadTagsBar } from "@/components/inbox/ThreadTagsBar";
import { getReplyTargetEmail, getSenderLabel, isOutboundMessage } from "@/components/inbox/inbox-utils";

const APPROVAL_ACTION_TYPES = new Set([
  "update_shipping_address",
  "cancel_order",
  "refund_order",
  "create_exchange_request",
  "process_exchange_return",
  "fulfill_exchange",
  "change_shipping_method",
  "hold_or_release_fulfillment",
  "edit_line_items",
  "update_customer_contact",
  "forward_email",
  "create_return_case",
  "send_return_instructions",
  "initiate_return",
]);

const TRACKING_KEYWORD_PATTERN =
  /\b(track|tracking|trace|shipment|shipping|delivery|delivered|out for delivery|parcel|package|pakke|pakken|forsendelse|levering|leveret|spor|sporing|track and trace|track&trace)\b/i;

const TRACKING_STATUS_QUESTION_PATTERN =
  /\b(where is my order|order status|shipping status|delivery status|when will .*arriv|estimated delivery|not received|still haven'?t received|hvor er min ordre|hvor bliver .* af|hvornår .* lever|leveringstid|forventet levering|ikke modtaget)\b/i;

const SATISFACTION_CLOSURE_PATTERN =
  /\b(?:thanks?(?:\s+a\s+lot)?|thank you(?:\s+so\s+much)?|tak(?:\s+for\s+hjælpen)?|perfekt|super|awesome|great|issue(?:\s+is|'s)?\s+(?:resolved|fixed|solved)|problem(?:\s+is|'s)?\s+(?:resolved|fixed|solved)|it(?:\s+is|'s)?\s+(?:resolved|fixed|solved)|it works(?:\s+now)?|works(?:\s+perfectly|fine|great)?(?:\s+now)?|alt(?:\s+er)?\s+løst|det(?:\s+er)?\s+løst|det virker(?:\s+nu)?|virker\s+nu|fungerer(?:\s+nu)?|all good(?:\s+now)?|all set|you can close(?:\s+the\s+ticket)?|close\s+the\s+ticket)\b/i;
const EXPLICIT_CLOSE_CONFIRMATION_PATTERN =
  /\b(?:you can close(?:\s+the\s+ticket)?|close\s+the\s+ticket|issue(?:\s+is|'s)?\s+(?:resolved|fixed|solved)|problem(?:\s+is|'s)?\s+(?:resolved|fixed|solved)|it(?:\s+is|'s)?\s+(?:resolved|fixed|solved)|all good(?:\s+now)?|all set|alt(?:\s+er)?\s+løst|det(?:\s+er)?\s+løst)\b/i;
const QUESTION_SIGNAL_PATTERN =
  /(?:\?|\b(?:can|could|would|should|how|what|why|where|when|hvor|hvornår|hvordan|hvad|hvorfor|kan|skal)\b)/i;
const OPEN_ISSUE_PATTERN =
  /\b(?:problem|issue|doesn'?t|does not|not\s+work(?:ing)?|still|however|but|cost|price|who\s+needs\s+to\s+pay|hvem\s+skal\s+betale)\b/i;

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

function messageLooksLikeSatisfactionClosure(message = null) {
  if (!message) return false;
  const haystack = [message?.clean_body_text, message?.body_text, message?.snippet]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join("\n");
  if (!haystack) return false;
  const normalized = haystack.trim();
  const explicitClose = EXPLICIT_CLOSE_CONFIRMATION_PATTERN.test(normalized);
  if (QUESTION_SIGNAL_PATTERN.test(normalized) && !explicitClose) return false;
  if (OPEN_ISSUE_PATTERN.test(normalized) && !explicitClose) return false;
  if (!SATISFACTION_CLOSURE_PATTERN.test(normalized)) return false;
  // Keep this suggestion conservative: long detailed replies are rarely closure confirmations.
  if (normalized.length > 240 && !explicitClose) return false;
  return true;
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
  isDraftFetching = false,
  draftValue,
  onDraftChange,
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
  onRefineDraft = null,
  isRefiningDraft = false,
  staleDraft = false,
  onDismissStaleDraft = null,
  awaitingReturn = false,
  onMarkReturnReceived = null,
  markReturnReceivedLoading = false,
  translationItems = [],
  translationLoading = false,
  onRequestTranslation = null,
  detectedLanguage = null,
  tagsRefreshTrigger = 0,
}) {
  const [composerCollapsed, setComposerCollapsed] = useState(false);
  const [processReturnRestock, setProcessReturnRestock] = useState(true);
  const [dismissedCloseSuggestionByThread, setDismissedCloseSuggestionByThread] = useState({});
  const closeSuggestionEnabled = false; // Temporarily disabled until heuristics are reworked.
  const conversationRef = useRef(null);
  const restoredThreadIdRef = useRef(null);
  const initialScrollTopRef = useRef(0);
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
    initiate_return: "Initiate Return",
    fulfill_exchange: "Fulfill Exchange",
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
  const shouldSuggestCloseFromCustomerReply = useMemo(() => {
    const normalizedTicketStatus = String(ticketState?.status || "").trim().toLowerCase();
    if (normalizedTicketStatus === "solved" || normalizedTicketStatus === "resolved") return false;
    const threadId = String(thread?.id || "").trim();
    if (threadId && dismissedCloseSuggestionByThread[threadId]) return false;
    return messageLooksLikeSatisfactionClosure(latestInboundCustomerMessage);
  }, [dismissedCloseSuggestionByThread, latestInboundCustomerMessage, thread?.id, ticketState?.status]);
  const shouldShowTrackingCard = useMemo(() => {
    const hasTrackingData = Boolean(
      selectedOrderSummary?.tracking?.number || selectedOrderSummary?.tracking?.url
    );
    if (!hasTrackingData) return false;
    // Never show tracking card for return/exchange tickets — the order tracking is not relevant
    const classKey = String(thread?.classification_key || "").toLowerCase();
    const isReturnOrExchange = classKey === "return" || classKey === "exchange";
    const tags = Array.isArray(thread?.tags) ? thread.tags : [];
    const hasReturnTag = tags.some((t) => /^return/i.test(String(t || "")));
    if (isReturnOrExchange || hasReturnTag) return false;
    // Show for all tracking-categorised threads, or when the message looks like a tracking question
    const threadIsTracking = tags.includes("Tracking");
    return threadIsTracking || messageLooksLikeTrackingQuestion(latestInboundCustomerMessage);
  }, [
    thread?.tags,
    thread?.classification_key,
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
    initialScrollTopRef.current = Number(conversationScrollTop) || 0;
  }, [conversationScrollTop]);

  useEffect(() => {
    const node = conversationRef.current;
    if (!node) return;
    const threadId = String(thread?.id || "");
    if (!threadId) return;
    if (restoredThreadIdRef.current === threadId) return;
    const initialScrollTop = Number(initialScrollTopRef.current) || 0;
    // Restore saved scroll position if available, otherwise scroll to bottom (newest messages)
    if (Number.isFinite(initialScrollTop) && initialScrollTop > 0) {
      node.scrollTop = initialScrollTop;
    } else {
      node.scrollTop = node.scrollHeight;
    }
    restoredThreadIdRef.current = threadId;
  }, [thread?.id]);

  const threadMessageIdSet = useMemo(
    () => new Set((messages || []).map((msg) => String(msg?.id || "").trim()).filter(Boolean)),
    [messages]
  );
  const orphanThreadAttachments = useMemo(
    () =>
      (attachments || []).filter((attachment) => {
        const attachmentMessageId = String(attachment?.message_id || "").trim();
        return !attachmentMessageId || !threadMessageIdSet.has(attachmentMessageId);
      }),
    [attachments, threadMessageIdSet]
  );
  const latestInboundMessageWithoutOwnAttachmentsId = useMemo(() => {
    const rows = Array.isArray(messages) ? messages : [];
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const message = rows[index];
      if (!message || isOutboundMessage(message, mailboxEmails)) continue;
      const messageId = String(message?.id || "").trim();
      if (!messageId) continue;
      const hasPersisted = (attachments || []).some(
        (attachment) => String(attachment?.message_id || "").trim() === messageId
      );
      const hasEmbedded = Array.isArray(message?.attachments) && message.attachments.length > 0;
      if (!hasPersisted && !hasEmbedded) return messageId;
    }
    return "";
  }, [attachments, mailboxEmails, messages]);

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
  const threadTicketRef = Number.isFinite(Number(thread?.ticket_number))
    ? `T-${String(Number(thread.ticket_number)).padStart(6, "0")}`
    : "No ticket ID";
  const hasTicketNumber = threadTicketRef !== "No ticket ID";

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-sidebar lg:min-w-0">
      <header className="flex min-h-[58px] items-center justify-between border-b border-gray-100 bg-white px-4 py-1.5">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={`rounded px-2 py-0.5 font-mono text-[11px] tabular-nums ${
              hasTicketNumber
                ? "bg-slate-100 font-medium text-slate-600"
                : "text-slate-400"
            }`}
          >
            {threadTicketRef}
          </div>
          {headerActions ? <div className="flex shrink-0 items-center gap-2">{headerActions}</div> : null}
        </div>
        <div className="flex items-center gap-2">
          {rightHeaderActions}
        </div>
      </header>

      {false && <ThreadTagsBar threadId={thread.id} refreshTrigger={tagsRefreshTrigger} />}

      <div
        ref={conversationRef}
        className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={(event) => onConversationScroll?.(event.currentTarget.scrollTop)}
      >
        <div key={thread.id} className="animate-detail-enter mx-auto w-full max-w-[900px] space-y-2.5 px-4 pb-4 pt-3">
          {orderUpdateError && !shouldShowActionCard ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              {orderUpdateError}
            </div>
          ) : null}
          {messages.map((message) => {
            const direction = isOutboundMessage(message, mailboxEmails) ? "outbound" : "inbound";
            const messageId = String(message?.id || "").trim();
            const persistedAttachments = attachments.filter(
              (attachment) => String(attachment?.message_id || "").trim() === messageId
            );
            const bodyWithPlaceholders = String(
              message?.clean_body_text || message?.body_text || message?.snippet || ""
            );
            const inlineImagePlaceholderMatches = Array.from(
              bodyWithPlaceholders.matchAll(/\[([^\]]+\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp))\]/gi)
            )
              .map((match) => String(match?.[1] || "").trim().toLowerCase())
              .filter(Boolean);
            const inferredAttachments =
              !persistedAttachments.length && inlineImagePlaceholderMatches.length
                ? orphanThreadAttachments.filter((attachment) => {
                    const filename = String(attachment?.filename || "").trim().toLowerCase();
                    if (!filename) return false;
                    return inlineImagePlaceholderMatches.includes(filename);
                  })
                : [];
            const inferredLatestInboundFallbackAttachments =
              !persistedAttachments.length &&
              !inferredAttachments.length &&
              !Array.isArray(message?.attachments) &&
              messageId &&
              messageId === latestInboundMessageWithoutOwnAttachmentsId
                ? orphanThreadAttachments.filter((attachment) => {
                    const mimeType = String(attachment?.mime_type || "").trim().toLowerCase();
                    const filename = String(attachment?.filename || "").trim().toLowerCase();
                    return mimeType.startsWith("image/") || /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|tiff?|webp)$/.test(filename);
                  })
                : [];
            const messageAttachments =
              persistedAttachments.length || !Array.isArray(message?.attachments)
                ? persistedAttachments.length
                  ? persistedAttachments
                  : inferredAttachments.length
                    ? inferredAttachments
                    : inferredLatestInboundFallbackAttachments
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
                  translatedText={
                    (Array.isArray(translationItems) ? translationItems : []).find(
                      (item) => String(item?.id || "") === String(message?.id || "")
                    )?.translatedText || null
                  }
                  translationLoading={translationLoading}
                  onRequestTranslation={onRequestTranslation}
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
        <div className="flex-none border-t border-violet-100 bg-violet-50/60 px-4 py-2.5">
          <div className="mx-auto flex w-full max-w-[900px] items-center gap-2 text-[13px] text-violet-700">
            <Sparkles className="h-3.5 w-3.5 shrink-0 animate-pulse text-violet-500" />
            <span>Review the action above to proceed</span>
          </div>
        </div>
      ) : (
        <>
        {awaitingReturn && !shouldShowActionCard && (
          <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
            <Package className="h-3.5 w-3.5 shrink-0 text-blue-500" />
            <span className="flex-1">Afventer retur fra kunde</span>
            <button
              type="button"
              onClick={() => onMarkReturnReceived?.()}
              disabled={markReturnReceivedLoading}
              className="shrink-0 rounded-md bg-blue-600 px-2.5 py-1 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {markReturnReceivedLoading ? "..." : "Markér modtaget"}
            </button>
          </div>
        )}
        {/* {staleDraft && (
          <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            <span className="flex-1">Ny besked fra kunden — dit udkast er muligvis forældet.</span>
            <button
              type="button"
              onClick={() => onGenerateDraft?.()}
              className="shrink-0 font-medium underline underline-offset-2 hover:text-amber-900"
            >
              Regenerer
            </button>
            <button
              type="button"
              onClick={() => onDismissStaleDraft?.()}
              className="shrink-0 rounded p-0.5 hover:bg-amber-100"
              aria-label="Luk"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )} */}
        {closeSuggestionEnabled && shouldSuggestCloseFromCustomerReply && !shouldShowActionCard && (
          <div className="px-3 pb-1">
            <div className="mx-auto w-full max-w-[900px] rounded-xl border border-transparent bg-transparent px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex items-center gap-2 text-[13px] font-medium text-slate-700">
                  <span className="truncate">
                    Mark this ticket as solved.
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 shrink-0 border border-emerald-200 bg-white px-2.5 text-emerald-700 hover:bg-emerald-50"
                    onClick={() => onTicketStateChange?.({ status: "Solved" })}
                  >
                    Mark as solved
                  </Button>
                  <button
                    type="button"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-emerald-700 hover:bg-emerald-50"
                    aria-label="Dismiss suggestion"
                    title="Dismiss suggestion"
                    onClick={() => {
                      const threadId = String(thread?.id || "").trim();
                      if (!threadId) return;
                      setDismissedCloseSuggestionByThread((prev) => ({
                        ...prev,
                        [threadId]: true,
                      }));
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="px-3 pb-1.5">
          <Composer
            key={`${thread?.id || "thread"}:${composerMode}`}
            value={draftValue}
            onChange={(nextValue) => onDraftChange?.(nextValue, thread?.id || null)}
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
            isDraftLoading={showThinkingCard || isDraftFetching}
            onGenerateDraft={onGenerateDraft}
            isGeneratingDraft={isGeneratingDraft}
            onRefineDraft={onRefineDraft}
            isRefiningDraft={isRefiningDraft}
          />
        </div>
        </>
      )}
    </section>
  );
}
